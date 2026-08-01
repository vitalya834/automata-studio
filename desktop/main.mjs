import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trustedExternalUrl } from './security.mjs';

const APP_ID = 'io.github.vitalya834.automata-studio';
const SMOKE_TEST = process.argv.includes('--smoke-test');
const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(desktopDir, '..', 'dist', 'index.html');

function hardenSession() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
    window.webContents.once('did-finish-load', () => {
      console.log('AUTOMATA_STUDIO_DESKTOP_SMOKE_OK');
      app.exit(0);
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
