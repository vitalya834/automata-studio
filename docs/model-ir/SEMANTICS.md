# Model IR v1 — Semantics

Canonical interchange model for Automata Studio. Schema:
[`schema/automata-model-v1.schema.json`](../../schema/automata-model-v1.schema.json),
runtime validator: [`src/model-ir.ts`](../../src/model-ir.ts).

The JSON Schema enforces structure only. The TypeScript validator is strictly
stronger: it additionally enforces unique IDs, declared references and
initial-configuration consistency, which JSON Schema 2020-12 cannot express.
A document is a valid v1 model **iff `validateModel` accepts it**.

## Common envelope

Every model, regardless of kind, carries:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `"1.0"` for this schema. |
| `id` | Stable machine-readable identifier of the model. |
| `name`, `description` | Human-facing metadata; no semantic weight. |
| `modelKind` | Discriminator: `mealy`, `moore`, `efsm`, `tfsm`. |
| `semanticProfile` | Declared contract: `deterministic`/`nondeterministic` × `complete`/`partial`. |
| `inputAlphabet`, `outputAlphabet` | Typed symbol lists; every transition/state output must reference them. |
| `states`, `transitions` | Stable IDs; shapes differ per kind (see below). |
| `initial` | Exactly one explicit initial configuration. |
| `provenance` | Who produced the model: tool, source format, optional seed, RFC 3339 timestamp. |
| `extensions` | Optional namespace for future fields; keys must start with `x-`. |
| `presentation` | Optional, **non-semantic**: graph coordinates only. Tools must ignore it when comparing or executing models. |

`semanticProfile` is a declared intent, not a verified property. Cross-checking
the declaration against the actual transition relation is an analyzer concern
and is deliberately out of scope for the validator (planned integration with
the C++ `analysis` module).

Unknown fields anywhere in the semantic part of the document are **rejected**.
Future data goes into `extensions`. Probability/weight fields are explicitly
forbidden in v1: v1 models nondeterminism qualitatively only.

## Identifiers

Identifiers (`id`, symbol ids, state ids, variable and clock names) match
`^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$` — Unicode letters and digits are allowed, so
Cyrillic identifiers from the legacy `.fsm` format survive import unchanged.

## Kinds

### `mealy`

Classical Mealy machine. Every transition carries `input` and `output` symbols.
States are plain. Nondeterminism (several transitions with the same
`from`+`input`) and partiality (missing `from`+`input` pairs) are legal and
declared via `semanticProfile`.

### `moore`

Every **state** carries a required `output` symbol; transitions must not carry
outputs. The output of the initial state is emitted before any input is
consumed. Mealy transition output and Moore state output are mutually
exclusive by construction and by validation.

### `efsm`

Extended FSM: `variables` (typed `bool`/`int`/`real`/`string`), alphabet
symbols may declare typed parameters, transitions may carry a `guard`
expression and an **ordered** `updates` list. Expressions are language-tagged
strings (`{"language": "c-expr", "text": "retries < 3"}`); v1 stores them
verbatim and does not define an evaluator or a canonical expression language.
`initial.variableValues` must give a type-correct value for every declared
variable. Updates apply in list order after the guard is evaluated.

### `tfsm`

Timed FSM. `timeUnit` is declared **once per model** (`ns`…`h`, `ticks`);
individual numbers never carry units. Exactly one `timingProfile`:

| Profile | Extra structure | Informal semantics |
| --- | --- | --- |
| `timedGuards` | `transitions[].timedGuard: TimeInterval` | Transition fires only if the input arrives at a time `t` (since entering the source state) inside the interval. |
| `timeouts` | `states[].timeout: {after, to}` | If no input arrives within `after` units of entering the state, the machine silently moves to `to`. `after > 0`. |
| `outputDelays` | `transitions[].outputDelay` | Output is emitted `d` units after the input: `constant` (`d = value`), `interval` (`d` chosen nondeterministically from the interval), `linearFamily` (`d = base + slope·t`, where `t` is the input arrival time since entering the source state). |
| `timeoutsAndOutputDelays` | Both of the above | Timeouts and output delays combined (Tomsk-school style TFSM). |
| `alurDill` | `clocks`, location `invariant`, edge `guard` + `resets` | Classical Alur–Dill timed automaton: all clocks start at 0, advance uniformly; an edge may fire when its clock-constraint guard holds, resetting the listed clocks; time may pass in a location only while its invariant holds. Edges carry input labels only — no outputs in v1. |

Time intervals use explicit endpoints:

```json
{ "lower": { "value": 0, "inclusive": true },
  "upper": { "value": 5, "inclusive": false } }
```

The upper endpoint may be `{ "unbounded": true }` (+∞, always exclusive).
`lower ≤ upper` is validated; a point interval requires both endpoints
inclusive. All time values are finite, non-negative numbers; `NaN` and
infinities as numbers are rejected.

## Determinism and non-mutation

`validateModel` never mutates its input and yields identical diagnostics (same
order, same JSON-pointer paths) for identical input. Diagnostics use RFC 6901
JSON pointers, e.g. `/transitions/0/to`.

## Out of scope in v1 (designed but not implemented)

- probabilistic/stochastic machines (`probability` explicitly rejected);
- hierarchical (Statechart-style) states and parallel regions;
- expression evaluation for EFSM guards/updates;
- clock difference constraints (`x - y < c`) and diagonal guards for Alur–Dill;
- machine composition; multiple initial configurations;
- checking `semanticProfile` claims against the transition relation.
