# Own Workflow orchestration on the server

A deep server orchestration module owns command validation, persisted events, Workflow Projection, orthogonal Node State, and Allowed Actions. Queue-backed reactors adapt provider, tracker, and Git effects and emit typed receipts. Mutations are identity-deduplicated and optimistic-versioned; clients render bounded snapshots and sequenced deltas without reimplementing workflow rules, and disconnected projections remain read-only.
