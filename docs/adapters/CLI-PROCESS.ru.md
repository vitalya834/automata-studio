# CLI Process SUT Adapter v0.6

[English](CLI-PROCESS.md) | [Русский](CLI-PROCESS.ru.md)

Адаптер [`src/adapters/cli-process.ts`](../../src/adapters/cli-process.ts)
реализует контракт `SutAdapter` для локального дочернего процесса. Обмен идёт
объектами JSON Lines через stdin/stdout. Тестовые SUT находятся в
[`test-fixtures/cli-sut`](../../test-fixtures/cli-sut/).

## Протокол

На каждой строке расположен один UTF-8 JSON-объект. В каждый момент выполняется
не более одного запроса.

| Запрос адаптера | Ответ SUT |
| --- | --- |
| `{"type":"reset","requestId":"r1"}` | `{"type":"ready","requestId":"r1"}` |
| `{"type":"input","requestId":"r2","symbol":"coin"}` | `{"type":"output","requestId":"r2","symbol":"unlock","metadata":{}}` |
| `{"type":"close","requestId":"r3"}` | `{"type":"closed","requestId":"r3"}` |

Адаптер проверяет `requestId`, ожидаемый тип ответа, тип `symbol`, объект
`metadata`, JSON и максимальный размер строки. Неизвестный, отсутствующий,
повторный или незапрошенный ID является ошибкой протокола. Stderr никогда не
разбирается как протокол, а сохраняется как ограниченная диагностика.

Ошибка протокола, тайм-аут или неожиданный выход процесса делают текущую сессию
непригодной: запрос завершается с `CliProcessAdapterError`, процесс останавливается,
а новый `reset()` создаёт свежий процесс.

## Конфигурация

```ts
new CliProcessAdapter({
  executable: 'path/to/sut.exe',
  args: ['--mode', 'fsm'],
  cwd: 'optional/working/dir',
  envAllowlist: ['MY_SUT_LICENSE'],
  startupTimeoutMs: 5000,
  responseTimeoutMs: 5000,
  maxLineBytes: 65536,
  stderrLimitBytes: 16384,
});
```

## Границы безопасности

- **Без shell:** executable запускается напрямую с массивом аргументов.
- **Allowlist окружения:** процесс получает только системный минимум и явно
  разрешённые имена; значения не логируются.
- **Ограниченная память:** stdout/stderr ограничены настройками размера.
- **Без процессов-сирот:** ошибки и идемпотентный `close()` завершают child;
  после мягкой команды используются `kill()` и принудительный fallback.
- **Отмена:** `AbortSignal` отменяет запрос и завершает непригодную сессию.

## Минимальный пример

```ts
import { CliProcessAdapter } from './adapters/cli-process';
import { runTestPlan } from './testing';

const adapter = new CliProcessAdapter({
  executable: process.execPath,
  args: ['test-fixtures/cli-sut/turnstile.cjs'],
});
const result = await runTestPlan(plan, adapter);
console.log(result.verdict);
```

## Ошибки

`spawn` — не удалось запустить; `startup-timeout` / `response-timeout` — истёк
дедлайн; `protocol` — неверный ответ; `process-exit` — неожиданный выход;
`broken-pipe` — ошибка stdin; `cancelled` — отмена; `closed` — вызов после close;
`state` — нарушение контракта. Ошибка содержит ограниченный `stderr` и признак
`stderrTruncated`.

Адаптер работает только в Node.js и не импортируется браузерным `src/main.ts`.
Для UI-запуска локальных программ потребуется desktop/local-runner слой.
