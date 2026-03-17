const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');

const HOOK_PORT = 7523;

let win        = null;
let setupWin   = null;
let tray       = null;
let hookServer = null;

// ── Hook HTTP server ───────────────────────────────
// Claude Code hooks POST to http://localhost:7523/event
// Supported types: prompt_submit, pre_tool_use, stop
function startHookServer() {
  hookServer = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200).end('ok');
      try {
        const { type } = JSON.parse(body);
        if (!win || win.isDestroyed()) return;
        if (type === 'prompt_submit' || type === 'pre_tool_use') {
          win.webContents.send('claude-state', 'working');
        } else if (type === 'stop') {
          win.webContents.send('claude-state', 'idle');
        }
      } catch { /* ignore malformed */ }
    });
  });

  hookServer.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[pet] Port ${HOOK_PORT} already in use — hook server not started`);
    }
  });

  hookServer.listen(HOOK_PORT, '127.0.0.1');
}

// ── Config ─────────────────────────────────────────
const CONFIG_FILE = path.join(app.getPath('userData'), 'claude-pet-config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveConfig(data) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── Tray icon ──────────────────────────────────────
function makeTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  // Fallback: programmatic orange circle
  const size = 16;
  const buf  = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
      if (d < 7) { buf[i]=0xDA; buf[i+1]=0x77; buf[i+2]=0x56; buf[i+3]=0xFF; }
    }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ── Pet window ─────────────────────────────────────
function createWindow(petName) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 160,
    height: 185,
    x: width  - 180,
    y: height - 200,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow:   false,
    resizable:   false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.platform === 'win32') {
    win.setAlwaysOnTop(true, 'screen-saver');
  } else if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // Mouse pass-through for transparent areas by default
  win.setIgnoreMouseEvents(true, { forward: true });

  // Store name for renderer to retrieve
  ipcMain.removeHandler('get-pet-name');
  ipcMain.handle('get-pet-name', () => petName || 'Claude');

  win.on('closed', () => { win = null; });
}

// ── Setup window (first run) ───────────────────────
function showSetupWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  setupWin = new BrowserWindow({
    width:       360,
    height:      320,
    x:           Math.round(width  / 2 - 180),
    y:           Math.round(height / 2 - 160),
    frame:       false,
    transparent: false,
    alwaysOnTop: true,
    resizable:   false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  setupWin.loadFile(path.join(__dirname, 'src', 'setup.html'));

  let submitted = false;

  ipcMain.once('save-name', (_, rawName) => {
    submitted = true;
    const petName = (rawName || '').trim() || 'Claude';
    saveConfig({ petName });
    if (setupWin && !setupWin.isDestroyed()) setupWin.close();
    createWindow(petName);
  });

  setupWin.on('closed', () => {
    setupWin = null;
    if (!submitted && !win) createWindow('Claude');
  });
}

// ── Rename window ───────────────────────────────────
let renameWin = null;

function showRenameWindow() {
  if (renameWin && !renameWin.isDestroyed()) { renameWin.focus(); return; }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const cfg = loadConfig();

  renameWin = new BrowserWindow({
    width: 360, height: 320,
    x: Math.round(width  / 2 - 180),
    y: Math.round(height / 2 - 160),
    frame: false, transparent: false,
    alwaysOnTop: true, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  const currentName = encodeURIComponent(cfg.petName || 'Claude');
  renameWin.loadFile(path.join(__dirname, 'src', 'setup.html'), {
    query: { mode: 'rename', name: currentName },
  });

  ipcMain.once('save-name', (_, rawName) => {
    const newName = (rawName || '').trim() || cfg.petName || 'Claude';
    saveConfig({ ...cfg, petName: newName });
    ipcMain.removeHandler('get-pet-name');
    ipcMain.handle('get-pet-name', () => newName);
    if (win && !win.isDestroyed()) win.webContents.send('pet-name-updated', newName);
    if (renameWin && !renameWin.isDestroyed()) renameWin.close();
  });

  renameWin.on('closed', () => { renameWin = null; });
}

// ── Tray ───────────────────────────────────────────
function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Claude Code Pet');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show',        click: () => win && win.show() },
    { label: 'Rename Pet…', click: () => showRenameWindow() },
    { type: 'separator' },
    { label: 'Quit',        click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// ── IPC: mouse / drag ──────────────────────────────
ipcMain.on('set-ignore-mouse', (_, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true });
});
ipcMain.on('drag-start', () => {});
ipcMain.on('move-window', (_, { deltaX, deltaY }) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + deltaX, y + deltaY);
});
ipcMain.on('drag-end', () => {});

// ── App lifecycle ──────────────────────────────────
app.whenReady().then(async () => {
  startHookServer();
  createTray();

  const cfg = loadConfig();
  if (cfg.petName) {
    createWindow(cfg.petName);
  } else {
    showSetupWindow();
  }

  app.on('activate', () => { if (!win) createWindow(loadConfig().petName || 'Claude'); });
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive via tray
app.on('before-quit', () => { if (hookServer) hookServer.close(); });
