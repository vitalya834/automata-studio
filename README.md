# Automata Studio

[English](README.md) | [Русский](README.ru.md)

[![CI](https://github.com/vitalya834/automata-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/vitalya834/automata-studio/actions/workflows/ci.yml)

Automata Studio is a hybrid C++/TypeScript model-based testing workbench. It
generates finite-state models from reproducible constraints, imports the legacy
`.fsm` format, validates machine properties, synthesizes transition-cover test
suites and presents models and tests as graphs and structured JSON.

The product is a protocol-neutral testing engine for software, services,
embedded systems and physical devices. Graphs are views; formal model
semantics, test oracles, reproducible execution and coverage evidence are the
core. Modbus is one future adapter, not the product boundary: the same abstract
test plan can target a simulator, CLI process, HTTP service, CAN device or other
SUT through an adapter.

## v0.7 capabilities

- executable Node.js test runner for plan validation, external SUT execution,
  readable/JSON traces, report files and CI exit codes;
- real Modbus TCP adapter with FC1–FC6 reads/writes, MBAP correlation, TCP
  fragmentation handling and abstract symbol predicates;
- non-destructive Modbus reset and an explicit `allowWrites: true` gate;
- loopback-only Modbus fixture and `npm run demo:modbus` end-to-end scenario;
- strict response framing, deadlines, cancellation and socket cleanup;
- adapter configuration kept outside protocol-neutral Test Plan IR.

## v0.6 capabilities

- Node.js CLI-process adapter for testing real external programs through a
  strict JSON Lines stdin/stdout protocol;
- process lifecycle, response deadlines, cancellation and deterministic reset;
- direct executable spawning without a shell and an explicit environment
  allowlist;
- bounded protocol lines and stderr diagnostics, correlation IDs and rejection
  of malformed, duplicate or mismatched replies;
- end-to-end execution of generated Test Plan IR against a fixture process;
- executable terminal runner with validation, text/JSON output, CI exit codes
  and optional JSON evidence reports;
- 100 automated TypeScript tests plus the C++ runner/core checks.

The browser workbench cannot spawn local executables because of browser security
boundaries. The CLI adapter is a Node.js integration API and uses the same
`runTestPlan` engine as the visible in-memory execution panel.

## v0.5 capabilities

- visible Timed Testing Workbench with TFSM graphs and five bundled profiles;
- virtual-time simulator for timed guards, state timeouts, output delays and
  combined timeout/delay models;
- boundary-case synthesis at inclusive/exclusive guard endpoints;
- timed oracle verdicts: PASS, FAIL, EARLY, LATE, TIMEOUT and INVALID;
- constant, interval and residence-dependent linear-family output delays;
- JSON export of timed boundary campaigns for future real SUT adapters;
- explicit Alur–Dill visualization with execution blocked until a correct
  zone/region engine is available.

## v0.4 capabilities

- canonical Model IR 1.0 for Mealy, Moore, EFSM and five TFSM timing profiles;
- JSON Schema plus deterministic runtime validation with JSON-pointer errors;
- 21 valid/invalid canonical fixtures and schema parity tests;
- lossless `Machine` ↔ canonical Mealy conversion, including silent outputs,
  final-state compatibility metadata and source lines;
- canonical Model IR import/export in the browser workbench;
- explicit refusal of currently unsupported Moore/EFSM/TFSM execution instead
  of silently discarding their semantics.

## v0.3 capabilities

- versioned Test Plan IR with JSON Schema and stable serialization;
- reusable asynchronous TypeScript runner with deadlines and cancellation;
- matching synchronous C++20 runner contract and JSON output;
- protocol-neutral SUT adapter interface and deterministic in-memory adapter;
- manual browser execution with PASS/FAIL/TIMEOUT summaries and step traces;
- JSON export for transition-cover plans;
- sample plan plus TypeScript and C++ runner tests.

## v0.2 capabilities

- text DSL and recovered `F/s/i/o/n0/p` legacy format;
- deterministic or nondeterministic seeded Mealy FSM generation;
- complete or partial machine generation with reachable states;
- determinism, completeness, alphabets and reachability analysis;
- transition-cover tests with shortest access paths and expected output traces;
- interactive graph, JSON, diagnostics and test-suite UI;
- matching C++20 core and command-line interface.

Transition cover is structural coverage, not a claim of complete fault coverage.
W/Wp/H/HSI and timed/EFSM methods are planned as separate algorithms with
explicit preconditions.

## Browser workbench

```powershell
npm install
npm run dev
```

## Verification

```powershell
npm test
npm run build
npm run cpp:test
npm run cpp:build
```

## C++ CLI

After `npm run cpp:build`:

```powershell
.\build-cpp\fsm-cli.exe parse examples\turnstile.fsm
.\build-cpp\fsm-cli.exe analyze examples\legacy-ndfsm.fsm
.\build-cpp\fsm-cli.exe analyze examples\turnstile.fsm
.\build-cpp\fsm-cli.exe cover examples\turnstile.fsm
.\build-cpp\fsm-cli.exe generate --name Demo --states 8 --inputs 3 --outputs 2 --seed 2025
.\build-cpp\fsm-cli.exe generate --name NDFSM --states 8 --inputs 3 --outputs 2 --seed 42 --nondeterministic --incomplete
```

`fsm-cli <file>` remains a backward-compatible alias for `parse`.

## External SUT runner

```powershell
npm run cli -- validate examples/test-plans/turnstile-transition-cover.json
npm run demo:cli
npm run demo:modbus
```

See [runner CLI documentation](docs/RUNNER-CLI.md) for external executables,
environment allowlisting, JSON output and report files.

## Architecture and research

- [Documentation index (English / Русский)](docs/README.md)
- [Product architecture](docs/PRODUCT-ARCHITECTURE.md)
- [Automata taxonomy](docs/AUTOMATA-TAXONOMY.md)
- [Test execution architecture](docs/TEST-EXECUTION.md)
- [Test Plan IR JSON Schema](schema/automata-test-plan-v1.schema.json)
- [Model IR semantics](docs/model-ir/SEMANTICS.md)
- [Model IR migrations](docs/model-ir/MIGRATIONS.md)
- [Timed testing semantics](docs/TIMED-TESTING.md)
- [External SUT runner CLI](docs/RUNNER-CLI.md)
- [Modbus TCP adapter](docs/adapters/MODBUS-TCP.md)
- [Next isolated task for Claude](docs/CLAUDE-NEXT-TASK.md)

Obsidian project notes:
`D:\_Проекты\Second Brain\Second Brain\01 Projects\Automata Studio`.

The recovered 2010 Java reference application remains outside the repository at
`D:\FSMTest-Recovered-2010`; it is used for behavioural research and is not
redistributed because its licence and provenance are not established.
