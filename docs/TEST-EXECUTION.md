# Test execution architecture

[English](TEST-EXECUTION.md) | [Русский](TEST-EXECUTION.ru.md)

## Purpose

The execution layer runs the same generated test plan against a simulator,
software process, service, protocol endpoint or physical device. Model and test
algorithms never depend directly on Modbus, CAN, HTTP or another transport.

## Pipeline

```text
Machine + generation method
  -> versioned Test Plan IR
  -> SUT adapter
  -> stimulus encoding / transport
  -> observation decoding
  -> model-specific oracle
  -> step trace and verdict
  -> JSON / JUnit / HTML report
```

## Test Plan IR

A plan contains:

- `schemaVersion`;
- stable plan, case and step IDs;
- optional model ID and generation metadata;
- setup/reset policy;
- ordered test cases;
- abstract input stimulus for each step;
- a set of allowed outputs;
- deadline/timeout;
- optional tags and adapter-independent metadata.

The plan stores abstract symbols, not raw Modbus registers or CAN frames.
Protocol mapping belongs to adapter configuration so the same behavioural plan
can be reused across implementations.

## Adapter contract

Every SUT adapter provides the same lifecycle:

1. `reset` — establish a known initial configuration;
2. `send` — encode and deliver one abstract stimulus;
3. observe/decode one reaction and timing metadata;
4. `close` — release sockets, ports, handles or simulator state.

The adapter must not decide conformance. It returns observations; the oracle
assigns the verdict.

## Verdicts

- `pass` — every observed reaction satisfies the oracle;
- `fail` — a reaction is outside the allowed set or violates a predicate;
- `timeout` — the deadline expired without an acceptable observation;
- `inconclusive` — the run cannot prove pass or fail;
- `invalid` — model, plan, mapping or adapter setup is invalid.

## Adapter roadmap

### Built-in simulator

Executes a deterministic FSM in memory. It is the reference adapter for demos,
unit tests and comparing C++/TypeScript behaviour.

### Process and service adapters

- CLI/stdin/stdout;
- file request/response;
- HTTP/REST;
- WebSocket;
- TCP/UDP;
- MQTT.

### Device and industrial adapters

- serial port;
- Modbus TCP/RTU;
- CAN with DBC mapping;
- OPC UA;
- GPIO or vendor SDK plugin.

### UI adapters

Browser or desktop UI automation is possible, but should map visible actions and
observations into the same abstract symbol contract. It is not a special test
generation engine.

## Modbus example

An abstract stimulus `start` may map to writing coil 0, while output `running`
maps to reading status bit 1. The FSM still contains `start/running`; host, port,
unit ID, function code, address, byte order and polling interval live in adapter
configuration.

## CAN example

An abstract stimulus `enable_motor` may map through a DBC signal to one CAN
frame. Observations are decoded from response frames into symbols such as
`motor_enabled` or `fault`. Bus bitrate, channel, arbitration IDs and DBC files
remain adapter configuration.

## Safety and reproducibility

- Adapters declare whether reset and cleanup are destructive.
- Hardware campaigns require an explicit allowlist of endpoints/channels.
- Every run records model version, plan hash, adapter config hash, seed and time.
- Secrets are referenced by environment/provider key, never stored in plans.
- Cancellation must close transports and leave the SUT in a documented state.
- Reports preserve actual observations and durations, not only final counts.
