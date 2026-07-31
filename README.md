# FSM Generator

Гибридный C++/TypeScript-продукт: текстовое описание конечного автомата
превращается в типизированную модель, проходит проверки и отображается как
SVG-граф.

- C++20: доменная логика, parser, validator и будущие алгоритмы FSM.
- TypeScript: браузерный интерфейс и интерактивная визуализация.
- Будущий мост: компиляция C++-ядра в WebAssembly.

## Запуск

```powershell
npm install
npm run dev
```

## Проверка

```powershell
npm test
npm run build
npm run cpp:test
npm run cpp:build
```

Проектная документация находится в Obsidian:
`D:\_Проекты\Second Brain\Second Brain\01 Projects\FSM Generator`.
