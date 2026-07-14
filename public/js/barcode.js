'use strict';
/* barcode.js — reusable IMEI / barcode scanning for the POS frontend.
 *
 * Two scan paths:
 *   (A) attachUsbScanner(inputEl, onScan, [validate])
 *       USB / keyboard-wedge scanners that type the code fast, then send Enter.
 *   (B) startCameraScan(onDetected)
 *       phone camera via the native BarcodeDetector API, with an automatic
 *       ZXing CDN fallback when BarcodeDetector is unavailable.
 *
 * Depends only on the optional global helper window.ui (for toasts).
 * No build step, no external CSS dependency. Attaches window.barcode.
 */
(function () {
  // Per-keystroke gap (ms) at/below which we assume a scanner burst.
  // Human typing is usually > 150ms between keys; scanners are < 20ms.
  const CHAR_THRESHOLD_MS = 70;
  const MIN_IMEI_DIGITS = 8;          // "looks like an IMEI" lower bound
  const ZXING_CDN = 'https://unpkg.com/@zxing/browser@latest';
  // The UMD bundle exposes the global "ZXingBrowser" (NOT "ZXing").
  const ZXING_GLOBAL = 'ZXingBrowser';

  function looksLikeImei(s) {
    return typeof s === 'string' && /^\d+$/.test(s) && s.length >= MIN_IMEI_DIGITS;
  }

  function toast(msg, type) {
    if (window.ui && typeof window.ui.toast === 'function') {
      window.ui.toast(msg, type);
    } else {
      console.warn('[barcode]', msg);
    }
  }

  function now() {
    return (window.performance && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  /* ---------------------------------------------------------------
   * (A) USB keyboard-wedge scanner
   * ------------------------------------------------------------- */
  function attachUsbScanner(inputEl, onScan, validate) {
    if (!inputEl) return;
    const ok = typeof validate === 'function' ? validate : looksLikeImei;
    let buffer = '';
    let lastTime = 0;

    inputEl.addEventListener('keydown', function (e) {
      const t = now();
      const rapid = (t - lastTime) <= CHAR_THRESHOLD_MS;
      lastTime = t;

      // A scanner finishes a burst with Enter.
      if (e.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (rapid && ok(code)) {
          e.preventDefault();            // stop form submit / newline
          e.stopPropagation();
          inputEl.value = code;          // populate the field
          if (typeof onScan === 'function') onScan(code);
        }
        return;
      }

      // Accumulate only during fast bursts; ignore slow human keystrokes.
      if (e.key && e.key.length === 1) {
        buffer = rapid ? buffer + e.key : e.key;
      } else {
        buffer = '';                     // modifier / non-character key — reset
      }
    });
  }

  /* ---------------------------------------------------------------
   * (B) Camera scan (native BarcodeDetector + ZXing fallback)
   * ------------------------------------------------------------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function buildModal(videoEl, onCancel) {
    const overlay = document.createElement('div');
    overlay.id = 'bcModal';
    overlay.setAttribute('style',
      'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.85);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;');

    const box = document.createElement('div');
    box.setAttribute('style',
      'background:#0f172a;border-radius:16px;max-width:480px;width:100%;' +
      'overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.5);');

    const head = document.createElement('div');
    head.setAttribute('style',
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:14px 16px;color:#fff;font-weight:600;font-size:1rem;');
    head.innerHTML = '<span>📷 Scan barcode</span>';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.setAttribute('style',
      'background:#2563eb;color:#fff;border:none;border-radius:10px;' +
      'padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;');
    if (typeof onCancel === 'function') cancel.addEventListener('click', onCancel);
    head.appendChild(cancel);

    videoEl.setAttribute('style', 'display:block;width:100%;height:auto;background:#000;');
    videoEl.setAttribute('playsinline', '');   // iOS Safari autoplay
    videoEl.muted = true;

    const hint = document.createElement('div');
    hint.setAttribute('style', 'padding:10px 16px 16px;color:#94a3b8;font-size:.82rem;');
    hint.textContent = 'Point the camera at the barcode on the box or device.';

    box.appendChild(head);
    box.appendChild(videoEl);
    box.appendChild(hint);
    overlay.appendChild(box);
    return overlay;
  }

  async function startCameraScan(onDetected) {
    if (typeof onDetected !== 'function') return;

    const video = document.createElement('video');
    let modal = null, stream = null, zxControls = null, done = false;

    function cleanup() {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      if (zxControls && zxControls.stop) { try { zxControls.stop(); } catch (e) {} zxControls = null; }
    }
    function cancel() {            // user pressed Cancel — silent close, no toast
      if (done) return; done = true; cleanup();
    }
    function fail(msg) {           // unrecoverable — notify and close
      if (done) return; done = true; cleanup();
      toast(msg || 'Scan failed — use USB scanner or type manually', 'error');
    }

    const constraints = { video: { facingMode: 'environment' } };

    try {
      if ('BarcodeDetector' in window) {
        let detector;
        try {
          detector = new BarcodeDetector({
            formats: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'qr_code']
          });
        } catch (e) {
          detector = new BarcodeDetector();   // scan all supported formats
        }
        modal = buildModal(video, cancel);
        document.body.appendChild(modal);
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        await video.play();

        const tick = async function () {
          if (done) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length) { finish(codes[0].rawValue); return; }
          } catch (e) { /* transient decode error — keep scanning */ }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else {
        // Fallback: load ZXing (UMD global "ZXingBrowser") from CDN.
        await loadScript(ZXING_CDN);
        const ZB = window[ZXING_GLOBAL];
        if (!ZB || !ZB.BrowserMultiFormatReader) throw new Error('ZXing unavailable');
        const reader = new ZB.BrowserMultiFormatReader();
        modal = buildModal(video, cancel);
        document.body.appendChild(modal);
        zxControls = await reader.decodeFromConstraints(constraints, video, function (result, _err) {
          if (done) return;
          if (result && typeof result.getText === 'function' && result.getText()) {
            finish(result.getText());
          }
        });
      }
    } catch (e) {
      console.warn('[barcode] camera scan failed:', e);
      fail('Camera scanning not supported on this device — use USB scanner or type manually');
    }

    function finish(value) {
      if (done) return; done = true; cleanup(); onDetected(value);
    }
  }

  window.barcode = {
    attachUsbScanner: attachUsbScanner,
    startCameraScan: startCameraScan,
    looksLikeImei: looksLikeImei
  };
})();
