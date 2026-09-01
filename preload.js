const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  // File dialogs
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  openIconFileDialog: () => ipcRenderer.invoke('dialog:openIconFile'),
  openImageFileDialog: () => ipcRenderer.invoke('dialog:openImageFile'),

  // App operations
  getFileIcon: (filePath) => ipcRenderer.invoke('app:getFileIcon', filePath),
  launchApp: (appPath, args) => ipcRenderer.invoke('app:launch', appPath, args),
  launchAppAsAdmin: (appPath, args) => ipcRenderer.invoke('app:launchAsAdmin', appPath, args),
  openInExplorer: (filePath) => ipcRenderer.invoke('app:openInExplorer', filePath),
  getFileName: (filePath) => ipcRenderer.invoke('app:getFileName', filePath),
  readIconFile: (filePath) => ipcRenderer.invoke('app:readIconFile', filePath),
  readImageFile: (filePath) => ipcRenderer.invoke('app:readImageFile', filePath),

  // Tray / Window
  showWindow: () => ipcRenderer.invoke('tray:showWindow'),
  quitApp: () => ipcRenderer.invoke('tray:quit'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),

  // Desktop shortcut
  createDesktopShortcut: () => ipcRenderer.invoke('app:createDesktopShortcut'),
  checkDesktopShortcut: () => ipcRenderer.invoke('app:checkDesktopShortcut'),

  // Auto start
  getAutoStart: () => ipcRenderer.invoke('app:getAutoStart'),
  setAutoStart: (enabled) => ipcRenderer.invoke('app:setAutoStart', enabled),

  // ========== Float Ball ==========
  fbDragStart: () => ipcRenderer.send('floatball:dragStart'),
  fbDragEnd: () => ipcRenderer.send('floatball:dragEnd'),
  fbSavePosition: () => ipcRenderer.send('floatball:savePosition'),
  fbExpand: () => ipcRenderer.invoke('floatball:expand'),
  fbCollapse: () => ipcRenderer.invoke('floatball:collapse'),
  fbGetRecentApps: () => ipcRenderer.invoke('floatball:getRecentApps'),
  fbLaunchApp: (appId) => ipcRenderer.invoke('floatball:launchApp', appId),
  fbShowMain: () => ipcRenderer.invoke('floatball:showMain'),
  fbRightClick: () => ipcRenderer.send('floatball:rightClick'),
  fbGetSettings: () => ipcRenderer.invoke('floatball:getSettings'),
  fbOnInit: (callback) => ipcRenderer.on('floatball:init', (_e, data) => callback(data)),
  fbOnSettingsChanged: (callback) => ipcRenderer.on('floatball:settingsChanged', (_e, data) => callback(data)),
  fbOnCollapseUI: (callback) => ipcRenderer.on('floatball:collapseUI', () => callback()),

  // Main window: listen for float ball disabled by user
  onFloatBallDisabled: (callback) => ipcRenderer.on('floatball:disabledByUser', () => callback()),

  // ========== Icon Crop Window ==========
  cropOnInit: (callback) => ipcRenderer.on('crop:init', (_e, data) => callback(data)),
  cropConfirm: (dataUrl) => ipcRenderer.invoke('crop:confirm', dataUrl),
  cropCancel: () => ipcRenderer.invoke('crop:cancel'),
});
