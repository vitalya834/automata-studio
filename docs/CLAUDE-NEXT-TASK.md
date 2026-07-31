# Next task for Claude — Canonical Model IR v1

## Context

Repository: `vitalya834/automata-studio`.

Automata Studio is a C++/TypeScript model-based testing platform. The current
v0.3 implements Mealy FSM parsing, legacy `.fsm`, deterministic seeded
generation, analysis, transition-cover tests, Test Plan IR 1.0 and an in-memory
runner in TypeScript and C++. Your task is the next isolated layer: a canonical,
versioned Model IR. Do not redesign the UI, Test Plan IR or existing algorithms.

## Branch and ownership

Create branch `claude/model-ir-v1` from `agent/test-runner-v03` after that
branch is pushed. If PR #1 and the v0.3 PR have already been merged, use the
latest `main` instead.

Own only:

- `schema/automata-model-v1.schema.json`
- `src/model-ir.ts`
- `src/model-ir.test.ts`
- `examples/models/**`
- `docs/model-ir/**`

Do not modify `schema/automata-test-plan-v1.schema.json`, `src/testing.ts`,
`src/main.ts`, `src/style.css` or C++ files. If integration needs changes to
`src/fsm.ts`, describe them in the handoff instead of editing it.

## Deliverables

1. `schema/automata-model-v1.schema.json`, JSON Schema 2020-12.
2. Matching discriminated TypeScript types in `src/model-ir.ts`.
3. Runtime validation with human-readable, JSON-pointer diagnostics.
4. Valid and invalid fixtures plus Vitest coverage.
5. `docs/model-ir/SEMANTICS.md` and `MIGRATIONS.md`.

## Required common envelope

- `schemaVersion: "1.0"`
- `id`, `name`, optional `description`
- `modelKind`
- `semanticProfile`
- typed input/output alphabets
- stable state and transition IDs
- one explicit initial configuration
- provenance: generator/importer, source format, seed and timestamp
- extension namespace for future fields

Reject unknown semantic fields by default. Do not use graph coordinates as
semantic data; put them in optional presentation metadata.

## Model kinds in v1

Implement tagged variants for:

1. `mealy`
2. `moore`
3. `efsm`
4. `tfsm`

For `tfsm`, require exactly one timing profile:

- `timedGuards`
- `timeouts`
- `outputDelays`
- `timeoutsAndOutputDelays`
- `alurDill`

Represent a time bound with explicit inclusive/exclusive endpoints and infinity.
Represent output delay as `constant`, `interval` or `linearFamily` (`b + k*t`).
Alur–Dill requires clocks, location invariants, edge guards and reset sets.

EFSM requires typed variables, input/output parameters, guard expression and an
ordered update list. Expressions may be stored as language-tagged strings in v1;
do not invent an evaluator.

## Validation rules

- unique IDs and declared references;
- initial state/location exists;
- probability fields are forbidden in v1;
- timing fields are forbidden outside `tfsm`;
- Mealy transition output and Moore state output are mutually exclusive;
- interval lower bound must not exceed upper bound;
- timeout target and clock reset references must exist;
- no `NaN` or implicit units; timing unit is declared once per model.

## Examples

Provide at least:

- deterministic Mealy turnstile;
- nondeterministic partial Mealy machine;
- EFSM login with retry counter;
- TFSM password timeout;
- TFSM lamp with output delay;
- combined timeout + linear-family output delay;
- Alur–Dill two-clock example;
- one invalid fixture for each validation family.

## Acceptance

- `npm test` and `npm run build` pass;
- schema and TypeScript validator agree on all fixtures;
- validation is deterministic and does not mutate input;
- no `any` in public types;
- README/handoff lists unsupported features and exact integration points;
- make focused commits and report their hashes; do not push directly to `main`.
