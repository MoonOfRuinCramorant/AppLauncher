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
    // Horizontal bar theming — kept on state so settings can be applied live
    // without restarting the float-ball window.
    barTheme: 'auto',
    barAccent: '#0078d4',
    barBg: null,
    barBorder: null,
  };

  // ========== DOM ==========
  const ball = document.getElementById('ball');
  const popup = document.getElementById('popup');
  const appList = document.getElementById('appList');
  const popupEmpty = document.getElementById('popupEmpty');
  const tooltipEl = document.getElementById('appTooltip');

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
      // It's a click, not a drag. Suppress the ball's transition/hover-scale
      // for one frame so the click -> expand -> window resize happens in a
      // single paint — otherwise the lingering hover transform combines
      // with the absolute positioning of popup-horizontal mode and creates a
      // visible "blink" of the ball at the moment of expand.
      ball.classList.add('no-transition');
      handleClick();
      // After two frames (so the resize has been laid out) re-enable transitions.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ball.classList.remove('no-transition');
      }));
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
    const result = await window.api.fbExpand();

    // Apply the popup presentation style. The main process computes the
    // window geometry and returns which side the ball sits on for the
    // horizontal bar ('left' = bar extends rightward, 'right' = leftward).
    const isHorizontal = !!(result && result.style === 'horizontal');
    const ballSide = isHorizontal ? (result.direction === 'right' ? 'right' : 'left') : null;
    document.body.classList.toggle('popup-horizontal', isHorizontal);
    document.body.classList.toggle('popup-hbar-left', ballSide === 'left');
    document.body.classList.toggle('popup-hbar-right', ballSide === 'right');

    // Load recent apps
    const recentApps = await window.api.fbGetRecentApps();
    renderAppList(recentApps);

    popup.style.display = '';
  }

  async function collapsePopup() {
    state.isExpanded = false;
    popup.style.display = 'none';
    document.body.classList.remove('popup-horizontal', 'popup-hbar-left', 'popup-hbar-right');
    hideTooltip();
    await window.api.fbCollapse();
  }

  function renderAppList(apps) {
    appList.innerHTML = '';

    if (!apps || apps.length === 0) {
      popupEmpty.style.display = '';
      return;
    }

    popupEmpty.style.display = 'none';

    // Horizontal bar shows icons only; the app name appears on hover.
    const horizontal = document.body.classList.contains('popup-horizontal');

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

      if (horizontal) {
        item.setAttribute('data-tooltip', escapeText(app.name));
        item.innerHTML = iconHtml;
      } else {
        item.innerHTML = `${iconHtml}<div class="popup-app-item-name">${escapeText(app.name)}</div>`;
      }

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

  // ========== Tooltip (app-name on hover in horizontal bar) ==========
  // Rendered as a real <div id="appTooltip"> with position:fixed so it can
  // sit above the float-ball's own stacking context. The previous ::after
  // approach was visually buried under the ball because #ball creates a
  // stacking context (z-index:2) that's higher than the auto-context the
  // popup lives in.
  function positionTooltip(text, anchorRect) {
    tooltipEl.textContent = text || '';
    // Default: tooltip appears centered below the icon.
    let cx = anchorRect.left + anchorRect.width / 2;
    let by = anchorRect.bottom + 8;
    // Flip above the icon if we would clip the window bottom edge.
    if (by + 22 > window.innerHeight) {
      by = anchorRect.top - 8;
      tooltipEl.classList.add('flip-up');
    } else {
      tooltipEl.classList.remove('flip-up');
    }
    // Clamp horizontally so the tooltip never extends past the window.
    cx = Math.max(60, Math.min(cx, window.innerWidth - 60));
    if (by < 0) by = 8;
    tooltipEl.style.left = cx + 'px';
    tooltipEl.style.top = by + 'px';
  }

  // Hover delegation: any list item with data-tooltip shows the tooltip.
  appList.addEventListener('mouseover', (e) => {
    if (!document.body.classList.contains('popup-horizontal')) return;
    const item = e.target.closest('.popup-app-item');
    if (!item) return;
    positionTooltip(item.dataset.tooltip || '', item.getBoundingClientRect());
    tooltipEl.classList.add('visible');
  });
  appList.addEventListener('mouseout', (e) => {
    if (!document.body.classList.contains('popup-horizontal')) return;
    // Hide only when the cursor leaves to a non-descendant element.
    const related = e.relatedTarget;
    if (related && appList.contains(related)) return;
    const fromItem = e.target.closest('.popup-app-item');
    if (!fromItem) return;
    tooltipEl.classList.remove('visible');
  });

  // Collapse: hide tooltip immediately so it doesn't linger after the bar closes.
  function hideTooltip() {
    tooltipEl.classList.remove('visible');
  }

  // ========== Init ==========

  // Listen for init data from main process
  window.api.fbOnInit((data) => {
    state.theme = data.theme || 'light';
    state.singleClickAction = data.singleClick || 'recent';
    state.doubleClickAction = data.doubleClick || 'showMain';
    applyTheme(state.theme);
    applyBarSettings({
      barTheme: data.barTheme,
      barAccent: data.barAccent,
      barBg: data.barBg,
      barBorder: data.barBorder,
      theme: state.theme,
    });
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
    // Bar theming: re-apply when any of the bar* fields come through.
    if (data.hasOwnProperty('barTheme') || data.hasOwnProperty('barAccent') ||
        data.hasOwnProperty('barBg') || data.hasOwnProperty('barBorder')) {
      state.barTheme = data.barTheme || 'auto';
      state.barAccent = data.barAccent || '#0078d4';
      state.barBg = data.barBg || null;
      state.barBorder = data.barBorder || null;
      applyBarSettings({
        barTheme: state.barTheme,
        barAccent: state.barAccent,
        barBg: state.barBg,
        barBorder: state.barBorder,
        theme: state.theme,
      });
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
      // Custom icon mode: hide the blue gradient frame, show the cropped
      // circular image directly (see body.custom-icon styles).
      document.body.classList.add('custom-icon');
      const img = document.createElement('img');
      img.src = iconDataUrl;
      img.className = 'ball-img';
      img.alt = '';
      iconEl.appendChild(img);
    } else {
      document.body.classList.remove('custom-icon');
      iconEl.textContent = '🚀';
    }
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
    // bar-theme may depend on global theme — re-apply so the derived
    // CSS variables refresh together with the global theme switch.
    applyBarSettings({
      barTheme: state.barTheme,
      barAccent: state.barAccent,
      barBg: state.barBg,
      barBorder: state.barBorder,
      theme: state.theme,
    });
  }

  // Resolve which palette the horizontal bar should use, then write the
  // values into the CSS variables on <html>/<body>. The two palettes live
  // in :root and :root.bar-theme-dark (see floatball.css). When 'auto' we
  // follow the global theme; when 'light'/'dark' the bar locks to that
  // look regardless of the rest of the app.
  function applyBarSettings(s) {
    const baseTheme = (s.barTheme === 'light' || s.barTheme === 'dark') ? s.barTheme : s.theme;
    document.documentElement.classList.toggle('bar-theme-dark', baseTheme === 'dark');

    const accent = (s.barAccent && /^#[0-9a-fA-F]{6}$/.test(s.barAccent)) ? s.barAccent : '#0078d4';
    const accentSoft = hexToRgba(accent, baseTheme === 'dark' ? 0.18 : 0.12);
    const accentActive = hexToRgba(accent, baseTheme === 'dark' ? 0.30 : 0.22);

    document.documentElement.style.setProperty('--fb-bar-accent', accent);
    document.documentElement.style.setProperty('--fb-bar-accent-soft', accentSoft);
    document.documentElement.style.setProperty('--fb-bar-accent-active', accentActive);

    if (s.barBg && /^#[0-9a-fA-F]{6}$/.test(s.barBg)) {
      document.documentElement.style.setProperty('--fb-bar-bg', s.barBg + (s.barBg.length === 7 ? 'f5' : ''));
    } else {
      document.documentElement.style.removeProperty('--fb-bar-bg');
    }
    if (s.barBorder && /^#[0-9a-fA-F]{6}$/.test(s.barBorder)) {
      document.documentElement.style.setProperty('--fb-bar-border', s.barBorder + '30');
    } else {
      document.documentElement.style.removeProperty('--fb-bar-border');
    }

    // Tooltip background uses the accent color in a soft, slightly opaque form
    // for clear visual identification; falls back to the dark theme pair.
    if (baseTheme === 'dark') {
      document.documentElement.style.setProperty('--fb-bar-tooltip-bg', hexToRgba('#222222', 0.95));
      document.documentElement.style.setProperty('--fb-bar-tooltip-text', '#f5f5f5');
      document.documentElement.style.setProperty('--fb-bar-tooltip-border', 'rgba(255,255,255,0.12)');
    } else {
      document.documentElement.style.setProperty('--fb-bar-tooltip-bg', hexToRgba(accent, 0.95));
      document.documentElement.style.setProperty('--fb-bar-tooltip-text', '#ffffff');
      document.documentElement.style.setProperty('--fb-bar-tooltip-border', hexToRgba(accent, 0.4));
    }
  }

  // Convert "#RRGGBB" to "rgba(r,g,b,a)" — needed because barBg/barBorder
  // from the color picker is always opaque and we want to blend it into the
  // glassy bar background.
  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return `rgba(0,0,0,${a})`;
    const v = m[1];
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Prevent the ball from being dragged by HTML drag-and-drop
  ball.addEventListener('dragstart', (e) => e.preventDefault());

})();
