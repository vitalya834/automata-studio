# Timed testing v0.5

## Scope

The v0.5 workbench makes TFSM timing semantics visible and executable. It uses
a deterministic virtual clock, so a 60-second timeout campaign executes
instantly and reproducibly. The resulting cases can later be run against real
controllers by Modbus, CAN, serial, CLI or other SUT adapters using measured
wall-clock timestamps.

Supported timing profiles:

- `timedGuards`;
- `timeouts`;
- `outputDelays`;
- `timeoutsAndOutputDelays`.

Alur–Dill models are visualized but deliberately not executed. Correct
Alur–Dill execution requires a zone/region engine with multiple clocks,
invariants and reset sets; approximating it as a one-clock TFSM would produce
false test verdicts.

## Runtime semantics

- Time is monotonic and expressed in the model's declared `timeUnit`.
- A timed guard is evaluated against residence time in the source state.
- A state timeout fires before an input arriving at the same timestamp.
- On accepted input, the transition changes state immediately and schedules
  its output using the declared delay contract.
- Constant delay is one exact value.
- Interval delay preserves inclusive/exclusive endpoints.
- Linear-family delay is `base + slope * residenceTime`.
- The reference simulator chooses the midpoint of a finite interval for its
  deterministic observation; the oracle accepts every point in the interval.

## Generated tests

For timed guards, the generator probes immediately before, exactly at and
immediately after every finite endpoint. It respects endpoint inclusivity and
does not mix probes after a state timeout with guard tests for the old state.

For timeouts, it builds an access sequence and advances virtual time to the
declared boundary. For linear-family output delays, it samples the start,
middle and final reachable part of the state's residence window.

## Oracle verdicts

- `pass`: output symbol and timing satisfy the contract;
- `fail`: wrong output or wrong transition acceptance;
- `early`: correct output arrived before the allowed window;
- `late`: correct output arrived after the allowed window;
- `timeout`: expected output was not observed;
- `invalid`: ambiguous transition, malformed campaign or unsupported engine.

## From virtual model to controller

```text
TFSM Model IR
  -> generated timed boundary cases
  -> protocol adapter maps abstract symbols to Modbus/CAN/serial messages
  -> adapter timestamps actual observations
  -> timed oracle compares symbol and delay window
  -> evidence report
```

The protocol adapter does not contain automata semantics. For example,
`start` may map to a Modbus coil write and `running` to a polled status bit;
the TFSM still contains only abstract symbols and timing contracts.

## Current limitations

- virtual reference execution only; real protocol adapters are separate work;
- no stochastic timing distributions;
- no parallel/composed TFSM;
- no Alur–Dill zone/region execution;
- state change currently occurs when input is accepted, while output may be
  emitted later. Alternative delayed-transition semantics require a new tagged
  timing profile rather than an implicit interpretation.
