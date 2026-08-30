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
  //
  // We support three payload formats, in priority order:
  //
  //   1. (preferred) { imageUrl: 'file:///C:/.../icon-...png' }
  //      The main process stages the picked image on disk under
  //      userData/crop-temp/ and sends the file:// URL. This path is
  //      CSP-safe ('self' covers file://→file://), zero-copy, and
  //      MIME-agnostic (Chromium sniffs magic bytes).
  //
  //   2. (legacy) { imageBytes: Uint8Array, imageMime: string }
  //      Main wraps the raw bytes in a Blob and feeds <img> a Blob URL.
  //      Kept as a fallback in case the temp-file write fails (e.g.
  //      disk full, permission denied on userData).
  //
  //   3. (very legacy) { imageDataUrl: 'data:image/...;base64,...' }
  //      Even older installs — kept for completeness but should not
  //      appear in v1.1.7+ builds.

  let activeBlobUrl = null;

  window.api.cropOnInit((data) => {
    if (!data) {
      showError('未收到图片数据，请重试');
      return;
    }
    // Clean up any previous blob URL to avoid memory leaks across opens.
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    }

    // Try each known loader in priority order. The first one that sets
    // a non-empty src wins; if <img> fires onerror we fall through to
    // the next strategy. This keeps one bad channel from locking the
    // user out of the cropper entirely.
    const strategies = [];

    if (typeof data.imageUrl === 'string' && data.imageUrl.length > 0) {
      strategies.push({ name: 'fileUrl', src: data.imageUrl });
    }
    if (data.imageBytes && (data.imageBytes.length || data.imageBytes.byteLength)) {
      try {
        const mime = data.imageMime || 'image/png';
        const buf = data.imageBytes instanceof Uint8Array
          ? data.imageBytes
          : new Uint8Array(data.imageBytes);
        const blob = new Blob([buf], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrl = blobUrl;
        strategies.push({ name: 'blob', src: blobUrl });
      } catch (err) {
        // ignore — fall through
      }
    }
    if (typeof data.imageDataUrl === 'string' && data.imageDataUrl.length > 0) {
      strategies.push({ name: 'dataUrl', src: data.imageDataUrl });
    }

    if (strategies.length === 0) {
      showError('未收到图片数据，请重试');
      return;
    }

    let attempt = 0;
    const tryNext = () => {
      if (attempt >= strategies.length) {
        showError('无法加载所选图片，请换一张图片后重试');
        return;
      }
      const cur = strategies[attempt++];
      loadImage(cur.src, (ok) => {
        if (ok) {
          // success — hide any previous error
          hideError();
          fitImage();
        } else {
          tryNext();
        }
      });
    };

    function loadImage(src, cb) {
      const probe = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        cb(ok);
      };
      // Belt-and-braces timeout: if neither onload nor onerror fires
      // within 4s (which can happen with corrupt-but-header-valid
      // files that Chromium tries to parse forever), assume the load
      // failed and let the strategy chain move on.
      const timer = setTimeout(() => {
        if (!settled) finish(false);
      }, 4000);
      // Important: we hand the source URL to BOTH the off-screen probe
      // (used by doCrop's canvas.drawImage) and the on-page <img>
      // (imgEl — the one the user actually sees). Previous versions
      // only fed the probe, which is why the page-side container was
      // forever transparent: imgEl.style was being set (width/height/
      // transform) but its `src` attribute was always empty, so the
      // browser never painted anything.
      //
      // We set imgEl.src *inside* onload so we don't briefly show a
      // broken-image icon if the first attempt fails and we move on
      // to the next strategy. Instead, we set both src at the same
      // moment once we know this strategy actually decoded.
      probe.onload = () => {
        clearTimeout(timer);
        // The previous version silently accepted onload-with-zero-size
        // and substituted a 512x512 virtual size, so the crop frame would
        // render around an invisible phantom <img>. That was the v1.1.8
        // failure mode (frame visible, image blank, no error message).
        // Treat 0×0 onload as a hard load failure and let the strategy
        // chain fall through — a real image will give us a real size.
        if (!probe.naturalWidth || !probe.naturalHeight) {
          finish(false);
          return;
        }
        img = probe;
        imgW = probe.naturalWidth;
        imgH = probe.naturalHeight;
        // Now that we know the bytes decode correctly, hand the same
        // source to the on-page <img>. Setting src triggers a fresh
        // decode (the probe and imgEl are independent Image objects);
        // since the URL is already validated we don't need to wait
        // for imgEl to also fire onload — the dimensions and the probe
        // prove the resource is good.
        imgEl.src = src;
        finish(true);
      };
      probe.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      probe.src = src;
    }

    tryNext();
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
