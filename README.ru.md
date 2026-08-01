# Automata Studio

[English](README.md) | [Русский](README.ru.md)

Automata Studio — гибридная C++/TypeScript-платформа модельного тестирования.
Она генерирует модели конечных автоматов по воспроизводимым ограничениям,
импортирует старый формат `.fsm`, проверяет свойства автоматов, синтезирует
тестовые наборы и показывает модели и тесты в виде графов и JSON.

Это независимый от протокола движок для тестирования программ, сервисов,
встраиваемых систем и физических устройств. Граф является представлением, а
формальная семантика, тестовый оракул, воспроизводимое выполнение и покрытие —
ядром продукта. Один абстрактный тест-план можно выполнять на симуляторе,
CLI-процессе, HTTP-сервисе, Modbus/CAN-устройстве или другом SUT через адаптер.

## Возможности v0.7

- запускаемый Node.js runner: проверка планов, внешние SUT, text/JSON-трассы,
  файлы отчётов и exit codes для CI;
- настоящий Modbus TCP‑адаптер: FC1–FC6, MBAP transaction ID, фрагментация TCP
  и отображение значений в абстрактные символы;
- неразрушающий reset и обязательный `allowWrites: true` для любой записи;
- loopback‑симулятор и сквозная демонстрация `npm run demo:modbus`;
- строгая длина ответов, дедлайны, отмена и закрытие sockets;
- Modbus‑адреса хранятся в адаптере, а Test Plan IR остаётся независимым.

## Возможности v0.6

- Node.js-адаптер для тестирования внешних программ через строгий протокол
  JSON Lines по stdin/stdout;
- жизненный цикл процесса, тайм-ауты ответа, отмена и детерминированный reset;
- прямой запуск executable без shell и явный список разрешённых переменных
  окружения;
- ограничение размера строк и stderr, request ID и отклонение ошибочных ответов;
- выполнение Test Plan IR на настоящем дочернем процессе;
- запускаемый terminal runner с валидацией, text/JSON, exit codes для CI и
  сохранением полного отчёта;
- 100 автоматических TypeScript-тестов и проверки C++-ядра/runner.

Браузер не может запускать локальные программы из-за своей модели безопасности.
CLI-адаптер работает как Node.js API и использует тот же `runTestPlan`, что и
видимая панель выполнения в браузере.

## Временное тестирование v0.5

- визуальная лаборатория TFSM с пятью профилями;
- виртуальное время для временных guards, тайм-аутов состояний, задержек выхода
  и комбинированных моделей;
- генерация граничных тестов для открытых и закрытых границ интервалов;
- вердикты PASS, FAIL, EARLY, LATE, TIMEOUT и INVALID;
- постоянные, интервальные и линейно зависящие от времени задержки;
- экспорт временных кампаний в JSON;
- визуализация Alur–Dill без некорректной имитации zone/region engine.

## Основа продукта

- канонический Model IR 1.0 для Mealy, Moore, EFSM и пяти TFSM-профилей;
- Test Plan IR с JSON Schema и стабильной сериализацией;
- текстовый DSL и восстановленный формат `F/s/i/o/n0/p`;
- воспроизводимая генерация детерминированных и недетерминированных Mealy FSM;
- анализ полноты, детерминизма, алфавитов и достижимости;
- transition-cover тесты с кратчайшими путями доступа;
- TypeScript и C++20 runner, трассы, дедлайны и отмена;
- интерактивные графы, JSON, диагностика и экспорт тестов.

Transition cover является структурным покрытием, а не гарантией полной
конформности. W/Wp/H/HSI и другие методы добавляются отдельно с явными
предусловиями.

## Запуск веб-лаборатории

```powershell
npm install
npm run dev
```

Откройте локальный адрес, который выведет Vite.

## Проверка

```powershell
npm test
npm run build
npm run cpp:test
npm run cpp:build
```

## C++ CLI

После `npm run cpp:build`:

```powershell
.\build-cpp\fsm-cli.exe parse examples\turnstile.fsm
.\build-cpp\fsm-cli.exe analyze examples\turnstile.fsm
.\build-cpp\fsm-cli.exe cover examples\turnstile.fsm
.\build-cpp\fsm-cli.exe generate --name Demo --states 8 --inputs 3 --outputs 2 --seed 2025
```

## Runner для внешнего SUT

```powershell
npm run cli -- validate examples/test-plans/turnstile-transition-cover.json
npm run demo:cli
npm run demo:modbus
```

Настройка executable, allowlist окружения, JSON и файлы отчётов описаны в
[документации runner CLI](docs/RUNNER-CLI.ru.md).

## Документация

- [Двуязычный индекс документации](docs/README.ru.md)
- [Архитектура продукта](docs/PRODUCT-ARCHITECTURE.ru.md)
- [Таксономия автоматов](docs/AUTOMATA-TAXONOMY.ru.md)
- [Архитектура выполнения тестов](docs/TEST-EXECUTION.ru.md)
- [Временное тестирование](docs/TIMED-TESTING.ru.md)
- [Runner CLI для внешних SUT](docs/RUNNER-CLI.ru.md)
- [Modbus TCP‑адаптер](docs/adapters/MODBUS-TCP.ru.md)
- [CLI Process SUT Adapter](docs/adapters/CLI-PROCESS.ru.md)

Восстановленное Java-приложение 2010 года хранится вне репозитория в
`D:\FSMTest-Recovered-2010`. Оно используется для исследования поведения и не
распространяется, поскольку его лицензия и происхождение не установлены.
