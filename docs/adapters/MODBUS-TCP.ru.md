# Modbus TCP SUT Adapter v0.7

[English](MODBUS-TCP.md) | [Русский](MODBUS-TCP.ru.md)

Адаптер [`src/adapters/modbus-tcp.ts`](../../src/adapters/modbus-tcp.ts)
реализует `SutAdapter` поверх Modbus TCP. Детерминированный тестовый сервер:
[`test-fixtures/modbus-tcp/fixture-server.ts`](../../test-fixtures/modbus-tcp/fixture-server.ts).

## Возможности

Поддерживаются function codes 1–6: чтение coils, discrete inputs, holding/input
registers, запись одного coil или register. Одновременно выполняется один запрос,
а MBAP transaction ID всегда проверяется. FC15/16, RTU, TLS и разные unit ID для
символов пока не входят в v0.7.

## Отображение символов

Test Plan IR остаётся независимым от протокола. Абстрактный вход отображается в
операцию в конфигурации адаптера, а считанные значения — обратно в стабильный
выходной символ. Адреса и function codes не попадают в план.

```ts
const adapter = new ModbusTcpAdapter({
  host: '127.0.0.1',
  port: 1502,
  unitId: 1,
  allowWrites: false,
  inputs: {
    read_lamp: {
      operation: { kind: 'readCoils', address: 10, quantity: 1 },
      outputs: [{ symbol: 'lamp_on', when: { kind: 'valueAt', index: 0, equals: 1 } }],
      otherwise: 'lamp_off',
    },
  },
});
```

Предикаты: `always`, `equals` для всего вектора и `valueAt` с
`equals`/`min`/`max`. Bits нормализуются в 0/1, registers — в uint16. Правила
проверяются по порядку. Сырые `values`, `functionCode`, `address`, transaction ID
и длительность остаются в metadata.

## Протокол

- Каждый запрос получает transaction ID; protocol ID должен быть 0, unit ID —
  совпадать с конфигурацией.
- TCP‑фрагменты собираются, несколько кадров в одном сегменте разбираются
  последовательно, размеры ADU и буфера ограничены.
- Количество байтов чтения проверяется, write echo обязан точно повторить адрес
  и значение; лишние байты запрещены.
- Ошибка протокола, deadline, отмена или disconnect уничтожают текущий socket;
  `reset()` создаёт новое соединение.

## Безопасность

- Адаптер подключается только к заданному host/port и ничего не сканирует.
- Любая запись в `inputs` или `resetOperations` запрещена без явного
  `allowWrites: true`.
- Проверенная конфигурация глубоко копируется: вызывающий код не может после
  создания адаптера превратить разрешённое чтение в неразрешённую запись.
- Reset по умолчанию только соединяется. Разрушающие reset operations задаются
  явно и выполняются по порядку.
- Записи никогда автоматически не повторяются после ошибки или тайм-аута.
- Тесты используют только `127.0.0.1` и случайный локальный порт.

## Ошибки

`config`, `connect`, `connect-timeout`, `response-timeout`, `protocol`,
`modbus-exception`, `disconnected`, `cancelled`, `closed`, `state`.

## Запуск

```powershell
npm run demo:modbus

npm run cli -- run examples/test-plans/modbus-lamp.json -- `
  --adapter modbus `
  --config examples/adapters/modbus-lamp.json
```

Первая команда полностью безопасна и сама поднимает loopback‑симулятор. Вторая
ожидает уже запущенный endpoint `127.0.0.1:1502` из примера конфигурации.
