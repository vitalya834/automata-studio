import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readBitmapHeader(path) {
  const buffer = await readFile(path);
  assert.equal(buffer.toString('ascii', 0, 2), 'BM');
  return {
    width: buffer.readInt32LE(18),
    height: buffer.readInt32LE(22),
    bitsPerPixel: buffer.readUInt16LE(28),
  };
}

test('ships branded NSIS artwork and shortcut configuration', async () => {
  const packageDocument = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const nsis = packageDocument.build.nsis;
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.createDesktopShortcut, 'always');
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.shortcutName, 'Automata Studio');
  assert.equal(nsis.installerHeader, 'build/installerHeader.bmp');
  assert.equal(nsis.installerSidebar, 'build/installerSidebar.bmp');
  assert.equal(nsis.uninstallerSidebar, 'build/uninstallerSidebar.bmp');

  assert.deepEqual(await readBitmapHeader(new URL('../build/installerHeader.bmp', import.meta.url)), {
    width: 150, height: 57, bitsPerPixel: 24,
  });
  assert.deepEqual(await readBitmapHeader(new URL('../build/installerSidebar.bmp', import.meta.url)), {
    width: 164, height: 314, bitsPerPixel: 24,
  });
  assert.deepEqual(await readBitmapHeader(new URL('../build/uninstallerSidebar.bmp', import.meta.url)), {
    width: 164, height: 314, bitsPerPixel: 24,
  });
});
