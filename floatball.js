/* ============================================
   Float Ball - Renderer Logic
   ============================================ */

(function () {
  'use strict';

  // ========== State ==========
  const state = {
    isDragging: false,
    hasMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    mouseDownTime: 0,
    clickTimer: null,
    isExpanded: false,
    singleClickAction: 'recent',
    doubleClickAction: 'showMain',
    theme: 'light',
  };

  // ========== DOM ==========
  const ball = document.getElementById('ball');
  const popup = document.getElementById('popup');
  const appList = document.getElementById('appList');
  const popupEmpty = document.getElementById('popupEmpty');

  // ========== Drag Logic ==========
  // The actual window movement is driven by the main process polling the
  // cursor position (see floatball:dragStart in main.js). The renderer only
  // reports the drag start/end and tracks a local threshold to distinguish
  // clicks from drags. This fixes the ball "vanishing" when the cursor
  // outruns the 56x56 window and mousemove/mouseup events get lost.

  ball.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only left button
    state.isDragging = true;
    state.hasMoved = false;
    state.dragStartX = e.screenX;
    state.dragStartY = e.screenY;
    state.mouseDownTime = Date.now();
    window.api.fbDragStart();
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    const dx = e.screenX - state.dragStartX;
    const dy = e.screenY - state.dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!state.hasMoved) {
        state.hasMoved = true;
        ball.classList.add('dragging');
        // Collapse popup if open while dragging
        if (state.isExpanded) {
          collapsePopup();
        }
      }
      state.dragStartX = e.screenX;
      state.dragStartY = e.screenY;
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (!state.isDragging) return;
    state.isDragging = false;
    ball.classList.remove('dragging');

    // Always end the drag in the main process (stops cursor polling and
    // persists the position). Safe to call even if nothing moved.
    window.api.fbDragEnd();

    if (!state.hasMoved && Date.now() - state.mouseDownTime < 400) {
      // It's a click, not a drag
      handleClick();
    }
  });

  // Fallback: if the window loses focus while dragging (cursor somehow
  // escaped), reset local state so the ball doesn't get stuck.
  window.addEventListener('blur', () => {
    if (state.isDragging) {
      state.isDragging = false;
      state.hasMoved = false;
      ball.classList.remove('dragging');
      window.api.fbDragEnd();
    }
  });

  // ========== Click vs Double-Click ==========

  function handleClick() {
    if (state.clickTimer) {
      // Second click within 300ms = double click
      clearTimeout(state.clickTimer);
      state.clickTimer = null;
      handleDoubleClick();
    } else {
      state.clickTimer = setTimeout(() => {
        state.clickTimer = null;
        handleSingleClick();
      }, 280);
    }
  }

  function handleSingleClick() {
    if (state.singleClickAction === 'recent') {
      togglePopup();
    } else if (state.singleClickAction === 'showMain') {
      window.api.fbShowMain();
    }
  }

  function handleDoubleClick() {
    if (state.doubleClickAction === 'showMain') {
      // Collapse popup if open
      if (state.isExpanded) {
        collapsePopup();
      }
      window.api.fbShowMain();
    } else if (state.doubleClickAction === 'recent') {
      if (state.isExpanded) {
        collapsePopup();
      } else {
        expandPopup();
      }
    }
  }

  // ========== Right Click ==========

  ball.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent document-level handler from also firing
    window.api.fbRightClick();
  });

  // Prevent default context menu on the rest of the document (popup area, etc.)
  // Do NOT call fbRightClick here — the ball handler above already does it.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // ========== Popup Logic ==========

  async function togglePopup() {
    if (state.isExpanded) {
      collapsePopup();
    } else {
      await expandPopup();
    }
  }

  async function expandPopup() {
    state.isExpanded = true;
    await window.api.fbExpand();

    // Load recent apps
    const recentApps = await window.api.fbGetRecentApps();
    renderAppList(recentApps);

    popup.style.display = '';
  }

  async function collapsePopup() {
    state.isExpanded = false;
    popup.style.display = 'none';
    await window.api.fbCollapse();
  }

  function renderAppList(apps) {
    appList.innerHTML = '';

    if (!apps || apps.length === 0) {
      popupEmpty.style.display = '';
      return;
    }

    popupEmpty.style.display = 'none';

    apps.forEach(app => {
      const item = document.createElement('div');
      item.className = 'popup-app-item';

      let iconHtml;
      if (app.icon) {
        if (app.icon.startsWith('data:')) {
          iconHtml = `<img src="${app.icon}" alt="${escapeText(app.name)}" />`;
        } else {
          iconHtml = `<div class="popup-app-item-icon">${escapeText(app.icon)}</div>`;
        }
      } else {
        iconHtml = '<div class="popup-app-item-icon">📦</div>';
      }

      item.innerHTML = `${iconHtml}<div class="popup-app-item-name">${escapeText(app.name)}</div>`;

      item.addEventListener('click', async () => {
        const result = await window.api.fbLaunchApp(app.id);
        if (result.success) {
          await collapsePopup();
        }
      });

      appList.appendChild(item);
    });
  }

  function escapeText(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // ========== Click Outside to Collapse ==========

  document.addEventListener('click', (e) => {
    // If popup is open and user clicks outside popup (but inside window),
    // collapse it. The ball click is handled separately.
    if (state.isExpanded && e.target !== ball && !ball.contains(e.target) && !popup.contains(e.target)) {
      collapsePopup();
    }
  });

  // ========== Init ==========

  // Listen for init data from main process
  window.api.fbOnInit((data) => {
    state.theme = data.theme || 'light';
    state.singleClickAction = data.singleClick || 'recent';
    state.doubleClickAction = data.doubleClick || 'showMain';
    applyTheme(state.theme);
    applyBallIcon(data.ballIcon || null);
  });

  // Listen for settings changes
  window.api.fbOnSettingsChanged((data) => {
    if (data.theme) {
      state.theme = data.theme;
      applyTheme(state.theme);
    }
    if (data.singleClick) {
      state.singleClickAction = data.singleClick;
    }
    if (data.doubleClick) {
      state.doubleClickAction = data.doubleClick;
    }
    if (data.hasOwnProperty('ballIcon')) {
      applyBallIcon(data.ballIcon || null);
    }
  });

  // Main process asks us to collapse the popup (e.g. before docking to edge)
  window.api.fbOnCollapseUI(() => {
    if (state.isExpanded) {
      collapsePopup();
    }
  });

  function applyBallIcon(iconDataUrl) {
    const iconEl = document.getElementById('ballIcon');
    if (!iconEl) return;
    iconEl.innerHTML = '';
    if (iconDataUrl) {
      const img = document.createElement('img');
      img.src = iconDataUrl;
      img.className = 'ball-img';
      img.alt = '';
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = '🚀';
    }
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }

  // Prevent the ball from being dragged by HTML drag-and-drop
  ball.addEventListener('dragstart', (e) => e.preventDefault());

})();
