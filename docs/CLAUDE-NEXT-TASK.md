# Next task for Claude — CLI process SUT adapter v0.5

## Context

Repository: `vitalya834/automata-studio`.

Canonical Model IR v1 is complete and integrated in v0.4. The product already
has versioned Test Plan IR, TypeScript/C++ runners and deterministic in-memory
adapters. The next isolated task is the first adapter for a real external SUT:
a local child process speaking JSON Lines over stdin/stdout.

## Branch and ownership

Create branch `claude/cli-sut-adapter-v05` from
`agent/model-ir-integration-v04` after that branch is pushed.

Own only:

- `src/adapters/cli-process.ts`
- `src/adapters/cli-process.test.ts`
- `test-fixtures/cli-sut/**`
- `docs/adapters/CLI-PROCESS.md`

Do not modify the UI, `src/testing.ts`, Model/Test IR schemas, C++ files,
package metadata or existing tests. Describe required integration changes in
the handoff instead of editing owned-by-Codex files.

## Protocol

One UTF-8 JSON object per line.

Requests written by the adapter:

```json
{"type":"reset","requestId":"r1"}
{"type":"input","requestId":"r2","symbol":"coin"}
{"type":"close","requestId":"r3"}
```

Responses read from the SUT:

```json
{"type":"ready","requestId":"r1"}
{"type":"output","requestId":"r2","symbol":"unlock","metadata":{}}
{"type":"closed","requestId":"r3"}
```

`symbol` may be a string or `null`. Ignore unrelated stderr as captured
diagnostic output; never parse it as protocol data.

## Required behaviour

1. Implement the existing `SutAdapter` contract from `src/testing.ts`.
2. Configuration includes executable, argument array, cwd, environment
   allowlist, startup timeout, response timeout and maximum line size.
3. No shell invocation and no string-built command line. Spawn the executable
   directly with an argument array.
4. Correlate every response by `requestId`; reject duplicates, missing IDs,
   malformed JSON, wrong message types and oversized lines.
5. Honour `AbortSignal`: terminate pending requests and cleanly stop the child.
6. Detect early exit, signal termination, broken pipes and stderr truncation.
7. `close()` is idempotent and must not leave a child process running.
8. Never log environment values or secrets.

## Tests

Provide deterministic fixture processes for:

- happy-path turnstile;
- delayed response and timeout;
- malformed JSON;
- mismatched request ID;
- early process exit;
- cancellation;
- idempotent close;
- maximum-line rejection.

Tests must run on Windows and avoid timing-sensitive sleeps where an explicit
fixture handshake can be used.

## Acceptance

- `npm test` and `npm run build` pass from the integration branch;
- public API contains no `any`;
- no shell execution;
- no orphan process remains after any test;
- documentation includes protocol, security boundaries and a minimal example;
- focused commits with hashes; do not push directly to `main`.
