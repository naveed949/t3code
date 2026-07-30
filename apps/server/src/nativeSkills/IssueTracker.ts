import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { WayfinderMapProjection } from "@t3tools/contracts";
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
    }) => Effect.Effect<WayfinderMapProjection | null>;
  }
>()("t3/nativeSkills/IssueTracker") {}

const RepositoryProbe = Schema.Struct({
  hasIssuesEnabled: Schema.Boolean,
  viewerPermission: Schema.String,
});
const LabelsProbe = Schema.Array(Schema.Struct({ name: Schema.String }));
const IssueProbe = Schema.Struct({ number: Schema.Number, url: Schema.String });
const IssueTypeFieldsProbe = Schema.Struct({
  data: Schema.Struct({
    __type: Schema.Struct({ fields: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  }),
});
const WayfinderMapProbe = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      issue: Schema.NullOr(
        Schema.Struct({
          number: Schema.Number,
          title: Schema.String,
          url: Schema.String,
          state: Schema.Literals(["OPEN", "CLOSED"]),
          labels: Schema.Struct({
            nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
          }),
          body: Schema.String,
          subIssues: Schema.Struct({
            nodes: Schema.Array(
              Schema.Struct({
                number: Schema.Number,
                title: Schema.String,
                url: Schema.String,
                state: Schema.Literals(["OPEN", "CLOSED"]),
                assignees: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ login: Schema.String })),
                }),
                labels: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
                }),
                blockedBy: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.Struct({
                      number: Schema.Number,
                      state: Schema.Literals(["OPEN", "CLOSED"]),
                    }),
                  ),
                }),
                blocking: Schema.Struct({
                  nodes: Schema.Array(Schema.Struct({ number: Schema.Number })),
                }),
              }),
            ),
          }),
        }),
      ),
    }),
  }),
});
const decodeRepositoryProbe = Schema.decodeUnknownOption(Schema.fromJsonString(RepositoryProbe));
const decodeLabelsProbe = Schema.decodeUnknownOption(Schema.fromJsonString(LabelsProbe));
const decodeIssueProbe = Schema.decodeUnknownOption(Schema.fromJsonString(IssueProbe));
const decodeIssueTypeFieldsProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(IssueTypeFieldsProbe),
);
const decodeWayfinderMapProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(WayfinderMapProbe),
);

const noCapabilities: IssueTrackerCapabilities = {
  supportsIssues: false,
  canWriteIssues: false,
  supportsChildRelationships: false,
  supportsBlockingRelationships: false,
  labels: [],
};

const writePermission = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

function repositoryReference(repository: IssueTrackerRepository): string {
  return `${repository.owner}/${repository.name}`;
}

function resolveGitHubIssueReference(
  repository: IssueTrackerRepository,
  reference: string,
): string | null {
  const trimmed = reference.trim();
  if (/^#?\d+$/u.test(trimmed)) return trimmed.replace(/^#/u, "");
  try {
    const url = new URL(trimmed);
    const match = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/u.exec(url.pathname);
    const [, owner, name, issueNumber] = match ?? [];
    return url.hostname === "github.com" &&
      owner?.toLowerCase() === repository.owner.toLowerCase() &&
      name?.toLowerCase() === repository.name.toLowerCase() &&
      issueNumber
      ? issueNumber
      : null;
  } catch {
    return null;
  }
}

export const GitHubIssueTrackerLive = Layer.effect(
  IssueTracker,
  Effect.gen(function* () {
    const github = yield* GitHubCli.GitHubCli;
    const repositories = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;

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
        const output = yield* github
          .execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              `query=query($owner:String!,$name:String!,$number:Int!){
                repository(owner:$owner,name:$name){
                  issue(number:$number){
                    number title url state body
                    labels(first:20){nodes{name}}
                    subIssues(first:100){
                      nodes{
                        number title url state
                        assignees(first:10){nodes{login}}
                        labels(first:20){nodes{name}}
                        blockedBy(first:100){nodes{number state}}
                        blocking(first:100){nodes{number}}
                      }
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
          })
          .pipe(Effect.option);
        if (Option.isNone(output)) return null;
        const probe = decodeWayfinderMapProbe(output.value.stdout);
        const issue = Option.isSome(probe) ? probe.value.data.repository.issue : null;
        return issue?.labels.nodes.some((label) => label.name === "wayfinder:map")
          ? projectWayfinderMap(issue, input.synchronizedAt)
          : null;
      }),
    });
  }),
);
