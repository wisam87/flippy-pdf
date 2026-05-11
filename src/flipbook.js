import * as pdfjsLib from 'pdfjs-dist';

/**
 * Configure the PDF.js worker. Call this once at app startup, or pass
 * `workerSrc` in the Flipbook options. Bundler-agnostic — pass any URL.
 *
 * Examples:
 *   // Vite / Rollup
 *   import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
 *   setWorkerSrc(workerUrl);
 *
 *   // Webpack 5+ (asset modules)
 *   setWorkerSrc(new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href);
 *
 *   // CDN (no bundler required)
 *   setWorkerSrc('https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs');
 */
export function setWorkerSrc(url) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = url;
}

// Fallback to a jsDelivr-hosted worker pinned to the major version we depend
// on, so the library works out-of-the-box for consumers who don't configure
// anything. Production apps should self-host the worker for offline use.
const DEFAULT_WORKER_SRC = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version || '4'}/build/pdf.worker.min.mjs`;

const ICONS = {
  prev: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  next: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  fullscreen: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
  exitFullscreen: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h3a2 2 0 0 0 2-2V3M16 3v3a2 2 0 0 0 2 2h3M21 16h-3a2 2 0 0 0-2 2v3M8 21v-3a2 2 0 0 0-2-2H3"/></svg>`,
  zoomIn: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  zoomOut: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  zoomReset: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/></svg>`,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Flipbook {
  constructor(options = {}) {
    this.options = {
      renderScale: Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 1.5)),
      flipDuration: 700,
      enableDrag: true,
      enableKeyboard: true,
      // Below this stage width (px), switch to one-page-at-a-time layout
      // (phones + tablets in portrait). Above, render two-page spreads.
      singlePageBreakpoint: 900,
      // Optional override for the PDF.js worker URL. If omitted, falls back
      // to the CDN-hosted worker for the bundled pdfjs-dist version.
      workerSrc: null,
      ...options,
    };
    if (this.options.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = this.options.workerSrc;
    } else if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = DEFAULT_WORKER_SRC;
    }
    const c = options.container;
    this.root = typeof c === 'string' ? document.querySelector(c) : c;
    if (!this.root) throw new Error('Flipbook: container not found');

    this.pdf = null;
    this.numPages = 0;
    this.pageURLs = [];
    this.spreads = [];
    this.spreadIndex = 0;
    this.aspectRatio = 0.7071; // A4 default
    this.flipping = false;
    this.zoom = 1;
    this.singlePage = false;
    this._dom = {};
    this._drag = null;
    this._destroyed = false;
    this._resizeObserver = null;
  }

  async load(pdfUrl) {
    if (pdfUrl) this.options.pdfUrl = pdfUrl;
    if (!this.options.pdfUrl) throw new Error('Flipbook: pdfUrl is required');
    this._buildUI();
    this._setLoading(true, 'Loading PDF…');
    try {
      const task = pdfjsLib.getDocument({ url: this.options.pdfUrl });
      task.onProgress = ({ loaded, total }) => {
        if (total) {
          const pct = Math.round((loaded / total) * 100);
          this._setLoading(true, `Loading PDF… ${pct}%`);
        }
      };
      this.pdf = await task.promise;
      this.numPages = this.pdf.numPages;

      const first = await this.pdf.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      this.aspectRatio = vp.width / vp.height;

      this._buildSpreads();
      this._applyBookSize();
      this._renderSpread();
      this._updateToolbar();
      this._setLoading(false);

      this._renderQueue();
    } catch (err) {
      console.error('[Flipbook] load failed', err);
      this._setLoading(true, 'Failed to load PDF');
    }
    return this;
  }

  next() {
    if (this.flipping || this.spreadIndex >= this.spreads.length - 1) return;
    this._animateFlip(1);
  }

  prev() {
    if (this.flipping || this.spreadIndex <= 0) return;
    this._animateFlip(-1);
  }

  goTo(page) {
    page = clamp(page, 1, this.numPages);
    const idx = this.spreads.findIndex(([l, r]) => l === page || r === page);
    if (idx >= 0 && idx !== this.spreadIndex && !this.flipping) {
      this.spreadIndex = idx;
      this._renderSpread();
      this._updateToolbar();
    }
  }

  destroy() {
    this._destroyed = true;
    this.pageURLs.forEach((u) => u && URL.revokeObjectURL(u));
    if (this.pdf) this.pdf.destroy();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    document.removeEventListener('keydown', this._onKeyDownBound);
    document.removeEventListener('fullscreenchange', this._onFsChangeBound);
    this.root.classList.remove('ic-root');
    this.root.innerHTML = '';
  }

  // ---------- internal: UI ----------

  _buildUI() {
    this.root.classList.add('ic-root');
    this.root.innerHTML = `
      <div class="ic-stage">
        <button class="ic-side ic-side-prev" aria-label="Previous spread" type="button">${ICONS.prev}</button>
        <div class="ic-canvas">
          <div class="ic-book">
            <div class="ic-page ic-page-left"><div class="ic-spine-shadow ic-spine-shadow-left"></div></div>
            <div class="ic-page ic-page-right"><div class="ic-spine-shadow ic-spine-shadow-right"></div></div>
            <div class="ic-leaf" data-state="idle">
              <div class="ic-leaf-face ic-leaf-front"><div class="ic-leaf-gloss"></div></div>
              <div class="ic-leaf-face ic-leaf-back"><div class="ic-leaf-gloss"></div></div>
            </div>
          </div>
        </div>
        <button class="ic-side ic-side-next" aria-label="Next spread" type="button">${ICONS.next}</button>
        <div class="ic-loader">
          <div class="ic-spinner"></div>
          <div class="ic-loader-text">Loading…</div>
        </div>
      </div>
      <div class="ic-toolbar">
        <button class="ic-btn ic-btn-prev" aria-label="Previous" type="button">${ICONS.prev}</button>
        <div class="ic-page-info">
          <input class="ic-page-input" type="number" min="1" value="1" />
          <span class="ic-page-total">/ —</span>
        </div>
        <button class="ic-btn ic-btn-next" aria-label="Next" type="button">${ICONS.next}</button>
        <span class="ic-divider"></span>
        <button class="ic-btn ic-btn-zoom-out" aria-label="Zoom out" type="button">${ICONS.zoomOut}</button>
        <button class="ic-btn ic-btn-zoom-reset" aria-label="Reset zoom" type="button">${ICONS.zoomReset}</button>
        <button class="ic-btn ic-btn-zoom-in" aria-label="Zoom in" type="button">${ICONS.zoomIn}</button>
        <span class="ic-divider"></span>
        <button class="ic-btn ic-btn-fullscreen" aria-label="Fullscreen" type="button">${ICONS.fullscreen}</button>
      </div>
    `;
    const $ = (sel) => this.root.querySelector(sel);
    this._dom = {
      stage: $('.ic-stage'),
      canvas: $('.ic-canvas'),
      book: $('.ic-book'),
      pageLeft: $('.ic-page-left'),
      pageRight: $('.ic-page-right'),
      leaf: $('.ic-leaf'),
      leafFront: $('.ic-leaf-front'),
      leafBack: $('.ic-leaf-back'),
      loader: $('.ic-loader'),
      loaderText: $('.ic-loader-text'),
      sidePrev: $('.ic-side-prev'),
      sideNext: $('.ic-side-next'),
      toolbar: $('.ic-toolbar'),
      btnPrev: $('.ic-btn-prev'),
      btnNext: $('.ic-btn-next'),
      btnZoomIn: $('.ic-btn-zoom-in'),
      btnZoomOut: $('.ic-btn-zoom-out'),
      btnZoomReset: $('.ic-btn-zoom-reset'),
      btnFullscreen: $('.ic-btn-fullscreen'),
      pageInput: $('.ic-page-input'),
      pageTotal: $('.ic-page-total'),
    };
    this._bindEvents();
  }

  _bindEvents() {
    const d = this._dom;

    d.btnPrev.addEventListener('click', () => this.prev());
    d.btnNext.addEventListener('click', () => this.next());
    d.sidePrev.addEventListener('click', () => this.prev());
    d.sideNext.addEventListener('click', () => this.next());

    d.btnZoomIn.addEventListener('click', () => this._setZoom(this.zoom * 1.25));
    d.btnZoomOut.addEventListener('click', () => this._setZoom(this.zoom / 1.25));
    d.btnZoomReset.addEventListener('click', () => this._setZoom(1));
    d.btnFullscreen.addEventListener('click', () => this._toggleFullscreen());

    d.pageInput.addEventListener('change', () => {
      const v = parseInt(d.pageInput.value, 10);
      if (!isNaN(v)) this.goTo(v);
      else this._updateToolbar();
    });
    d.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') d.pageInput.blur();
    });

    if (this.options.enableKeyboard) {
      this._onKeyDownBound = (e) => this._onKeyDown(e);
      document.addEventListener('keydown', this._onKeyDownBound);
    }

    if (this.options.enableDrag) {
      d.book.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    }

    this._onFsChangeBound = () => this._onFullscreenChange();
    document.addEventListener('fullscreenchange', this._onFsChangeBound);

    this._resizeObserver = new ResizeObserver(() => this._applyBookSize());
    this._resizeObserver.observe(this._dom.stage);
  }

  _onKeyDown(e) {
    if (!this.root.isConnected) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      this.prev();
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.goTo(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      this.goTo(this.numPages);
    } else if (e.key === 'f' || e.key === 'F') {
      this._toggleFullscreen();
    }
  }

  _applyBookSize() {
    const stage = this._dom.stage;
    if (!stage) return;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (!stageW || !stageH) {
      // Layout not ready yet — retry on the next frame.
      if (!this._sizeRetryQueued) {
        this._sizeRetryQueued = true;
        requestAnimationFrame(() => {
          this._sizeRetryQueued = false;
          this._applyBookSize();
        });
      }
      return;
    }

    // Pick mode based on stage width. If it changes, switch and bail —
    // _setMode will rebuild and call us again.
    if (this.numPages > 0) {
      const wantsSingle = stageW < this.options.singlePageBreakpoint;
      if (wantsSingle !== this.singlePage) {
        this._setMode(wantsSingle);
        return;
      }
    }

    const horizontalPad = Math.max(20, Math.min(120, stageW * 0.06));
    const verticalPad = 32;
    const bookAspect = (this.singlePage ? 1 : 2) * this.aspectRatio;

    let w = (stageW - horizontalPad * 2) * this.zoom;
    let h = w / bookAspect;
    const maxH = (stageH - verticalPad * 2) * this.zoom;
    if (h > maxH) {
      h = maxH;
      w = h * bookAspect;
    }
    const book = this._dom.book;
    book.style.width = `${Math.round(w)}px`;
    book.style.height = `${Math.round(h)}px`;
  }

  _setMode(singlePage) {
    if (this.singlePage === singlePage) return;
    const currentPage = this._currentPage();
    this.singlePage = singlePage;
    this.root.classList.toggle('ic-single-page', singlePage);
    this._buildSpreads();
    const idx = this.spreads.findIndex(([l, r]) => l === currentPage || r === currentPage);
    this.spreadIndex = idx >= 0 ? idx : 0;
    // Reset any in-flight leaf state.
    const leaf = this._dom.leaf;
    if (leaf) {
      leaf.dataset.state = 'idle';
      leaf.style.transition = 'none';
      leaf.style.transform = '';
    }
    this.flipping = false;
    this._renderSpread();
    this._updateToolbar();
    this._applyBookSize();
  }

  _currentPage() {
    const [l, r] = this.spreads[this.spreadIndex] || [];
    return l || r || 1;
  }

  _setZoom(z) {
    this.zoom = clamp(z, 0.5, 2.5);
    this._applyBookSize();
  }

  _toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.root.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  _onFullscreenChange() {
    const inFs = document.fullscreenElement === this.root;
    this._dom.btnFullscreen.innerHTML = inFs ? ICONS.exitFullscreen : ICONS.fullscreen;
    this.root.classList.toggle('ic-fullscreen', inFs);
    requestAnimationFrame(() => this._applyBookSize());
  }

  // ---------- internal: spreads & rendering ----------

  _buildSpreads() {
    const N = this.numPages;
    if (this.singlePage) {
      // One page per "spread" — the right slot carries the page.
      const spreads = [];
      for (let p = 1; p <= N; p++) spreads.push([null, p]);
      this.spreads = spreads;
      return;
    }
    const spreads = [[null, 1]];
    for (let p = 2; p <= N; p += 2) {
      spreads.push([p, p + 1 <= N ? p + 1 : null]);
    }
    this.spreads = spreads;
  }

  _setLoading(loading, text) {
    if (text) this._dom.loaderText.textContent = text;
    this._dom.loader.classList.toggle('ic-loader-show', loading);
  }

  async _renderQueue() {
    const order = [];
    const seen = new Set();
    const add = (n) => { if (n && !seen.has(n)) { seen.add(n); order.push(n); } };
    add(1);
    const cur = this.spreads[this.spreadIndex] || [];
    add(cur[0]); add(cur[1]);
    if (this.spreads[this.spreadIndex + 1]) {
      add(this.spreads[this.spreadIndex + 1][0]);
      add(this.spreads[this.spreadIndex + 1][1]);
    }
    for (let i = 1; i <= this.numPages; i++) add(i);

    for (const pageNum of order) {
      if (this._destroyed) return;
      if (this.pageURLs[pageNum]) continue;
      try {
        const url = await this._renderPage(pageNum);
        if (this._destroyed) { URL.revokeObjectURL(url); return; }
        this.pageURLs[pageNum] = url;
        const [cl, cr] = this.spreads[this.spreadIndex] || [];
        if (pageNum === cl || pageNum === cr) this._renderSpread();
      } catch (e) {
        console.warn('[Flipbook] failed to render page', pageNum, e);
      }
    }
  }

  async _renderPage(pageNum) {
    const page = await this.pdf.getPage(pageNum);
    const scale = this.options.renderScale;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return await new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL()),
        'image/jpeg',
        0.92,
      );
    });
  }

  _setPageContent(el, pageNum) {
    if (!pageNum) {
      el.classList.add('ic-page-empty');
      el.style.backgroundImage = '';
      return;
    }
    el.classList.remove('ic-page-empty');
    const url = this.pageURLs[pageNum];
    el.style.backgroundImage = url ? `url(${url})` : '';
    el.classList.toggle('ic-page-pending', !url);
  }

  _renderSpread() {
    const [l, r] = this.spreads[this.spreadIndex] || [];
    this._setPageContent(this._dom.pageLeft, l);
    this._setPageContent(this._dom.pageRight, r);
  }

  _updateToolbar() {
    const [l, r] = this.spreads[this.spreadIndex] || [];
    const showPage = l || r;
    this._dom.pageInput.value = showPage || 1;
    this._dom.pageInput.max = this.numPages || 1;
    this._dom.pageTotal.textContent = `/ ${this.numPages || '—'}`;
    const atStart = this.spreadIndex === 0;
    const atEnd = this.spreadIndex >= this.spreads.length - 1;
    this._dom.btnPrev.disabled = atStart;
    this._dom.btnNext.disabled = atEnd;
    this._dom.sidePrev.classList.toggle('ic-side-disabled', atStart);
    this._dom.sideNext.classList.toggle('ic-side-disabled', atEnd);
  }

  // ---------- internal: flipping ----------

  _setLeafFaces(direction) {
    // direction = 1 (forward) or -1 (backward)
    const cur = this.spreads[this.spreadIndex];
    const target = this.spreads[this.spreadIndex + direction];
    if (!target) return false;

    let frontPage, backPage;
    if (this.singlePage) {
      // Slide-mode leaf: front always shows the *currently visible* page
      // as it slides off to reveal the target page underneath. No back face
      // is shown (no rotation), so leave it neutral.
      frontPage = cur[1];
      backPage = null;
    } else if (direction === 1) {
      // Front = current right page, Back = next left page
      frontPage = cur[1];
      backPage = target[0];
    } else {
      // Front = previous right page (will land on right after flip)
      // Back = current left page (currently on left, leaf starts at -180 covering it)
      frontPage = target[1];
      backPage = cur[0];
    }
    this._setPageContent(this._dom.leafFront, frontPage);
    this._setPageContent(this._dom.leafBack, backPage);
    return true;
  }

  _setUnderneath(direction) {
    const cur = this.spreads[this.spreadIndex];
    const target = this.spreads[this.spreadIndex + direction];
    if (this.singlePage) {
      // Left slot stays empty; right shows the target so it's revealed
      // as the leaf slides away (forward) or covered by the incoming
      // leaf (backward).
      this._setPageContent(this._dom.pageLeft, null);
      this._setPageContent(this._dom.pageRight, target[1]);
      return;
    }
    if (direction === 1) {
      // Pre-set: left stays as cur[0], right becomes target[1] (revealed mid-flip)
      this._setPageContent(this._dom.pageLeft, cur[0]);
      this._setPageContent(this._dom.pageRight, target[1]);
    } else {
      // Pre-set: left becomes target[0] (revealed mid-flip), right stays as cur[1]
      this._setPageContent(this._dom.pageLeft, target[0]);
      this._setPageContent(this._dom.pageRight, cur[1]);
    }
  }

  _leafTransform(direction, progress) {
    // progress: 0 = start, 1 = fully flipped/slid
    if (this.singlePage) {
      // Forward: slide left to -100%. Backward: slide right to +100%.
      const sign = direction === 1 ? -1 : 1;
      return `translateX(${sign * progress * 100}%)`;
    }
    // Two-page rotation
    const startAngle = direction === 1 ? 0 : -180;
    const endAngle = direction === 1 ? -180 : 0;
    const angle = startAngle + (endAngle - startAngle) * progress;
    return `rotateY(${angle}deg)`;
  }

  _animateFlip(direction) {
    if (this.flipping) return;
    if (!this._setLeafFaces(direction)) return;
    this.flipping = true;
    this._setUnderneath(direction);

    const leaf = this._dom.leaf;
    leaf.dataset.state = 'flipping';
    leaf.dataset.direction = direction === 1 ? 'forward' : 'backward';
    leaf.style.transition = 'none';
    leaf.style.transform = this._leafTransform(direction, 0);
    // Force reflow
    void leaf.offsetWidth;
    leaf.style.transition = `transform ${this.options.flipDuration}ms cubic-bezier(0.45, 0.05, 0.25, 1)`;
    leaf.style.transform = this._leafTransform(direction, 1);

    const onEnd = () => {
      leaf.removeEventListener('transitionend', onEnd);
      this._finishFlip(direction);
    };
    leaf.addEventListener('transitionend', onEnd);
  }

  _finishFlip(direction) {
    this.spreadIndex += direction;
    const leaf = this._dom.leaf;
    leaf.dataset.state = 'idle';
    leaf.style.transition = 'none';
    leaf.style.transform = '';
    this._renderSpread();
    this._updateToolbar();
    this.flipping = false;
  }

  // ---------- internal: drag-to-flip ----------

  _onPointerDown(e) {
    if (this.flipping) return;
    if (e.button !== undefined && e.button !== 0) return;

    const rect = this._dom.book.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const onRightHalf = x > rect.width / 2;
    const direction = onRightHalf ? 1 : -1;
    const target = this.spreads[this.spreadIndex + direction];
    if (!target) return;

    if (!this._setLeafFaces(direction)) return;

    // Don't start a drag from clicks on page content unless near edges; use small threshold
    this._drag = {
      direction,
      startX: e.clientX,
      bookRect: rect,
      moved: false,
      pointerId: e.pointerId,
      progress: 0, // 0 = leaf at start, 1 = fully flipped
    };

    this._setUnderneath(direction);
    const leaf = this._dom.leaf;
    leaf.dataset.state = 'dragging';
    leaf.dataset.direction = direction === 1 ? 'forward' : 'backward';
    leaf.style.transition = 'none';
    leaf.style.transform = this._leafTransform(direction, 0);

    this._onPointerMoveBound = (ev) => this._onPointerMove(ev);
    this._onPointerUpBound = (ev) => this._onPointerUp(ev);
    document.addEventListener('pointermove', this._onPointerMoveBound);
    document.addEventListener('pointerup', this._onPointerUpBound);
    document.addEventListener('pointercancel', this._onPointerUpBound);

    try { this._dom.book.setPointerCapture(e.pointerId); } catch (_) {}
  }

  _onPointerMove(e) {
    const drag = this._drag;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;

    const w = drag.bookRect.width;
    // In single-page mode the drag distance to reach 100% progress is the
    // full book width (you're sliding the whole page); in two-page mode it's
    // half (you're rotating one leaf around the spine).
    const span = this.singlePage ? w : w / 2;
    let progress;
    if (drag.direction === 1) {
      progress = clamp(-dx / span, 0, 1);
    } else {
      progress = clamp(dx / span, 0, 1);
    }
    drag.progress = progress;

    this._dom.leaf.style.transform = this._leafTransform(drag.direction, progress);
  }

  _onPointerUp(e) {
    const drag = this._drag;
    if (!drag) return;
    document.removeEventListener('pointermove', this._onPointerMoveBound);
    document.removeEventListener('pointerup', this._onPointerUpBound);
    document.removeEventListener('pointercancel', this._onPointerUpBound);
    try { this._dom.book.releasePointerCapture(drag.pointerId); } catch (_) {}

    const leaf = this._dom.leaf;

    if (!drag.moved) {
      // Treat as click — full flip
      this._drag = null;
      leaf.dataset.state = 'idle';
      leaf.style.transition = 'none';
      leaf.style.transform = '';
      this._renderSpread();
      // Use the full animation
      this._animateFlip(drag.direction);
      return;
    }

    const shouldComplete = drag.progress > 0.4;
    const targetProgress = shouldComplete ? 1 : 0;
    const remaining = Math.abs(targetProgress - drag.progress);
    const duration = Math.max(180, remaining * this.options.flipDuration);

    this.flipping = true;
    leaf.style.transition = `transform ${duration}ms cubic-bezier(0.45, 0.05, 0.25, 1)`;
    leaf.style.transform = this._leafTransform(drag.direction, targetProgress);

    const onEnd = () => {
      leaf.removeEventListener('transitionend', onEnd);
      if (shouldComplete) {
        this._finishFlip(drag.direction);
      } else {
        leaf.dataset.state = 'idle';
        leaf.style.transition = 'none';
        leaf.style.transform = '';
        this._renderSpread();
        this.flipping = false;
      }
      this._drag = null;
    };
    leaf.addEventListener('transitionend', onEnd);
  }
}

export default Flipbook;
