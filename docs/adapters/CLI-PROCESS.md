# CLI Process SUT Adapter (v0.5)

Adapter: [`src/adapters/cli-process.ts`](../../src/adapters/cli-process.ts) —
implements the `SutAdapter` contract from `src/testing.ts` for a local child
process speaking JSON Lines over stdin/stdout. Fixture SUTs:
[`test-fixtures/cli-sut/`](../../test-fixtures/cli-sut/).

## Protocol

One UTF-8 JSON object per line. The adapter writes requests to the child's
stdin; the child answers on stdout. The protocol is strictly sequential: the
adapter never has more than one request in flight.

| Request (adapter → SUT) | Expected response (SUT → adapter) |
| --- | --- |
| `{"type":"reset","requestId":"r1"}` | `{"type":"ready","requestId":"r1"}` |
| `{"type":"input","requestId":"r2","symbol":"coin"}` | `{"type":"output","requestId":"r2","symbol":"unlock","metadata":{}}` |
| `{"type":"close","requestId":"r3"}` | `{"type":"closed","requestId":"r3"}` |

Rules enforced by the adapter:

- every response must carry the `requestId` of the pending request; unknown,
  missing, duplicate (already completed) or unsolicited IDs are protocol
  errors;
- the response `type` must match the request (`reset→ready`, `input→output`,
  `close→closed`);
- `symbol` in an `output` response must be a string or `null` (quiescence);
- `metadata`, when present, must be a JSON object;
- a stdout line longer than `maxLineBytes` (default 64 KiB) — or that many
  bytes without any line break — is a protocol error;
- lines that are not valid JSON objects are protocol errors;
- stderr is **never** parsed as protocol data: it is captured as bounded
  diagnostic text (default 16 KiB, truncation flagged) and attached to errors.

Any protocol error, response timeout or unexpected process exit is **fatal
for the current child**: the pending request rejects with a typed
`CliProcessAdapterError`, the child is terminated, and subsequent `send()`
calls fail fast. `reset()` recovers by spawning a fresh process.

## Configuration

```ts
new CliProcessAdapter({
  executable: 'path/to/sut.exe', // or a name resolved via the child PATH
  args: ['--mode', 'fsm'],       // argument array, passed verbatim
  cwd: 'optional/working/dir',
  envAllowlist: ['MY_SUT_LICENSE'],
  startupTimeoutMs: 5000,
  responseTimeoutMs: 5000,
  maxLineBytes: 65536,
  stderrLimitBytes: 16384,
});
```

## Security boundaries

- **No shell.** The executable is spawned directly with an argument array
  (`shell: false`); there is no string-built command line and no quoting
  surface for injection.
- **Environment allowlist.** The child receives only a small platform
  baseline (`PATH`, `SystemRoot`, `TEMP`, … — needed for ordinary executables
  to start at all) plus explicitly allowlisted variable names. Values are
  copied, never logged, and never included in error messages or diagnostics.
- **Bounded input.** Oversized stdout lines and unbounded stderr are cut off
  by `maxLineBytes` / `stderrLimitBytes`, so a misbehaving SUT cannot exhaust
  adapter memory.
- **No orphans.** Every failure path and `close()` (idempotent) terminate the
  child: polite `close` request first when the session is healthy, then
  `kill()`, then a forced `SIGKILL` fallback. `running` exposes the child
  state for tests.
- **Cancellation.** `AbortSignal` on `reset`/`send` rejects the pending
  request with kind `cancelled` and stops the child; the session is not
  reused afterwards.

## Minimal example

```ts
import { CliProcessAdapter } from './adapters/cli-process';
import { runTestPlan } from './testing';

const adapter = new CliProcessAdapter({
  executable: process.execPath,
  args: ['test-fixtures/cli-sut/turnstile.cjs'],
});
const result = await runTestPlan(plan, adapter); // runTestPlan closes the adapter
console.log(result.verdict);
```

A conforming SUT can be written in ~20 lines; see
`test-fixtures/cli-sut/turnstile.cjs` for the reference implementation.

## Error taxonomy

`CliProcessAdapterError.kind`:

| Kind | Meaning |
| --- | --- |
| `spawn` | Executable could not be started. |
| `startup-timeout` | Process did not reach the spawned state in time. |
| `response-timeout` | No response for the pending request in time. |
| `protocol` | Malformed JSON, bad ID/type/symbol, oversized line. |
| `process-exit` | Child exited or was killed by a signal unexpectedly. |
| `broken-pipe` | Writing to the child's stdin failed. |
| `cancelled` | AbortSignal fired. |
| `closed` | Adapter used after `close()`. |
| `state` | Contract misuse (concurrent request, send before reset). |

Errors carry `stderr` (bounded) and `stderrTruncated` for diagnostics.

## Handoff notes for Codex

- No files outside the owned paths were touched; no new dependencies.
- The adapter is Node-only (`node:child_process`) and is not imported by
  `src/main.ts`, so the browser bundle is unchanged. If the UI ever needs it,
  the integration point is an Electron/local-runner context, not the browser.
- `runTestPlan` works with the adapter unchanged; `reset()` per case maps to
  one `reset` request and reuses the same child, which matches the runner's
  semantics. If a future runner wants a **fresh process per case**, add an
  adapter option (`restartOnReset: true`) rather than changing the runner.
- Startup handshake is process-level (`spawn` event), not protocol-level. If
  SUTs need a protocol banner (e.g. `{"type":"hello","version":1}`), extend
  the protocol here and bump the doc — the current fixtures would remain
  valid by ignoring unknown request types.
