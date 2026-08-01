# Next task for Claude — Modbus TCP SUT adapter v0.7

## Context

Repository: `vitalya834/automata-studio`.

The v0.6 integration has a protocol-neutral Test Plan IR, runner, timed oracle,
in-memory adapter and hardened CLI-process adapter. The next isolated task is a
real Modbus TCP adapter so the same abstract test steps can drive a local
simulator now and an explicitly authorised controller later.

## Branch and ownership

Create branch `claude/modbus-tcp-adapter-v07` from
`agent/cli-adapter-integration-v06` after that branch is pushed.

Own only:

- `src/adapters/modbus-tcp.ts`
- `src/adapters/modbus-tcp.test.ts`
- `test-fixtures/modbus-tcp/**`
- `docs/adapters/MODBUS-TCP.md`

Do not modify the UI, runner, Model/Test IR schemas, C++ files, package metadata
or existing tests. Do not add a dependency without documenting why it is needed
in the handoff.

## Required design

1. Implement the existing `SutAdapter` lifecycle: `reset`, `send`, `close`.
2. Map abstract input symbols to typed Modbus operations through configuration;
   do not put Modbus addresses or function codes into the Test Plan IR.
3. Initially support reads of coils/discrete inputs/holding registers/input
   registers and writes of single coils/registers (function codes 1–6).
4. Map observations back to stable output symbols using configured predicates;
   include raw values and timing only in metadata.
5. Implement MBAP transaction correlation, protocol/unit ID validation, Modbus
   exception responses, TCP fragmentation and multiple frames per read.
6. Enforce connect/response deadlines, cancellation, bounded receive buffers and
   idempotent cleanup. Never retry a write automatically.
7. `reset` must be non-destructive by default. Optional reset operations require
   an explicit `allowWrites: true` safety gate.
8. Connect only to the configured host/port. Do not scan networks and do not
   contact real equipment in tests.

## Deterministic tests

Build an in-process TCP fixture server bound to `127.0.0.1` on an ephemeral port.
Cover happy reads/writes, fragmented frames, two buffered frames, transaction or
unit mismatch, exception response, timeout, cancellation, early disconnect,
write safety gate and idempotent close. Assert that no socket/server remains
open after each test.

## Acceptance and handoff

- `npm test` and `npm run build` pass;
- public API contains no `any` and no shell execution;
- no network access beyond the loopback fixture in tests;
- documentation includes configuration, symbol mapping, safety boundaries and a
  minimal `runTestPlan` example;
- provide focused commit hashes and do not push directly to `main`.
