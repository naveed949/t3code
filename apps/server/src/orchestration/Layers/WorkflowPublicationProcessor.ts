import {
  CommandId,
  type ChangeRequest,
  type OrchestrationEvent,
  type ThreadId,
  type WorkflowAttachment,
  type WorkflowPublication,
} from "@t3tools/contracts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { IssueTracker } from "../../nativeSkills/IssueTracker.ts";
import * as SourceControlProvider from "../../sourceControl/SourceControlProvider.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";

import {
  withWorkflowPublicationActions,
  workflowPublicationBlockers,
  workflowPublicationCommits,
} from "../WorkflowPublication.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";

type PublicationPreflightedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-publication-preflighted" }
>;
type PublicationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-publication-requested" }
>;
type PublicationObservationRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.workflow-publication-observation-requested" }
>;

export type WorkflowPublicationEvent =
  | PublicationPreflightedEvent
  | PublicationRequestedEvent
  | PublicationObservationRequestedEvent;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class WorkflowPublicationReconciliationError extends Data.TaggedError(
  "WorkflowPublicationReconciliationError",
)<{
  readonly detail: string;
}> {}

function publicationChangeRequestMismatch(input: {
  readonly publication: WorkflowPublication;
  readonly changeRequest: ChangeRequest;
  readonly allowPromotedDraft: boolean;
}): string | null {
  const { changeRequest, publication } = input;
  if (changeRequest.title !== publication.title) {
    return `Pull request #${changeRequest.number} has title ${JSON.stringify(changeRequest.title)} instead of the reviewed publication title.`;
  }
  if (changeRequest.isCrossRepository === true) {
    return `Pull request #${changeRequest.number} is cross-repository and cannot represent this Workstream publication.`;
  }
  if (changeRequest.isCrossRepository !== false) {
    return `Pull request #${changeRequest.number} did not provide verifiable same-repository source metadata.`;
  }
  if (
    publication.baselineCommit === null ||
    changeRequest.headCommitSha !== publication.baselineCommit
  ) {
    return `Pull request #${changeRequest.number} does not point at the reviewed Workstream Baseline commit.`;
  }
  if (!input.allowPromotedDraft && changeRequest.isDraft !== true) {
    return `Pull request #${changeRequest.number} is not a draft; publication will not adopt it.`;
  }
  return null;
}

export const makeWorkflowPublicationProcessor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService;
  const tracker = yield* IssueTracker;
  const providers = yield* SourceControlProviderRegistry;
  const receipts = yield* RuntimeReceiptBus;
  const fileSystem = yield* FileSystem.FileSystem;

  const serverCommandId = Effect.fn("WorkflowPublicationReactor.serverCommandId")(function* (
    tag: string,
  ) {
    return CommandId.make(`server:${tag}:${yield* crypto.randomUUIDv4}`);
  });

  const publishReceipt = Effect.fn("WorkflowPublicationReactor.publishReceipt")(function* (
    threadId: ThreadId,
    publication: WorkflowPublication,
    message: string | null,
  ) {
    yield* receipts.publish({
      type: "workflow.publication.progress",
      threadId,
      status: publication.status,
      createdAt: publication.updatedAt,
      message,
    });
  });

  const updatePublication = Effect.fn("WorkflowPublicationReactor.updatePublication")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly attachment: WorkflowAttachment;
      readonly publication: WorkflowPublication;
    }) {
      const currentVersion = input.attachment.workflowVersion ?? 0;
      const publication = withWorkflowPublicationActions(input.publication);
      yield* orchestrationEngine.dispatch({
        type: "thread.workflow.publication.update",
        commandId: yield* serverCommandId("workflow-publication-update"),
        threadId: input.threadId,
        publication,
        expectedWorkstreamVersion: currentVersion,
        createdAt: publication.updatedAt,
      });
      yield* publishReceipt(input.threadId, publication, publication.failure);
    },
  );

  const resolveIntegrationWorkspace = Effect.fn(
    "WorkflowPublicationReactor.resolveIntegrationWorkspace",
  )(function* (input: { readonly cwd: string; readonly baselineBranch: string }) {
    const refsResult = yield* git
      .listRefs({
        cwd: input.cwd,
        query: input.baselineBranch,
        includeMatchingRemoteRefs: false,
        refKind: "local",
        refresh: true,
      })
      .pipe(Effect.result);
    if (Result.isFailure(refsResult)) return null;
    const baselineRef = refsResult.success.refs.find((ref) => ref.name === input.baselineBranch);
    if (baselineRef === undefined) return null;
    if (baselineRef.worktreePath !== null) return baselineRef.worktreePath;
    const worktreeResult = yield* git
      .createWorktree({ cwd: input.cwd, refName: input.baselineBranch, path: null })
      .pipe(Effect.result);
    return Result.isSuccess(worktreeResult) ? worktreeResult.success.worktree.path : null;
  });

  const findExistingChangeRequest = Effect.fn(
    "WorkflowPublicationReactor.findExistingChangeRequest",
  )(function* (input: {
    readonly provider: SourceControlProvider.SourceControlProvider["Service"];
    readonly cwd: string;
    readonly publication: WorkflowPublication;
  }) {
    const requests = yield* input.provider
      .listChangeRequests({
        cwd: input.cwd,
        headSelector: input.publication.headBranch,
        state: "all",
        limit: 50,
      })
      .pipe(Effect.result);
    if (Result.isFailure(requests)) return yield* requests.failure;
    const sameHead = requests.success.filter(
      (request) => request.headRefName === input.publication.headBranch,
    );
    const matching = sameHead.filter(
      (request) => request.baseRefName === input.publication.targetBranch,
    );
    if (sameHead.length > 1) {
      return yield* new WorkflowPublicationReconciliationError({
        detail: `Multiple pull requests use Workstream head ${input.publication.headBranch}; reconcile the ambiguity before retrying.`,
      });
    }
    if (sameHead.length === 1 && matching.length === 0) {
      return yield* new WorkflowPublicationReconciliationError({
        detail: `Pull request for Workstream head ${input.publication.headBranch} targets a different base than ${input.publication.targetBranch}.`,
      });
    }
    const candidate = matching[0];
    if (candidate === undefined) return null;
    const wasRecorded = input.publication.changeRequest?.number === candidate.number;
    const mismatch = publicationChangeRequestMismatch({
      publication: input.publication,
      changeRequest: candidate,
      allowPromotedDraft: wasRecorded,
    });
    if (mismatch !== null) {
      return yield* new WorkflowPublicationReconciliationError({
        detail: mismatch,
      });
    }
    return candidate;
  });

  const observeTrackerState = Effect.fn("WorkflowPublicationReactor.observeTrackerState")(
    function* (input: {
      readonly cwd: string;
      readonly attachment: WorkflowAttachment;
      readonly observedAt: string;
    }) {
      const projected =
        input.attachment.trackerProjection?.canonicalReference ??
        input.attachment.ticketingStage?.trackerProjection?.canonicalReference;
      if (projected === undefined) {
        return yield* new WorkflowPublicationReconciliationError({
          detail: "The Workflow PRD tracker state is unavailable for publication reconciliation.",
        });
      }
      const repositoryResult = yield* tracker
        .resolveProjectRepository(input.cwd)
        .pipe(Effect.result);
      if (Result.isFailure(repositoryResult)) {
        return yield* new WorkflowPublicationReconciliationError({
          detail: `Workflow PRD repository resolution failed: ${failureMessage(repositoryResult.failure)}`,
        });
      }
      if (repositoryResult.success === null) {
        return yield* new WorkflowPublicationReconciliationError({
          detail:
            "The Workflow PRD repository could not be resolved for publication reconciliation.",
        });
      }
      const loadedResult = yield* tracker
        .loadWayfinderMap({
          cwd: input.cwd,
          repository: repositoryResult.success,
          issueNumber: projected.number,
          synchronizedAt: input.observedAt,
        })
        .pipe(Effect.result);
      if (Result.isFailure(loadedResult)) {
        return yield* new WorkflowPublicationReconciliationError({
          detail: `Workflow PRD tracker refresh failed: ${failureMessage(loadedResult.failure)}`,
        });
      }
      if (loadedResult.success.kind !== "loaded") {
        return yield* new WorkflowPublicationReconciliationError({
          detail: "The Workflow PRD tracker projection was truncated and could not verify closure.",
        });
      }
      return loadedResult.success.map.canonicalReference.state;
    },
  );

  const observePublication = Effect.fn("WorkflowPublicationReactor.observePublication")(
    function* (input: {
      readonly cwd: string;
      readonly provider: SourceControlProvider.SourceControlProvider["Service"];
      readonly attachment: WorkflowAttachment;
      readonly publication: WorkflowPublication;
      readonly observedAt: string;
    }) {
      const listed = yield* findExistingChangeRequest(input).pipe(Effect.result);
      if (Result.isFailure(listed)) {
        return {
          status: "needs-recovery" as const,
          ...(input.publication.changeRequest === undefined
            ? {}
            : { changeRequest: input.publication.changeRequest }),
          observedAt: input.observedAt,
          failure: failureMessage(listed.failure),
        };
      }
      let changeRequest: ChangeRequest | undefined =
        listed.success !== null ? listed.success : input.publication.changeRequest;
      if (changeRequest !== undefined) {
        const refreshed = yield* input.provider
          .getChangeRequest({ cwd: input.cwd, reference: String(changeRequest.number) })
          .pipe(Effect.result);
        if (Result.isFailure(refreshed)) {
          return {
            status: "needs-recovery" as const,
            changeRequest,
            observedAt: input.observedAt,
            failure: `Pull request refresh failed: ${failureMessage(refreshed.failure)}`,
          };
        }
        changeRequest = refreshed.success;
        const mismatch = publicationChangeRequestMismatch({
          publication: input.publication,
          changeRequest,
          allowPromotedDraft: input.publication.changeRequest?.number === changeRequest.number,
        });
        if (mismatch !== null) {
          return {
            status: "needs-recovery" as const,
            changeRequest,
            observedAt: input.observedAt,
            failure: mismatch,
          };
        }
      }
      const trackerResult = yield* observeTrackerState({
        cwd: input.cwd,
        attachment: input.attachment,
        observedAt: input.observedAt,
      }).pipe(Effect.result);
      if (Result.isFailure(trackerResult)) {
        return {
          status: "needs-recovery" as const,
          ...(changeRequest === undefined ? {} : { changeRequest }),
          observedAt: input.observedAt,
          failure: failureMessage(trackerResult.failure),
        };
      }
      const trackerState = trackerResult.success;
      if (changeRequest === undefined) {
        return {
          status: "needs-recovery" as const,
          changeRequest: undefined,
          ...(trackerState === undefined ? {} : { trackerState }),
          observedAt: input.observedAt,
          failure: "No matching Workstream pull request was found after publication.",
        };
      }
      const merged = changeRequest.state === "merged" && trackerState === "closed";
      return {
        status: merged ? ("merged" as const) : ("published-for-review" as const),
        changeRequest,
        ...(trackerState === undefined ? {} : { trackerState }),
        observedAt: input.observedAt,
        failure: null,
      };
    },
  );

  const writePublicationBody = Effect.fn("WorkflowPublicationReactor.writePublicationBody")(
    function* (publication: WorkflowPublication) {
      const bodyFile = yield* fileSystem.makeTempFileScoped({
        prefix: "t3-workflow-publication-",
        suffix: ".md",
      });
      yield* fileSystem.writeFileString(bodyFile, publication.body);
      return bodyFile;
    },
  );

  const processPreflight = Effect.fn("WorkflowPublicationReactor.processPreflight")(function* (
    event: PublicationPreflightedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const attachment = thread?.workflowAttachment ?? event.payload.attachment;
    const publication = attachment.publication;
    if (thread === undefined || publication === undefined || publication.status !== "previewing") {
      return;
    }
    yield* publishReceipt(thread.id, publication, "Previewing the validated Workstream Baseline.");
    const blockers = workflowPublicationBlockers(attachment);
    if (blockers.length > 0) {
      const blocked = {
        ...publication,
        status: "blocked" as const,
        baselineCommit: null,
        commits: [],
        authorityGranted: false,
        failure: blockers.join(" "),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: blocked });
      return;
    }
    const cwd = resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects });
    if (cwd === undefined) {
      const blocked = {
        ...publication,
        status: "blocked" as const,
        failure: "The Origin Thread has no resolvable project workspace.",
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: blocked });
      return;
    }
    const integrationCwd = yield* resolveIntegrationWorkspace({
      cwd,
      baselineBranch: publication.headBranch,
    });
    if (integrationCwd === null) {
      const blocked = {
        ...publication,
        status: "blocked" as const,
        failure: `The Workstream Baseline ${publication.headBranch} has no dedicated integration workspace.`,
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: blocked });
      return;
    }
    const providerResult = yield* providers
      .resolveHandle({ cwd: integrationCwd })
      .pipe(Effect.result);
    if (Result.isFailure(providerResult) || providerResult.success.provider.kind === "unknown") {
      const blocked = {
        ...publication,
        status: "blocked" as const,
        failure: "No supported source-control provider is available for the Workstream remote.",
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: blocked });
      return;
    }
    const previewResult = yield* git
      .previewPublication({
        cwd: integrationCwd,
        baselineBranch: publication.headBranch,
        fixedPoint: attachment.workflowRun?.configuration.fixedPoint ?? "",
        remoteTarget: publication.remoteTarget,
      })
      .pipe(Effect.result);
    if (Result.isFailure(previewResult)) {
      const blocked = {
        ...publication,
        status: "blocked" as const,
        failure: failureMessage(previewResult.failure),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: blocked });
      return;
    }
    if (previewResult.success.commits.length === 0) {
      const blocked = {
        ...publication,
        status: "blocked" as const,
        baselineCommit: previewResult.success.baselineCommit,
        commits: [],
        failure: "The Workstream Baseline has no commits beyond the verified Fixed Point.",
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: blocked });
      return;
    }
    const ready = {
      ...publication,
      status: "ready" as const,
      baselineCommit: previewResult.success.baselineCommit,
      commits: workflowPublicationCommits(previewResult.success.commits),
      authorityGranted: false,
      failure: null,
      updatedAt: event.occurredAt,
    } satisfies WorkflowPublication;
    yield* updatePublication({ threadId: thread.id, attachment, publication: ready });
  });

  const publishRequested = Effect.fn("WorkflowPublicationReactor.publishRequested")(function* (
    event: PublicationRequestedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const attachment = thread?.workflowAttachment ?? event.payload.attachment;
    const publication = attachment.publication;
    if (thread === undefined || publication === undefined || publication.status !== "publishing") {
      return;
    }
    yield* publishReceipt(
      thread.id,
      publication,
      "Publishing the approved draft Workstream pull request.",
    );
    const blockers = workflowPublicationBlockers(attachment);
    if (blockers.length > 0) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: blockers.join(" "),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const cwd = resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects });
    if (cwd === undefined) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: "The Origin Thread has no resolvable project workspace.",
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const integrationCwd = yield* resolveIntegrationWorkspace({
      cwd,
      baselineBranch: publication.headBranch,
    });
    if (integrationCwd === null) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: `The Workstream Baseline ${publication.headBranch} has no dedicated integration workspace.`,
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const providerResult = yield* providers
      .resolveHandle({ cwd: integrationCwd })
      .pipe(Effect.result);
    if (Result.isFailure(providerResult)) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: failureMessage(providerResult.failure),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const provider = providerResult.success.provider;
    const existing = yield* findExistingChangeRequest({
      provider,
      cwd: integrationCwd,
      publication,
    }).pipe(Effect.result);
    if (Result.isFailure(existing)) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: failureMessage(existing.failure),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    if (existing.success !== null) {
      const observed = yield* observePublication({
        cwd: integrationCwd,
        provider,
        attachment,
        publication: { ...publication, changeRequest: existing.success },
        observedAt: event.occurredAt,
      });
      yield* updatePublication({
        threadId: thread.id,
        attachment,
        publication: {
          ...publication,
          ...observed,
          updatedAt: event.occurredAt,
        },
      });
      return;
    }
    const currentPreview = yield* git
      .previewPublication({
        cwd: integrationCwd,
        baselineBranch: publication.headBranch,
        fixedPoint: attachment.workflowRun?.configuration.fixedPoint ?? "",
        remoteTarget: publication.remoteTarget,
      })
      .pipe(Effect.result);
    if (Result.isFailure(currentPreview)) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: `The approved publication could not be revalidated before push: ${failureMessage(currentPreview.failure)}`,
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const currentCommits = workflowPublicationCommits(currentPreview.success.commits);
    const previewMatches =
      currentPreview.success.baselineCommit === publication.baselineCommit &&
      currentCommits.length === publication.commits.length &&
      currentCommits.every(
        (commit, index) =>
          commit.sha === publication.commits[index]?.sha &&
          commit.title === publication.commits[index]?.title,
      );
    if (!previewMatches) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure:
          "The Workstream Baseline changed after approval; refresh the exact preview before publishing.",
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const pushResult = yield* git
      .pushCurrentBranch({
        cwd: integrationCwd,
        branch: publication.headBranch,
        remoteName: publication.remote,
      })
      .pipe(Effect.result);
    if (Result.isFailure(pushResult)) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: failureMessage(pushResult.failure),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const afterPush = yield* findExistingChangeRequest({
      provider,
      cwd: integrationCwd,
      publication,
    }).pipe(Effect.result);
    if (Result.isFailure(afterPush)) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: failureMessage(afterPush.failure),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    let changeRequest = afterPush.success;
    if (changeRequest === null) {
      const bodyFile = yield* writePublicationBody(publication);
      const createResult = yield* provider
        .createChangeRequest({
          cwd: integrationCwd,
          baseRefName: publication.targetBranch,
          headSelector: publication.headBranch,
          title: publication.title,
          bodyFile,
          draft: true,
        })
        .pipe(
          Effect.result,
          Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))),
        );
      if (Result.isFailure(createResult)) {
        const afterFailure = yield* findExistingChangeRequest({
          provider,
          cwd: integrationCwd,
          publication,
        }).pipe(Effect.result);
        if (Result.isFailure(afterFailure)) {
          const recovery = {
            ...publication,
            status: "needs-recovery" as const,
            failure: `${failureMessage(createResult.failure)} Reconciliation also failed: ${failureMessage(afterFailure.failure)}`,
            updatedAt: event.occurredAt,
          } satisfies WorkflowPublication;
          yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
          return;
        }
        changeRequest = afterFailure.success;
        if (changeRequest === null) {
          const recovery = {
            ...publication,
            status: "needs-recovery" as const,
            failure: failureMessage(createResult.failure),
            updatedAt: event.occurredAt,
          } satisfies WorkflowPublication;
          yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
          return;
        }
      } else {
        const afterCreate = yield* findExistingChangeRequest({
          provider,
          cwd: integrationCwd,
          publication,
        }).pipe(Effect.result);
        if (Result.isFailure(afterCreate)) {
          const recovery = {
            ...publication,
            status: "needs-recovery" as const,
            failure: `Draft pull request creation completed, but reconciliation failed: ${failureMessage(afterCreate.failure)}`,
            updatedAt: event.occurredAt,
          } satisfies WorkflowPublication;
          yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
          return;
        }
        changeRequest = afterCreate.success;
      }
    }
    if (changeRequest === null) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure:
          "The draft pull request was not visible after publication; reconcile before retrying.",
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const observed = yield* observePublication({
      cwd: integrationCwd,
      provider,
      attachment,
      publication: { ...publication, changeRequest },
      observedAt: event.occurredAt,
    });
    yield* updatePublication({
      threadId: thread.id,
      attachment,
      publication: { ...publication, ...observed, updatedAt: event.occurredAt },
    });
  });

  const observeRequested = Effect.fn("WorkflowPublicationReactor.observeRequested")(function* (
    event: PublicationObservationRequestedEvent,
  ) {
    const snapshot = yield* snapshots.getSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === event.payload.threadId);
    const attachment = thread?.workflowAttachment ?? event.payload.attachment;
    const publication = attachment.publication;
    if (
      thread === undefined ||
      publication === undefined ||
      !["publishing", "published-for-review", "needs-recovery"].includes(publication.status)
    ) {
      return;
    }
    const cwd = resolveThreadWorkspaceCwd({ thread, projects: snapshot.projects });
    if (cwd === undefined) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: "The Origin Thread has no resolvable project workspace.",
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const integrationCwd = yield* resolveIntegrationWorkspace({
      cwd,
      baselineBranch: publication.headBranch,
    });
    if (integrationCwd === null) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: `The Workstream Baseline ${publication.headBranch} has no dedicated integration workspace.`,
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const providerResult = yield* providers
      .resolveHandle({ cwd: integrationCwd })
      .pipe(Effect.result);
    if (Result.isFailure(providerResult)) {
      const recovery = {
        ...publication,
        status: "needs-recovery" as const,
        failure: failureMessage(providerResult.failure),
        updatedAt: event.occurredAt,
      } satisfies WorkflowPublication;
      yield* updatePublication({ threadId: thread.id, attachment, publication: recovery });
      return;
    }
    const observed = yield* observePublication({
      cwd: integrationCwd,
      provider: providerResult.success.provider,
      attachment,
      publication,
      observedAt: event.occurredAt,
    });
    yield* updatePublication({
      threadId: thread.id,
      attachment,
      publication: { ...publication, ...observed, updatedAt: event.occurredAt },
    });
  });

  return Effect.fn("WorkflowPublicationReactor.processEvent")(function* (
    event: WorkflowPublicationEvent,
  ) {
    switch (event.type) {
      case "thread.workflow-publication-preflighted":
        yield* processPreflight(event);
        return;
      case "thread.workflow-publication-requested":
        yield* publishRequested(event);
        return;
      case "thread.workflow-publication-observation-requested":
        yield* observeRequested(event);
        return;
    }
  });
});
