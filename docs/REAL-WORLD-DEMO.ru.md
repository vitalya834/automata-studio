# Проверка реального продукта через GitHub API

[English](REAL-WORLD-DEMO.md) | [Русский](REAL-WORLD-DEMO.ru.md)

Automata Studio умеет проверять внешний продукт, а не только тестовую заглушку.
В этом сценарии SUT является публичный GitHub REST API. Проверяется контракт
репозитория Automata Studio: публичная доступность, основная ветка `main`,
лицензия MIT и релиз `v1.0.0`.

```powershell
npm run cli -- run examples/test-plans/github-api-product.json -- `
  --adapter http --config examples/adapters/http-github-api.json `
  --report github-result.json --junit github-junit.xml --html github-report.html
```

Тест выполняет четыре неавторизованных GET-запроса только для чтения. Он ничего
не изменяет на GitHub, не использует секреты и ограничивает ответ одним МиБ.
Поскольку проверяется живое внешнее состояние, необходим интернет; результат
может зависеть от доступности GitHub и лимитов анонимного API.
