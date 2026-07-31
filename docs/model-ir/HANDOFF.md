# Model IR v1 — Handoff

Branch: `claude/model-ir-v1` (based on `main`). Nothing outside the owned
paths was modified except `package.json`/`package-lock.json` (see
"Dependencies").

## What was delivered

- `schema/automata-model-v1.schema.json` — JSON Schema 2020-12, discriminated
  on `modelKind` (`mealy`, `moore`, `efsm`, `tfsm`) with five TFSM timing
  profiles.
- `src/model-ir.ts` — matching discriminated TypeScript types (no `any` in
  the public surface) and `validateModel(value: unknown)`: deterministic,
  non-mutating, human-readable diagnostics with RFC 6901 JSON pointers and
  stable `code`s.
- `src/model-ir.test.ts` — Vitest suite (50 tests): every fixture is checked
  against both the schema (ajv) and the runtime validator, plus behavioural
  tests (determinism, non-mutation, NaN rejection, EFSM initial-value typing).
- `examples/models/valid/**` — 9 models: Mealy turnstile, nondeterministic
  partial Mealy, Moore traffic light, EFSM login-with-retry, TFSM password
  timeout, TFSM lamp with output delays, TFSM timeout + linear-family delay,
  TFSM timed guards door, Alur–Dill two-clock automaton.
- `examples/models/invalid/**` — 12 fixtures, one per validation family
  (unique IDs, references, initial configuration, probability, timing outside
  tfsm, output exclusivity, interval bounds, timeout target, clock resets,
  implicit units, unknown fields, schema version).
- `docs/model-ir/SEMANTICS.md`, `docs/model-ir/MIGRATIONS.md`.

## Schema vs validator contract

The schema checks structure; the TS validator is strictly stronger (it also
checks cross-references, which JSON Schema 2020-12 cannot express). The test
suite pins which invalid fixtures each layer catches
(`SCHEMA_DETECTABLE` in `src/model-ir.test.ts`). Source of truth for
"is this a valid v1 model" is `validateModel`.

## Dependencies

Added devDependencies only: `ajv` (schema cross-check in tests) and
`@types/node` (fixture loading in tests). Neither ships to the browser
bundle; `npm run build` output is unchanged.

## Unsupported in v1 (designed, not implemented)

Probabilistic machines; hierarchical/parallel states; EFSM expression
evaluation (expressions are language-tagged strings); Alur–Dill diagonal
constraints (`x - y < c`) and edge outputs; machine composition; verification
of the declared `semanticProfile` against the transition relation; export of
non-Mealy kinds to the legacy `.fsm` text format.

## Exact integration points (for Codex)

1. **`src/fsm.ts` → IR adapter (not edited, as instructed).** Suggested
   addition: `export function machineToModelIr(machine: Machine): MealyModel`
   following the mapping table in `MIGRATIONS.md`. Required decisions there:
   silent output symbol for output-less transitions, `x-legacy` extension for
   `final` states and source lines, weakest-safe `semanticProfile`
   (`nondeterministic.partial`) until the analyzer computes the real one.
2. **`src/main.ts` (owned by Codex).** UI can offer "Export canonical JSON":
   `JSON.stringify(machineToModelIr(parseResult.machine))`, and "Import":
   `validateModel(json)` and render `diagnostics[].path/message` in the
   existing error panel.
3. **C++ core.** `cpp/fsm.hpp`'s `to_json` emits the legacy ad-hoc JSON. A
   future `to_model_ir_json(Machine)` should target this schema; the schema
   file is the language-neutral contract, and `examples/models/**` doubles as
   shared fixtures for C++ and TypeScript parity tests.
4. **Seeded generators (v0.2 branch).** Generators should stamp
   `provenance = { createdBy: "generator", sourceFormat: "seeded-random",
   seed, timestamp }` — the field set already matches.

## How to verify

```bash
npm test
npm run build
```

Both pass on this branch (54 tests: 4 legacy + 50 model-ir).
