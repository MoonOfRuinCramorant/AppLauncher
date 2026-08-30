/* ============================================
   Icon Crop - Renderer Logic
   1:1 圆形裁剪悬浮球图标
   ============================================ */

(function () {
  'use strict';

  const container = document.getElementById('cropContainer');
  const imgEl = document.getElementById('cropImage');
  const cropBox = document.getElementById('cropBox');
  const confirmBtn = document.getElementById('confirmBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const closeBtn = document.getElementById('closeBtn');

  const OUT_SIZE = 512;      // 输出图标尺寸（正方形）
  const MIN_BOX = 40;        // 裁剪框最小边长

  // ========== State ==========
  let img = null;            // 原始图片对象
  let imgW = 0;              // 原图宽
  let imgH = 0;              // 原图高
  let scale = 1;             // 图片显示缩放比
  let offsetX = 0;           // 图片显示区域左上角（相对容器）
  let offsetY = 0;

  // 裁剪框（相对容器坐标），恒为正方形
  let box = { x: 0, y: 0, w: 0, h: 0 };

  let dragMode = null;       // 'move' | 'nw' | 'ne' | 'sw' | 'se'
  let dragStart = null;

  // ========== Helpers ==========

  function containerSize() {
    return { w: container.clientWidth, h: container.clientHeight };
  }

  function applyImage() {
    imgEl.style.width = (imgW * scale) + 'px';
    imgEl.style.height = (imgH * scale) + 'px';
    imgEl.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px)';
  }

  function applyBox() {
    cropBox.style.left = box.x + 'px';
    cropBox.style.top = box.y + 'px';
    cropBox.style.width = box.w + 'px';
    cropBox.style.height = box.h + 'px';
  }

  function clampBox() {
    const { w: cw, h: ch } = containerSize();
    const maxSide = Math.min(cw, ch);
    if (box.w < MIN_BOX) box.w = MIN_BOX;
    if (box.h < MIN_BOX) box.h = MIN_BOX;
    if (box.w > maxSide) box.w = maxSide;
    if (box.h > maxSide) box.h = maxSide;
    if (box.x < 0) box.x = 0;
    if (box.y < 0) box.y = 0;
    if (box.x + box.w > cw) box.x = cw - box.w;
    if (box.y + box.h > ch) box.y = ch - box.h;
  }

  // 图片 cover 容器并初始化裁剪框（居中，约 70% 大小）
  function fitImage() {
    const { w: cw, h: ch } = containerSize();
    scale = Math.max(cw / imgW, ch / imgH);
    offsetX = (cw - imgW * scale) / 2;
    offsetY = (ch - imgH * scale) / 2;
    applyImage();

    const boxSize = Math.max(MIN_BOX, Math.round(Math.min(cw, ch) * 0.7));
    box = {
      x: Math.round((cw - boxSize) / 2),
      y: Math.round((ch - boxSize) / 2),
      w: boxSize,
      h: boxSize
    };
    applyBox();
  }

  // ========== Wheel: zoom image (anchor at container center) ==========

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { w: cw, h: ch } = containerSize();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    let ns = scale * factor;
    if (ns < 0.05) ns = 0.05;
    if (ns > 40) ns = 40;
    const cx = cw / 2;
    const cy = ch / 2;
    offsetX = cx - (cx - offsetX) * (ns / scale);
    offsetY = cy - (cy - offsetY) * (ns / scale);
    scale = ns;
    applyImage();
  }, { passive: false });

  // ========== Drag crop box / handles ==========

  function startDrag(e, mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragMode = mode;
    dragStart = { x: e.clientX, y: e.clientY, box: { ...box } };
    document.body.style.cursor = mode === 'move' ? 'move' : 'nwse-resize';
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
  }

  function onDrag(e) {
    if (!dragMode || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const s = dragStart.box;

    if (dragMode === 'move') {
      box = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
    } else {
      // Resize handles keep the box square, anchored at the opposite corner
      let nx = s.x, ny = s.y, ns = s.w;
      if (dragMode === 'nw') {
        ns = Math.max(s.w - dx, s.w - dy, MIN_BOX);
        nx = s.x + s.w - ns;
        ny = s.y + s.h - ns;
      } else if (dragMode === 'ne') {
        ns = Math.max(s.w + dx, s.w - dy, MIN_BOX);
        nx = s.x;
        ny = s.y + s.h - ns;
      } else if (dragMode === 'sw') {
        ns = Math.max(s.w - dx, s.w + dy, MIN_BOX);
        nx = s.x + s.w - ns;
        ny = s.y;
      } else { // se
        ns = Math.max(s.w + dx, s.w + dy, MIN_BOX);
        nx = s.x;
        ny = s.y;
      }
      box = { x: nx, y: ny, w: ns, h: ns };
    }
    clampBox();
    applyBox();
  }

  function endDrag() {
    dragMode = null;
    dragStart = null;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
  }

  cropBox.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const handle = e.target.closest('.crop-handle');
    if (handle) {
      const cls = handle.classList;
      startDrag(e, cls.contains('nw') ? 'nw' : cls.contains('ne') ? 'ne' : cls.contains('sw') ? 'sw' : 'se');
    } else {
      startDrag(e, 'move');
    }
  });

  // ========== Confirm: crop & output circular PNG ==========

  function doCrop() {
    if (!img) return;
    const { w: cw, h: ch } = containerSize();
    const dw = imgW * scale;   // 图片显示宽
    const dh = imgH * scale;   // 图片显示高

    // 裁剪框相对图片显示区域（裁掉框超出图片的部分）
    const rx = Math.max(0, box.x - offsetX);
    const ry = Math.max(0, box.y - offsetY);
    const rw = Math.min(box.w, dw - rx);
    const rh = Math.min(box.h, dh - ry);
    if (rw <= 0 || rh <= 0) return;

    // 映射回原图坐标
    const sx = rx / scale;
    const sy = ry / scale;
    const sw = rw / scale;
    const sh = rh / scale;

    const canvas = document.createElement('canvas');
    canvas.width = OUT_SIZE;
    canvas.height = OUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.save();
    // 圆形裁剪：悬浮球是圆的，输出透明背景的圆形图标
    ctx.beginPath();
    ctx.arc(OUT_SIZE / 2, OUT_SIZE / 2, OUT_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_SIZE, OUT_SIZE);
    ctx.restore();

    window.api.cropConfirm(canvas.toDataURL('image/png'));
  }

  confirmBtn.addEventListener('click', doCrop);
  cancelBtn.addEventListener('click', () => window.api.cropCancel());
  closeBtn.addEventListener('click', () => window.api.cropCancel());

  // ========== Init: receive image from main process ==========

  window.api.cropOnInit((data) => {
    if (!data || !data.imageDataUrl) {
      showError('未收到图片数据，请重试');
      return;
    }
    img = new Image();
    img.onload = () => {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
      // Guard against images without an intrinsic size (e.g. broken/odd
      // files that still "decode"): fall back to a 512x512 virtual size so
      // the UI never ends up with an invisible image on a blank canvas.
      if (!imgW || !imgH) {
        imgW = 512;
        imgH = 512;
      }
      hideError();
      fitImage();
    };
    img.onerror = () => {
      showError('无法加载所选图片，请换一张图片后重试');
    };
    img.src = data.imageDataUrl;
  });

  const errEl = document.createElement('div');
  errEl.className = 'crop-error';
  errEl.style.display = 'none';
  container.parentNode.insertBefore(errEl, container.nextSibling);

  function showError(msg) {
    errEl.textContent = msg;
    errEl.style.display = '';
  }

  function hideError() {
    errEl.style.display = 'none';
  }

})();
