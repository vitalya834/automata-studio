# Evidence reports

[English](REPORTS.md) | [Русский](REPORTS.ru.md)

Automata Studio converts the same immutable `TestRunResult` into JSON, JUnit XML
and a standalone HTML report. Report generation is pure and deterministic: it
does not read files, contact a network, mutate the result or insert current time.

## CLI

```powershell
npm run cli -- run plan.json -- --adapter cli --executable sut.exe `
  --report result.json `
  --junit junit.xml `
  --html report.html
```

All three files can be emitted by one test execution.

## JUnit mapping

- one `<testcase>` per Test Case IR case;
- `fail` → `<failure>`;
- `timeout` and `invalid` → `<error>`;
- `inconclusive` → `<skipped>`;
- `pass` has no failure element;
- every case carries a compact step trace in `<system-out>`;
- durations are converted from milliseconds to seconds.

## Standalone HTML

The report contains overall verdict/count cards, timestamps, durations and
case/step tables with inputs, expected outputs, observations and messages. CSS
is embedded. There are no scripts, external resources, images or inline event
handlers, so the file can be archived and opened offline.

## Safety

Plan IDs, case names, symbols, adapter observations and error messages are
untrusted. Every value is escaped for its XML or HTML context. Tests include
`<script>`, `</style>`, quotes and ampersands and verify deterministic output and
input non-mutation.
