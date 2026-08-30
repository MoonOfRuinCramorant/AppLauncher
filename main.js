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
  floatBallX: 100,
  floatBallY: 100,
  floatBallIcon: null, // custom icon for the float ball (data URL)
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

function createFloatBallWindow() {
  if (floatBallWindow) return;

  const config = loadConfig();
  const s = config.settings;

  floatBallWindow = new BrowserWindow({
    width: BALL_SIZE,
    height: BALL_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    x: s.floatBallX || 100,
    y: s.floatBallY || 100,
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
    // Send current theme and settings
    floatBallWindow.webContents.send('floatball:init', {
      theme: s.theme,
      singleClick: s.floatBallSingleClick,
      doubleClick: s.floatBallDoubleClick,
      ballIcon: s.floatBallIcon || null,
    });
  });

  floatBallWindow.on('closed', () => {
    floatBallWindow = null;
  });

  // Fallback: if the window loses focus mid-drag (e.g. mouse released
  // outside the window after the window failed to follow), stop the drag
  // so the ball never gets stuck in a broken dragging state.
  floatBallWindow.on('blur', () => {
    stopDragFollow();
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
    dockState = { side: null, hidden: false, freeX: 0, freeY: 0, lastOutTime: 0 };
    // Save position before destroying
    if (floatBallWindow) {
      // If the ball was docked to an edge, restore the free position instead
      const sx = dockState.side ? dockState.freeX : floatBallWindow.getPosition()[0];
      const sy = dockState.side ? dockState.freeY : floatBallWindow.getPosition()[1];
      const config = loadConfig();
      config.settings.floatBallX = sx;
      config.settings.floatBallY = sy;
      saveConfig(config);
    }
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
let dragOffset = { x: 0, y: 0 };

function stopDragFollow() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

function startDragFollow() {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
  stopDragFollow();
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = floatBallWindow.getPosition();
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy };

  // If the ball was docked to the edge, dragging it out cancels the dock
  cancelDockKeepPosition();

  dragTimer = setInterval(() => {
    if (!floatBallWindow || floatBallWindow.isDestroyed()) {
      stopDragFollow();
      return;
    }
    const cursorNow = screen.getCursorScreenPoint();
    floatBallWindow.setPosition(cursorNow.x - dragOffset.x, cursorNow.y - dragOffset.y);
  }, 16);
}

function saveFloatBallPosition() {
  try {
    if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
    const [x, y] = floatBallWindow.getPosition();
    const config = loadConfig();
    config.settings.floatBallX = x;
    config.settings.floatBallY = y;
    saveConfig(config);
  } catch (err) {
    console.error('Failed to save float ball position:', err);
  }
}

// ========== Float Ball Dock (hide to screen edge) ==========
// Right-click -> "hide to edge": the ball tucks itself at the right/top
// screen edge leaving a few pixels visible. Moving the cursor to that edge
// pops the ball back out; moving away re-hides it after a short delay.

const DOCK_PEEK = 6;          // px left visible while hidden at the edge
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
    nx = wa.x + wa.width - BALL_SIZE + DOCK_PEEK;
    ny = Math.min(Math.max(y, wa.y), wa.y + wa.height - BALL_SIZE);
  } else { // top
    nx = Math.min(Math.max(x, wa.x), wa.x + wa.width - BALL_SIZE);
    ny = wa.y + DOCK_PEEK;
  }
  floatBallWindow.setPosition(nx, ny);

  // If the popup was open, collapse it so the window shrinks back to the ball
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
    nx = wa.x + wa.width - BALL_SIZE + DOCK_PEEK;
  } else {
    ny = wa.y + DOCK_PEEK;
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
  floatBallWindow.setPosition(dockState.freeX, dockState.freeY);
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
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    try {
      // If the ball was docked to an edge, restore the free position instead
      const x = dockState.side ? dockState.freeX : floatBallWindow.getPosition()[0];
      const y = dockState.side ? dockState.freeY : floatBallWindow.getPosition()[1];
      const config = loadConfig();
      config.settings.floatBallX = x;
      config.settings.floatBallY = y;
      saveConfig(config);
    } catch (err) {
      console.error('Failed to save float ball position on quit:', err);
    }
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
  startDragFollow();
});

// End drag: stop following the cursor and persist the position
ipcMain.on('floatball:dragEnd', () => {
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

  // If the ball is docked to an edge, restore the free position first so
  // the popup is fully visible on screen.
  if (dockState.side) {
    undockFloatBall();
  }

  const [x, y] = floatBallWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x, y });
  const workArea = display.workArea;

  // Check if there's enough space below the ball
  const spaceBelow = workArea.y + workArea.height - y - BALL_SIZE;
  let newY = y;

  if (spaceBelow < POPUP_HEIGHT) {
    // Not enough space below, show popup above the ball
    newY = y - (POPUP_HEIGHT - BALL_SIZE);
    if (newY < workArea.y) newY = workArea.y;
  }

  floatBallWindow.setBounds({
    x: x,
    y: newY,
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT
  });
});

// Collapse the float ball window back to just the ball
ipcMain.handle('floatball:collapse', () => {
  if (!floatBallWindow || floatBallWindow.isDestroyed()) return;

  const [x, y] = floatBallWindow.getPosition();
  // When collapsing, keep the ball position stable
  // The ball is always at the top-left of the window
  floatBallWindow.setBounds({
    x: x,
    y: y,
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
        // Save position
        if (floatBallWindow && !floatBallWindow.isDestroyed()) {
          const [x, y] = floatBallWindow.getPosition();
          const config = loadConfig();
          config.settings.floatBallEnabled = false;
          config.settings.floatBallX = x;
          config.settings.floatBallY = y;
          saveConfig(config);
        }
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

    const buffer = fs.readFileSync(result.filePaths[0]);
    const ext = path.extname(result.filePaths[0]).toLowerCase();
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.bmp': 'image/bmp',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const dataUrl = `data:${mimeMap[ext] || 'image/png'};base64,${buffer.toString('base64')}`;

    const config = loadConfig();
    config.settings.floatBallIcon = dataUrl;
    saveConfig(config);
    sendToFloatBall('floatball:settingsChanged', { ballIcon: dataUrl });
  } catch (err) {
    console.error('Failed to choose float ball icon:', err);
  }
}

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
