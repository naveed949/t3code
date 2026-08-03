import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const canonicalLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

canonicalLayer("036_ProjectionTitleAndSkillInvocationReconciliation", (it) => {
  it.effect("adds both branches' schema changes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* runMigrations({ toMigrationInclusive: 36 });

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const threadColumnNames = new Set(threadColumns.map((column) => column.name));
      assert.ok(threadColumnNames.has("title_regeneration_request_id"));
      assert.ok(threadColumnNames.has("title_regeneration_started_at"));

      const turnColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turns)
      `;
      assert.ok(turnColumns.some((column) => column.name === "skill_invocation_json"));
    }),
  );
});

const legacySkillLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

legacySkillLayer("036 legacy skill-invocation migration lineage", (it) => {
  it.effect("repairs databases that previously used migration 35 for skill invocation", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* sql`
        ALTER TABLE projection_turns
        ADD COLUMN skill_invocation_json TEXT
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (35, 'ProjectionTurnsSkillInvocation')
      `;

      yield* runMigrations({ toMigrationInclusive: 36 });

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const threadColumnNames = new Set(threadColumns.map((column) => column.name));
      assert.ok(threadColumnNames.has("title_regeneration_request_id"));
      assert.ok(threadColumnNames.has("title_regeneration_started_at"));

      const migration = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id = 36
      `;
      assert.deepStrictEqual(migration, [
        {
          migration_id: 36,
          name: "ProjectionTitleAndSkillInvocationReconciliation",
        },
      ]);
    }),
  );
});
