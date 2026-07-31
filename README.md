# Automata Studio

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

## Architecture and research

- [Product architecture](docs/PRODUCT-ARCHITECTURE.md)
- [Automata taxonomy](docs/AUTOMATA-TAXONOMY.md)
- [Test execution architecture](docs/TEST-EXECUTION.md)
- [Test Plan IR JSON Schema](schema/automata-test-plan-v1.schema.json)
- [Next isolated task for Claude](docs/CLAUDE-NEXT-TASK.md)

Obsidian project notes:
`D:\_Проекты\Second Brain\Second Brain\01 Projects\Automata Studio`.

The recovered 2010 Java reference application remains outside the repository at
`D:\FSMTest-Recovered-2010`; it is used for behavioural research and is not
redistributed because its licence and provenance are not established.
