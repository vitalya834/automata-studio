# Test campaign generation

[English](TEST-GENERATION.md) | [Русский](TEST-GENERATION.ru.md)

Automata Studio v1.0 turns a deterministic DSL model into versioned Test Plan
IR that can be executed through any SUT adapter.

```powershell
npm run cli -- generate examples/game-session.fsm -- `
  --strategy transition-cover --output game-plan.json

npm run cli -- generate examples/game-session.fsm -- `
  --strategy random-walk --cases 50 --max-steps 25 `
  --seed game-2026 --timeout 1000 --output game-fuzz.json
```

`transition-cover` creates one test for each reachable transition using a
shortest access sequence. `random-walk` creates reproducible bounded campaigns
for exploratory and fuzz-like behavioral testing. Both derive oracle outputs
from the model and preserve state/transition traces in metadata.

The generated plan is protocol-neutral: it can be validated and then executed
against a CLI process, Modbus TCP device or HTTP service.
