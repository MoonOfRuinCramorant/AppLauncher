/* ============================================
   App Launcher - Renderer Logic
   ============================================ */

// ========== State ==========

const state = {
  config: {
    apps: [],
    groups: [],
    settings: {
      theme: 'light',
      sortBy: 'manual',
      minimizeToTray: true,
      viewMode: 'grid',
      backgroundEnabled: false,
      backgroundImage: null,
      backgroundOpacity: 0.3,
      backgroundBlur: 0,
  launchClose: false,
  floatBallEnabled: false,
  floatBallSingleClick: 'recent',
  floatBallDoubleClick: 'showMain',
}
  },
  currentView: 'all',
  currentViewMode: 'grid',
  searchQuery: '',
  contextMenuAppId: null,
  editingAppId: null,
  editingGroupId: null,
  selectedEmoji: '📁',
  pendingIconData: null,
  pendingIconPath: null,
  isDefaultIcon: true,
  pendingBgImage: null,
  pendingBgFileName: null,
  draggedAppId: null,
  draggedGroupId: null,
  // Crop state
  cropImageDataUrl: null,
  cropNaturalWidth: 0,
  cropNaturalHeight: 0,
  cropDisplayWidth: 0,
  cropDisplayHeight: 0,
  cropSel: { x: 0, y: 0, w: 0, h: 0 },
  cropDragMode: null,
  cropDragStart: null,
};

// ========== Constants ==========

const EMOJI_LIST = [
  '📁', '💻', '🎮', '📝', '🎨', '📊', '🎬', '🎵',
  '🔧', '⚙️', '🌐', '📚', '🏢', '🛠️', '💼', '🔬',
  '📸', '💬', '🎯', '⭐', '🚀', '🏠', '🔒', '💡',
  '📺', '🎲', '✏️', '📋', '🗂️', '📦', '🔌', '🎨'
];

// System folders with CLSIDs / shell commands / URIs
const SYSTEM_FOLDERS = [
  { name: '此电脑', path: 'shell:::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', icon: '💻' },
  { name: '回收站', path: 'shell:::{645FF040-5081-101B-9F08-00AA002F954E}', icon: '🗑️' },
  { name: '控制面板', path: 'shell:::{21EC2020-3AEA-1069-A2DD-08002B30309D}', icon: '⚙️' },
  { name: 'Windows 设置', path: 'ms-settings:', icon: '🔧' },
  { name: '网络', path: 'shell:::{F02C1A0D-BE21-4350-88B0-7447BC5800D3}', icon: '🌐' },
  { name: '文档', path: 'shell:Personal', icon: '📄' },
  { name: '下载', path: 'shell:Downloads', icon: '📥' },
  { name: '桌面', path: 'shell:Desktop', icon: '🖥️' },
  { name: '图片', path: 'shell:My Pictures', icon: '🖼️' },
  { name: '音乐', path: 'shell:My Music', icon: '🎵' },
  { name: '视频', path: 'shell:My Video', icon: '🎬' },
  { name: '用户文件夹', path: 'shell:Profile', icon: '🏠' },
  { name: '运行', path: 'shell:::{2559a1f3-21d7-11d4-bdaf-00c04f60b9f0}', icon: '🏃' },
];

const VIEW_TITLES = {
  all: '全部应用',
  recent: '最近使用',
  mostUsed: '常用应用',
};

// ========== DOM References ==========

const $ = (id) => document.getElementById(id);

const dom = {
  bgLayer: $('bgLayer'),
  searchInput: $('searchInput'),
  searchClear: $('searchClear'),
  sidebarNav: $('sidebarNav'),
  navGroups: $('navGroups'),
  appGrid: $('appGrid'),
  appList: $('appList'),
  emptyState: $('emptyState'),
  emptyTitle: $('emptyTitle'),
  emptyDesc: $('emptyDesc'),
  emptyAddBtn: $('emptyAddBtn'),
  viewTitle: $('viewTitle'),
  viewSubtitle: $('viewSubtitle'),
  sortSelect: $('sortSelect'),
  addAppBtn: $('addAppBtn'),
  addGroupBtn: $('addGroupBtn'),
  appCount: $('appCount'),
  viewToggle: $('viewToggle'),
  footerSettingsBtn: $('footerSettingsBtn'),
  // App modal
  appModal: $('appModal'),
  modalTitle: $('modalTitle'),
  appPathInput: $('appPathInput'),
  appNameInput: $('appNameInput'),
  appGroupSelect: $('appGroupSelect'),
  appArgsInput: $('appArgsInput'),
  iconPreview: $('iconPreview'),
  iconFileName: $('iconFileName'),
  customIconBtn: $('customIconBtn'),
  resetIconBtn: $('resetIconBtn'),
  browseBtn: $('browseBtn'),
  browseFolderBtn: $('browseFolderBtn'),
  browseSystemBtn: $('browseSystemBtn'),
  // System folder modal
  systemFolderModal: $('systemFolderModal'),
  systemFolderGrid: $('systemFolderGrid'),
  systemFolderClose: $('systemFolderClose'),
  modalClose: $('modalClose'),
  modalCancel: $('modalCancel'),
  modalSave: $('modalSave'),
  // Group modal
  groupModal: $('groupModal'),
  groupModalTitle: $('groupModalTitle'),
  groupNameInput: $('groupNameInput'),
  emojiPicker: $('emojiPicker'),
  groupModalClose: $('groupModalClose'),
  groupModalCancel: $('groupModalCancel'),
  groupModalSave: $('groupModalSave'),
  groupDeleteBtn: $('groupDeleteBtn'),
  // Settings modal
  settingsModal: $('settingsModal'),
  settingsClose: $('settingsClose'),
  settingsCloseBtn: $('settingsCloseBtn'),
  themeSelector: $('themeSelector'),
  bgEnabledToggle: $('bgEnabledToggle'),
  bgUploadRow: $('bgUploadRow'),
  bgUploadBtn: $('bgUploadBtn'),
  bgRemoveBtn: $('bgRemoveBtn'),
  bgFileName: $('bgFileName'),
  bgOpacityRow: $('bgOpacityRow'),
  bgOpacitySlider: $('bgOpacitySlider'),
  bgOpacityValue: $('bgOpacityValue'),
  bgBlurRow: $('bgBlurRow'),
  bgBlurSlider: $('bgBlurSlider'),
  bgBlurValue: $('bgBlurValue'),
  defaultViewSelect: $('defaultViewSelect'),
  trayToggle: $('trayToggle'),
  launchCloseToggle: $('launchCloseToggle'),
  createShortcutBtn: $('createShortcutBtn'),
  shortcutStatus: $('shortcutStatus'),
  // Float ball settings
  floatBallToggle: $('floatBallToggle'),
  floatBallClickRow: $('floatBallClickRow'),
  floatBallDblClickRow: $('floatBallDblClickRow'),
  floatBallSingleSelect: $('floatBallSingleClick'),
  floatBallDoubleSelect: $('floatBallDoubleClick'),
  // Context menu
  contextMenu: $('contextMenu'),
  ctxLaunch: $('ctxLaunch'),
  ctxOpenLocation: $('ctxOpenLocation'),
  ctxEdit: $('ctxEdit'),
  ctxMoveTo: $('ctxMoveTo'),
  ctxSubmenu: $('ctxSubmenu'),
  ctxDelete: $('ctxDelete'),
  // Toast
  toast: $('toast'),
  toastIcon: $('toastIcon'),
  toastMsg: $('toastMsg'),
  // Confirm dialog
  confirmDialog: $('confirmDialog'),
  confirmTitle: $('confirmTitle'),
  confirmMsg: $('confirmMsg'),
  confirmCancel: $('confirmCancel'),
  confirmOk: $('confirmOk'),
  // Crop modal
  cropModal: $('cropModal'),
  cropClose: $('cropClose'),
  cropCancel: $('cropCancel'),
  cropFullBtn: $('cropFullBtn'),
  cropConfirmBtn: $('cropConfirmBtn'),
  cropContainer: $('cropContainer'),
  cropImage: $('cropImage'),
  cropSelection: $('cropSelection'),
  // Badges
  badgeAll: $('badge-all'),
  badgeRecent: $('badge-recent'),
  badgeMostUsed: $('badge-mostUsed'),
  // Auto start
  autoStartToggle: $('autoStartToggle'),
};

// ========== Utilities ==========

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(msg, type = 'success') {
  dom.toast.className = 'toast toast-' + type;
  dom.toastIcon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  dom.toastMsg.textContent = msg;
  dom.toast.style.display = 'flex';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    dom.toast.style.display = 'none';
  }, 2400);
}

let confirmCallback = null;
function showConfirm(title, msg, callback) {
  dom.confirmTitle.textContent = title;
  dom.confirmMsg.textContent = msg;
  dom.confirmDialog.style.display = 'flex';
  confirmCallback = callback;
}

function hideConfirm() {
  dom.confirmDialog.style.display = 'none';
  confirmCallback = null;
}

// ========== Theme Management ==========

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ========== Background Management ==========

function applyBackground() {
  const { backgroundEnabled, backgroundImage, backgroundOpacity, backgroundBlur } = state.config.settings;

  if (backgroundEnabled && backgroundImage) {
    dom.bgLayer.style.backgroundImage = `url("${backgroundImage}")`;
    dom.bgLayer.style.opacity = backgroundOpacity;
    dom.bgLayer.style.filter = `blur(${backgroundBlur}px)`;
  } else {
    dom.bgLayer.style.opacity = '0';
    dom.bgLayer.style.backgroundImage = '';
  }
}

// ========== View Mode Management ==========

function applyViewMode(mode) {
  state.currentViewMode = mode;
  // Update toggle buttons
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  renderMain();
}

// ========== Config Persistence ==========

async function saveConfig() {
  await window.api.saveConfig(state.config);
}

// ========== Data Filtering ==========

function getFilteredApps() {
  let apps = [...state.config.apps];

  // Filter by view
  if (state.currentView === 'recent') {
    apps = apps
      .filter(a => a.lastLaunched)
      .sort((a, b) => new Date(b.lastLaunched) - new Date(a.lastLaunched))
      .slice(0, 20);
  } else if (state.currentView === 'mostUsed') {
    apps = apps
      .filter(a => a.launchCount > 0)
      .sort((a, b) => b.launchCount - a.launchCount)
      .slice(0, 20);
  } else if (state.currentView !== 'all') {
    apps = apps.filter(a => a.groupId === state.currentView);
  }

  // Filter by search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    apps = apps.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.path && a.path.toLowerCase().includes(q))
    );
  }

  // Sort (only for all and group views)
  if (state.currentView === 'all' || state.currentView.startsWith('group_')) {
    const sortBy = state.config.settings.sortBy || 'manual';
    if (sortBy === 'name') {
      apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortBy === 'lastLaunched') {
      apps.sort((a, b) => new Date(b.lastLaunched || 0) - new Date(a.lastLaunched || 0));
    } else if (sortBy === 'mostUsed') {
      apps.sort((a, b) => b.launchCount - a.launchCount);
    }
    // For 'manual' sort, maintain original array order (no sorting)
  }

  return apps;
}

// ========== Rendering ==========

function renderSidebar() {
  // Update badges
  const totalApps = state.config.apps.length;
  dom.badgeAll.textContent = totalApps > 0 ? totalApps : '';
  dom.badgeAll.style.display = totalApps > 0 ? '' : 'none';

  const recentCount = state.config.apps.filter(a => a.lastLaunched).length;
  dom.badgeRecent.textContent = recentCount > 0 ? recentCount : '';
  dom.badgeRecent.style.display = recentCount > 0 ? '' : 'none';

  const usedCount = state.config.apps.filter(a => a.launchCount > 0).length;
  dom.badgeMostUsed.textContent = usedCount > 0 ? usedCount : '';
  dom.badgeMostUsed.style.display = usedCount > 0 ? '' : 'none';

  // Render groups
  dom.navGroups.innerHTML = '';
  state.config.groups.forEach(group => {
    const item = document.createElement('div');
    item.className = 'nav-item nav-group-item' + (state.currentView === group.id ? ' active' : '');
    item.dataset.view = group.id;
    item.dataset.groupId = group.id;
    item.draggable = true;

    const count = state.config.apps.filter(a => a.groupId === group.id).length;

    item.innerHTML = `
      <span class="nav-icon">${escapeHtml(group.icon || '📁')}</span>
      <span class="nav-label">${escapeHtml(group.name)}</span>
      <span class="nav-badge">${count > 0 ? count : ''}</span>
    `;

    item.addEventListener('click', () => {
      state.currentView = group.id;
      renderAll();
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      state.editingGroupId = group.id;
      openGroupModal(group);
    });

    // Drag & Drop for group reordering
    item.addEventListener('dragstart', (e) => handleGroupDragStart(e, group.id));
    item.addEventListener('dragover', (e) => handleGroupDragOver(e, group.id));
    item.addEventListener('dragleave', (e) => handleGroupDragLeave(e));
    item.addEventListener('drop', (e) => handleGroupDrop(e, group.id));
    item.addEventListener('dragend', (e) => handleGroupDragEnd(e));

    dom.navGroups.appendChild(item);
  });

  // Update active states
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === state.currentView);
  });

  // Footer
  dom.appCount.textContent = `${totalApps} 个应用 · ${state.config.groups.length} 个分组`;
}

function renderMain() {
  const apps = getFilteredApps();

  // Update title
  if (state.currentView === 'all' || state.currentView === 'recent' || state.currentView === 'mostUsed') {
    dom.viewTitle.textContent = VIEW_TITLES[state.currentView] || '全部应用';
    const subtitle = apps.length > 0 ? `${apps.length} 个应用` : '';
    dom.viewSubtitle.textContent = subtitle;
  } else {
    const group = state.config.groups.find(g => g.id === state.currentView);
    dom.viewTitle.textContent = group ? `${group.icon || '📁'} ${group.name}` : '全部应用';
    dom.viewSubtitle.textContent = apps.length > 0 ? `${apps.length} 个应用` : '';
  }

  // Show/hide sort dropdown
  const showSort = state.currentView === 'all' || state.currentView.startsWith('group_');
  dom.sortSelect.style.display = showSort ? '' : 'none';

  // Show/hide empty state
  if (apps.length === 0) {
    dom.appGrid.style.display = 'none';
    dom.appList.style.display = 'none';
    dom.emptyState.style.display = 'flex';

    if (state.searchQuery) {
      dom.emptyTitle.textContent = '没有找到匹配的应用';
      dom.emptyDesc.textContent = `没有应用匹配"${state.searchQuery}"，试试其他关键词`;
      dom.emptyAddBtn.style.display = 'none';
    } else if (state.currentView === 'recent') {
      dom.emptyTitle.textContent = '还没有使用记录';
      dom.emptyDesc.textContent = '启动应用后，最近使用的应用会显示在这里';
      dom.emptyAddBtn.style.display = 'none';
    } else if (state.currentView === 'mostUsed') {
      dom.emptyTitle.textContent = '还没有常用应用';
      dom.emptyDesc.textContent = '多使用应用后，最常用的应用会显示在这里';
      dom.emptyAddBtn.style.display = 'none';
    } else if (state.currentView !== 'all') {
      dom.emptyTitle.textContent = '这个分组还没有应用';
      dom.emptyDesc.textContent = '点击右上角"添加应用"按钮，将应用添加到此分组';
      dom.emptyAddBtn.style.display = '';
    } else {
      dom.emptyTitle.textContent = '还没有添加应用';
      dom.emptyDesc.textContent = '点击下方按钮，导入你常用的应用程序';
      dom.emptyAddBtn.style.display = '';
    }
  } else {
    dom.emptyState.style.display = 'none';
    if (state.currentViewMode === 'grid') {
      dom.appGrid.style.display = 'grid';
      dom.appList.style.display = 'none';
      renderAppGrid(apps);
    } else {
      dom.appGrid.style.display = 'none';
      dom.appList.style.display = 'flex';
      renderAppList(apps);
    }
  }
}

function renderAppGrid(apps) {
  dom.appGrid.innerHTML = '';

  const canDrag = state.currentView === 'all' || state.currentView.startsWith('group_');

  apps.forEach(app => {
    const card = document.createElement('div');
    card.className = 'app-card';
    card.dataset.appId = app.id;
    if (canDrag) card.draggable = true;

    const group = app.groupId ? state.config.groups.find(g => g.id === app.groupId) : null;

    let iconHtml;
    if (app.icon) {
      if (app.icon.startsWith('data:')) {
        iconHtml = `<img src="${app.icon}" alt="${escapeHtml(app.name)}" />`;
      } else {
        iconHtml = `<span class="emoji-icon">${escapeHtml(app.icon)}</span>`;
      }
    } else {
      iconHtml = '📦';
    }

    card.innerHTML = `
      <div class="app-card-icon">${iconHtml}</div>
      <div class="app-card-name">${escapeHtml(app.name)}</div>
      ${group ? `<div class="app-card-badge">${escapeHtml(group.icon || '📁')}</div>` : ''}
      ${app.launchCount > 0 ? `<div class="app-card-count">🔥 ${app.launchCount}</div>` : ''}
    `;

    card.addEventListener('click', () => launchApp(app.id));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(app.id, e.clientX, e.clientY);
    });

    if (canDrag) {
      card.addEventListener('dragstart', (e) => handleDragStart(e, app.id));
      card.addEventListener('dragover', (e) => handleDragOver(e, app.id));
      card.addEventListener('dragleave', (e) => handleDragLeave(e));
      card.addEventListener('drop', (e) => handleDrop(e, app.id));
      card.addEventListener('dragend', (e) => handleDragEnd(e));
    }

    dom.appGrid.appendChild(card);
  });
}

function renderAppList(apps) {
  dom.appList.innerHTML = '';

  const canDrag = state.currentView === 'all' || state.currentView.startsWith('group_');

  apps.forEach(app => {
    const item = document.createElement('div');
    item.className = 'app-list-item';
    item.dataset.appId = app.id;
    if (canDrag) item.draggable = true;

    const group = app.groupId ? state.config.groups.find(g => g.id === app.groupId) : null;

    let iconHtml;
    if (app.icon) {
      if (app.icon.startsWith('data:')) {
        iconHtml = `<img src="${app.icon}" alt="${escapeHtml(app.name)}" />`;
      } else {
        iconHtml = `<span class="emoji-icon">${escapeHtml(app.icon)}</span>`;
      }
    } else {
      iconHtml = '📦';
    }

    item.innerHTML = `
      <div class="app-list-item-icon">${iconHtml}</div>
      <div class="app-list-item-name">${escapeHtml(app.name)}</div>
      <div class="app-list-item-path">${escapeHtml(app.path || '')}</div>
      ${group ? `<div class="app-list-item-group">${escapeHtml(group.icon || '📁')} ${escapeHtml(group.name)}</div>` : ''}
      ${app.launchCount > 0 ? `<div class="app-list-item-count">🔥 ${app.launchCount}</div>` : ''}
    `;

    item.addEventListener('click', () => launchApp(app.id));
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(app.id, e.clientX, e.clientY);
    });

    if (canDrag) {
      item.addEventListener('dragstart', (e) => handleDragStart(e, app.id));
      item.addEventListener('dragover', (e) => handleDragOver(e, app.id));
      item.addEventListener('dragleave', (e) => handleDragLeave(e));
      item.addEventListener('drop', (e) => handleDrop(e, app.id));
      item.addEventListener('dragend', (e) => handleDragEnd(e));
    }

    dom.appList.appendChild(item);
  });
}

function renderAll() {
  renderSidebar();
  renderMain();
}

// ========== Drag & Drop Reordering ==========

function handleDragStart(e, appId) {
  state.draggedAppId = appId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', appId);
  e.target.classList.add('dragging');
}

function handleDragOver(e, targetAppId) {
  if (!state.draggedAppId || state.draggedAppId === targetAppId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, targetAppId) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');

  const draggedId = state.draggedAppId;
  if (!draggedId || draggedId === targetAppId) return;

  // Reorder the apps array
  const draggedIndex = state.config.apps.findIndex(a => a.id === draggedId);
  const targetIndex = state.config.apps.findIndex(a => a.id === targetAppId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  // Remove dragged app and insert at target position
  const [draggedApp] = state.config.apps.splice(draggedIndex, 1);
  state.config.apps.splice(targetIndex, 0, draggedApp);

  // Switch to manual sort if not already
  if (state.config.settings.sortBy !== 'manual') {
    state.config.settings.sortBy = 'manual';
    dom.sortSelect.value = 'manual';
  }

  await saveConfig();
  renderMain();
  showToast('已调整顺序', 'success');
}

function handleDragEnd(e) {
  state.draggedAppId = null;
  e.target.classList.remove('dragging');
  // Clean up any remaining drag-over classes
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

// ========== Group Drag & Drop Reordering ==========

function handleGroupDragStart(e, groupId) {
  state.draggedGroupId = groupId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', groupId);
  e.target.classList.add('dragging');
}

function handleGroupDragOver(e, targetGroupId) {
  if (!state.draggedGroupId || state.draggedGroupId === targetGroupId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function handleGroupDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleGroupDrop(e, targetGroupId) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');

  const draggedId = state.draggedGroupId;
  if (!draggedId || draggedId === targetGroupId) return;

  // Reorder the groups array
  const draggedIndex = state.config.groups.findIndex(g => g.id === draggedId);
  const targetIndex = state.config.groups.findIndex(g => g.id === targetGroupId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  const [draggedGroup] = state.config.groups.splice(draggedIndex, 1);
  state.config.groups.splice(targetIndex, 0, draggedGroup);

  await saveConfig();
  renderSidebar();
  showToast('分组顺序已调整', 'success');
}

function handleGroupDragEnd(e) {
  state.draggedGroupId = null;
  e.target.classList.remove('dragging');
  document.querySelectorAll('.nav-group-item.drag-over').forEach(el => el.classList.remove('drag-over'));
}

// ========== App Launch ==========

async function launchApp(appId) {
  const app = state.config.apps.find(a => a.id === appId);
  if (!app) return;

  // Add launch animation
  const elements = document.querySelectorAll(`[data-app-id="${appId}"]`);
  elements.forEach(el => {
    el.classList.add('launching');
    setTimeout(() => el.classList.remove('launching'), 400);
  });

  const result = await window.api.launchApp(app.path, app.args || '');
  if (result.success) {
    app.lastLaunched = new Date().toISOString();
    app.launchCount = (app.launchCount || 0) + 1;
    await saveConfig();
    showToast(`已启动: ${app.name}`, 'success');

    // If launchClose is enabled, hide the window
    if (state.config.settings.launchClose) {
      setTimeout(() => window.api.hideWindow(), 500);
    }

    // Re-render if in recent/mostUsed view to update order
    if (state.currentView === 'recent' || state.currentView === 'mostUsed') {
      renderMain();
    }
    renderSidebar();
  } else {
    showToast(`启动失败: ${result.error || '未知错误'}`, 'error');
  }
}

// ========== App Modal (Add/Edit) ==========

async function openAppModal(appId = null) {
  state.editingAppId = appId;
  state.pendingIconData = null;
  state.pendingIconPath = null;
  state.isDefaultIcon = true;

  // Populate group select
  dom.appGroupSelect.innerHTML = '<option value="">未分组</option>';
  state.config.groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.icon || '📁'} ${g.name}`;
    dom.appGroupSelect.appendChild(opt);
  });

  if (appId) {
    const app = state.config.apps.find(a => a.id === appId);
    if (!app) return;

    dom.modalTitle.textContent = '编辑应用';
    dom.appPathInput.value = app.path || '';
    dom.appNameInput.value = app.name || '';
    dom.appGroupSelect.value = app.groupId || '';
    dom.appArgsInput.value = app.args || '';

    if (app.icon) {
      if (app.icon.startsWith('data:')) {
        dom.iconPreview.innerHTML = `<img src="${app.icon}" alt="icon" />`;
      } else {
        dom.iconPreview.innerHTML = `<span class="icon-placeholder" style="font-size:36px;">${escapeHtml(app.icon)}</span>`;
      }
      dom.iconFileName.textContent = '当前图标';
      state.pendingIconData = app.icon;
    } else {
      dom.iconPreview.innerHTML = '<span class="icon-placeholder">🖼️</span>';
      dom.iconFileName.textContent = '无图标';
    }
    dom.resetIconBtn.style.display = 'none';
  } else {
    dom.modalTitle.textContent = '添加应用';
    dom.appPathInput.value = '';
    dom.appNameInput.value = '';
    dom.appGroupSelect.value = state.currentView.startsWith('group_') ? state.currentView : '';
    dom.appArgsInput.value = '';
    dom.iconPreview.innerHTML = '<span class="icon-placeholder">🖼️</span>';
    dom.iconFileName.textContent = '选择应用后自动提取图标';
    dom.resetIconBtn.style.display = 'none';
  }

  dom.appModal.style.display = 'flex';
  setTimeout(() => dom.appNameInput.focus(), 100);
}

function closeAppModal() {
  dom.appModal.style.display = 'none';
  state.editingAppId = null;
  state.pendingIconData = null;
  state.pendingIconPath = null;
}

async function handleBrowse() {
  const filePath = await window.api.openFileDialog();
  if (!filePath) return;

  dom.appPathInput.value = filePath;

  if (!dom.appNameInput.value) {
    const name = await window.api.getFileName(filePath);
    dom.appNameInput.value = name;
  }

  const iconData = await window.api.getFileIcon(filePath);
  if (iconData) {
    state.pendingIconData = iconData;
    state.pendingIconPath = null;
    state.isDefaultIcon = true;
    dom.iconPreview.innerHTML = `<img src="${iconData}" alt="icon" />`;
    dom.iconFileName.textContent = '已自动提取图标';
    dom.resetIconBtn.style.display = 'none';
  }
}

async function handleBrowseFolder() {
  const folderPath = await window.api.openDirectoryDialog();
  if (!folderPath) return;

  dom.appPathInput.value = folderPath;

  if (!dom.appNameInput.value) {
    // Use folder name as app name
    const folderName = folderPath.split(/[\\/]/).pop();
    dom.appNameInput.value = folderName;
  }

  // Try to get the system folder icon
  const iconData = await window.api.getFileIcon(folderPath);
  if (iconData) {
    state.pendingIconData = iconData;
    state.pendingIconPath = null;
    state.isDefaultIcon = true;
    dom.iconPreview.innerHTML = `<img src="${iconData}" alt="icon" />`;
    dom.iconFileName.textContent = '文件夹图标';
    dom.resetIconBtn.style.display = 'none';
  } else {
    // Fallback to folder emoji
    state.pendingIconData = null;
    dom.iconPreview.innerHTML = '<span class="icon-placeholder">📁</span>';
    dom.iconFileName.textContent = '文件夹';
  }
}

// ========== System Folder Picker ==========

function openSystemFolderModal() {
  dom.systemFolderGrid.innerHTML = '';
  SYSTEM_FOLDERS.forEach(folder => {
    const btn = document.createElement('div');
    btn.className = 'system-folder-item';
    btn.innerHTML = `
      <span class="system-folder-icon">${folder.icon}</span>
      <span class="system-folder-name">${escapeHtml(folder.name)}</span>
    `;
    btn.addEventListener('click', () => {
      handleSelectSystemFolder(folder);
    });
    dom.systemFolderGrid.appendChild(btn);
  });

  dom.systemFolderModal.style.display = 'flex';
}

function closeSystemFolderModal() {
  dom.systemFolderModal.style.display = 'none';
}

function handleSelectSystemFolder(folder) {
  dom.appPathInput.value = folder.path;

  if (!dom.appNameInput.value) {
    dom.appNameInput.value = folder.name;
  }

  // Use emoji icon for system folders
  state.pendingIconData = folder.icon;
  state.pendingIconPath = null;
  state.isDefaultIcon = true;
  dom.iconPreview.innerHTML = `<span class="icon-placeholder" style="font-size:36px;">${folder.icon}</span>`;
  dom.iconFileName.textContent = folder.name + ' 图标';
  dom.resetIconBtn.style.display = 'none';

  closeSystemFolderModal();
  showToast(`已选择: ${folder.name}`, 'success');
}

async function handleCustomIcon() {
  const iconPath = await window.api.openIconFileDialog();
  if (!iconPath) return;

  try {
    const dataUrl = await window.api.readIconFile(iconPath);
    if (!dataUrl) {
      showToast('读取图标文件失败', 'error');
      return;
    }

    state.pendingIconData = dataUrl;
    state.pendingIconPath = iconPath;
    state.isDefaultIcon = false;

    dom.iconPreview.innerHTML = `<img src="${dataUrl}" alt="icon" />`;
    dom.iconFileName.textContent = iconPath.split(/[\\/]/).pop();
    dom.resetIconBtn.style.display = '';
  } catch (err) {
    showToast('读取图标文件失败', 'error');
  }
}

async function handleResetIcon() {
  const filePath = dom.appPathInput.value;
  if (!filePath) {
    dom.iconPreview.innerHTML = '<span class="icon-placeholder">🖼️</span>';
    dom.iconFileName.textContent = '选择应用后自动提取图标';
    return;
  }
  // For shell paths or URI schemes, try to get system icon, fall back to folder emoji
  if (filePath.startsWith('shell:') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filePath)) {
    const iconData = await window.api.getFileIcon(filePath);
    if (iconData) {
      state.pendingIconData = iconData;
      dom.iconPreview.innerHTML = `<img src="${iconData}" alt="icon" />`;
      dom.iconFileName.textContent = '已自动提取图标';
    } else {
      state.pendingIconData = '📁';
      dom.iconPreview.innerHTML = '<span class="icon-placeholder" style="font-size:36px;">📁</span>';
      dom.iconFileName.textContent = '系统文件夹';
    }
    dom.resetIconBtn.style.display = 'none';
    return;
  }
  const iconData = await window.api.getFileIcon(filePath);
  if (iconData) {
    state.pendingIconData = iconData;
    state.pendingIconPath = null;
    state.isDefaultIcon = true;
    dom.iconPreview.innerHTML = `<img src="${iconData}" alt="icon" />`;
    dom.iconFileName.textContent = '已自动提取图标';
  }
  dom.resetIconBtn.style.display = 'none';
}

async function handleSaveApp() {
  const appPath = dom.appPathInput.value.trim();
  const name = dom.appNameInput.value.trim();

  if (!appPath) {
    showToast('请选择应用程序路径', 'error');
    return;
  }
  if (!name) {
    showToast('请输入应用名称', 'error');
    return;
  }

  const groupId = dom.appGroupSelect.value || null;
  const args = dom.appArgsInput.value.trim();
  const icon = state.pendingIconData || null;

  if (state.editingAppId) {
    const app = state.config.apps.find(a => a.id === state.editingAppId);
    if (app) {
      app.name = name;
      app.path = appPath;
      app.groupId = groupId;
      app.args = args;
      app.icon = icon;
    }
    showToast('应用已更新', 'success');
  } else {
    const newApp = {
      id: generateId('app'),
      name,
      path: appPath,
      icon,
      groupId,
      args,
      lastLaunched: null,
      launchCount: 0,
      sortOrder: state.config.apps.length,
    };
    state.config.apps.push(newApp);
    showToast('应用已添加', 'success');
  }

  await saveConfig();
  closeAppModal();
  renderAll();
}

// ========== App Delete ==========

async function deleteApp(appId) {
  const app = state.config.apps.find(a => a.id === appId);
  if (!app) return;

  showConfirm(
    '删除应用',
    `确定要删除"${app.name}"吗？此操作不会删除实际的应用程序文件。`,
    async () => {
      state.config.apps = state.config.apps.filter(a => a.id !== appId);
      await saveConfig();
      renderAll();
      showToast('应用已删除', 'success');
    }
  );
}

// ========== Group Modal ==========

function openGroupModal(group = null) {
  state.editingGroupId = group ? group.id : null;
  state.selectedEmoji = group ? (group.icon || '📁') : '📁';

  dom.groupModalTitle.textContent = group ? '编辑分组' : '新建分组';
  dom.groupNameInput.value = group ? group.name : '';
  dom.groupDeleteBtn.style.display = group ? '' : 'none';

  dom.emojiPicker.innerHTML = '';
  EMOJI_LIST.forEach(emoji => {
    const opt = document.createElement('div');
    opt.className = 'emoji-option' + (emoji === state.selectedEmoji ? ' selected' : '');
    opt.textContent = emoji;
    opt.addEventListener('click', () => {
      state.selectedEmoji = emoji;
      dom.emojiPicker.querySelectorAll('.emoji-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
    dom.emojiPicker.appendChild(opt);
  });

  dom.groupModal.style.display = 'flex';
  setTimeout(() => dom.groupNameInput.focus(), 100);
}

function closeGroupModal() {
  dom.groupModal.style.display = 'none';
  state.editingGroupId = null;
}

async function handleSaveGroup() {
  const name = dom.groupNameInput.value.trim();
  if (!name) {
    showToast('请输入分组名称', 'error');
    return;
  }

  if (state.editingGroupId) {
    const group = state.config.groups.find(g => g.id === state.editingGroupId);
    if (group) {
      group.name = name;
      group.icon = state.selectedEmoji;
    }
    showToast('分组已更新', 'success');
  } else {
    const newGroup = {
      id: generateId('group'),
      name,
      icon: state.selectedEmoji,
      sortOrder: state.config.groups.length,
    };
    state.config.groups.push(newGroup);
    state.currentView = newGroup.id;
    showToast('分组已创建', 'success');
  }

  await saveConfig();
  closeGroupModal();
  renderAll();
}

async function handleDeleteGroup() {
  const groupId = state.editingGroupId;
  if (!groupId) return;

  const group = state.config.groups.find(g => g.id === groupId);
  const appCount = state.config.apps.filter(a => a.groupId === groupId).length;

  showConfirm(
    '删除分组',
    `确定要删除分组"${group.name}"吗？${appCount > 0 ? `分组中的 ${appCount} 个应用将变为未分组。` : ''}`,
    async () => {
      state.config.apps.forEach(a => {
        if (a.groupId === groupId) a.groupId = null;
      });
      state.config.groups = state.config.groups.filter(g => g.id !== groupId);

      if (state.currentView === groupId) {
        state.currentView = 'all';
      }

      await saveConfig();
      closeGroupModal();
      hideConfirm();
      renderAll();
      showToast('分组已删除', 'success');
    }
  );
}

// ========== Context Menu ==========

function showContextMenu(appId, x, y) {
  state.contextMenuAppId = appId;
  const app = state.config.apps.find(a => a.id === appId);
  if (!app) return;

  // Hide "打开文件位置" for system folders (shell paths) and URI schemes (ms-settings:)
  const isShellPath = app.path && (app.path.startsWith('shell:') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(app.path));
  dom.ctxOpenLocation.style.display = isShellPath ? 'none' : '';

  dom.ctxSubmenu.innerHTML = `
    <div class="submenu-item ${!app.groupId ? 'active' : ''}" data-group="">
      <span class="submenu-item-icon">📭</span> 未分组
    </div>
  `;
  state.config.groups.forEach(g => {
    const item = document.createElement('div');
    item.className = 'submenu-item' + (app.groupId === g.id ? ' active' : '');
    item.dataset.group = g.id;
    item.innerHTML = `<span class="submenu-item-icon">${escapeHtml(g.icon || '📁')}</span> ${escapeHtml(g.name)}`;
    dom.ctxSubmenu.appendChild(item);
  });

  dom.contextMenu.style.display = 'block';
  const rect = dom.contextMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  dom.contextMenu.style.left = Math.min(x, maxX) + 'px';
  dom.contextMenu.style.top = Math.min(y, maxY) + 'px';
}

function hideContextMenu() {
  dom.contextMenu.style.display = 'none';
  state.contextMenuAppId = null;
}

async function handleMoveToGroup(groupId) {
  const app = state.config.apps.find(a => a.id === state.contextMenuAppId);
  if (!app) return;

  app.groupId = groupId || null;
  await saveConfig();
  hideContextMenu();
  renderAll();
  showToast('已移动分组', 'success');
}

// ========== Search ==========

function handleSearch(query) {
  state.searchQuery = query;
  dom.searchClear.style.display = query ? 'flex' : 'none';
  renderMain();
}

// ========== Settings Modal ==========

function openSettingsModal() {
  const s = state.config.settings;

  // Theme
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === s.theme);
  });

  // Background
  dom.bgEnabledToggle.checked = s.backgroundEnabled || false;
  updateBgRowsVisibility(s.backgroundEnabled);

  if (s.backgroundImage) {
    dom.bgFileName.textContent = '已设置背景图片';
    dom.bgRemoveBtn.style.display = '';
  } else {
    dom.bgFileName.textContent = '未选择图片';
    dom.bgRemoveBtn.style.display = 'none';
  }

  dom.bgOpacitySlider.value = Math.round((s.backgroundOpacity || 0.3) * 100);
  dom.bgOpacityValue.textContent = dom.bgOpacitySlider.value + '%';

  dom.bgBlurSlider.value = s.backgroundBlur || 0;
  dom.bgBlurValue.textContent = dom.bgBlurSlider.value + 'px';

  // Default view
  dom.defaultViewSelect.value = s.viewMode || 'grid';

  // Behavior
  dom.trayToggle.checked = s.minimizeToTray !== false;
  dom.launchCloseToggle.checked = s.launchClose || false;

  // Auto start - read from config (authoritative source)
  dom.autoStartToggle.checked = !!s.autoStart;

  // Float ball
  dom.floatBallToggle.checked = s.floatBallEnabled || false;
  updateFloatBallRowsVisibility(s.floatBallEnabled);
  dom.floatBallSingleSelect.value = s.floatBallSingleClick || 'recent';
  dom.floatBallDoubleSelect.value = s.floatBallDoubleClick || 'showMain';

  // Check shortcut status
  checkShortcutStatus();

  dom.settingsModal.style.display = 'flex';
}

function closeSettingsModal() {
  dom.settingsModal.style.display = 'none';
}

function updateBgRowsVisibility(visible) {
  dom.bgUploadRow.style.display = visible ? '' : 'none';
  dom.bgOpacityRow.style.display = visible ? '' : 'none';
  dom.bgBlurRow.style.display = visible ? '' : 'none';
}

async function handleThemeChange(theme) {
  state.config.settings.theme = theme;
  applyTheme(theme);
  await saveConfig();
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
}

async function handleBgToggle(enabled) {
  state.config.settings.backgroundEnabled = enabled;
  updateBgRowsVisibility(enabled);
  applyBackground();
  await saveConfig();
}

async function handleBgUpload() {
  const imagePath = await window.api.openImageFileDialog();
  if (!imagePath) return;

  const dataUrl = await window.api.readImageFile(imagePath);
  if (!dataUrl) {
    showToast('读取图片失败', 'error');
    return;
  }

  state.pendingBgFileName = imagePath.split(/[\\/]/).pop();
  openCropModal(dataUrl);
}

// ========== Crop Modal ==========

function openCropModal(dataUrl) {
  state.cropImageDataUrl = dataUrl;
  dom.cropImage.src = dataUrl;
  dom.cropModal.style.display = 'flex';

  // Wait for image to load to get dimensions
  dom.cropImage.onload = () => {
    state.cropNaturalWidth = dom.cropImage.naturalWidth;
    state.cropNaturalHeight = dom.cropImage.naturalHeight;
    state.cropDisplayWidth = dom.cropImage.clientWidth;
    state.cropDisplayHeight = dom.cropImage.clientHeight;

    // Initialize selection to full image
    state.cropSel = { x: 0, y: 0, w: state.cropDisplayWidth, h: state.cropDisplayHeight };
    updateCropSelection();
  };
}

function closeCropModal() {
  dom.cropModal.style.display = 'none';
  state.cropImageDataUrl = null;
  state.cropDragMode = null;
  dom.cropImage.onload = null;
}

function updateCropSelection() {
  const { x, y, w, h } = state.cropSel;
  dom.cropSelection.style.left = x + 'px';
  dom.cropSelection.style.top = y + 'px';
  dom.cropSelection.style.width = w + 'px';
  dom.cropSelection.style.height = h + 'px';
}

function clampCropSel() {
  const s = state.cropSel;
  // Min size 30px
  s.w = Math.max(30, s.w);
  s.h = Math.max(30, s.h);
  // Clamp to image bounds
  if (s.x < 0) { s.w += s.x; s.x = 0; }
  if (s.y < 0) { s.h += s.y; s.y = 0; }
  if (s.x + s.w > state.cropDisplayWidth) { s.w = state.cropDisplayWidth - s.x; }
  if (s.y + s.h > state.cropDisplayHeight) { s.h = state.cropDisplayHeight - s.y; }
  s.w = Math.max(30, s.w);
  s.h = Math.max(30, s.h);
}

function getCropMousePos(e) {
  const rect = dom.cropContainer.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function onCropMouseDown(e) {
  const handle = e.target.closest('.crop-handle');
  if (handle) {
    state.cropDragMode = handle.dataset.handle;
  } else if (e.target === dom.cropSelection || dom.cropSelection.contains(e.target)) {
    state.cropDragMode = 'move';
  } else {
    return; // Click outside selection, ignore
  }

  e.preventDefault();
  const pos = getCropMousePos(e);
  state.cropDragStart = {
    mx: pos.x,
    my: pos.y,
    sel: { ...state.cropSel },
  };

  document.addEventListener('mousemove', onCropMouseMove);
  document.addEventListener('mouseup', onCropMouseUp);
}

function onCropMouseMove(e) {
  if (!state.cropDragMode || !state.cropDragStart) return;

  const pos = getCropMousePos(e);
  const dx = pos.x - state.cropDragStart.mx;
  const dy = pos.y - state.cropDragStart.my;
  const start = state.cropDragStart.sel;
  const s = state.cropSel;

  if (state.cropDragMode === 'move') {
    s.x = start.x + dx;
    s.y = start.y + dy;
    s.w = start.w;
    s.h = start.h;
  } else {
    // Resize: reset to start, then adjust based on handle
    s.x = start.x;
    s.y = start.y;
    s.w = start.w;
    s.h = start.h;

    const mode = state.cropDragMode;
    if (mode.includes('e')) s.w = start.w + dx;
    if (mode.includes('w')) { s.x = start.x + dx; s.w = start.w - dx; }
    if (mode.includes('s')) s.h = start.h + dy;
    if (mode.includes('n')) { s.y = start.y + dy; s.h = start.h - dy; }
  }

  clampCropSel();
  updateCropSelection();
}

function onCropMouseUp() {
  state.cropDragMode = null;
  state.cropDragStart = null;
  document.removeEventListener('mousemove', onCropMouseMove);
  document.removeEventListener('mouseup', onCropMouseUp);
}

async function handleCropConfirm() {
  if (!state.cropImageDataUrl) return;

  const scaleX = state.cropNaturalWidth / state.cropDisplayWidth;
  const scaleY = state.cropNaturalHeight / state.cropDisplayHeight;

  const sx = Math.round(state.cropSel.x * scaleX);
  const sy = Math.round(state.cropSel.y * scaleY);
  const sw = Math.round(state.cropSel.w * scaleX);
  const sh = Math.round(state.cropSel.h * scaleY);

  const img = new Image();
  img.src = state.cropImageDataUrl;
  await new Promise(resolve => { img.onload = resolve; });

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const croppedDataUrl = canvas.toDataURL('image/png');
  state.config.settings.backgroundImage = croppedDataUrl;
  dom.bgFileName.textContent = state.pendingBgFileName + ' (已裁剪)';
  dom.bgRemoveBtn.style.display = '';
  applyBackground();
  await saveConfig();
  closeCropModal();
  showToast('背景图片已设置', 'success');
}

async function handleCropFull() {
  if (!state.cropImageDataUrl) return;
  state.config.settings.backgroundImage = state.cropImageDataUrl;
  dom.bgFileName.textContent = state.pendingBgFileName;
  dom.bgRemoveBtn.style.display = '';
  applyBackground();
  await saveConfig();
  closeCropModal();
  showToast('背景图片已设置', 'success');
}

async function handleBgRemove() {
  state.config.settings.backgroundImage = null;
  dom.bgFileName.textContent = '未选择图片';
  dom.bgRemoveBtn.style.display = 'none';
  applyBackground();
  await saveConfig();
}

async function handleBgOpacityChange(value) {
  state.config.settings.backgroundOpacity = value / 100;
  dom.bgOpacityValue.textContent = value + '%';
  applyBackground();
  await saveConfig();
}

async function handleBgBlurChange(value) {
  state.config.settings.backgroundBlur = parseInt(value);
  dom.bgBlurValue.textContent = value + 'px';
  applyBackground();
  await saveConfig();
}

async function handleDefaultViewChange(mode) {
  state.config.settings.viewMode = mode;
  await saveConfig();
}

async function handleTrayToggle(enabled) {
  state.config.settings.minimizeToTray = enabled;
  await saveConfig();
  if (enabled) {
    showToast('已开启最小化到托盘', 'success');
  } else {
    showToast('已关闭最小化到托盘，关闭窗口将直接退出', 'success');
  }
}

async function handleLaunchCloseToggle(enabled) {
  state.config.settings.launchClose = enabled;
  await saveConfig();
}

async function handleAutoStartToggle(enabled) {
  const result = await window.api.setAutoStart(enabled);
  if (result.success) {
    state.config.settings.autoStart = enabled;
    await saveConfig();
    showToast(enabled ? '已开启开机自启' : '已关闭开机自启', 'success');
  } else {
    dom.autoStartToggle.checked = !enabled;
    showToast('设置失败: ' + (result.error || '未知错误'), 'error');
  }
}

function updateFloatBallRowsVisibility(visible) {
  dom.floatBallClickRow.style.display = visible ? '' : 'none';
  dom.floatBallDblClickRow.style.display = visible ? '' : 'none';
}

async function handleFloatBallToggle(enabled) {
  state.config.settings.floatBallEnabled = enabled;
  updateFloatBallRowsVisibility(enabled);
  await saveConfig();
  if (enabled) {
    showToast('悬浮球已启用', 'success');
  } else {
    showToast('悬浮球已关闭', 'success');
  }
}

async function handleFloatBallSingleClickChange(value) {
  state.config.settings.floatBallSingleClick = value;
  await saveConfig();
}

async function handleFloatBallDoubleClickChange(value) {
  state.config.settings.floatBallDoubleClick = value;
  await saveConfig();
}

async function handleCreateShortcut() {
  dom.createShortcutBtn.disabled = true;
  dom.createShortcutBtn.textContent = '创建中...';
  const result = await window.api.createDesktopShortcut();
  dom.createShortcutBtn.disabled = false;
  dom.createShortcutBtn.textContent = '创建快捷方式';

  if (result.success) {
    showToast('桌面快捷方式已创建', 'success');
    dom.shortcutStatus.textContent = '快捷方式已创建';
    dom.createShortcutBtn.textContent = '重新创建';
  } else {
    showToast('创建失败: ' + (result.error || '未知错误'), 'error');
    dom.shortcutStatus.textContent = '创建失败';
  }
  checkShortcutStatus();
}

async function checkShortcutStatus() {
  const exists = await window.api.checkDesktopShortcut();
  if (exists) {
    dom.shortcutStatus.textContent = '桌面快捷方式已存在';
    dom.createShortcutBtn.textContent = '重新创建';
  } else {
    dom.shortcutStatus.textContent = '尚未创建桌面快捷方式';
    dom.createShortcutBtn.textContent = '创建快捷方式';
  }
}

// ========== Event Listeners ==========

function initEventListeners() {
  // Sidebar navigation - built-in views
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    if (item.id === 'addGroupBtn') return;
    item.addEventListener('click', () => {
      state.currentView = item.dataset.view;
      renderAll();
    });
  });

  // Add group button
  dom.addGroupBtn.addEventListener('click', () => openGroupModal());

  // Search
  dom.searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  dom.searchClear.addEventListener('click', () => {
    dom.searchInput.value = '';
    handleSearch('');
    dom.searchInput.focus();
  });

  // Add app button
  dom.addAppBtn.addEventListener('click', () => openAppModal());
  dom.emptyAddBtn.addEventListener('click', () => openAppModal());

  // Sort
  dom.sortSelect.addEventListener('change', (e) => {
    state.config.settings.sortBy = e.target.value;
    saveConfig();
    renderMain();
  });

  // View toggle
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyViewMode(btn.dataset.mode);
    });
  });

  // Settings button
  dom.footerSettingsBtn.addEventListener('click', () => openSettingsModal());

  // Settings modal
  dom.settingsClose.addEventListener('click', closeSettingsModal);
  dom.settingsCloseBtn.addEventListener('click', closeSettingsModal);
  dom.settingsModal.addEventListener('click', (e) => {
    if (e.target === dom.settingsModal) closeSettingsModal();
  });

  // Theme selector
  dom.themeSelector.addEventListener('click', (e) => {
    const opt = e.target.closest('.theme-option');
    if (opt) handleThemeChange(opt.dataset.theme);
  });

  // Background settings
  dom.bgEnabledToggle.addEventListener('change', (e) => handleBgToggle(e.target.checked));
  dom.bgUploadBtn.addEventListener('click', handleBgUpload);
  dom.bgRemoveBtn.addEventListener('click', handleBgRemove);
  dom.bgOpacitySlider.addEventListener('input', (e) => handleBgOpacityChange(e.target.value));
  dom.bgBlurSlider.addEventListener('input', (e) => handleBgBlurChange(e.target.value));

  // Crop modal
  dom.cropClose.addEventListener('click', closeCropModal);
  dom.cropCancel.addEventListener('click', closeCropModal);
  dom.cropFullBtn.addEventListener('click', handleCropFull);
  dom.cropConfirmBtn.addEventListener('click', handleCropConfirm);
  dom.cropModal.addEventListener('click', (e) => {
    if (e.target === dom.cropModal) closeCropModal();
  });
  dom.cropContainer.addEventListener('mousedown', onCropMouseDown);

  // Default view
  dom.defaultViewSelect.addEventListener('change', (e) => handleDefaultViewChange(e.target.value));

  // Behavior toggles
  dom.trayToggle.addEventListener('change', (e) => handleTrayToggle(e.target.checked));
  dom.launchCloseToggle.addEventListener('change', (e) => handleLaunchCloseToggle(e.target.checked));
  dom.autoStartToggle.addEventListener('change', (e) => handleAutoStartToggle(e.target.checked));

  // Float ball settings
  dom.floatBallToggle.addEventListener('change', (e) => handleFloatBallToggle(e.target.checked));
  dom.floatBallSingleSelect.addEventListener('change', (e) => handleFloatBallSingleClickChange(e.target.value));
  dom.floatBallDoubleSelect.addEventListener('change', (e) => handleFloatBallDoubleClickChange(e.target.value));

  // Desktop shortcut
  dom.createShortcutBtn.addEventListener('click', handleCreateShortcut);

  // App modal
  dom.browseBtn.addEventListener('click', handleBrowse);
  dom.browseFolderBtn.addEventListener('click', handleBrowseFolder);
  dom.browseSystemBtn.addEventListener('click', openSystemFolderModal);
  dom.customIconBtn.addEventListener('click', handleCustomIcon);
  dom.resetIconBtn.addEventListener('click', handleResetIcon);
  dom.modalSave.addEventListener('click', handleSaveApp);
  dom.modalCancel.addEventListener('click', closeAppModal);
  dom.modalClose.addEventListener('click', closeAppModal);
  dom.appModal.addEventListener('click', (e) => {
    if (e.target === dom.appModal) closeAppModal();
  });

  // System folder modal
  dom.systemFolderClose.addEventListener('click', closeSystemFolderModal);
  dom.systemFolderModal.addEventListener('click', (e) => {
    if (e.target === dom.systemFolderModal) closeSystemFolderModal();
  });

  // Group modal
  dom.groupModalSave.addEventListener('click', handleSaveGroup);
  dom.groupModalCancel.addEventListener('click', closeGroupModal);
  dom.groupModalClose.addEventListener('click', closeGroupModal);
  dom.groupDeleteBtn.addEventListener('click', handleDeleteGroup);
  dom.groupModal.addEventListener('click', (e) => {
    if (e.target === dom.groupModal) closeGroupModal();
  });

  // Context menu items
  dom.ctxLaunch.addEventListener('click', () => {
    if (state.contextMenuAppId) {
      launchApp(state.contextMenuAppId);
      hideContextMenu();
    }
  });

  dom.ctxOpenLocation.addEventListener('click', () => {
    const app = state.config.apps.find(a => a.id === state.contextMenuAppId);
    if (app) {
      window.api.openInExplorer(app.path);
      hideContextMenu();
    }
  });

  dom.ctxEdit.addEventListener('click', () => {
    if (state.contextMenuAppId) {
      const appId = state.contextMenuAppId;
      hideContextMenu();
      openAppModal(appId);
    }
  });

  dom.ctxDelete.addEventListener('click', () => {
    if (state.contextMenuAppId) {
      const appId = state.contextMenuAppId;
      hideContextMenu();
      deleteApp(appId);
    }
  });

  dom.ctxSubmenu.addEventListener('click', (e) => {
    const item = e.target.closest('.submenu-item');
    if (item) {
      handleMoveToGroup(item.dataset.group);
    }
  });

  // Close context menu on outside click
  document.addEventListener('click', (e) => {
    if (!dom.contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Confirm dialog
  dom.confirmCancel.addEventListener('click', hideConfirm);
  dom.confirmOk.addEventListener('click', () => {
    if (confirmCallback) {
      const cb = confirmCallback;
      hideConfirm();
      cb();
    }
  });
  dom.confirmDialog.addEventListener('click', (e) => {
    if (e.target === dom.confirmDialog) hideConfirm();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+F to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      dom.searchInput.focus();
      dom.searchInput.select();
    }
    // Escape to close modals/menus
    if (e.key === 'Escape') {
      if (dom.systemFolderModal.style.display === 'flex') closeSystemFolderModal();
      else if (dom.settingsModal.style.display === 'flex') closeSettingsModal();
      else if (dom.appModal.style.display === 'flex') closeAppModal();
      else if (dom.groupModal.style.display === 'flex') closeGroupModal();
      else if (dom.confirmDialog.style.display === 'flex') hideConfirm();
      else hideContextMenu();
    }
    // Enter to save in modals
    if (e.key === 'Enter') {
      if (dom.appModal.style.display === 'flex' && document.activeElement.tagName === 'INPUT') {
        handleSaveApp();
      } else if (dom.groupModal.style.display === 'flex' && document.activeElement === dom.groupNameInput) {
        handleSaveGroup();
      }
    }
  });
}

// ========== Initialize ==========

// Re-extract icons for apps with null icon (e.g. .lnk shortcuts that failed previously)
async function refreshMissingIcons() {
  const missingApps = state.config.apps.filter(a => !a.icon && a.path);
  if (missingApps.length === 0) return;

  let updated = false;
  await Promise.all(missingApps.map(async (appItem) => {
    try {
      const iconData = await window.api.getFileIcon(appItem.path);
      if (iconData) {
        appItem.icon = iconData;
        updated = true;
      }
    } catch (err) {
      // ignore
    }
  }));

  if (updated) {
    await saveConfig();
  }
}

async function init() {
  try {
    state.config = await window.api.loadConfig();

    // Restore sort setting
    if (state.config.settings.sortBy) {
      dom.sortSelect.value = state.config.settings.sortBy;
    }

    // Apply theme
    applyTheme(state.config.settings.theme || 'light');

    // Apply background
    applyBackground();

    // Apply view mode
    state.currentViewMode = state.config.settings.viewMode || 'grid';
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.currentViewMode);
    });

    initEventListeners();

    // Re-extract icons for apps that have no icon (e.g. .lnk shortcuts that failed before)
    await refreshMissingIcons();

    renderAll();

    // Listen for float ball being disabled by user (from right-click menu)
    window.api.onFloatBallDisabled(() => {
      state.config.settings.floatBallEnabled = false;
      dom.floatBallToggle.checked = false;
      updateFloatBallRowsVisibility(false);
      showToast('悬浮球已关闭', 'success');
    });
  } catch (err) {
    console.error('Init error:', err);
    showToast('初始化失败', 'error');
  }
}

// Start
init();
