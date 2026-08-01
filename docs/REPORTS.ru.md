# Evidence reports

[English](REPORTS.md) | [Русский](REPORTS.ru.md)

Automata Studio преобразует один неизменяемый `TestRunResult` в JSON, JUnit XML
и автономный HTML. Генерация чистая и детерминированная: она не читает файлы, не
обращается к сети, не меняет результат и не добавляет текущее время.

## CLI

```powershell
npm run cli -- run plan.json -- --adapter cli --executable sut.exe `
  --report result.json `
  --junit junit.xml `
  --html report.html
```

Все три файла создаются одним выполнением тестов.

## Отображение JUnit

- один `<testcase>` на случай Test Case IR;
- `fail` → `<failure>`;
- `timeout` и `invalid` → `<error>`;
- `inconclusive` → `<skipped>`;
- pass не создаёт failure element;
- компактная трасса каждого случая находится в `<system-out>`;
- миллисекунды переводятся в секунды.

## Автономный HTML

Отчёт содержит общий вердикт, карточки счётчиков, timestamps, durations и
таблицы случаев/шагов: вход, ожидаемый и фактический выход, сообщение. CSS
встроен; scripts, внешних ресурсов, картинок и inline event handlers нет.

## Безопасность

ID плана, имена случаев, символы, наблюдения и сообщения считаются недоверенными
и экранируются отдельно для XML и HTML. Тесты используют `<script>`, `</style>`,
кавычки и амперсанды, а также проверяют детерминизм и отсутствие мутаций входа.
