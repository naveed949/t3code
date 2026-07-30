import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

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

export type WayfinderMapLoadResult =
  | { readonly kind: "loaded"; readonly map: WayfinderMapProjection }
  | { readonly kind: "not-wayfinder-map" }
  | { readonly kind: "truncated" };

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
const decodeIssueTypeFieldsProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(IssueTypeFieldsProbe),
);
const decodeWayfinderMapProbe = Schema.decodeUnknownOption(
  Schema.fromJsonString(WayfinderMapProbe),
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
                    labels(first:100){nodes{name} pageInfo{hasNextPage}}
                    subIssues(first:100){
                      nodes{
                        number title url state
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
          })
          .pipe(Effect.option);
        if (Option.isNone(output)) return { kind: "not-wayfinder-map" };
        const probe = decodeWayfinderMapProbe(output.value.stdout);
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
        return issue?.labels.nodes.some((label) => label.name === "wayfinder:map")
          ? { kind: "loaded", map: projectWayfinderMap(issue, input.synchronizedAt) }
          : { kind: "not-wayfinder-map" };
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
    });
  }),
);
