// OmniContext desktop app: edit your profile/projects/handoffs, configure sync, connect Claude.

const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
import { Store, VERSION } from '../src/store.js';
import { buildContext } from '../src/context.js';
import { buildGraph } from '../src/graph.js';
import { sync, initSync, createGithubRemote, syncStatus } from '../src/sync.js';
import { startHttpServer, startTunnel, serveToken } from '../src/http.js';
import { installClaudeDesktop, installClaudeCode, installCodex, installCursor, installGemini, claudeDesktopConfigPath } from '../src/install.js';

const store = new Store();
let win = null;
let tray = null;
let quitting = false;
let lastSync = null;

function serverScript() {
  const packaged = path.join(process.resourcesPath, 'omnicontext.mjs');
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', '..', 'dist', 'omnicontext.mjs');
}

// ChatGPT link: the MCP server over HTTP behind a Cloudflare quick tunnel, alive while the app runs.
let chatgpt = null;
function stopChatgpt() {
  if (!chatgpt) return;
  try {
    chatgpt.child.kill();
  } catch {}
  chatgpt.srv.close();
  chatgpt = null;
}

function doSync() {
  try {
    if (!syncStatus(store.home).configured) return { ok: false, reason: 'not configured' };
    lastSync = { ...sync(store.home, store.device), at: new Date().toISOString() };
  } catch (e) {
    lastSync = { ok: false, reason: e.message, at: new Date().toISOString() };
  }
  win?.webContents.send('synced', lastSync);
  return lastSync;
}

const api = {
  info: () => ({
    version: VERSION,
    home: store.home,
    device: store.device,
    local: store.getLocal(),
    sync: { ...syncStatus(store.home), last: lastSync },
    claudeDesktopConfig: claudeDesktopConfigPath(),
    platform: process.platform,
  }),
  getProfile: () => store.getProfile(),
  setProfile: (content) => store.setProfile(content),
  remember: (fact) => store.remember(fact),
  listProjects: () => store.listProjects(),
  upsertProject: (p) => store.upsertProject({ ...p, replaceLists: true }),
  addNote: (slug, text) => store.addProjectNote(slug, text),
  deleteProject: (slug) => store.deleteProject(slug),
  listHandoffs: (status) => store.listHandoffs({ status: status || 'all' }),
  setHandoffStatus: (id, status) => store.setHandoffStatus(id, status),
  deleteHandoff: (id) => store.deleteHandoff(id),
  graph: () => buildGraph(store),
  listInbox: () => store.listInbox(),
  capture: (text, project) => store.capture(text, { project }),
  fileInbox: (id, opts) => store.fileInbox(id, opts),
  exportAll: async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'omnicontext-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.exportAll(), null, 2) + '\n');
    return r.filePath;
  },
  importAll: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return null;
    return store.importAll(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
  },
  context: () => buildContext(store, {}),
  setDevice: (name) => store.setLocal({ deviceName: name }),
  setLocal: (patch) => store.setLocal(patch),
  syncNow: () => doSync(),
  connectRemote: (url) => initSync(store.home, url, store.device),
  connectGithub: (name) => createGithubRemote(store.home, name || undefined, store.device),
  installDesktop: (mode) =>
    installClaudeDesktop(
      mode === 'npx'
        ? { command: 'npx', args: ['-y', '@aaryanbindage/omnicontext', 'mcp'] }
        : { command: process.execPath, args: [serverScript(), 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    ),
  installCode: () => installClaudeCode(),
  chatgptStatus: () => (chatgpt ? chatgpt.url : null),
  chatgptStart: async (rotate) => {
    stopChatgpt();
    if (rotate) serveToken(store, { rotate: true });
    const srv = await startHttpServer({ store, port: 0 });
    try {
      const t = await startTunnel(srv.port);
      chatgpt = { srv, child: t.child, url: t.url + srv.path };
    } catch (e) {
      srv.close();
      throw e;
    }
    return chatgpt.url;
  },
  chatgptStop: () => stopChatgpt(),
  installCodex: () => installCodex(),
  installCursor: () => installCursor(),
  installGemini: () => installGemini(),
  pickFolder: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  openData: () => shell.openPath(store.home),
  openUrl: (url) => /^https:\/\//.test(url) && shell.openExternal(url),
  copy: (text) => clipboard.writeText(String(text)),
};

ipcMain.handle('omni', async (_e, method, ...args) => {
  if (!Object.hasOwn(api, method)) throw new Error(`Unknown method ${method}`);
  return api[method](...args);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 760,
    minHeight: 520,
    title: 'OmniContext',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // OMNICONTEXT_SCREENSHOT=out.png[,tab] renders one tab to a PNG and exits (used for docs).
  const shot = process.env.OMNICONTEXT_SCREENSHOT;
  if (shot) {
    const [file, tab = 'profile'] = shot.split(',');
    win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
    win.webContents.once('did-finish-load', async () => {
      await win.webContents.executeJavaScript(`document.querySelector('nav button[data-tab="${tab}"]').click();`);
      await new Promise((r) => setTimeout(r, 800));
      await win.webContents.executeJavaScript(
        process.env.OMNICONTEXT_SCREENSHOT_JS || `document.querySelector('#projectList li[data-slug]')?.click();`,
      );
      await new Promise((r) => setTimeout(r, 1200));
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      quitting = true;
      app.exit(0);
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Keep running in the tray so background sync continues.
  win.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('OmniContext');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open OmniContext', click: showWindow },
      { label: 'Sync now', click: doSync },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    createWindow();
    try {
      createTray();
    } catch {
      tray = null;
    }
    // Background sync: on launch and every N minutes (default 5).
    setTimeout(doSync, 3000);
    setInterval(() => {
      if (store.getLocal().autoSync !== false) doSync();
    }, Math.max(1, Number(store.getLocal().syncMinutes) || 5) * 60000);
    app.on('activate', showWindow);
  });
  app.on('before-quit', () => {
    quitting = true;
    stopChatgpt();
    try {
      if (syncStatus(store.home).configured) sync(store.home, store.device, { timeout: 10000 });
    } catch {}
  });
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
}
