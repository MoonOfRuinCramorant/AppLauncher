const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Disable GPU acceleration for compatibility with remote/virtualized environments
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// ========== Single Instance Lock ==========
// Prevent multiple instances — if already running, focus the existing window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

let mainWindow = null;
let tray = null;
let floatBallWindow = null;
let isQuitting = false;

// ========== Float Ball Diagnostics Log ==========
// Writes key float-ball lifecycle events to a log file so that "the ball
// vanished" bugs can be diagnosed from a reproduction. Dev: next to main.js;
// packaged: inside userData. Keep it tiny — rotate at 256 KB.
function fbLog(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    const file = app.isPackaged
      ? path.join(app.getPath('userData'), 'floatball.log')
      : path.join(__dirname, '.fb-log.txt');
    fs.appendFileSync(file, line);
    // Rotate: if the log grows past 256 KB, start a fresh file.
    try {
      const st = fs.statSync(file);
      if (st.size > 256 * 1024) fs.truncateSync(file, 0);
    } catch (_) {}
  } catch (_) {}
}

// Helper: show main window and restore taskbar presence
function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// Helper: hide main window and remove from taskbar
function hideMainWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

function getConfigPath() {
  // When packaged, config lives in userData (writable). In dev, it stays
  // next to main.js so the project folder is self-contained.
  // config.local.json (gitignored) holds the developer's personal apps and
  // takes priority in dev mode; config.json is the clean public default.
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'config.json');
  }
  const localConfig = path.join(__dirname, 'config.local.json');
  if (fs.existsSync(localConfig)) return localConfig;
  return path.join(__dirname, 'config.json');
}

// Path to the bundled (read-only) config used for first-run migration.
function getBundledConfigPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'config.json');
  }
  return path.join(__dirname, 'config.json');
}

function getTrayIconPath() {
  return path.join(__dirname, 'tray-icon.png');
}

// app-icon.ico is in extraResources when packaged (outside asar) because
// shell.writeShortcutLink needs a real filesystem path for the icon.
function getAppIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app-icon.ico');
  }
  return path.join(__dirname, 'app-icon.ico');
}

// First-run migration: copy bundled config.json to userData so the app
// has a writable copy with all the pre-configured apps and groups.
function ensureUserDataConfig() {
  if (!app.isPackaged) return;
  const target = getConfigPath();
  if (!fs.existsSync(target)) {
    const source = getBundledConfigPath();
    if (fs.existsSync(source)) {
      try {
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(source, target);
        console.log('[Config] Copied bundled config to userData');
      } catch (err) {
        console.error('[Config] Failed to copy bundled config:', err);
      }
    }
  }
}

// ========== Config Persistence ==========

const DEFAULT_SETTINGS = {
  theme: 'light',
  sortBy: 'manual',
  minimizeToTray: true,
  viewMode: 'grid',
  backgroundEnabled: false,
  backgroundImage: null,
  backgroundOpacity: 0.3,
  backgroundBlur: 0,
  launchClose: false,
  autoStart: false,
  floatBallEnabled: false,
  floatBallSingleClick: 'recent',
  floatBallDoubleClick: 'showMain',
  floatBallPopupStyle: 'vertical', // 'vertical' | 'horizontal' — how the recent-apps panel is presented
  floatBallX: 100,
  floatBallY: 100,
  floatBallIcon: null, // custom icon for the float ball (data URL)
  // ---- Horizontal (icon-bar) popup theming ----
  // 'auto' = follow the global theme; 'light' / 'dark' = force the chosen look
  floatBallBarTheme: 'auto',
  // Accent color used by the ball gradient in horizontal mode and by the
  // tooltip border/bg accent. Empty string falls back to a default.
  floatBallBarAccent: '#0078d4',
  // Optional overrides for the bar background / border. null = follow theme.
  floatBallBarBg: null,
  floatBallBarBorder: null,
};

function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(data);
      return {
        apps: config.apps || [],
        groups: config.groups || [],
        settings: { ...DEFAULT_SETTINGS, ...(config.settings || {}) }
      };
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
  return { apps: [], groups: [], settings: { ...DEFAULT_SETTINGS } };
}

function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save config:', err);
    return false;
  }
}

// ========== Tray ==========

function createTray() {
  let icon;
  const iconPath = getTrayIconPath();
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('应用启动器');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        showMainWindow();
      }
    },
    { type: 'separator' },
    {
      label: '彻底退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        hideMainWindow();
      } else {
        showMainWindow();
      }
    }
  });

  tray.on('double-click', () => {
    showMainWindow();
  });
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function updateTrayVisibility(minimizeToTray) {
  if (minimizeToTray && !tray) {
    createTray();
  } else if (!minimizeToTray && tray) {
    destroyTray();
  }
}

// ========== Float Ball ==========

const BALL_SIZE = 56;
const POPUP_WIDTH = 190;
const POPUP_HEIGHT = 340;

// Horizontal (icon-bar) popup geometry. The bar holds up to 5 recent-app
// icons side by side; the ball stays attached at the right end of the bar.
//
// Window size:
//   width  = HBAR_POPUP_WIDTH (bar area) + BALL_SIZE + HBAR_BALL_GAP
//   height = BALL_SIZE (== 56) — same as the collapsed window so the
//            vertical jump is zero; the bar and ball are vertically
//            centered via CSS.
const HBAR_ICON = 48;         // icon tile size
const HBAR_GAP = 6;           // gap between tiles
const HBAR_PAD = 8;           // inner padding of the bar
const HBAR_ITEMS = 5;         // max recent apps
const HBAR_BALL_GAP = 12;     // gap between the ball and the bar
const HBAR_POPUP_WIDTH = HBAR_ITEMS * HBAR_ICON + (HBAR_ITEMS - 1) * HBAR_GAP + HBAR_PAD * 2;
const HBAR_WIDTH = HBAR_POPUP_WIDTH + BALL_SIZE + HBAR_BALL_GAP;
const HBAR_HEIGHT = BALL_SIZE; // 56: no vertical resize -> ball does not shift

// Re-assert the always-on-top flag on the float ball window. On Windows a
// transparent always-on-top window can silently drop OUT of the topmost
// layer when it takes focus or is resized (setBounds) while another app
// (browser, etc.) is in the foreground — the ball then appears to
// "vanish" because the foreground window covers it. The plain
// setAlwaysOnTop(true) call only re-sets the WS_EX_TOPMOST flag, which
// is not enough by itself; we also need moveTop() so the window is
// physically pushed to the front of its z-band, and we do that on a slow
// timer (every 2.5s) so silent drops mid-session are recovered.
function assertFloatBallTopmost() {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  try {
    // 'screen-saver' is the highest z-level Windows exposes — Windows
    // treats it as above 'topmost', so a foreground browser (which sits
    // at 'topmost' when its window has WS_EX_TOPMOST) cannot cover us
    // after a focus change.
    floatBallWindow.setAlwaysOnTop(true, 'screen-saver');
    // moveTop() calls BringWindowToTop, which promotes us inside our
    // z-band. Crucially, per Electron docs this does NOT steal focus
    // from whatever the user is currently using — the ball never
    // interrupts typing in the foreground app.
    floatBallWindow.moveTop();
  } catch (_) {}
}

// Periodic safety net: re-assert topmost every couple of seconds so that
// even OS-level z-order changes we can't observe (UWP app foreground
// flapping, anti-cheat / accessibility tools snapping us down, etc.) are
// eventually self-healed within one tick. Cleared when the ball is
// disabled or the window is destroyed.
let topmostKeepAliveTimer = null;
function startTopmostKeepAlive() {
  stopTopmostKeepAlive();
  topmostKeepAliveTimer = setInterval(() => {
    if (!floatBallWindow || floatBallWindow.isDestroyed()) {
      stopTopmostKeepAlive();
      return;
    }
    try {
      // Only re-assert when actually visible — when the window is hidden
      // on purpose (e.g. during dock-to-edge, or during shutdown) we
      // leave it alone so we don't fight the user's intent.
      if (floatBallWindow.isVisible() && !floatBallWindow.isAlwaysOnTop()) {
        assertFloatBallTopmost();
      }
    } catch (_) {}
  }, 2500);
}
function stopTopmostKeepAlive() {
  if (topmostKeepAliveTimer) {
    clearInterval(topmostKeepAliveTimer);
    topmostKeepAliveTimer = null;
  }
}

// Clamp the ball so it stays FULLY inside the visible work area of the
// display nearest to the given point. This is the safety net that makes
// the ball impossible to lose: positions saved/restored/dropped off-screen
// (resolution change, monitor unplugged, edge drops) are pulled back in.
function clampBallToWorkArea(x, y, size = BALL_SIZE, point = null) {
  const ref = point || { x: x + size / 2, y: y + size / 2 };
  const wa = screen.getDisplayNearestPoint(ref).workArea;
  const cx = Math.min(Math.max(x, wa.x), wa.x + wa.width - size);
  const cy = Math.min(Math.max(y, wa.y), wa.y + wa.height - size);
  return { x: cx, y: cy };
}

function createFloatBallWindow() {
  if (floatBallWindow) return;

  const config = loadConfig();
  const s = config.settings;

  // Clamp the restored position into the visible work area — if the saved
  // spot is off-screen (resolution change, monitor unplugged, old bug), the
  // ball would otherwise be invisible on launch ("disappeared").
  const startPos = clampBallToWorkArea(s.floatBallX || 100, s.floatBallY || 100);

  floatBallWindow = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    x: startPos.x,
    y: startPos.y,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  floatBallWindow.loadFile('floatball.html');
  floatBallWindow.once('ready-to-show', () => {
    floatBallWindow.show();
    // Make sure the freshly shown window sits on the topmost layer.
    assertFloatBallTopmost();
    startTopmostKeepAlive();
    // Send current theme and settings
    floatBallWindow.webContents.send('floatball:init', {
      theme: s.theme,
      singleClick: s.floatBallSingleClick,
      doubleClick: s.floatBallDoubleClick,
      ballIcon: s.floatBallIcon || null,
      barTheme: s.floatBallBarTheme,
      barAccent: s.floatBallBarAccent,
      barBg: s.floatBallBarBg,
      barBorder: s.floatBallBarBorder,
    });
  });

  floatBallWindow.on('closed', () => {
    fbLog('[floatball] closed');
    stopTopmostKeepAlive();
    floatBallWindow = null;
  });

  // When the OS tells us the window changed visibility for any reason
  // (alt-tab, Win+D, screen lock, or a competing topmost window briefly
  // burying us) we re-assert so we stay the highest floating widget.
  floatBallWindow.on('show', () => assertFloatBallTopmost());
  floatBallWindow.on('focus', () => assertFloatBallTopmost());
  floatBallWindow.on('move', () => assertFloatBallTopmost());
  floatBallWindow.on('resize', () => assertFloatBallTopmost());

  // Fallback: if the window loses focus mid-drag (e.g. mouse released
  // outside the window after the window failed to follow), stop the drag
  // so the ball never gets stuck in a broken dragging state. Blur is also
  // a classic moment where Windows loses the topmost flag, so re-assert.
  floatBallWindow.on('blur', () => {
    fbLog('[floatball] blur -> stopDragFollow + reassert topmost');
    stopDragFollow();
    assertFloatBallTopmost();
  });

  // If the renderer dies (GPU/transparent-window glitches on Windows), the
  // transparent window can become fully invisible — i.e. the ball "vanishes"
  // while the process still lives. Rebuild the window so it always recovers.
  floatBallWindow.webContents.on('render-process-gone', (_e, details) => {
    fbLog('[floatball] render-process-gone reason=' + (details && details.reason));
    const pos = floatBallWindow.getPosition();
    const wasDocked = !!dockState.side;
    const dock = dockState;
    try { floatBallWindow.destroy(); } catch (_) {}
    floatBallWindow = null;
    // Re-create at the same spot (or at the docked edge if it was docked).
    const config = loadConfig();
    if (config.settings.floatBallEnabled) {
      createFloatBallWindow();
      if (floatBallWindow && !floatBallWindow.isDestroyed()) {
        floatBallWindow.setPosition(pos[0], pos[1]);
        assertFloatBallTopmost();
        if (wasDocked && dock.side) dockFloatBall(dock.side);
      }
    }
  });

  // Prevent the floatball window from being closed by the user
  floatBallWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
    }
  });
}

function destroyFloatBallWindow() {
  if (floatBallWindow) {
    stopDragFollow();
    stopEdgeWatch();
    stopTopmostKeepAlive();
    // Save position BEFORE resetting dock state: if the ball was docked to
    // an edge we must persist the remembered free position, not the docked
    // edge position (which is almost entirely off-screen and would look
    // like the ball "disappeared" when re-enabled).
    try {
      let x, y;
      if (dockState.side) {
        x = dockState.freeX;
        y = dockState.freeY;
      } else {
        [x, y] = floatBallWindow.getPosition();
      }
      const pos = clampBallToWorkArea(x, y);
      const config = loadConfig();
      config.settings.floatBallX = pos.x;
      config.settings.floatBallY = pos.y;
      saveConfig(config);
    } catch (err) {
      console.error('Failed to save float ball position on destroy:', err);
    }
    dockState = { side: null, hidden: false, freeX: 0, freeY: 0, lastOutTime: 0 };
    preExpandPos = null;
    floatBallWindow.destroy();
    floatBallWindow = null;
  }
}

// ========== Float Ball Drag (robust) ==========
// The renderer's mousemove events stop firing the moment the cursor leaves
// the tiny 56x56 window, which caused the ball to get lost mid-drag.
// Fix: the main process polls screen.getCursorScreenPoint() and moves the
// window to follow the cursor, so the cursor never actually leaves the
// window while dragging.

let dragTimer = null;
let dragLastCursor = null;
// Ball position before the popup expanded — restored on collapse so the
// ball returns to where the user placed it after using the quick panel.
let preExpandPos = null;

function stopDragFollow() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  dragLastCursor = null;
}

function startDragFollow() {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  stopDragFollow();
  dragLastCursor = screen.getCursorScreenPoint();

  // If the ball was docked to the edge, dragging it out cancels the dock
  cancelDockKeepPosition();

  dragTimer = setInterval(() => {
    if (!floatBallWindow || floatBallWindow.isDestroyed()) {
      stopDragFollow();
      return;
    }
    const cursorNow = screen.getCursorScreenPoint();
    if (dragLastCursor.x !== cursorNow.x || dragLastCursor.y !== cursorNow.y) {
      const [wx, wy] = floatBallWindow.getPosition();
      // Delta-based movement: apply the cursor's movement to the window's
      // CURRENT position. Unlike absolute positioning this stays correct
      // even when other code moves the window mid-drag (e.g. the popup
      // collapsing back to ball size shifts the top-left corner).
      const nx = wx + (cursorNow.x - dragLastCursor.x);
      const ny = wy + (cursorNow.y - dragLastCursor.y);
      // Clamp into the cursor's display work area every frame: the ball
      // can never be dragged off-screen, so it can never be "lost" by
      // releasing the mouse at a screen edge.
      const safe = clampBallToWorkArea(nx, ny, BALL_SIZE, cursorNow);
      floatBallWindow.setPosition(safe.x, safe.y);
    }
    dragLastCursor = cursorNow;
  }, 16);
}

function saveFloatBallPosition() {
  try {
    if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
    // When docked, persist the remembered free position — the docked edge
    // position is mostly off-screen by design and must not be saved.
    let x, y;
    if (dockState.side) {
      x = dockState.freeX;
      y = dockState.freeY;
    } else {
      [x, y] = floatBallWindow.getPosition();
    }
    const pos = clampBallToWorkArea(x, y);
    const config = loadConfig();
    config.settings.floatBallX = pos.x;
    config.settings.floatBallY = pos.y;
    saveConfig(config);
  } catch (err) {
    console.error('Failed to save float ball position:', err);
  }
}

// ========== Float Ball Dock (hide to screen edge) ==========
// Right-click -> "hide to edge": the ball tucks itself at the right/top
// screen edge leaving ~1/3 of the icon visible (a grab handle for the
// mouse). Moving the cursor to that edge pops the ball back out; moving
// away re-hides it after a short delay.

const DOCK_PEEK = Math.round(BALL_SIZE / 3); // px left visible while hidden at the edge (~1/3 of the icon)
const EDGE_ZONE = 12;         // px from the edge that triggers the pop-out
const DOCK_AUTO_HIDE_DELAY = 800; // ms after cursor leaves the edge to re-hide

let dockState = { side: null, hidden: false, freeX: 0, freeY: 0, lastOutTime: 0 };
let edgeTimer = null;

function isFloatBallPopupOpen() {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return false;
  const b = floatBallWindow.getBounds();
  return b.width > BALL_SIZE || b.height > BALL_SIZE;
}

function getFloatBallDisplay() {
  const [x, y] = floatBallWindow.getPosition();
  return screen.getDisplayNearestPoint({ x: x + BALL_SIZE / 2, y: y + BALL_SIZE / 2 });
}

function dockFloatBall(side) {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  const display = getFloatBallDisplay();
  const wa = display.workArea;
  const [x, y] = floatBallWindow.getPosition();
  dockState = { side, hidden: true, freeX: x, freeY: y, lastOutTime: 0 };

  let nx = x;
  let ny = y;
  if (side === 'right') {
    // Window left edge sits at (screen right - 1/3 of the ball) so only the
    // left third of the icon remains visible inside the work area.
    nx = wa.x + wa.width - DOCK_PEEK;
    ny = Math.min(Math.max(y, wa.y), wa.y + wa.height - BALL_SIZE);
  } else { // top
    // Window top edge sits above the screen; only the bottom third of the
    // icon peeks into the work area.
    nx = Math.min(Math.max(x, wa.x), wa.x + wa.width - BALL_SIZE);
    ny = wa.y - BALL_SIZE + DOCK_PEEK;
  }
  floatBallWindow.setPosition(nx, ny);

  // If the popup was open, collapse it so the window shrinks back to the ball.
  // Clear preExpandPos first so the collapse handler does not "restore" the
  // pre-popup position and undo the dock we just applied above.
  preExpandPos = null;
  if (isFloatBallPopupOpen()) {
    floatBallWindow.setBounds({ width: BALL_SIZE, height: BALL_SIZE });
    sendToFloatBall('floatball:collapseUI');
  }
  startEdgeWatch();
}

function peekFloatBall() {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  const wa = getFloatBallDisplay().workArea;
  const [x, y] = floatBallWindow.getPosition();
  let nx = x;
  let ny = y;
  if (dockState.side === 'right') {
    nx = wa.x + wa.width - BALL_SIZE - 8;
  } else {
    ny = wa.y + 8;
  }
  floatBallWindow.setPosition(nx, ny);
  dockState.hidden = false;
  dockState.lastOutTime = 0;
}

function hideFloatBallToEdge() {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  const wa = getFloatBallDisplay().workArea;
  const [x, y] = floatBallWindow.getPosition();
  let nx = x;
  let ny = y;
  if (dockState.side === 'right') {
    nx = wa.x + wa.width - DOCK_PEEK;
  } else {
    ny = wa.y - BALL_SIZE + DOCK_PEEK;
  }
  floatBallWindow.setPosition(nx, ny);
  dockState.hidden = true;
  dockState.lastOutTime = 0;
}

function cancelDockKeepPosition() {
  if (dockState.side) {
    stopEdgeWatch();
    dockState = { side: null, hidden: false, freeX: 0, freeY: 0, lastOutTime: 0 };
  }
}

function undockFloatBall() {
  stopEdgeWatch();
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  // Restore the remembered free position, clamped into the visible area
  const safe = clampBallToWorkArea(dockState.freeX, dockState.freeY);
  floatBallWindow.setPosition(safe.x, safe.y);
  dockState = { side: null, hidden: false, freeX: 0, freeY: 0, lastOutTime: 0 };
}

function startEdgeWatch() {
  stopEdgeWatch();
  edgeTimer = setInterval(() => {
    if (!dockState.side || !floatBallWindow || floatBallWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(cursor).workArea;
    const inZone =
      (dockState.side === 'right' && cursor.x >= wa.x + wa.width - EDGE_ZONE) ||
      (dockState.side === 'top' && cursor.y <= wa.y + EDGE_ZONE);

    if (inZone && dockState.hidden) {
      peekFloatBall();
    } else if (!inZone && !dockState.hidden) {
      if (dockState.lastOutTime === 0) dockState.lastOutTime = Date.now();
      if (Date.now() - dockState.lastOutTime > DOCK_AUTO_HIDE_DELAY && !isFloatBallPopupOpen()) {
        hideFloatBallToEdge();
      }
    } else {
      dockState.lastOutTime = 0;
    }
  }, 120);
}

function stopEdgeWatch() {
  if (edgeTimer) {
    clearInterval(edgeTimer);
    edgeTimer = null;
  }
}

function updateFloatBallVisibility(enabled) {
  if (enabled && !floatBallWindow) {
    createFloatBallWindow();
  } else if (!enabled && floatBallWindow) {
    destroyFloatBallWindow();
  }
}

function sendToFloatBall(channel, data) {
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    floatBallWindow.webContents.send(channel, data);
  }
}

// ========== Window Creation ==========

function createWindow() {
  const config = loadConfig();

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: config.settings.theme === 'dark' ? '#1e1e1e' : '#f0f0f0',
      symbolColor: config.settings.theme === 'dark' ? '#cccccc' : '#333333',
      height: 40
    },
    backgroundColor: config.settings.theme === 'dark' ? '#1e1e1e' : '#f5f5f5',
    icon: getAppIconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    // If launched with --hidden (e.g. auto-start), keep window hidden
    if (process.argv.includes('--hidden') && config.settings.minimizeToTray) {
      mainWindow.setSkipTaskbar(true);
    } else {
      showMainWindow();
    }
  });

  // Minimize to tray on close if enabled
  mainWindow.on('close', (e) => {
    const cfg = loadConfig();
    if (cfg.settings.minimizeToTray && !isQuitting) {
      e.preventDefault();
      hideMainWindow();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Create tray if minimize to tray is enabled
  if (config.settings.minimizeToTray) {
    createTray();
  }

  // Create float ball if enabled
  if (config.settings.floatBallEnabled) {
    createFloatBallWindow();
  }
}

// ========== App Lifecycle ==========

app.whenReady().then(() => {
  // First-run: copy bundled config to userData (packaged builds only)
  ensureUserDataConfig();
  createWindow();
  // Sync config.autoStart to system on startup so the two stay consistent
  syncAutoStart();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  // Save float ball position so it restores at the same spot next launch
  // (dock-aware + clamped into the visible work area)
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    saveFloatBallPosition();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ========== IPC Handlers ==========

ipcMain.handle('config:load', () => {
  return loadConfig();
});

ipcMain.handle('config:save', (_event, config) => {
  const result = saveConfig(config);
  // Update tray visibility if minimizeToTray setting changed
  if (config.settings && config.settings.minimizeToTray !== undefined) {
    updateTrayVisibility(config.settings.minimizeToTray);
  }
  // Update title bar overlay color based on theme
  if (mainWindow && config.settings && config.settings.theme) {
    const isDark = config.settings.theme === 'dark';
    mainWindow.setTitleBarOverlay({
      color: isDark ? '#1e1e1e' : '#f0f0f0',
      symbolColor: isDark ? '#cccccc' : '#333333'
    });
  }
  // Update float ball visibility
  if (config.settings && config.settings.floatBallEnabled !== undefined) {
    updateFloatBallVisibility(config.settings.floatBallEnabled);
  }
  // Notify float ball of theme/settings change
  if (config.settings) {
    sendToFloatBall('floatball:settingsChanged', {
      theme: config.settings.theme,
      singleClick: config.settings.floatBallSingleClick,
      doubleClick: config.settings.floatBallDoubleClick,
      ballIcon: config.settings.floatBallIcon || null,
      barTheme: config.settings.floatBallBarTheme,
      barAccent: config.settings.floatBallBarAccent,
      barBg: config.settings.floatBallBarBg,
      barBorder: config.settings.floatBallBarBorder,
    });
  }
  return result;
});

// ========== File Dialogs ==========

ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择应用程序或文件',
    filters: [
      { name: '应用程序', extensions: ['exe', 'bat', 'cmd', 'lnk', 'ps1'] },
      { name: '文档文件', extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md'] },
      { name: '媒体文件', extensions: ['mp4', 'avi', 'mkv', 'mov', 'flv', 'wmv', 'mp3', 'wav', 'flac', 'm4a'] },
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'svg', 'ico'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件夹',
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openIconFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择图标文件',
    filters: [
      { name: '图片文件', extensions: ['ico', 'png', 'jpg', 'jpeg', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openImageFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择背景图片',
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

// ========== App Operations ==========

// Resolve a .lnk shortcut to get the target path and icon location
function resolveLnkShortcut(lnkPath) {
  try {
    const link = shell.readShortcutLink(lnkPath);
    return {
      targetPath: link.target || '',
      iconLocation: link.icon || '',
    };
  } catch (err) {
    return { targetPath: '', iconLocation: '' };
  }
}

ipcMain.handle('app:getFileIcon', async (_event, filePath) => {
  try {
    // For shell paths (system folders), try to extract the system icon
    if (filePath && filePath.startsWith('shell:')) {
      // Extract the CLSID part for icon lookup
      const clsidMatch = filePath.match(/::\{(.+?)\}/);
      if (clsidMatch) {
        // Try getting icon using the CLSID path
        const icon = await app.getFileIcon(filePath, { size: 'normal' });
        const dataUrl = icon.toDataURL();
        // Only return if it's a real icon (not empty)
        if (dataUrl && dataUrl.length > 200) {
          return dataUrl;
        }
      }
      // Return null for shell paths where we can't extract an icon
      return null;
    }
    // For URI schemes (e.g. ms-settings:), return null — use emoji icon instead
    // Exclude Windows drive letter paths like C:\ or D:/
    if (filePath && /^[a-zA-Z][a-zA-Z0-9+.-]*:(?![/\\])/.test(filePath)) {
      return null;
    }

    // For .lnk shortcut files, resolve the target/icon location first
    const lowerPath = filePath.toLowerCase();
    if (lowerPath.endsWith('.lnk')) {
      const { targetPath, iconLocation } = resolveLnkShortcut(filePath);

      // Try icon location first (format: "path,index" or "path")
      if (iconLocation) {
        const iconPath = iconLocation.split(',')[0].trim();
        if (iconPath && fs.existsSync(iconPath)) {
          // For .ico files, use nativeImage which reads the actual icon
          if (iconPath.toLowerCase().endsWith('.ico')) {
            const img = nativeImage.createFromPath(iconPath);
            if (!img.isEmpty()) {
              const dataUrl = img.toDataURL();
              if (dataUrl && dataUrl.length > 200) {
                return dataUrl;
              }
            }
          } else {
            const icon = await app.getFileIcon(iconPath, { size: 'normal' });
            const dataUrl = icon.toDataURL();
            if (dataUrl && dataUrl.length > 200) {
              return dataUrl;
            }
          }
        }
      }

      // Fall back to the shortcut target path
      if (targetPath && fs.existsSync(targetPath)) {
        const icon = await app.getFileIcon(targetPath, { size: 'normal' });
        const dataUrl = icon.toDataURL();
        if (dataUrl && dataUrl.length > 200) {
          return dataUrl;
        }
      }
      // If both fail, fall through to try the .lnk file itself
    }

    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    return icon.toDataURL();
  } catch (err) {
    console.error('Failed to get icon:', err);
    return null;
  }
});

ipcMain.handle('app:launch', async (_event, appPath, args) => {
  try {
    // Handle shell paths (system folders like Recycle Bin, This PC, etc.)
    if (appPath && appPath.startsWith('shell:')) {
      const child = spawn('explorer.exe', [appPath], { detached: true, stdio: 'ignore' });
      child.unref();
      return { success: true };
    }

    // Handle URI schemes (e.g. ms-settings: for Windows Settings)
    if (appPath && /^[a-zA-Z][a-zA-Z0-9+.-]*:(?![/\\])/.test(appPath) && !appPath.startsWith('shell:')) {
      await shell.openExternal(appPath);
      return { success: true };
    }

    if (!appPath || !fs.existsSync(appPath)) {
      return { success: false, error: '文件不存在: ' + appPath };
    }
    const ext = path.extname(appPath).toLowerCase();
    if (ext === '.exe') {
      const argArray = args && args.trim()
        ? args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(a => a.replace(/^"|"$/g, '')) || []
        : [];
      const child = spawn(appPath, argArray, {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(appPath)
      });
      child.unref();
    } else {
      await shell.openPath(appPath);
    }
    return { success: true };
  } catch (err) {
    console.error('Failed to launch:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:openInExplorer', (_event, filePath) => {
  // For shell paths, open explorer with the shell path
  if (filePath && filePath.startsWith('shell:')) {
    spawn('explorer.exe', [filePath], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('app:getFileName', (_event, filePath) => {
  try {
    const ext = path.extname(filePath);
    return path.basename(filePath, ext);
  } catch {
    return '未命名应用';
  }
});

ipcMain.handle('app:readIconFile', (_event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mime = mimeMap[ext] || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('Failed to read icon file:', err);
    return null;
  }
});

ipcMain.handle('app:readImageFile', (_event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.bmp': 'image/bmp',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mime = mimeMap[ext] || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('Failed to read image file:', err);
    return null;
  }
});

// ========== Tray / Window IPC ==========

ipcMain.handle('tray:showWindow', () => {
  showMainWindow();
});

ipcMain.handle('window:hide', () => {
  hideMainWindow();
});

ipcMain.handle('tray:quit', () => {
  isQuitting = true;
  app.quit();
});

// ========== Float Ball IPC ==========

// Start robust cursor-follow drag (main-process polling)
ipcMain.on('floatball:dragStart', () => {
  fbLog('[floatball] dragStart');
  startDragFollow();
});

// End drag: stop following the cursor and persist the position
ipcMain.on('floatball:dragEnd', () => {
  fbLog('[floatball] dragEnd');
  stopDragFollow();
  saveFloatBallPosition();
});

// Save float ball position to config (fallback; normally done on dragEnd)
ipcMain.on('floatball:savePosition', () => {
  saveFloatBallPosition();
});

// Expand the float ball window to show popup
ipcMain.handle('floatball:expand', () => {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;

  // Guard against the ball "vanishing" when another app (browser, etc.) is
  // in the foreground: on Windows a transparent always-on-top window can
  // drop out of the topmost layer after it takes focus. Re-assert topmost
  // (at 'screen-saver' level so we sit above any other topmost window) and
  // make sure the window is actually visible before sizing the popup.
  try {
    floatBallWindow.setAlwaysOnTop(true, 'screen-saver');
    floatBallWindow.moveTop();
    if (!floatBallWindow.isVisible()) {
      fbLog('[floatball] expand: window not visible -> show()');
      floatBallWindow.show();
    }
  } catch (err) {
    fbLog('[floatball] expand: setAlwaysOnTop/show error', err.message);
  }

  // If the ball is docked to an edge, restore the free position first so
  // the popup is fully visible on screen.
  if (dockState.side) {
    fbLog('[floatball] expand: undock from edge');
    undockFloatBall();
  }

  const [x, y] = floatBallWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: x + BALL_SIZE / 2, y: y + BALL_SIZE / 2 });
  const workArea = display.workArea;

  // Remember the ball position before expanding; collapse restores it so the
  // ball returns to where the user placed it after using the quick panel.
  preExpandPos = { x, y };

  // ========== Horizontal (icon bar) popup ==========
  // The bar expands horizontally from the ball: if the ball sits in the
  // right half of the screen the bar opens to the LEFT of the ball, and
  // vice versa, so the whole bar always stays on screen.
  const config = loadConfig();
  const popupStyle = config.settings.floatBallPopupStyle || 'vertical';

  if (popupStyle === 'horizontal') {
    // Bar ALWAYS appears on the LEFT of the ball (per user preference:
    // the ball must NOT move when the bar opens, and the bar grows
    // leftward from the ball's current screen position).
    //
    // Geometry: the window's right edge is anchored to the original right
    // edge of the ball (x + BALL_SIZE), and its vertical center is on the
    // ball's vertical center. The bar fills the left part of the new
    // window, the ball stays where it was.
    let newX = x - (HBAR_WIDTH - BALL_SIZE);
    let newY = y - (HBAR_HEIGHT - BALL_SIZE) / 2;

    // Clamp inside the work area. We never want to drop the ball off
    // screen, so when there's no room on the left we keep the window's
    // left edge at the work-area left (the bar gets clipped on its left
    // side rather than the ball shifting right).
    newX = Math.max(workArea.x, newX);
    newY = Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - HBAR_HEIGHT));

    fbLog('[floatball] expand horizontal at', x, y, '->', newX, newY, HBAR_WIDTH + 'x' + HBAR_HEIGHT);
    floatBallWindow.setBounds({
      x: newX,
      y: newY,
      width: HBAR_WIDTH,
      height: HBAR_HEIGHT
    });
    // Windows can drop a transparent always-on-top window out of the
    // topmost layer WHILE it is being resized, especially when another
    // app (browser, etc.) was in the foreground. This is the "ball
    // vanished after a click over a webpage" bug. The resize happens
    // synchronously but the topmost flag loss may settle a moment later,
    // so re-assert now and again after the resize has fully settled.
    assertFloatBallTopmost();
    setTimeout(assertFloatBallTopmost, 120);
    setTimeout(assertFloatBallTopmost, 400);
    // Ball is always at the right end of the bar in horizontal mode.
    return { style: 'horizontal', direction: 'right' };
  }

  // ========== Vertical (list) popup ==========

  // Fit the popup horizontally inside the work area — a ball sitting near
  // the right edge would otherwise open a popup clipped off-screen.
  let newX = x;
  if (newX + POPUP_WIDTH > workArea.x + workArea.width) {
    newX = workArea.x + workArea.width - POPUP_WIDTH;
  }
  if (newX < workArea.x) newX = workArea.x;

  // Check if there's enough space below the ball
  const spaceBelow = workArea.y + workArea.height - y - BALL_SIZE;
  let newY = y;

  if (spaceBelow < POPUP_HEIGHT) {
    // Not enough space below, show popup above the ball
    newY = y - (POPUP_HEIGHT - BALL_SIZE);
    if (newY < workArea.y) newY = workArea.y;
  }

  fbLog('[floatball] expand vertical at', x, y, '->', newX, newY, POPUP_WIDTH + 'x' + POPUP_HEIGHT);
  floatBallWindow.setBounds({
    x: newX,
    y: newY,
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT
  });
  // Same topmost re-assertion as the horizontal branch (see above).
  assertFloatBallTopmost();
  setTimeout(assertFloatBallTopmost, 120);
  setTimeout(assertFloatBallTopmost, 400);
  return { style: 'vertical', direction: null };
});

// Collapse the float ball window back to just the ball
ipcMain.handle('floatball:collapse', () => {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  fbLog('[floatball] collapse');

  // Restore the pre-expand ball position (where the user placed it) unless
  // the ball has since been docked to an edge — the dock owns the position.
  let targetX, targetY;
  if (preExpandPos && !dockState.side) {
    targetX = preExpandPos.x;
    targetY = preExpandPos.y;
  } else {
    [targetX, targetY] = floatBallWindow.getPosition();
  }
  preExpandPos = null;

  // Safety clamp: the ball must end up fully visible no matter what.
  const safe = clampBallToWorkArea(targetX, targetY);
  floatBallWindow.setBounds({
    x: safe.x,
    y: safe.y,
    width: BALL_SIZE,
    height: BALL_SIZE
  });
});

// Get recent apps for the float ball popup
ipcMain.handle('floatball:getRecentApps', () => {
  const config = loadConfig();
  const recentApps = config.apps
    .filter(a => a.lastLaunched)
    .sort((a, b) => new Date(b.lastLaunched) - new Date(a.lastLaunched))
    .slice(0, 5);
  return recentApps;
});

// Launch an app from the float ball
ipcMain.handle('floatball:launchApp', async (_event, appId) => {
  const config = loadConfig();
  const appItem = config.apps.find(a => a.id === appId);
  if (!appItem) return { success: false, error: '应用不存在' };

  try {
    // Handle shell paths (system folders like Recycle Bin, This PC, etc.)
    if (appItem.path && appItem.path.startsWith('shell:')) {
      const child = spawn('explorer.exe', [appItem.path], { detached: true, stdio: 'ignore' });
      child.unref();
    } else if (appItem.path && /^[a-zA-Z][a-zA-Z0-9+.-]*:(?![/\\])/.test(appItem.path) && !appItem.path.startsWith('shell:')) {
      // Handle URI schemes (e.g. ms-settings:)
      await shell.openExternal(appItem.path);
    } else {
      if (!appItem.path || !fs.existsSync(appItem.path)) {
        return { success: false, error: '文件不存在' };
      }
      const ext = path.extname(appItem.path).toLowerCase();
      if (ext === '.exe') {
        const argArray = appItem.args && appItem.args.trim()
          ? appItem.args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(a => a.replace(/^"|"$/g, '')) || []
          : [];
        const child = spawn(appItem.path, argArray, {
          detached: true,
          stdio: 'ignore',
          cwd: path.dirname(appItem.path)
        });
        child.unref();
      } else {
        await shell.openPath(appItem.path);
      }
    }

    // Update launch stats
    appItem.lastLaunched = new Date().toISOString();
    appItem.launchCount = (appItem.launchCount || 0) + 1;
    saveConfig(config);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Show main window from float ball
ipcMain.handle('floatball:showMain', () => {
  showMainWindow();
});

// Right-click context menu on float ball
ipcMain.on('floatball:rightClick', () => {
  const isDocked = !!dockState.side;
  const template = [
    {
      label: '显示主窗口',
      click: () => {
        showMainWindow();
      }
    },
    { type: 'separator' }
  ];

  if (isDocked) {
    template.push({
      label: '取消隐藏（恢复自由位置）',
      click: () => {
        undockFloatBall();
      }
    });
  } else {
    template.push(
      {
        label: '隐藏到屏幕右侧',
        click: () => {
          dockFloatBall('right');
        }
      },
      {
        label: '隐藏到屏幕顶部',
        click: () => {
          dockFloatBall('top');
        }
      }
    );
  }

  template.push(
    { type: 'separator' },
    {
      label: '更换悬浮球图标…',
      click: () => {
        chooseFloatBallIcon();
      }
    },
    {
      label: '恢复默认图标',
      click: () => {
        resetFloatBallIcon();
      }
    },
    { type: 'separator' },
    {
      label: '关闭悬浮球',
      click: () => {
        // Just flip the setting; destroyFloatBallWindow persists the
        // (dock-aware, clamped) position on its own.
        const config = loadConfig();
        config.settings.floatBallEnabled = false;
        saveConfig(config);
        destroyFloatBallWindow();
        // Notify main window to update settings UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('floatball:disabledByUser');
        }
      }
    }
  );

  // Popup at cursor position with window reference for correct positioning
  const menu = Menu.buildFromTemplate(template);
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    menu.popup(floatBallWindow);
  } else {
    menu.popup();
  }
});

// Pick a custom image for the float ball icon
async function chooseFloatBallIcon() {
  try {
    // No parent window: works even when the ball is docked/hidden at an edge
    const result = await dialog.showOpenDialog({
      title: '选择悬浮球图标',
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return;

    const filePath = result.filePaths[0];

    // Decode / copy the picked image into a *real PNG file* on disk under
    // userData/crop-temp/ and pass the file:// URL to the renderer. This
    // is the most reliable image-loading path in Electron, and avoids
    // three historical bugs in one shot:
    //
    //   (a) The previous v1.1.6 data-URL path was silently rejected by
    //       Chromium for some images (notably PNG with a tRNS chunk that
    //       conflicted with the alpha channel — see "tRNS: invalid with
    //       alpha channel" libpng warnings). The crop container stayed
    //       transparent and the user had no way to know the data hadn't
    //       arrived.
    //   (b) The v1.1.7 Buffer→Blob-URL path was blocked by crop.html's
    //       strict CSP: `img-src 'self' data:;` did NOT include `blob:`,
    //       so the Blob URL was rejected by the CSP layer BEFORE <img>
    //       even tried to decode the bytes — onerror fired and we showed
    //       "无法加载所选图片". Easy to miss because there is no console
    //       error in production builds.
    //   (c) IPC payload-size sanity (base64 inflation, structured-clone
    //       edge cases for huge buffers). A 5 MB PNG became a 6.7 MB
    //       message, which occasionally tripped the per-channel limit.
    //
    // Writing to disk and using file:// is:
    //   • under CSP ('self' covers file://→file://)
    //   • zero-copy (Chromium reads the bytes straight from disk)
    //   • MIME-agnostic (the browser sniffs magic bytes)
    //   • lifecycle-clean (we delete the temp file on close).

    let tempPath = null;
    try {
      tempPath = writeIconTempFile(filePath);
    } catch (err) {
      fbLog('[icon] temp file write failed:', err.message);
      console.error('Failed to stage float ball icon:', err);
      return;
    }

    try {
      const cropped = await openIconCropWindow(tempPath);
      if (!cropped) return;

      const config = loadConfig();
      config.settings.floatBallIcon = cropped;
      saveConfig(config);
      sendToFloatBall('floatball:settingsChanged', { ballIcon: cropped });
    } finally {
      // Always clean up the temp file, whether the user confirmed or
      // cancelled — never leak temp PNGs into userData.
      cleanupCropTempFile(tempPath);
    }
  } catch (err) {
    console.error('Failed to choose float ball icon:', err);
  }
}

// ========== Icon Crop Window ==========
// A small modal window that lets the user crop the picked image into a
// circular float-ball icon. The ball itself is alwaysOnTop, so this window
// is raised to the 'screen-saver' level to sit above it.
//
// The image is staged on disk under userData/crop-temp/ and passed to the
// renderer as a file:// URL. This is the most reliable image-loading path
// in Electron — see chooseFloatBallIcon() for the full rationale.

// Magic-byte MIME detector — kept around so unit tests can verify it sniffs
// real PNG/JPEG/BMP/etc correctly. Not used in the production flow.
function detectImageMimeFromBuffer(buf) {
  if (!buf || buf.length < 4) return 'image/png';
  const b0 = buf[0], b1 = buf[1], b2 = buf[2], b3 = buf[3];
  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF) return 'image/jpeg';
  // GIF: 47 49 46 38
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return 'image/gif';
  // BMP: 42 4D
  if (b0 === 0x42 && b1 === 0x4D) return 'image/bmp';
  // ICO: 00 00 01 00 (icon) or 00 00 02 00 (cursor)
  if (b0 === 0x00 && b1 === 0x00 && (b2 === 0x01 || b2 === 0x02) && b3 === 0x00) return 'image/x-icon';
  // WebP: "RIFF" .... "WEBP"
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 &&
      buf.length >= 12 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return 'image/png';
}

// Path-safe directory for cropped-icon staging files. Created lazily.
let cropTempDirCache = null;
function getCropTempDir() {
  if (cropTempDirCache && fs.existsSync(cropTempDirCache)) return cropTempDirCache;
  const dir = path.join(app.getPath('userData'), 'crop-temp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  cropTempDirCache = dir;
  return dir;
}

// Decode the source image into a real file on disk under userData/crop-temp/
// and return its absolute path. The renderer receives the file:// URL and
// hands it straight to <img> — Chromium decodes whatever magic bytes the
// file advertises.
//
// v1.1.8 originally routed every picked image through `nativeImage.toPNG()`
// to "guarantee" the renderer saw a valid PNG. In practice that helper
// doubles/quadruples the file size on some inputs AND occasionally writes
// out a buffer that Chromium parses as a PNG (header OK, magic byte OK)
// but cannot fully decode — `<img>` fires onload with naturalWidth=0, the
// crop frame is drawn around a 0-px ghost, and the user sees the
// transparent checkerboard. v1.1.8's "fallback to raw bytes" path only
// kicked in when nativeImage was empty; it didn't cover the silent
// decode-failure case.
//
// We now: always copy the source bytes unchanged, keeping the original
// extension. Chromium sniffs magic bytes regardless of extension, so this
// works for PNG / JPEG / WEBP / BMP / GIF / ICO without further help.
// nativeImage is reserved as an *optional* repair step (only used when
// the file is missing or unreadable), never as the primary code path.
function writeIconTempFile(srcPath) {
  const dir = getCropTempDir();
  const srcExt = (path.extname(srcPath) || '.png').toLowerCase();
  const outPath = path.join(dir, `icon-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}${srcExt}`);

  // Read the source file as raw bytes — *no* nativeImage in the loop.
  // We trust Chromium's image decoder (libpng/skia) more than
  // `nativeImage.toPNG()` because the former has been decoding user
  // images correctly for years, while the latter is a thin Electron
  // wrapper that has historically produced broken output on tRNS PNGs
  // and oversized buffers.
  let bytes;
  try {
    bytes = fs.readFileSync(srcPath);
    if (!bytes || bytes.length === 0) throw new Error('source file is empty');
  } catch (err) {
    fbLog('[icon] stage source read failed:', err.message);
    // As a last-ditch fallback, hand the renderer whatever nativeImage
    // can produce — even a damaged buffer is better than nothing, and
    // the renderer's strategy chain will fall through to the legacy
    // data URL if it can't decode.
    try {
      const ni = nativeImage.createFromPath(srcPath);
      if (!ni.isEmpty()) {
        bytes = ni.toPNG();
        if (bytes && bytes.length) {
          const fallback = path.join(dir, `icon-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.png`);
          fs.writeFileSync(fallback, bytes);
          fbLog('[icon] staged via nativeImage fallback =', fallback);
          return fallback;
        }
      }
    } catch (_) { /* ignore */ }
    throw err;
  }

  fs.writeFileSync(outPath, bytes);
  fbLog('[icon] staged raw bytes =', outPath, 'size =', bytes.length, 'mime sniffed from ext =', srcExt);
  return outPath;
}

function cleanupCropTempFile(p) {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    fbLog('[icon] temp cleanup warn:', err.message);
  }
}

// Convert a Windows path (C:\foo\bar.png) to a file:// URL that Chromium
// will accept: file:///C:/foo/bar.png
function pathToFileUrl(absPath) {
  let p = absPath.replace(/\\/g, '/');
  // Electron 32+ requires the drive letter to be inside the URL path
  // part with a leading slash, e.g. file:///C:/Users/foo/x.png
  if (/^[A-Za-z]:\//.test(p)) p = '/' + p;
  return 'file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

let cropWindow = null;
let cropResolve = null;
let cropTempPath = null;     // currently-staged icon file (for emergency cleanup)

function closeCropWindow() {
  if (cropWindow) {
    cropWindow.destroy();
    cropWindow = null;
  }
}

function openIconCropWindow(imageFilePath) {
  return new Promise((resolve) => {
    closeCropWindow();
    cropResolve = resolve;
    cropTempPath = imageFilePath;       // remember so we can clean up if needed

    const imageUrl = pathToFileUrl(imageFilePath);

    cropWindow = new BrowserWindow({
      width: 540,
      height: 640,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      center: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    // Raise above the always-on-top float ball so the crop UI is never hidden
    cropWindow.setAlwaysOnTop(true, 'screen-saver');

    cropWindow.loadFile('crop.html');

    // Hook the init send to did-finish-load (which fires after the
    // renderer's IPC listeners have been registered), not to
    // ready-to-show — IPC messages sent to a not-yet-listening webContents
    // are silently dropped, which was the secondary bug behind the
    // "blank crop window" reports.
    cropWindow.webContents.once('did-finish-load', () => {
      cropWindow.show();
      try {
        cropWindow.webContents.send('crop:init', {
          imageUrl: imageUrl,           // primary path — file:// URL
          imagePath: imageFilePath,     // debug breadcrumb
          imageBytes: null,             // legacy field; renderer ignores when imageUrl is present
          imageMime: 'image/png'
        });
        fbLog('[icon] crop:init sent, url =', imageUrl);
      } catch (err) {
        fbLog('[icon] crop:init send failed:', err.message);
      }
    });

    cropWindow.on('closed', () => {
      cropWindow = null;
      cropTempPath = null;
      if (cropResolve) {
        const r = cropResolve;
        cropResolve = null;
        r(null); // closed without confirming = user cancelled
      }
    });
  });
}

ipcMain.handle('crop:confirm', (_e, dataUrl) => {
  const r = cropResolve;
  cropResolve = null;
  closeCropWindow();
  if (r) r(dataUrl || null);
  return true;
});

ipcMain.handle('crop:cancel', () => {
  const r = cropResolve;
  cropResolve = null;
  closeCropWindow();
  if (r) r(null);
  return true;
});

// Reset the float ball icon back to the default emoji
function resetFloatBallIcon() {
  try {
    const config = loadConfig();
    config.settings.floatBallIcon = null;
    saveConfig(config);
    sendToFloatBall('floatball:settingsChanged', { ballIcon: null });
  } catch (err) {
    console.error('Failed to reset float ball icon:', err);
  }
}

// Get current settings for float ball
ipcMain.handle('floatball:getSettings', () => {
  const config = loadConfig();
  return {
    theme: config.settings.theme,
    singleClick: config.settings.floatBallSingleClick,
    doubleClick: config.settings.floatBallDoubleClick,
    ballIcon: config.settings.floatBallIcon || null,
    barTheme: config.settings.floatBallBarTheme,
    barAccent: config.settings.floatBallBarAccent,
    barBg: config.settings.floatBallBarBg,
    barBorder: config.settings.floatBallBarBorder,
  };
});

// ========== Desktop Shortcut IPC ==========

// Force Windows Explorer to flush its icon cache so a freshly written .lnk
// shows the correct icon instead of a stale cached one.
// Strategy: delete the on-disk icon cache DBs, then tell Explorer to reload
// via SHChangeNotify (emulated by restarting explorer.exe as a last resort,
// we use the lighter `ie4uinit -show` first; the DB deletion guarantees the
// next icon lookup misses cache and re-reads from the .lnk).
function refreshIconCache() {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');

    // 1) Delete the flat icon cache DB
    const iconCacheDb = path.join(localAppData, 'IconCache.db');
    if (fs.existsSync(iconCacheDb)) {
      try { fs.unlinkSync(iconCacheDb); } catch (_) { /* may be locked */ }
    }

    // 2) Delete the per-size iconcache_*.db files under Explorer\
    const explorerDir = path.join(localAppData, 'Microsoft', 'Windows', 'Explorer');
    if (fs.existsSync(explorerDir)) {
      for (const name of fs.readdirSync(explorerDir)) {
        if (/^iconcache_.*\.db$/i.test(name)) {
          try { fs.unlinkSync(path.join(explorerDir, name)); } catch (_) { /* may be locked */ }
        }
      }
    }

    // 3) Ask the shell to refresh associations / icons (lightweight, no flicker)
    spawn('ie4uinit.exe', ['-show'], { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    console.warn('refreshIconCache failed (non-fatal):', err.message);
  }
}

ipcMain.handle('app:createDesktopShortcut', async () => {
  try {
    const desktopPath = path.join(require('os').homedir(), 'Desktop');
    const shortcutPath = path.join(desktopPath, '应用启动器.lnk');
    const iconPath = getAppIconPath();

    // Delete the existing shortcut first. Even though writeShortcutLink with
    // 'replace' overwrites the .lnk, Windows Explorer caches icons by file
    // inode/path. A fresh .lnk forces the shell to re-read the icon.
    if (fs.existsSync(shortcutPath)) {
      try {
        fs.unlinkSync(shortcutPath);
      } catch (e) {
        console.warn('Could not delete old shortcut (may be locked):', e.message);
      }
    }

    let shortcutOptions;
    if (app.isPackaged) {
      // Packaged: shortcut points directly to the exe
      shortcutOptions = {
        target: process.execPath,
        args: '',
        description: '应用启动器',
        icon: iconPath,
        iconIndex: 0
      };
    } else {
      // Dev: use start.vbs (ASCII path) to avoid Electron's CJK args bug
      const targetPath = path.join(__dirname, 'start.vbs');
      shortcutOptions = {
        target: 'wscript.exe',
        args: `"${targetPath}"`,
        cwd: __dirname,
        description: '应用启动器',
        icon: iconPath,
        iconIndex: 0
      };
    }

    const result = shell.writeShortcutLink(shortcutPath, 'create', shortcutOptions);

    if (result) {
      // Force Explorer to drop its stale icon cache for this shortcut
      refreshIconCache();
      return { success: true, path: shortcutPath };
    }
    return { success: false, error: '写入快捷方式失败' };
  } catch (err) {
    console.error('Failed to create shortcut:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:checkDesktopShortcut', () => {
  try {
    const desktopPath = path.join(require('os').homedir(), 'Desktop');
    const shortcutPath = path.join(desktopPath, '应用启动器.lnk');
    return fs.existsSync(shortcutPath);
  } catch {
    return false;
  }
});

// ========== Auto Start IPC ==========

// Build the auto-start command-line args. In dev (electron.exe + project folder)
// we must pass __dirname so Electron knows which app to launch — otherwise it
// shows the default Electron welcome page. In a packaged build, the exe already
// has its entry point baked in, so only --hidden is needed.
function getAutoStartArgs() {
  const args = ['--hidden'];
  if (!app.isPackaged) {
    args.push(__dirname);
  }
  return args;
}

// Sync config.autoStart to system on startup
function syncAutoStart() {
  try {
    const config = loadConfig();
    const desired = !!config.settings.autoStart;
    app.setLoginItemSettings({
      openAtLogin: desired,
      args: getAutoStartArgs()
    });
  } catch (err) {
    console.error('Failed to sync auto start:', err);
  }
}

ipcMain.handle('app:getAutoStart', () => {
  try {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  } catch {
    return false;
  }
});

ipcMain.handle('app:setAutoStart', (_event, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: getAutoStartArgs()
    });
    return { success: true };
  } catch (err) {
    console.error('Failed to set auto start:', err);
    return { success: false, error: err.message };
  }
});
