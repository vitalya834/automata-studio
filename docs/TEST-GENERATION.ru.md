# Генерация тестовых кампаний

[English](TEST-GENERATION.md) | [Русский](TEST-GENERATION.ru.md)

Automata Studio v1.0 преобразует детерминированную DSL-модель в версионированный
Test Plan IR, который выполняется через любой SUT-адаптер.

```powershell
npm run cli -- generate examples/game-session.fsm `
  --strategy transition-cover --output game-plan.json

npm run cli -- generate examples/game-session.fsm `
  --strategy random-walk --cases 50 --max-steps 25 `
  --seed game-2026 --timeout 1000 --output game-fuzz.json
```

`transition-cover` создаёт тест для каждого достижимого перехода по кратчайшей
последовательности доступа. `random-walk` создаёт воспроизводимые ограниченные
кампании для исследовательского и fuzz-подобного тестирования. Оба метода берут
эталонные выходы из модели и сохраняют трассы состояний/переходов в метаданных.

Сгенерированный план не зависит от протокола: его можно проверить и выполнить
на CLI-процессе, Modbus TCP-устройстве или HTTP-сервисе.
