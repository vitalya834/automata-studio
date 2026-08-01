# Modbus TCP SUT Adapter (v0.7)

[English](MODBUS-TCP.md) | [Русский](MODBUS-TCP.ru.md)

Adapter: [`src/adapters/modbus-tcp.ts`](../../src/adapters/modbus-tcp.ts) —
implements the `SutAdapter` contract from `src/testing.ts` over Modbus TCP.
Deterministic loopback fixture:
[`test-fixtures/modbus-tcp/fixture-server.ts`](../../test-fixtures/modbus-tcp/fixture-server.ts).

## Scope

Function codes 1–6: read coils, read discrete inputs, read holding registers,
read input registers, write single coil, write single register. One request in
flight at a time (MBAP transaction ids are still validated). Everything else
(multi-write FCs 15/16, RTU framing, TLS, gateways with differing unit ids per
symbol) is out of scope for v0.7 and listed in the handoff.

## Symbol mapping — the Test Plan IR stays protocol-free

Abstract input symbols map to typed Modbus operations in the **adapter
configuration**; addresses and function codes never appear in the Test Plan
IR. Observations map back to stable output symbols through configured
predicates; raw values and timing appear only in `metadata`.

```ts
const adapter = new ModbusTcpAdapter({
  host: '127.0.0.1',
  port: 1502,
  unitId: 1,
  inputs: {
    read_lamp: {
      operation: { kind: 'readCoils', address: 10, quantity: 1 },
      outputs: [{ symbol: 'lamp_on', when: { kind: 'valueAt', index: 0, equals: 1 } }],
      otherwise: 'lamp_off',
      onException: 'lamp_unavailable',
    },
    switch_on: {
      operation: { kind: 'writeSingleCoil', address: 10, value: true },
      onSuccess: 'switched_on',
    },
  },
  allowWrites: true, // required because switch_on writes
});
```

Predicates (`OutputCondition`) over the normalised values (bits → 0/1,
registers → uint16): `always`, `equals` (whole vector), `valueAt`
(`index` + `equals`/`min`/`max`). Rules are evaluated in order; first match
wins; `otherwise` (default `null`) applies when nothing matches. Writes
produce `onSuccess` (default `null`) after the echo is verified. A Modbus
exception response maps to `onException` when configured, otherwise it
rejects with kind `modbus-exception`.

Response metadata: `functionCode`, `address`, `transactionId`, `values`
(reads), `written` (writes), `exceptionCode`, `staleFramesDiscarded`.

## Protocol handling

- **MBAP correlation.** Each request gets a fresh transaction id. A response
  is accepted only for the pending transaction; protocol id must be 0 and the
  unit id must match. A duplicate of a recently completed transaction is
  discarded as stale (counted in `staleFramesDiscarded`); any other unknown
  id is a fatal protocol error.
- **Framing.** The receive path reassembles fragmented frames and parses
  several buffered frames from one TCP segment. The MBAP length field is
  sanity-checked (≤ 260-byte ADU); the receive buffer is bounded
  (`maxReceiveBufferBytes`, default 8 KiB).
- **Validation.** Read responses must match the requested byte counts; write
  responses must echo address and value exactly; exception frames carry their
  code into the error/metadata.
- **Failure model.** Any protocol error, response timeout, cancellation or
  disconnect is fatal for the current connection: the pending request rejects
  with a typed `ModbusTcpAdapterError`, the socket is torn down synchronously,
  and later `send()` calls fail fast. `reset()` reconnects.

## Safety boundaries

- **Fixed target.** The adapter connects only to the configured host/port —
  no scanning, no discovery, no fallback hosts. Tests use exclusively an
  in-process fixture on `127.0.0.1`; real equipment must never be targeted
  by automated tests.
- **Write gate.** Every write — in `inputs` or in `resetOperations` — is
  rejected at construction time unless `allowWrites: true` is set explicitly.
  Validated mappings are deep-copied so later caller mutation cannot turn an
  authorised read into an unauthorised write.
- **Non-destructive reset.** By default `reset()` only (re)establishes the
  connection. `resetOperations` (e.g. forcing a known coil state) are opt-in
  and run in order; an exception during reset is an error, not an output.
- **No automatic write retries.** A failed or timed-out write is reported and
  the connection is dropped; the caller decides what happens next. (Reads are
  not retried either.)
- **Bounded memory.** Receive buffer and frame sizes are capped.

## Error taxonomy

`ModbusTcpAdapterError.kind`: `config`, `connect`, `connect-timeout`,
`response-timeout`, `protocol`, `modbus-exception` (carries `exceptionCode`),
`disconnected`, `cancelled`, `closed`, `state`.

## Minimal runTestPlan example

```ts
import { ModbusTcpAdapter } from './adapters/modbus-tcp';
import { runTestPlan } from './testing';

const adapter = new ModbusTcpAdapter({
  host: '127.0.0.1',
  port: 1502,
  inputs: {
    read_lamp: {
      operation: { kind: 'readCoils', address: 10, quantity: 1 },
      outputs: [{ symbol: 'lamp_on', when: { kind: 'valueAt', index: 0, equals: 1 } }],
      otherwise: 'lamp_off',
    },
  },
});

const result = await runTestPlan(plan, adapter); // runTestPlan closes the adapter
console.log(result.verdict);
```

The plan's steps use only abstract symbols (`read_lamp` →
`lamp_on`/`lamp_off`), so the same plan runs against the in-memory adapter,
the CLI process adapter or Modbus TCP by swapping the adapter.

## Handoff notes for Codex

- No dependencies added (`node:net` only); nothing outside the owned paths
  changed. The adapter is Node-only and not imported by `src/main.ts` — the
  browser bundle is unchanged.
- The loopback fixture server is import-only (no listening socket at module
  load); it can be reused for future FC 15/16 support.
- Not implemented, by design: multi-register/multi-coil writes (FC 15/16),
  broadcast unit id 0 semantics, per-symbol unit ids, reconnect-with-backoff
  policies, TLS (Modbus/TCP Security). Each would extend the config, not the
  Test Plan IR.
- When a real controller is ever targeted, the authorisation decision and the
  host/port allowlisting belong to the caller/UI layer; the adapter
  deliberately has no facility to enumerate or guess targets.
