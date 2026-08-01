# Next task for Claude — JUnit and HTML evidence reports v0.8

## Context

Repository: `vitalya834/automata-studio`.

Version v0.7 executes Test Plan IR against external CLI programs and Modbus TCP
endpoints. The runner returns a complete `TestRunResult`, but CI systems and
humans need durable, safe reports beyond raw JSON.

## Branch and ownership

Create `claude/evidence-reports-v08` from
`agent/cli-adapter-integration-v06` after the v0.7 commit is pushed.

Own only:

- `src/reports.ts`
- `src/reports.test.ts`
- `docs/REPORTS.md`
- `docs/REPORTS.ru.md`

Do not edit the runner CLI, UI, adapters, package metadata, schemas or existing
tests. Describe CLI integration changes in the handoff.

## Required API

Implement pure functions with no filesystem or network access:

```ts
testRunToJUnit(result: TestRunResult, options?): string
testRunToHtml(result: TestRunResult, options?): string
```

Requirements:

1. JUnit XML has one testsuite, one testcase per Test Case IR case, accurate
   tests/failures/errors/skipped/time counts and stable deterministic ordering.
2. Map `fail` to `<failure>`, `timeout`/`invalid` to `<error>`, and
   `inconclusive` to `<skipped>`; include compact step traces.
3. HTML is a standalone UTF-8 document with summary cards, case/step tables,
   timestamps, durations, expected and observed symbols, and messages.
4. Escape every untrusted value for its context. A plan/case/symbol containing
   `<script>`, quotes, ampersands or `</style>` must never create executable
   markup or invalid XML.
5. No external scripts, CSS, fonts, images, network resources or inline event
   handlers. Static inline CSS is allowed.
6. Output must be deterministic for the same result. Do not include current
   time; use timestamps already present in the input.
7. Do not mutate `TestRunResult`. Public API contains no `any`.

## Tests

Cover every verdict, empty step traces, null output, metadata/messages,
millisecond-to-seconds conversion, XML special characters, hostile HTML strings,
determinism and input non-mutation.

## Acceptance

- `npm test` and `npm run build` pass;
- generated XML parses with a strict XML parser available in the existing test
  environment, or is checked with exact structural assertions if none exists;
- English and Russian user documentation include examples;
- focused commits, pushed to the Claude branch, never directly to `main`.
