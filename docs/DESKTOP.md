# Windows desktop application

Automata Studio is available as a browser workbench and as a Windows x64
desktop application. The desktop build packages the same validated UI together
with the Node runner bundle, canonical examples and schemas.

## Downloads

- `Automata-Studio-Setup-<version>-x64.exe` — assisted per-user NSIS installer
  with Start menu and desktop shortcuts.
- `Automata-Studio-Portable-<version>-x64.exe` — self-contained executable that
  does not install the application.

The v1.3 build is not yet Authenticode-signed. Windows SmartScreen may show an
unknown-publisher warning. Verify the SHA-256 checksum on the GitHub release
before running it. Code signing is planned before declaring the desktop channel
stable.

## Build locally

Requirements: Windows x64, Node.js 24 and npm.

```powershell
npm ci
npm test
npm run desktop:smoke
npm run desktop:dist
```

Artifacts are copied to `artifacts/`. The build script uses an ASCII-only
temporary path so NSIS remains reliable when the repository path contains
Unicode characters.

## Security model

- the renderer is sandboxed and has no Node.js integration;
- context isolation and web security remain enabled;
- permission requests, embedded webviews and arbitrary navigation are denied;
- only project links on approved HTTPS hosts can open in the system browser;
- packaged web assets use a restrictive Content Security Policy.

The v1.3 UI runs browser and virtual-time simulations. A native desktop wizard
for configuring and launching real CLI, HTTP and Modbus adapters is the next
desktop milestone.
