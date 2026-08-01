# Runner CLI для внешнего SUT

[English](RUNNER-CLI.md) | [Русский](RUNNER-CLI.ru.md)

Node.js runner превращает общий Test Plan IR и API адаптеров в запускаемый
продукт. Он проверяет план, выполняет его на внешней программе, печатает трассу
и сохраняет полный JSON-отчёт.

## Быстрый запуск

```powershell
npm install
npm run cli -- validate examples/test-plans/turnstile-transition-cover.json
npm run demo:cli
```

Демонстрация запускает turnstile как настоящий дочерний процесс и выполняет два
сгенерированных тестовых случая — граница адаптера не подменяется mock-объектом.

Modbus‑демонстрация поднимает сервер только на `127.0.0.1` со случайным портом и
выполняет настоящий запрос FC1:

```powershell
npm run demo:modbus
```

## Тестирование своей программы

```powershell
npm run cli -- run path/to/plan.json `
  --adapter cli `
  --executable path/to/sut.exe `
  --arg --json-lines `
  --response-timeout 5000 `
  --report artifacts/result.json `
  --junit artifacts/junit.xml `
  --html artifacts/report.html
```

Повторяйте `--arg` для аргументов и `--env NAME` для разрешённых переменных
окружения. Executable запускается напрямую без shell. Формат обмена описан в
[документации CLI-адаптера](adapters/CLI-PROCESS.ru.md).

## Вывод и exit codes

- text по умолчанию содержит общий вердикт, случаи и шаги;
- `--format json` пишет полный результат в stdout;
- `--report file.json` сохраняет полный результат независимо от режима консоли;
- `--junit file.xml` и `--html file.html` создают отчёты для CI и человека;
- код `0` означает pass, `1` — завершённый non-pass, `2` — неверные аргументы,
  план или инфраструктурная ошибка.

Так команду удобно использовать и вручную, и в CI.

## Modbus TCP

Endpoint и регистры остаются вне тест-плана:

```powershell
npm run cli -- run examples/test-plans/modbus-lamp.json `
  --adapter modbus `
  --config examples/adapters/modbus-lamp.json
```

Пример ожидает симулятор на `127.0.0.1:1502` и ничего не сканирует. Записи
отклоняются без явного `"allowWrites": true`. Перед включением этого флага
необходимо проверить каждое отображение символа.
