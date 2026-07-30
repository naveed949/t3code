import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";

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
  }
>()("t3/nativeSkills/IssueTracker") {}

const RepositoryProbe = Schema.Struct({
  hasIssuesEnabled: Schema.Boolean,
  viewerPermission: Schema.String,
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
});
const IssueProbe = Schema.Struct({ number: Schema.Number, url: Schema.String });
const IssueTypeFieldsProbe = Schema.Struct({
  data: Schema.Struct({
    __type: Schema.Struct({ fields: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  }),
});
const decodeRepositoryProbe = Schema.decodeUnknownOption(Schema.fromJsonString(RepositoryProbe));
const decodeIssueProbe = Schema.decodeUnknownOption(Schema.fromJsonString(IssueProbe));
const decodeIssueTypeFieldsProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(IssueTypeFieldsProbe),
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

function resolveGitHubIssueReference(reference: string): string | null {
  const trimmed = reference.trim();
  if (/^#?\d+$/u.test(trimmed)) return trimmed.replace(/^#/u, "");
  try {
    const url = new URL(trimmed);
    const match = /^\/[^/]+\/[^/]+\/issues\/(\d+)\/?$/u.exec(url.pathname);
    return url.hostname === "github.com" && match?.[1] ? match[1] : null;
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
            args: [
              "repo",
              "view",
              repository,
              "--json",
              "hasIssuesEnabled,viewerPermission,labels",
            ],
          })
          .pipe(Effect.option);
        if (Option.isNone(repositoryOutput)) return noCapabilities;
        const parsedRepository = decodeRepositoryProbe(repositoryOutput.value.stdout);
        if (Option.isNone(parsedRepository)) return noCapabilities;

        const relationshipOutput = yield* github
          .execute({
            cwd: input.cwd,
            args: ["api", "graphql", "-f", 'query={__type(name:"Issue"){fields{name}}}'],
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
          supportsChildRelationships: canWriteIssues && fields.has("subIssues"),
          supportsBlockingRelationships:
            canWriteIssues && fields.has("blockedBy") && fields.has("blocking"),
          labels: parsedRepository.value.labels.map((label) => label.name),
        };
      }),
      resolveIssue: Effect.fn("IssueTracker.resolveIssue")(function* (input) {
        const reference = resolveGitHubIssueReference(input.reference);
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
    });
  }),
);
