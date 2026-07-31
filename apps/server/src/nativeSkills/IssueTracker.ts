import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import type {
  WayfinderDraftTicketClassification,
  WayfinderMapField,
  WayfinderMapProjection,
} from "@t3tools/contracts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { projectWayfinderMap } from "./WayfinderMapProjection.ts";

export interface IssueTrackerRepository {
  readonly canonicalKey: string;
  readonly owner: string;
  readonly name: string;
}

export interface IssueTrackerCapabilities {
  readonly supportsIssues: boolean;
  readonly canWriteIssues: boolean;
  readonly supportsChildRelationships: boolean;
  readonly supportsBlockingRelationships: boolean;
  readonly labels: ReadonlyArray<string>;
}

export interface IssueTrackerIssue {
  readonly number: number;
  readonly url: string;
}

export interface IssueTrackerClaim {
  readonly viewerLogin: string;
}

export type WayfinderMapLoadResult =
  | { readonly kind: "loaded"; readonly map: WayfinderMapProjection }
  | { readonly kind: "not-wayfinder-map" }
  | { readonly kind: "truncated" };

export type WayfinderMapReconciliationResult =
  | WayfinderMapLoadResult
  | { readonly kind: "unchanged"; readonly revision: string };

export class IssueTracker extends Context.Service<
  IssueTracker,
  {
    readonly resolveProjectRepository: (
      cwd: string,
    ) => Effect.Effect<IssueTrackerRepository | null>;
    readonly inspectCapabilities: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
    }) => Effect.Effect<IssueTrackerCapabilities>;
    readonly resolveIssue: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly reference: string;
    }) => Effect.Effect<IssueTrackerIssue | null>;
    readonly loadWayfinderMap: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly synchronizedAt: string;
    }) => Effect.Effect<WayfinderMapLoadResult>;
    readonly reconcileWayfinderMap: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly synchronizedAt: string;
      readonly currentRevision?: string;
    }) => Effect.Effect<WayfinderMapReconciliationResult, GitHubCli.GitHubCliError>;
    readonly claimIssue: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
    }) => Effect.Effect<IssueTrackerClaim, GitHubCli.GitHubCliError>;
    readonly releaseIssue: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly ensureLabel: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly name: string;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly createIssue: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly key: string;
      readonly idempotencyKey: string;
      readonly title: string;
      readonly body: string;
      readonly labels: ReadonlyArray<string>;
    }) => Effect.Effect<IssueTrackerIssue, GitHubCli.GitHubCliError>;
    readonly addChild: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly parentNumber: number;
      readonly childNumber: number;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly addBlockedBy: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly blockedNumber: number;
      readonly blockerNumber: number;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly updateWayfinderMapField: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly field: WayfinderMapField;
      readonly value: string;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly updateWayfinderDecisions: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly value: string;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly updateIssueTitle: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly title: string;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly setWayfinderClassification: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly previous: WayfinderDraftTicketClassification | "unknown";
      readonly classification: WayfinderDraftTicketClassification;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly removeChild: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly parentNumber: number;
      readonly childNumber: number;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly removeBlockedBy: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly blockedNumber: number;
      readonly blockerNumber: number;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly addIssueComment: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly body: string;
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
    readonly setIssueState: (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly state: "open" | "closed";
    }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
  }
>()("t3/nativeSkills/IssueTracker") {}

const RepositoryProbe = Schema.Struct({
  hasIssuesEnabled: Schema.Boolean,
  viewerPermission: Schema.String,
});
const LabelsProbe = Schema.Array(Schema.Struct({ name: Schema.String }));
const IssueProbe = Schema.Struct({ number: Schema.Number, url: Schema.String });
const IssueBodyProbe = Schema.Struct({ body: Schema.String });
const ViewerProbe = Schema.Struct({ login: Schema.String });
const IssueClaimProbe = Schema.Struct({
  state: Schema.Literals(["OPEN", "CLOSED"]),
  assignees: Schema.Array(Schema.Struct({ login: Schema.String })),
});
const IssueTypeFieldsProbe = Schema.Struct({
  data: Schema.Struct({
    __type: Schema.Struct({ fields: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  }),
});
const ConnectionPageInfo = Schema.Struct({ hasNextPage: Schema.Boolean });
const WayfinderMapProbe = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      issue: Schema.NullOr(
        Schema.Struct({
          number: Schema.Number,
          title: Schema.String,
          url: Schema.String,
          state: Schema.Literals(["OPEN", "CLOSED"]),
          updatedAt: Schema.optional(Schema.String),
          comments: Schema.optional(
            Schema.Struct({
              totalCount: Schema.Number,
              nodes: Schema.Array(Schema.Struct({ updatedAt: Schema.String })),
            }),
          ),
          labels: Schema.Struct({
            nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
            pageInfo: ConnectionPageInfo,
          }),
          body: Schema.String,
          subIssues: Schema.Struct({
            nodes: Schema.Array(
              Schema.Struct({
                number: Schema.Number,
                title: Schema.String,
                url: Schema.String,
                state: Schema.Literals(["OPEN", "CLOSED"]),
                updatedAt: Schema.optional(Schema.String),
                comments: Schema.optional(
                  Schema.Struct({
                    totalCount: Schema.Number,
                    nodes: Schema.Array(Schema.Struct({ updatedAt: Schema.String })),
                  }),
                ),
                assignees: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ login: Schema.String })),
                  pageInfo: ConnectionPageInfo,
                }),
                labels: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
                  pageInfo: ConnectionPageInfo,
                }),
                blockedBy: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.Struct({
                      number: Schema.Number,
                      state: Schema.Literals(["OPEN", "CLOSED"]),
                    }),
                  ),
                  pageInfo: ConnectionPageInfo,
                }),
                blocking: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ number: Schema.Number })),
                  pageInfo: ConnectionPageInfo,
                }),
              }),
            ),
            pageInfo: ConnectionPageInfo,
          }),
        }),
      ),
    }),
  }),
});
const decodeRepositoryProbe = Schema.decodeUnknownOption(Schema.fromJsonString(RepositoryProbe));
const decodeLabelsProbe = Schema.decodeUnknownOption(Schema.fromJsonString(LabelsProbe));
const decodeIssueProbe = Schema.decodeUnknownOption(Schema.fromJsonString(IssueProbe));
const decodeIssueBodyProbe = Schema.decodeUnknownOption(Schema.fromJsonString(IssueBodyProbe));
const decodeViewerProbe = Schema.decodeUnknownOption(Schema.fromJsonString(ViewerProbe));
const decodeIssueClaimProbe = Schema.decodeUnknownOption(Schema.fromJsonString(IssueClaimProbe));
const decodeIssueTypeFieldsProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(IssueTypeFieldsProbe),
);
const decodeWayfinderMapProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(WayfinderMapProbe),
);
const WayfinderRevisionProbe = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      issue: Schema.NullOr(
        Schema.Struct({
          number: Schema.Number,
          title: Schema.String,
          state: Schema.Literals(["OPEN", "CLOSED"]),
          updatedAt: Schema.String,
          comments: Schema.Struct({
            totalCount: Schema.Number,
            nodes: Schema.Array(Schema.Struct({ updatedAt: Schema.String })),
          }),
          labels: Schema.Struct({
            nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
            pageInfo: ConnectionPageInfo,
          }),
          subIssues: Schema.Struct({
            nodes: Schema.Array(
              Schema.Struct({
                number: Schema.Number,
                title: Schema.String,
                state: Schema.Literals(["OPEN", "CLOSED"]),
                updatedAt: Schema.String,
                comments: Schema.Struct({
                  totalCount: Schema.Number,
                  nodes: Schema.Array(Schema.Struct({ updatedAt: Schema.String })),
                }),
                assignees: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ login: Schema.String })),
                  pageInfo: ConnectionPageInfo,
                }),
                labels: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
                  pageInfo: ConnectionPageInfo,
                }),
                blockedBy: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.Struct({
                      number: Schema.Number,
                      state: Schema.Literals(["OPEN", "CLOSED"]),
                    }),
                  ),
                  pageInfo: ConnectionPageInfo,
                }),
                blocking: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ number: Schema.Number })),
                  pageInfo: ConnectionPageInfo,
                }),
              }),
            ),
            pageInfo: ConnectionPageInfo,
          }),
        }),
      ),
    }),
  }),
});
const decodeWayfinderRevisionProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(WayfinderRevisionProbe),
);
const IssueNodeProbe = Schema.Struct({ id: Schema.String });
const decodeIssueNodeProbe = Schema.decodeUnknownOption(Schema.fromJsonString(IssueNodeProbe));
const IssueListProbe = Schema.Array(
  Schema.Struct({
    number: Schema.Number,
    url: Schema.String,
    body: Schema.String,
  }),
);
const decodeIssueListProbe = Schema.decodeUnknownOption(Schema.fromJsonString(IssueListProbe));
const CreatedIssueProbe = Schema.Struct({
  number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});
const decodeCreatedIssueProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(CreatedIssueProbe),
);
const ChildNumbersProbe = Schema.Struct({
  data: Schema.Struct({
    node: Schema.Struct({
      subIssues: Schema.Struct({
        nodes: Schema.Array(Schema.Struct({ number: Schema.Number })),
      }),
    }),
  }),
});
const BlockerNumbersProbe = Schema.Struct({
  data: Schema.Struct({
    node: Schema.Struct({
      blockedBy: Schema.Struct({
        nodes: Schema.Array(Schema.Struct({ number: Schema.Number })),
      }),
    }),
  }),
});
const decodeChildNumbersProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(ChildNumbersProbe),
);
const decodeBlockerNumbersProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(BlockerNumbersProbe),
);

const noCapabilities: IssueTrackerCapabilities = {
  supportsIssues: false,
  canWriteIssues: false,
  supportsChildRelationships: false,
  supportsBlockingRelationships: false,
  labels: [],
};

const writePermission = new Set(["ADMIN", "MAINTAIN", "WRITE"]);
const GitHubIssueNumber = Schema.Int.check(Schema.isGreaterThan(0));

function repositoryReference(repository: IssueTrackerRepository): string {
  return `${repository.owner}/${repository.name}`;
}

const mapFieldHeading: Record<WayfinderMapField, string> = {
  destination: "Destination",
  notes: "Notes",
  "fog-of-war": "Not Yet Specified",
  "out-of-scope": "Out of Scope",
};

export function replaceWayfinderMapSection(
  body: string,
  field: WayfinderMapField,
  value: string,
): string {
  return replaceMapSection(body, mapFieldHeading[field], value);
}

function replaceMapSection(body: string, heading: string, value: string): string {
  const lines = body.split(/\r?\n/u);
  const headingIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase(),
  );
  const replacement = [`## ${heading}`, "", value.trim()];
  if (headingIndex < 0)
    return [...lines, ...(body.endsWith("\n") ? [] : [""]), ...replacement].join("\n");
  const nextHeadingOffset = lines
    .slice(headingIndex + 1)
    .findIndex(
      (line) => /^##\s+/u.test(line) || /^\s*<!--\s*t3-wayfinder-publication:/u.test(line),
    );
  const end = nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset;
  return [...lines.slice(0, headingIndex), ...replacement, "", ...lines.slice(end)].join("\n");
}

function wayfinderRevision(issue: {
  readonly number: number;
  readonly title: string;
  readonly state: "OPEN" | "CLOSED";
  readonly updatedAt: string | undefined;
  readonly comments:
    | {
        readonly totalCount: number;
        readonly nodes: ReadonlyArray<{ readonly updatedAt: string }>;
      }
    | undefined;
  readonly labels?: { readonly nodes: ReadonlyArray<{ readonly name: string }> };
  readonly subIssues: {
    readonly nodes: ReadonlyArray<{
      readonly number: number;
      readonly title?: string;
      readonly state?: "OPEN" | "CLOSED";
      readonly updatedAt: string | undefined;
      readonly comments:
        | {
            readonly totalCount: number;
            readonly nodes: ReadonlyArray<{ readonly updatedAt: string }>;
          }
        | undefined;
      readonly assignees?: {
        readonly nodes: ReadonlyArray<{ readonly login: string }>;
      };
      readonly labels?: { readonly nodes: ReadonlyArray<{ readonly name: string }> };
      readonly blockedBy?: {
        readonly nodes: ReadonlyArray<{
          readonly number: number;
          readonly state: "OPEN" | "CLOSED";
        }>;
      };
      readonly blocking?: { readonly nodes: ReadonlyArray<{ readonly number: number }> };
    }>;
  };
}): string {
  const issueEvidence = [
    issue.number,
    issue.title,
    issue.state,
    issue.updatedAt ?? "",
    issue.comments?.totalCount ?? 0,
    issue.comments?.nodes[0]?.updatedAt ?? "",
    issue.labels?.nodes.map((label) => label.name).sort() ?? [],
  ];
  const ticketEvidence = issue.subIssues.nodes
    .map((ticket) => [
      ticket.number,
      ticket.title ?? "",
      ticket.state ?? "OPEN",
      ticket.updatedAt ?? "",
      ticket.comments?.totalCount ?? 0,
      ticket.comments?.nodes[0]?.updatedAt ?? "",
      ticket.assignees?.nodes.map((assignee) => assignee.login).sort() ?? [],
      ticket.labels?.nodes.map((label) => label.name).sort() ?? [],
      ticket.blockedBy?.nodes
        .map((blocker) => [blocker.number, blocker.state] as const)
        .sort(([left], [right]) => left - right) ?? [],
      ticket.blocking?.nodes.map((blocked) => blocked.number).sort((a, b) => a - b) ?? [],
    ])
    .sort(([left], [right]) => Number(left) - Number(right));
  return `github:${JSON.stringify([issueEvidence, ticketEvidence])}`;
}

function gitHubIssueReferenceSchema(repository: IssueTrackerRepository) {
  const invalidReference = (reference: string) =>
    new SchemaIssue.InvalidValue(Option.some(reference), {
      message: `Expected an issue number or ${repositoryReference(repository)} GitHub issue URL`,
    });
  return Schema.String.pipe(
    Schema.decodeTo(
      GitHubIssueNumber,
      SchemaTransformation.transformOrFail({
        decode: (reference) => {
          const trimmed = reference.trim();
          const numberReference = /^#?(\d+)$/u.exec(trimmed)?.[1];
          if (numberReference !== undefined) {
            return Effect.succeed(Number(numberReference));
          }
          return Effect.try({
            try: () => new URL(trimmed),
            catch: () => invalidReference(reference),
          }).pipe(
            Effect.flatMap((url) => {
              const [, owner, name, kind, issueNumber, trailing] = url.pathname.split("/");
              return url.hostname === "github.com" &&
                owner?.toLowerCase() === repository.owner.toLowerCase() &&
                name?.toLowerCase() === repository.name.toLowerCase() &&
                kind === "issues" &&
                issueNumber !== undefined &&
                (trailing === undefined || trailing === "") &&
                /^\d+$/u.test(issueNumber)
                ? Effect.succeed(Number(issueNumber))
                : Effect.fail(invalidReference(reference));
            }),
          );
        },
        encode: (number) => Effect.succeed(String(number)),
      }),
    ),
  );
}

function resolveGitHubIssueReference(
  repository: IssueTrackerRepository,
  reference: string,
): string | null {
  return Schema.decodeUnknownOption(gitHubIssueReferenceSchema(repository))(reference).pipe(
    Option.map(String),
    Option.getOrNull,
  );
}

export const GitHubIssueTrackerLive = Layer.effect(
  IssueTracker,
  Effect.gen(function* () {
    const github = yield* GitHubCli.GitHubCli;
    const repositories = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
    const loadIssueNodeId = Effect.fn("IssueTracker.loadIssueNodeId")(function* (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
    }) {
      const output = yield* github.execute({
        cwd: input.cwd,
        args: [
          "issue",
          "view",
          String(input.issueNumber),
          "--repo",
          repositoryReference(input.repository),
          "--json",
          "id",
        ],
      });
      const decoded = decodeIssueNodeProbe(output.stdout);
      if (Option.isSome(decoded)) return decoded.value.id;
      return yield* new GitHubCli.GitHubCliCommandError({
        command: "gh",
        cwd: input.cwd,
        cause: new Error(`GitHub returned no node id for issue #${input.issueNumber}.`),
      });
    });
    const updateIssueBody = Effect.fn("IssueTracker.updateIssueBody")(function* (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly transform: (body: string) => string;
    }) {
      const current = yield* github.execute({
        cwd: input.cwd,
        args: [
          "issue",
          "view",
          String(input.issueNumber),
          "--repo",
          repositoryReference(input.repository),
          "--json",
          "body",
        ],
      });
      const decoded = decodeIssueBodyProbe(current.stdout);
      if (Option.isNone(decoded)) {
        return yield* new GitHubCli.GitHubCliCommandError({
          command: "gh",
          cwd: input.cwd,
          cause: new Error(`GitHub returned no body for map #${input.issueNumber}.`),
        });
      }
      yield* github.execute({
        cwd: input.cwd,
        args: [
          "issue",
          "edit",
          String(input.issueNumber),
          "--repo",
          repositoryReference(input.repository),
          "--body",
          input.transform(decoded.value.body),
        ],
      });
    });

    const loadWayfinderMapEffect = Effect.fn("IssueTracker.loadWayfinderMapEffect")(
      function* (input: {
        readonly cwd: string;
        readonly repository: IssueTrackerRepository;
        readonly issueNumber: number;
        readonly synchronizedAt: string;
      }) {
        const output = yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            `query=query($owner:String!,$name:String!,$number:Int!){
              repository(owner:$owner,name:$name){
                issue(number:$number){
                  number title url state body updatedAt
                  comments(last:1){totalCount nodes{updatedAt}}
                  labels(first:100){nodes{name} pageInfo{hasNextPage}}
                  subIssues(first:100){
                    nodes{
                      number title url state updatedAt
                      comments(last:1){totalCount nodes{updatedAt}}
                      assignees(first:100){nodes{login} pageInfo{hasNextPage}}
                      labels(first:100){nodes{name} pageInfo{hasNextPage}}
                      blockedBy(first:100){nodes{number state} pageInfo{hasNextPage}}
                      blocking(first:100){nodes{number} pageInfo{hasNextPage}}
                    }
                    pageInfo{hasNextPage}
                  }
                }
              }
            }`,
            "-F",
            `owner=${input.repository.owner}`,
            "-F",
            `name=${input.repository.name}`,
            "-F",
            `number=${input.issueNumber}`,
          ],
        });
        const probe = decodeWayfinderMapProbe(output.stdout);
        const issue = Option.isSome(probe) ? probe.value.data.repository.issue : null;
        const isTruncated =
          issue?.labels.pageInfo.hasNextPage ||
          issue?.subIssues.pageInfo.hasNextPage ||
          issue?.subIssues.nodes.some(
            (ticket) =>
              ticket.assignees.pageInfo.hasNextPage ||
              ticket.labels.pageInfo.hasNextPage ||
              ticket.blockedBy.pageInfo.hasNextPage ||
              ticket.blocking.pageInfo.hasNextPage,
          );
        if (issue && isTruncated) return { kind: "truncated" as const };
        const normalizedIssue = issue
          ? {
              ...issue,
              updatedAt: issue.updatedAt,
              comments: issue.comments,
              subIssues: {
                ...issue.subIssues,
                nodes: issue.subIssues.nodes.map((ticket) => ({
                  ...ticket,
                  updatedAt: ticket.updatedAt,
                  comments: ticket.comments,
                })),
              },
            }
          : null;
        return issue?.labels.nodes.some((label) => label.name === "wayfinder:map")
          ? {
              kind: "loaded" as const,
              map: projectWayfinderMap(
                normalizedIssue!,
                input.synchronizedAt,
                issue.updatedAt === undefined ? undefined : wayfinderRevision(normalizedIssue!),
              ),
            }
          : { kind: "not-wayfinder-map" as const };
      },
    );
    const loadViewerLogin = Effect.fn("IssueTracker.loadViewerLogin")(function* (cwd: string) {
      const output = yield* github.execute({ cwd, args: ["api", "user"] });
      const viewer = decodeViewerProbe(output.stdout);
      if (Option.isSome(viewer) && viewer.value.login.trim() !== "") {
        return viewer.value.login;
      }
      return yield* new GitHubCli.GitHubCliCommandError({
        command: "gh",
        cwd,
        cause: new Error("GitHub returned no authenticated viewer login."),
      });
    });
    const loadIssueClaim = Effect.fn("IssueTracker.loadIssueClaim")(function* (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
    }) {
      const output = yield* github.execute({
        cwd: input.cwd,
        args: [
          "issue",
          "view",
          String(input.issueNumber),
          "--repo",
          repositoryReference(input.repository),
          "--json",
          "state,assignees",
        ],
      });
      const claim = decodeIssueClaimProbe(output.stdout);
      if (Option.isSome(claim)) return claim.value;
      return yield* new GitHubCli.GitHubCliCommandError({
        command: "gh",
        cwd: input.cwd,
        cause: new Error(`GitHub returned no claim state for issue #${input.issueNumber}.`),
      });
    });
    const editViewerAssignment = Effect.fn("IssueTracker.editViewerAssignment")(function* (input: {
      readonly cwd: string;
      readonly repository: IssueTrackerRepository;
      readonly issueNumber: number;
      readonly operation: "add" | "remove";
    }) {
      yield* github.execute({
        cwd: input.cwd,
        args: [
          "issue",
          "edit",
          String(input.issueNumber),
          "--repo",
          repositoryReference(input.repository),
          input.operation === "add" ? "--add-assignee" : "--remove-assignee",
          "@me",
        ],
      });
    });

    return IssueTracker.of({
      resolveProjectRepository: Effect.fn("IssueTracker.resolveProjectRepository")(function* (cwd) {
        const identity = yield* repositories.resolve(cwd);
        return identity?.provider === "github" && identity.owner && identity.name
          ? {
              canonicalKey: identity.canonicalKey,
              owner: identity.owner,
              name: identity.name,
            }
          : null;
      }),
      inspectCapabilities: Effect.fn("IssueTracker.inspectCapabilities")(function* (input) {
        const repository = repositoryReference(input.repository);
        const repositoryOutput = yield* github
          .execute({
            cwd: input.cwd,
            args: ["repo", "view", repository, "--json", "hasIssuesEnabled,viewerPermission"],
          })
          .pipe(Effect.option);
        if (Option.isNone(repositoryOutput)) return noCapabilities;
        const parsedRepository = decodeRepositoryProbe(repositoryOutput.value.stdout);
        if (Option.isNone(parsedRepository)) return noCapabilities;

        const labelsOutput = yield* github
          .execute({
            cwd: input.cwd,
            args: ["label", "list", "--repo", repository, "--json", "name", "--limit", "1000"],
          })
          .pipe(Effect.option);
        const labels = labelsOutput.pipe(
          Option.flatMap((result) => decodeLabelsProbe(result.stdout)),
          Option.getOrElse(() => []),
        );

        const relationshipOutput = yield* github
          .execute({
            cwd: input.cwd,
            args: ["api", "graphql", "-f", 'query={__type(name:"Mutation"){fields{name}}}'],
          })
          .pipe(Effect.option);
        const fields = Option.match(
          relationshipOutput.pipe(
            Option.flatMap((output) => decodeIssueTypeFieldsProbe(output.stdout)),
          ),
          {
            onNone: () => new Set<string>(),
            onSome: (probe) => new Set(probe.data.__type.fields.map((field) => field.name)),
          },
        );
        const canWriteIssues = writePermission.has(parsedRepository.value.viewerPermission);
        return {
          supportsIssues: parsedRepository.value.hasIssuesEnabled,
          canWriteIssues,
          supportsChildRelationships:
            canWriteIssues && fields.has("addSubIssue") && fields.has("removeSubIssue"),
          supportsBlockingRelationships:
            canWriteIssues && fields.has("addBlockedBy") && fields.has("removeBlockedBy"),
          labels: labels.map((label) => label.name),
        };
      }),
      resolveIssue: Effect.fn("IssueTracker.resolveIssue")(function* (input) {
        const reference = resolveGitHubIssueReference(input.repository, input.reference);
        if (reference === null) return null;
        const output = yield* github
          .execute({
            cwd: input.cwd,
            args: [
              "issue",
              "view",
              reference,
              "--repo",
              repositoryReference(input.repository),
              "--json",
              "number,url",
            ],
          })
          .pipe(Effect.option);
        return Option.match(
          output.pipe(Option.flatMap((result) => decodeIssueProbe(result.stdout))),
          {
            onNone: () => null,
            onSome: (issue) => issue,
          },
        );
      }),
      loadWayfinderMap: Effect.fn("IssueTracker.loadWayfinderMap")(function* (input) {
        const loaded = yield* loadWayfinderMapEffect(input).pipe(Effect.option);
        return Option.getOrElse(loaded, () => ({ kind: "not-wayfinder-map" as const }));
      }),
      reconcileWayfinderMap: Effect.fn("IssueTracker.reconcileWayfinderMap")(function* (input) {
        if (input.currentRevision !== undefined) {
          const output = yield* github.execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              `query=query($owner:String!,$name:String!,$number:Int!){
                repository(owner:$owner,name:$name){
                  issue(number:$number){
                    number title state updatedAt
                    comments(last:1){totalCount nodes{updatedAt}}
                    labels(first:100){nodes{name} pageInfo{hasNextPage}}
                    subIssues(first:100){
                      nodes{
                        number title state updatedAt
                        comments(last:1){totalCount nodes{updatedAt}}
                        assignees(first:100){nodes{login} pageInfo{hasNextPage}}
                        labels(first:100){nodes{name} pageInfo{hasNextPage}}
                        blockedBy(first:100){nodes{number state} pageInfo{hasNextPage}}
                        blocking(first:100){nodes{number} pageInfo{hasNextPage}}
                      }
                      pageInfo{hasNextPage}
                    }
                  }
                }
              }`,
              "-F",
              `owner=${input.repository.owner}`,
              "-F",
              `name=${input.repository.name}`,
              "-F",
              `number=${input.issueNumber}`,
            ],
          });
          const probe = decodeWayfinderRevisionProbe(output.stdout);
          const issue = Option.isSome(probe) ? probe.value.data.repository.issue : null;
          const isTruncated =
            issue?.labels.pageInfo.hasNextPage ||
            issue?.subIssues.pageInfo.hasNextPage ||
            issue?.subIssues.nodes.some(
              (ticket) =>
                ticket.assignees.pageInfo.hasNextPage ||
                ticket.labels.pageInfo.hasNextPage ||
                ticket.blockedBy.pageInfo.hasNextPage ||
                ticket.blocking.pageInfo.hasNextPage,
            );
          if (issue && isTruncated) return { kind: "truncated" };
          if (issue) {
            const revision = wayfinderRevision(issue);
            if (revision === input.currentRevision) return { kind: "unchanged", revision };
          }
        }
        return yield* loadWayfinderMapEffect(input);
      }),
      claimIssue: Effect.fn("IssueTracker.claimIssue")(function* (input) {
        const viewerLogin = yield* loadViewerLogin(input.cwd);
        const before = yield* loadIssueClaim(input);
        if (before.state !== "OPEN") {
          return yield* new GitHubCli.GitHubCliCommandError({
            command: "gh",
            cwd: input.cwd,
            cause: new Error(`Issue #${input.issueNumber} is closed and cannot be claimed.`),
          });
        }
        const currentOwner = before.assignees[0]?.login;
        if (currentOwner === viewerLogin) {
          return { viewerLogin };
        }
        if (currentOwner !== undefined) {
          return yield* new GitHubCli.GitHubCliCommandError({
            command: "gh",
            cwd: input.cwd,
            cause: new Error(`Issue #${input.issueNumber} is already claimed by ${currentOwner}.`),
          });
        }

        yield* editViewerAssignment({ ...input, operation: "add" });
        const after = yield* loadIssueClaim(input);
        if (after.state === "OPEN" && after.assignees[0]?.login === viewerLogin) {
          return { viewerLogin };
        }
        if (after.assignees.some((assignee) => assignee.login === viewerLogin)) {
          yield* editViewerAssignment({ ...input, operation: "remove" });
        }
        return yield* new GitHubCli.GitHubCliCommandError({
          command: "gh",
          cwd: input.cwd,
          cause: new Error(`Issue #${input.issueNumber} was claimed concurrently.`),
        });
      }),
      releaseIssue: Effect.fn("IssueTracker.releaseIssue")(function* (input) {
        const viewerLogin = yield* loadViewerLogin(input.cwd);
        const claim = yield* loadIssueClaim(input);
        if (!claim.assignees.some((assignee) => assignee.login === viewerLogin)) {
          return yield* new GitHubCli.GitHubCliCommandError({
            command: "gh",
            cwd: input.cwd,
            cause: new Error(`Issue #${input.issueNumber} is not claimed by ${viewerLogin}.`),
          });
        }
        yield* editViewerAssignment({ ...input, operation: "remove" });
      }),
      ensureLabel: Effect.fn("IssueTracker.ensureLabel")(function* (input) {
        const existingOutput = yield* github.execute({
          cwd: input.cwd,
          args: [
            "label",
            "list",
            "--repo",
            repositoryReference(input.repository),
            "--search",
            input.name,
            "--json",
            "name",
            "--limit",
            "100",
          ],
        });
        const existing = decodeLabelsProbe(existingOutput.stdout);
        if (Option.isSome(existing) && existing.value.some((label) => label.name === input.name)) {
          return;
        }
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "label",
            "create",
            input.name,
            "--repo",
            repositoryReference(input.repository),
            "--color",
            "5319E7",
            "--description",
            "Managed by the Wayfinder Workbench",
          ],
        });
      }),
      createIssue: Effect.fn("IssueTracker.createIssue")(function* (input) {
        const encodedIdempotencyKey = encodeURIComponent(input.idempotencyKey);
        const marker = `<!-- t3-wayfinder-publication:${encodedIdempotencyKey} -->`;
        const existingOutput = yield* github.execute({
          cwd: input.cwd,
          args: [
            "issue",
            "list",
            "--repo",
            repositoryReference(input.repository),
            "--state",
            "all",
            "--search",
            `"t3-wayfinder-publication:${encodedIdempotencyKey}" in:body`,
            "--json",
            "number,url,body",
            "--limit",
            "10",
          ],
        });
        const existing = decodeIssueListProbe(existingOutput.stdout).pipe(
          Option.map((issues) => issues.find((issue) => issue.body.includes(marker))),
          Option.getOrUndefined,
        );
        if (existing) return { number: existing.number, url: existing.url };
        const output = yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "--method",
            "POST",
            `repos/${input.repository.owner}/${input.repository.name}/issues`,
            "-f",
            `title=${input.title}`,
            "-f",
            `body=${input.body}\n\n${marker}`,
            ...input.labels.flatMap((label) => ["-f", `labels[]=${label}`]),
          ],
        });
        const created = decodeCreatedIssueProbe(output.stdout);
        if (Option.isSome(created)) {
          const number = created.value.number;
          return {
            number,
            url: `https://github.com/${input.repository.owner}/${input.repository.name}/issues/${number}`,
          };
        }
        return yield* new GitHubCli.GitHubCliCommandError({
          command: "gh",
          cwd: input.cwd,
          cause: new Error(`GitHub returned no canonical issue number for ${input.key}.`),
        });
      }),
      addChild: Effect.fn("IssueTracker.addChild")(function* (input) {
        const [parentId, childId] = yield* Effect.all([
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.parentNumber,
          }),
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.childNumber,
          }),
        ]);
        const existingOutput = yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            "query=query($issueId:ID!){node(id:$issueId){... on Issue{subIssues(first:100){nodes{number}}}}}",
            "-f",
            `issueId=${parentId}`,
          ],
        });
        const existing = decodeChildNumbersProbe(existingOutput.stdout);
        if (
          Option.isSome(existing) &&
          existing.value.data.node.subIssues.nodes.some(
            (issue) => issue.number === input.childNumber,
          )
        ) {
          return;
        }
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            "query=mutation($issueId:ID!,$subIssueId:ID!){addSubIssue(input:{issueId:$issueId,subIssueId:$subIssueId}){clientMutationId}}",
            "-f",
            `issueId=${parentId}`,
            "-f",
            `subIssueId=${childId}`,
          ],
        });
      }),
      addBlockedBy: Effect.fn("IssueTracker.addBlockedBy")(function* (input) {
        const [blockedId, blockerId] = yield* Effect.all([
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.blockedNumber,
          }),
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.blockerNumber,
          }),
        ]);
        const existingOutput = yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            "query=query($issueId:ID!){node(id:$issueId){... on Issue{blockedBy(first:100){nodes{number}}}}}",
            "-f",
            `issueId=${blockedId}`,
          ],
        });
        const existing = decodeBlockerNumbersProbe(existingOutput.stdout);
        if (
          Option.isSome(existing) &&
          existing.value.data.node.blockedBy.nodes.some(
            (issue) => issue.number === input.blockerNumber,
          )
        ) {
          return;
        }
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            "query=mutation($issueId:ID!,$blockingIssueId:ID!){addBlockedBy(input:{issueId:$issueId,blockingIssueId:$blockingIssueId}){clientMutationId}}",
            "-f",
            `issueId=${blockedId}`,
            "-f",
            `blockingIssueId=${blockerId}`,
          ],
        });
      }),
      updateWayfinderMapField: Effect.fn("IssueTracker.updateWayfinderMapField")(function* (input) {
        yield* updateIssueBody({
          cwd: input.cwd,
          repository: input.repository,
          issueNumber: input.issueNumber,
          transform: (body) => replaceWayfinderMapSection(body, input.field, input.value),
        });
      }),
      updateWayfinderDecisions: Effect.fn("IssueTracker.updateWayfinderDecisions")(
        function* (input) {
          yield* updateIssueBody({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.issueNumber,
            transform: (body) => replaceMapSection(body, "Decisions So Far", input.value),
          });
        },
      ),
      updateIssueTitle: Effect.fn("IssueTracker.updateIssueTitle")(function* (input) {
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "issue",
            "edit",
            String(input.issueNumber),
            "--repo",
            repositoryReference(input.repository),
            "--title",
            input.title,
          ],
        });
      }),
      setWayfinderClassification: Effect.fn("IssueTracker.setWayfinderClassification")(
        function* (input) {
          const label = `wayfinder:${input.classification}`;
          yield* github.execute({
            cwd: input.cwd,
            args: [
              "label",
              "create",
              label,
              "--repo",
              repositoryReference(input.repository),
              "--color",
              "5319E7",
              "--description",
              "Managed by the Wayfinder Workbench",
              "--force",
            ],
          });
          const remove =
            input.previous === "unknown" ? [] : ["--remove-label", `wayfinder:${input.previous}`];
          yield* github.execute({
            cwd: input.cwd,
            args: [
              "issue",
              "edit",
              String(input.issueNumber),
              "--repo",
              repositoryReference(input.repository),
              ...remove,
              "--add-label",
              label,
            ],
          });
        },
      ),
      removeChild: Effect.fn("IssueTracker.removeChild")(function* (input) {
        const [parentId, childId] = yield* Effect.all([
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.parentNumber,
          }),
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.childNumber,
          }),
        ]);
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            "query=mutation($issueId:ID!,$subIssueId:ID!){removeSubIssue(input:{issueId:$issueId,subIssueId:$subIssueId}){clientMutationId}}",
            "-f",
            `issueId=${parentId}`,
            "-f",
            `subIssueId=${childId}`,
          ],
        });
      }),
      removeBlockedBy: Effect.fn("IssueTracker.removeBlockedBy")(function* (input) {
        const [blockedId, blockerId] = yield* Effect.all([
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.blockedNumber,
          }),
          loadIssueNodeId({
            cwd: input.cwd,
            repository: input.repository,
            issueNumber: input.blockerNumber,
          }),
        ]);
        const existingOutput = yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            "query=query($issueId:ID!){node(id:$issueId){... on Issue{blockedBy(first:100){nodes{number}}}}}",
            "-f",
            `issueId=${blockedId}`,
          ],
        });
        const existing = decodeBlockerNumbersProbe(existingOutput.stdout);
        if (
          Option.isSome(existing) &&
          !existing.value.data.node.blockedBy.nodes.some(
            (issue) => issue.number === input.blockerNumber,
          )
        ) {
          return;
        }
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "-f",
            "query=mutation($issueId:ID!,$blockingIssueId:ID!){removeBlockedBy(input:{issueId:$issueId,blockingIssueId:$blockingIssueId}){clientMutationId}}",
            "-f",
            `issueId=${blockedId}`,
            "-f",
            `blockingIssueId=${blockerId}`,
          ],
        });
      }),
      addIssueComment: Effect.fn("IssueTracker.addIssueComment")(function* (input) {
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "issue",
            "comment",
            String(input.issueNumber),
            "--repo",
            repositoryReference(input.repository),
            "--body",
            input.body,
          ],
        });
      }),
      setIssueState: Effect.fn("IssueTracker.setIssueState")(function* (input) {
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "issue",
            input.state === "closed" ? "close" : "reopen",
            String(input.issueNumber),
            "--repo",
            repositoryReference(input.repository),
          ],
        });
      }),
    });
  }),
);
