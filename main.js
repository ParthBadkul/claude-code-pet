const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const os   = require('os');
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

// ── IPC: hooks management ──────────────────────────
ipcMain.handle('get-hook-status', () => ({ installed: hooksAreInstalled() }));

ipcMain.handle('install-hooks', () => {
  try {
    installClaudeHooks();
    const cfg = loadConfig();
    saveConfig({ ...cfg, hooksInstalled: true });
    return { ok: true, installed: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('uninstall-hooks', () => {
  try {
    uninstallClaudeHooks();
    const cfg = loadConfig();
    saveConfig({ ...cfg, hooksInstalled: false });
    return { ok: true, installed: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Music detection (cross-platform) ───────────────────────────────────────
//
// Windows: PowerShell System Media Transport Controls (SMTC)
//   — detects Spotify, Chrome, Edge, any registered media session
// macOS:   Two-tier osascript chain
//   Tier 1 (AppleScript): Spotify, Apple Music, iTunes — zero dependencies,
//          works Catalina through Sequoia, ~20–60ms per call
//   Tier 2 (JXA + ObjC bridge): MediaRemote.framework for browser audio
//          (Chrome/Safari/Firefox playing YouTube, Spotify Web, etc.)
//          No CLTs required — JXA's ObjC bridge dlopen()s the dylib directly
// Other:   Detection disabled, stays false
//
let musicCheckTimer = null;
let musicWasPlaying = false;

const MUSIC_POLL_MS      = process.platform === 'darwin' ? 3000 : 5000;
const MUSIC_EXEC_TIMEOUT = process.platform === 'darwin' ? 4000 : 5000;

// ── Windows: PowerShell SMTC script ────────────────
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

// ── macOS Tier 1: AppleScript multi-app check ──────
// Each app block wrapped in try/end try — non-running apps throw silently.
// Covers Spotify, Apple Music, and legacy iTunes (Catalina).
const MAC_AS_TIER1_CMD = [
  'osascript',
  '-e', 'set playing to false',
  '-e', 'try',
  '-e', 'tell application "Spotify" to if player state is playing then set playing to true',
  '-e', 'end try',
  '-e', 'try',
  '-e', 'tell application "Music" to if player state is playing then set playing to true',
  '-e', 'end try',
  '-e', 'try',
  '-e', 'tell application "iTunes" to if player state is playing then set playing to true',
  '-e', 'end try',
  '-e', 'playing as string',
].map((tok, i) => i === 0 ? tok : `'${tok}'`).join(' ');

// ── macOS Tier 2: JXA + MediaRemote.framework ──────
// Covers browser audio: Chrome/Safari/Firefox playing YouTube, Spotify Web, etc.
// ObjC.import loads MediaRemote.framework via dlopen() — no Xcode CLTs needed,
// the framework dylib ships with every macOS since 10.8.
// dispatch_semaphore safely awaits the async callback without CFRunLoopRun risk.
// kMRMediaRemoteNowPlayingInfoPlaybackRate > 0 means actively playing.
// Any load failure or missing symbol falls back to 'false'.
const MAC_JXA_SCRIPT = (
  "ObjC.import('Foundation');" +
  "var r='false';" +
  "try{" +
    "var b=$.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework');" +
    "if(!b.isLoaded){b.load;}" +
    "var fn=$.MRMediaRemoteGetNowPlayingInfo;" +
    "if(typeof fn!=='undefined'){" +
      "var s=$.dispatch_semaphore_create(0);" +
      "fn($.dispatch_get_global_queue(0,0),function(info){" +
        "try{" +
          "if(info&&!info.isNil()){" +
            "var rate=info.objectForKey('kMRMediaRemoteNowPlayingInfoPlaybackRate');" +
            "if(rate&&!rate.isNil()&&rate.doubleValue>0){r='true';}" +
          "}" +
        "}catch(e){}" +
        "$.dispatch_semaphore_signal(s);" +
      "});" +
      "$.dispatch_semaphore_wait(s,$.dispatch_time(0,2500000000));" + // 2.5s — DISPATCH_TIME_FOREVER is a C macro, not exposed in JXA
    "}" +
  "}catch(e){}" +
  "r;"
);
const MAC_JXA_TIER2_CMD =
  `osascript -l JavaScript -e '${MAC_JXA_SCRIPT.replace(/'/g, "'\\''")}'`;

// ── Helper: emit IPC only on state change ──────────
function emitMusicState(isPlaying) {
  if (isPlaying !== musicWasPlaying) {
    musicWasPlaying = isPlaying;
    if (win && !win.isDestroyed()) win.webContents.send('music-state', isPlaying);
  }
}

// ── macOS poll: Tier 1 → Tier 2 on false ───────────
function pollMacOS(poll) {
  exec(MAC_AS_TIER1_CMD, { timeout: MUSIC_EXEC_TIMEOUT }, (err1, stdout1) => {
    if (!err1 && stdout1.trim().toLowerCase() === 'true') {
      emitMusicState(true);
      musicCheckTimer = setTimeout(poll, MUSIC_POLL_MS);
      return;
    }
    // Tier 1 returned false — check browser audio via JXA
    exec(MAC_JXA_TIER2_CMD, { timeout: MUSIC_EXEC_TIMEOUT }, (err2, stdout2) => {
      emitMusicState(!err2 && stdout2.trim().toLowerCase() === 'true');
      musicCheckTimer = setTimeout(poll, MUSIC_POLL_MS);
    });
  });
}

function startMusicDetection() {
  if (musicCheckTimer !== null) return; // guard against double-start

  if (process.platform === 'win32') {
    try { fs.writeFileSync(MUSIC_PS_FILE, MUSIC_PS_SCRIPT, 'utf8'); }
    catch { return; }
    function pollWin() {
      exec(
        `powershell -NonInteractive -NoProfile -File "${MUSIC_PS_FILE}"`,
        { timeout: MUSIC_EXEC_TIMEOUT },
        (err, stdout) => {
          emitMusicState(!err && stdout.trim().toLowerCase() === 'true');
          musicCheckTimer = setTimeout(pollWin, MUSIC_POLL_MS);
        }
      );
    }
    pollWin();

  } else if (process.platform === 'darwin') {
    function pollMac() { pollMacOS(pollMac); }
    pollMac();
  }
  // Other platforms: silently disabled
}

function stopMusicDetection() {
  clearTimeout(musicCheckTimer);
  musicCheckTimer = null;
  if (process.platform === 'win32') {
    try { fs.unlinkSync(MUSIC_PS_FILE); } catch { /* ignore */ }
  }
  // macOS: no temp file to clean up
}

// ── Claude Code hook installer ─────────────────────
const CLAUDE_HOOK_PORT = 7523; // same as HOOK_PORT

function getClaudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function makeHookCmd(type) {
  if (process.platform === 'win32') {
    // Single-quoted PS body avoids inner escaping; "" inside cmd double-quotes = literal "
    return `powershell -NonInteractive -WindowStyle Hidden -Command "Invoke-WebRequest -Uri http://localhost:${CLAUDE_HOOK_PORT}/event -Method POST -ContentType 'application/json' -Body '{""type"":""${type}""}' -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null"`;
  }
  return `curl -s -X POST http://localhost:${CLAUDE_HOOK_PORT}/event -H 'Content-Type: application/json' -d '{"type":"${type}"}' 2>/dev/null || true`;
}

function isOurHook(command) {
  return typeof command === 'string' && command.includes(`localhost:${CLAUDE_HOOK_PORT}/event`);
}

function installClaudeHooks() {
  const settingsPath = getClaudeSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { /* new file */ }
  if (!cfg.hooks) cfg.hooks = {};

  const toInstall = [
    { event: 'PreToolUse',       type: 'pre_tool_use'  },
    { event: 'Stop',             type: 'stop'          },
    { event: 'UserPromptSubmit', type: 'prompt_submit' },
  ];

  let changed = false;
  for (const { event, type } of toInstall) {
    if (!cfg.hooks[event]) cfg.hooks[event] = [];
    const already = cfg.hooks[event].some(e => e.hooks?.some(h => isOurHook(h.command)));
    if (!already) {
      cfg.hooks[event].push({ hooks: [{ type: 'command', command: makeHookCmd(type) }] });
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2), 'utf-8');
  return changed;
}

function uninstallClaudeHooks() {
  const settingsPath = getClaudeSettingsPath();
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { return false; }
  if (!cfg.hooks) return false;

  let changed = false;
  for (const event of Object.keys(cfg.hooks)) {
    const before = cfg.hooks[event].length;
    cfg.hooks[event] = (cfg.hooks[event] || []).filter(
      e => !e.hooks?.some(h => isOurHook(h.command))
    );
    if (cfg.hooks[event].length !== before) changed = true;
    if (!cfg.hooks[event].length) delete cfg.hooks[event];
  }
  if (!Object.keys(cfg.hooks).length) delete cfg.hooks;

  if (changed) fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2), 'utf-8');
  return changed;
}

function hooksAreInstalled() {
  try {
    const cfg = JSON.parse(fs.readFileSync(getClaudeSettingsPath(), 'utf-8'));
    return !!(cfg.hooks?.PreToolUse?.some(e => e.hooks?.some(h => isOurHook(h.command))));
  } catch { return false; }
}

// ── App lifecycle ──────────────────────────────────
app.whenReady().then(async () => {
  startHookServer();
  createTray();

  // Auto-install Claude Code hooks on first launch
  const appCfg = loadConfig();
  if (!appCfg.hooksInstalled) {
    try {
      installClaudeHooks();
      saveConfig({ ...appCfg, hooksInstalled: true });
    } catch (e) {
      console.warn('[pet] Could not auto-install Claude hooks:', e.message);
    }
  }

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
