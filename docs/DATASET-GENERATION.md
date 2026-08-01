# FSM sequence dataset generation

[English](DATASET-GENERATION.md) | [Русский](DATASET-GENERATION.ru.md)

Automata Studio can turn a deterministic Mealy machine into reproducible JSONL
episodes for next-state, output-prediction and sequence-model experiments.

```powershell
npm run dataset -- examples/turnstile.fsm turnstile.jsonl 100 20 2026
```

Each record contains `episode`, `step`, `state`, `input`, `output`, `nextState`
and `terminal`. The seed makes generation repeatable. Episodes start from the
declared initial state and stop at a final/dead-end state or the step limit.

The generator deliberately requires determinism so every state/input pair has
one oracle result. Generated traces are useful for prototypes and augmentation,
but real ML evaluation still needs representative, independently collected
validation data and domain-specific metrics.
