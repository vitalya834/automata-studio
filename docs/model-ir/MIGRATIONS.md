# Model IR — Versioning and Migrations

## Versioning policy

`schemaVersion` is `"MAJOR.MINOR"`:

- **MINOR** bumps (`1.0` → `1.1`) are backward compatible: they may add new
  *optional* fields, new enum values for fields readers must already treat as
  open (none in 1.0), or relax a validation rule. Readers of `1.x` must accept
  any `1.y`, `y ≥ x`, document. Because unknown semantic fields are rejected,
  every new field in a minor version must be optional and its absence must
  keep 1.0 semantics.
- **MAJOR** bumps may break anything and require an explicit migration
  function `1.x → 2.0`. Migration tooling lives next to the validator; each
  major release ships a `migrateFrom(previous)` covering the last major only.
- Experimental data never fork the schema: it goes into `extensions`
  (`x-`-prefixed namespaces), which validators ignore semantically and
  migrations carry over verbatim.

Rules that will *not* change within 1.x:

- the envelope field set and `modelKind` discriminator values;
- identifier grammar;
- JSON-pointer diagnostic contract of `validateModel`;
- "one `timeUnit` per model" and explicit interval endpoints.

## Importing the legacy `.fsm` format (v0.x)

The legacy text format (`examples/turnstile.fsm`, parsed by `src/fsm.ts` and
`cpp/fsm.cpp`) maps into v1 as follows:

| Legacy | Model IR v1 |
| --- | --- |
| `machine Name` | `name`; `id` = slugified name; `modelKind: "mealy"` |
| `initial S` | `initial.stateId` |
| `state S` / states discovered in transitions | `states[].id` |
| `A --in/out--> B` | transition with `input: "in"`, `output: "out"` |
| `A --in--> B` (no output) | see below |
| `final S` | **dropped** in v1 (acceptors are not a v1 kind); preserve as `x-legacy.finalStates` extension |
| source line numbers | not part of IR; keep as `x-legacy.sourceLines` if round-tripping matters |

Open mapping decisions for the importer:

1. Mealy requires an output on every transition. Legacy transitions without
   outputs need a reserved silent symbol (recommended: add `"none"`/`"ε"` to
   `outputAlphabet` and use it), **or** the importer declares the model
   `moore`-incompatible and still emits `mealy` with the silent symbol.
2. Alphabets are collected from transitions (legacy has no alphabet
   declarations); the importer must emit the collected symbol sets.
3. `semanticProfile` should be computed by the analyzer (determinism +
   completeness), not guessed; until wired, importers emit
   `nondeterministic.partial` as the weakest safe claim.
4. `provenance.sourceFormat` = `"fsm-legacy"`, `createdBy` = importer name.

## Exporting v1 to legacy `.fsm`

Only `mealy` models with single-symbol outputs are representable. Everything
else (moore outputs, efsm guards, timing) has no legacy syntax; exporters must
refuse rather than silently drop semantics.

## Migration log

| From | To | Change | Migration |
| --- | --- | --- | --- |
| — | 1.0 | Initial release. | — |
