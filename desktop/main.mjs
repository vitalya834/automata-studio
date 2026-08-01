import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trustedExternalUrl } from './security.mjs';

const APP_ID = 'io.github.vitalya834.automata-studio';
const SMOKE_TEST = process.argv.includes('--smoke-test');
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(desktopDir, '..', 'dist', 'index.html');

function hardenSession() {
  const desktopSession = session.defaultSession;
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  desktopSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0d0f',
    autoHideMenuBar: true,
    title: 'Automata Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (trustedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (SMOKE_TEST) {
    window.webContents.once('did-finish-load', async () => {
      try {
        const state = await window.webContents.executeJavaScript(`(() => {
          const navigation = document.querySelector('.workspace-nav');
          const languageSpans = [...document.querySelectorAll('[data-lang]')];
          return {
            navigationDisplay: navigation ? getComputedStyle(navigation).display : null,
            visibleLanguages: [...new Set(languageSpans.filter((element) => getComputedStyle(element).display !== 'none').map((element) => element.dataset.lang))],
          };
        })()`);
        const visibleLanguages = new Set(state.visibleLanguages);
        if (state.navigationDisplay !== 'grid' || visibleLanguages.size !== 1) {
          throw new Error(`Renderer styles are not active: ${JSON.stringify(state)}`);
        }
        console.log(`AUTOMATA_STUDIO_DESKTOP_SMOKE_OK ${JSON.stringify(state)}`);
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`Desktop smoke test failed: ${code} ${description}`);
      app.exit(1);
    });
  } else {
    window.once('ready-to-show', () => window.show());
  }

  void window.loadFile(indexPath);
  return window;
}

app.setAppUserModelId(APP_ID);
app.enableSandbox();

app.whenReady().then(() => {
  hardenSession();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
