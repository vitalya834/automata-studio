# Real-world GitHub API dogfood test

[English](REAL-WORLD-DEMO.md) | [Русский](REAL-WORLD-DEMO.ru.md)

Automata Studio can test an actual external product instead of a fixture. This
scenario treats the public GitHub REST API as the SUT and verifies the published
contract of the Automata Studio repository: public visibility, `main` as the
default branch, MIT licensing and release `v1.0.0`.

```powershell
npm run cli -- run examples/test-plans/github-api-product.json -- `
  --adapter http --config examples/adapters/http-github-api.json `
  --report github-result.json --junit github-junit.xml --html github-report.html
```

The test performs four unauthenticated read-only GET requests. It does not write
to GitHub, use credentials or exceed the adapter's 1 MiB response limit. Since
this checks live external state, it requires internet access and may be affected
by GitHub availability or anonymous API rate limits.
