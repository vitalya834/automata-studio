# Automata Studio — product architecture

## Product statement

Automata Studio generates formal machine models and test suites, visualizes both
as graphs, executes tests against software or devices, evaluates observations
with a model-specific oracle and exports reproducible evidence.

It is a testing machine, not only an FSM editor.

## End-to-end pipeline

```text
model source/import
  -> canonical versioned Model IR
  -> validation and property analysis
  -> constrained model/corpus generation
  -> test synthesis with stated assumptions
  -> versioned Test Case IR
  -> SUT adapter and runner
  -> model-specific oracle
  -> verdict, trace, coverage and counterexample
  -> graph/report/export
```

## Product subsystems

1. **Model IR** — stable IDs, alphabets, transitions, data, timing,
   probabilities, composition and semantic profile.
2. **Import/export** — DSL, legacy `.fsm/.efsm`, JSON, SCXML, UML/XMI,
   UPPAAL, PRISM/JANI and DOT/SVG as a lossy visual export.
3. **Generator** — seeded constraint-driven models and corpora: random,
   exhaustive-small, mutation neighbourhoods and imported real models.
4. **Analyzer** — determinism, completeness, observability, reachability,
   minimality, feasibility, timing conflicts, deadlocks and boundedness.
5. **Test synthesis** — structural cover, W/Wp/H/HSI, adaptive/preset
   distinguishing, homing, synchronizing, mutation and timed boundary tests.
6. **Test Case IR** — setup/reset, stimulus, expected set/predicate/
   distribution, deadline, verdict policy, cleanup and seed.
7. **Adapters** — in-process API, CLI/stdin, files, HTTP, WebSocket, TCP/UDP,
   serial, CAN, Modbus and MQTT. Hardware support is delivered by adapters, not
   hidden inside automata algorithms.
8. **Runner** — scheduling, retries, cancellation, timeout, trace capture and
   deterministic replay.
9. **Oracle** — exact deterministic, allowed-set nondeterministic, symbolic
   EFSM, timed tolerance, ioco/quiescence or statistical probability oracle.
10. **Reports** — pass/fail/inconclusive/timeout/invalid-model, coverage,
    assumptions, surviving mutants, minimal counterexample, JSON/JUnit/HTML.

## Release sequence

### Foundation (current)

- deterministic and nondeterministic Mealy FSM;
- text and legacy `.fsm` parser;
- reproducible generator;
- structural analysis and transition cover;
- versioned Test Plan IR and JSON Schema;
- canonical Model IR 1.0 for Mealy, Moore, EFSM and TFSM plus runtime validation;
- canonical Mealy Model IR import/export and compatibility-preserving DSL bridge;
- TypeScript and C++ execution cores with deterministic in-memory adapters;
- manual execution, detailed traces and JSON export in the browser workbench;
- C++ CLI plus TypeScript UI.

### Conformance FSM

- canonical JSON Model/Test IR;
- completion and minimization;
- state/transition/n-switch cover;
- W, Wp, H and HSI with explicit preconditions;
- preset/adaptive distinguishing, UIO, homing and synchronizing;
- mutant generation and kill matrix.

### EFSM

- typed data, parameters, guards and updates;
- symbolic execution and solver interface;
- data-flow/boundary criteria and EFSM mutations.

### Timed

- timed guards, timeouts and output delays as separate tagged profiles;
- interval/linear delay representation;
- region/zone or finite FSM abstractions;
- early/late/missing-output oracle and tolerance policy;
- timed mutations and boundary timestamps.

### Integration

- SUT adapter SDK and real runner;
- device/protocol adapters;
- parallel/cascade composition and communicating machines;
- CI reports and reproducible test campaigns.

### Advanced

- probabilistic/statistical campaigns;
- statecharts/SCXML;
- bounded CFSM analysis;
- optional specialised engines for pushdown and hybrid models.

## Non-negotiable correctness rules

- Every algorithm declares supported model kinds and preconditions.
- `not exists`, `unsupported` and `search limit reached` are distinct results.
- Partial machines are not silently completed with a sink state.
- Nondeterministic output is checked against an allowed set, never one random
  reference run.
- Transition coverage is not advertised as complete fault coverage.
- Every generated model and test campaign records its seed and semantic profile.
- Graph layout never changes model meaning.
