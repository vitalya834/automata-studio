# External SUT runner CLI

[English](RUNNER-CLI.md) | [Русский](RUNNER-CLI.ru.md)

The Node.js runner turns the shared Test Plan IR and adapter API into an
executable product surface. It validates plans, runs them against an external
program, prints traces and can save complete JSON evidence.

## Quick start

```powershell
npm install
npm run cli -- validate examples/test-plans/turnstile-transition-cover.json
npm run demo:cli
```

The demo launches the bundled turnstile fixture as a real child process and
executes two generated test cases. It does not mock the adapter boundary.

## Run your own program

```powershell
npm run cli -- run path/to/plan.json `
  --adapter cli `
  --executable path/to/sut.exe `
  --arg --json-lines `
  --response-timeout 5000 `
  --report artifacts/result.json
```

Repeat `--arg` for each argument and `--env NAME` for each environment variable
the child is allowed to receive. The executable is spawned directly without a
shell. See [the process protocol](adapters/CLI-PROCESS.md).

## Output and exit codes

- default text output contains the aggregate verdict, case results and steps;
- `--format json` writes the complete result to stdout;
- `--report file.json` saves the complete result independently of console mode;
- exit `0` means pass, `1` is a completed non-pass run, and `2` means invalid
  CLI input, an invalid plan or an infrastructure error.

This separation makes the command suitable for local debugging and CI scripts.
