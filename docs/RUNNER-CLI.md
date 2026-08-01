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

The Modbus demo starts an in-process server bound only to `127.0.0.1` on an
ephemeral port and executes a real FC1 request:

```powershell
npm run demo:modbus
npm run demo:http
```

## Run your own program

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

Repeat `--arg` for each argument and `--env NAME` for each environment variable
the child is allowed to receive. The executable is spawned directly without a
shell. See [the process protocol](adapters/CLI-PROCESS.md).

## Output and exit codes

- default text output contains the aggregate verdict, case results and steps;
- `--format json` writes the complete result to stdout;
- `--report file.json` saves the complete result independently of console mode;
- `--junit file.xml` and `--html file.html` create CI and human evidence;
- exit `0` means pass, `1` is a completed non-pass run, and `2` means invalid
  CLI input, an invalid plan or an infrastructure error.

This separation makes the command suitable for local debugging and CI scripts.

## Modbus TCP

Keep endpoint and register mappings outside the plan:

```powershell
npm run cli -- run examples/test-plans/modbus-lamp.json `
  --adapter modbus `
  --config examples/adapters/modbus-lamp.json
```

## HTTP/REST

HTTP inputs are mapped to requests in a separate adapter configuration:

```powershell
npm run cli -- run examples/test-plans/http-ml-classifier.json `
  --adapter http `
  --config examples/adapters/http-ml-classifier.json
```

This supports APIs, game servers and ML inference services. See the
[HTTP adapter reference](adapters/HTTP.md).

The example expects a simulator on `127.0.0.1:1502`; it never scans for a
device. Writes are rejected unless the config explicitly contains
`"allowWrites": true`. Inspect every mapping before enabling that gate.
