# HTTP/REST SUT adapter

[English](HTTP.md) | [Русский](HTTP.ru.md)

The HTTP adapter connects protocol-neutral FSM inputs to REST operations. It is
intended for web APIs, microservices, game servers, model-serving endpoints and
training-pipeline control APIs. Test plans contain business symbols; URLs,
headers and payloads remain in a separate adapter configuration.

## Run

```powershell
npm run cli -- run examples/test-plans/http-ml-classifier.json `
  --adapter http --config examples/adapters/http-ml-classifier.json `
  --html ml-report.html --junit ml-junit.xml
```

`npm run demo:http` starts an ephemeral loopback game server and checks start,
pause, resume and victory transitions end to end.

## Configuration

```json
{
  "baseUrl": "http://127.0.0.1:8080",
  "maxResponseBytes": 1048576,
  "reset": { "method": "POST", "path": "/reset" },
  "inputs": {
    "predict_positive": {
      "method": "POST",
      "path": "/v1/predict",
      "body": { "features": [0.9, 0.8, 0.7] },
      "output": { "kind": "json-pointer", "pointer": "/prediction/label" }
    }
  }
}
```

Output selectors are `json-pointer`, `text`, and `status`. JSON scalar values
become FSM symbols; objects and arrays use compact JSON. Every test case invokes
the optional reset operation before its first step.

## Safety boundaries

- only HTTP and HTTPS base URLs are accepted;
- operation paths cannot escape to another origin;
- redirects are rejected;
- embedded URL credentials and transport-controlled headers are rejected;
- responses are bounded to 1 MiB by default;
- the test-plan deadline is propagated as an abort signal.

Tokens may be supplied as headers in a local config, but adapter configurations
containing secrets must not be committed. HTTP enables behavioral and contract
testing of an ML service; it does not validate statistical model quality by
itself.

## ML and game workflows

For ML systems, model loading, warm-up, inference, fallback and deployment can
be states; samples and control calls can be inputs; labels, status or error
classes can be outputs. For games, menus, sessions, pause, matchmaking and
victory/defeat are natural states. The same runner then provides deadlines,
repeatable sequences, JUnit/HTML evidence and CI exit codes.

Use `npm run dataset` to synthesize reproducible JSONL state-transition records
for sequence-model experiments. This is synthetic supervised data from the FSM
oracle, not a replacement for real-world training and validation data.
