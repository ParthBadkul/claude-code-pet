const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const { exec } = require('child_process');

const HOOK_PORT = 7523;
const BASE_W = 160;
const BASE_H = 185;

const DEFAULT_TIMINGS = {
  workingToWaving:    3000,
  wavingToFrustrated: 10000,
  idleBubbleMin:      20000,
  idleBubbleRandom:   25000,
  idleBobDuration:    1500,
  workBounceDuration: 420,
  waveAnimDuration:   220,
  trembleAnimDuration:400,
};

let win         = null;
let setupWin    = null;
let settingsWin = null;
let tray        = null;
let hookServer  = null;

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
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return {
      ...raw,
      timings: { ...DEFAULT_TIMINGS, ...(raw.timings || {}) },
      petSize: raw.petSize ?? 100,
    };
  } catch { return { timings: { ...DEFAULT_TIMINGS }, petSize: 100 }; }
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
  const cfg   = loadConfig();
  const scale = (cfg.petSize ?? 100) / 100;
  const winW  = Math.round(BASE_W * scale);
  const winH  = Math.round(BASE_H * scale);

  win = new BrowserWindow({
    width:  winW,
    height: winH,
    x: width  - winW - 20,
    y: height - winH - 15,
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
  win.webContents.on('did-finish-load', () => startMusicDetection());

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

// ── Settings window ─────────────────────────────────
function showSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  settingsWin = new BrowserWindow({
    width: 420, height: 560,
    x: Math.round(width  / 2 - 210),
    y: Math.round(height / 2 - 280),
    frame: false, transparent: false,
    alwaysOnTop: true, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  settingsWin.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ── Tray ───────────────────────────────────────────
function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Claude Code Pet');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show',       click: () => win && win.show() },
    { label: 'Settings…',  click: () => showSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit',       click: () => { app.isQuitting = true; app.quit(); } },
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

// ── IPC: settings ──────────────────────────────────
ipcMain.handle('get-settings', () => {
  const cfg = loadConfig();
  return { petName: cfg.petName || 'Claude', timings: cfg.timings, petSize: cfg.petSize ?? 100 };
});

ipcMain.on('save-settings', (_, data) => {
  const cfg     = loadConfig();
  const newName = (data.petName || '').trim() || cfg.petName || 'Claude';
  const petSize = Math.max(50, Math.min(300, data.petSize ?? cfg.petSize ?? 100));
  const newCfg  = { ...cfg, petName: newName, timings: { ...DEFAULT_TIMINGS, ...data.timings }, petSize };
  saveConfig(newCfg);
  ipcMain.removeHandler('get-pet-name');
  ipcMain.handle('get-pet-name', () => newName);
  if (win && !win.isDestroyed()) {
    const scale = petSize / 100;
    const newW  = Math.round(BASE_W * scale);
    const newH  = Math.round(BASE_H * scale);
    const [curX, curY] = win.getPosition();
    const [curW, curH] = win.getSize();
    win.setPosition(curX + (curW - newW), curY + (curH - newH));
    win.setSize(newW, newH);
    win.webContents.send('pet-name-updated', newName);
    win.webContents.send('settings-updated', { petName: newName, timings: newCfg.timings, petSize });
  }
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

ipcMain.on('quit-app', () => { app.isQuitting = true; app.quit(); });

// ── Music detection (Windows SMTC) ─────────────────
// Uses System Media Transport Controls — detects Spotify, browser audio, etc.
let musicCheckTimer = null;
let musicWasPlaying = false;

// Write PS script to a temp file to avoid all shell escaping issues
const MUSIC_PS_FILE = path.join(app.getPath('temp'), 'claude-pet-music-check.ps1');
const MUSIC_PS_SCRIPT = [
  'try {',
  '  Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq \'AsTask\' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncOperation`1\' })[0]',
  '  function Await($WinRtTask, $ResultType) {',
  '    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
  '    $netTask = $asTask.Invoke($null, @($WinRtTask))',
  '    $netTask.Wait(-1) | Out-Null',
  '    $netTask.Result',
  '  }',
  '  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]',
  '  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  '  $playing = $false',
  '  foreach ($s in $mgr.GetSessions()) {',
  '    if ($s.GetPlaybackInfo().PlaybackStatus -eq "Playing") { $playing = $true; break }',
  '  }',
  '  $playing.ToString().ToLower()',
  '} catch { "false" }',
].join('\r\n');

function startMusicDetection() {
  if (process.platform !== 'win32') return;
  fs.writeFileSync(MUSIC_PS_FILE, MUSIC_PS_SCRIPT, 'utf8');
  function poll() {
    exec(
      `powershell -NonInteractive -NoProfile -File "${MUSIC_PS_FILE}"`,
      { timeout: 5000 },
      (err, stdout) => {
        const isPlaying = !err && stdout.trim().toLowerCase() === 'true';
        if (isPlaying !== musicWasPlaying) {
          musicWasPlaying = isPlaying;
          if (win && !win.isDestroyed()) win.webContents.send('music-state', isPlaying);
        }
        musicCheckTimer = setTimeout(poll, 5000);
      }
    );
  }
  poll();
}

function stopMusicDetection() {
  clearTimeout(musicCheckTimer);
  musicCheckTimer = null;
  try { fs.unlinkSync(MUSIC_PS_FILE); } catch { /* ignore */ }
}

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
app.on('before-quit', () => { if (hookServer) hookServer.close(); stopMusicDetection(); });
