(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const APP_ORIGIN = "https://script.google.com";
  const appFrame = $("appFrame");
  const layer = $("cameraLayer");
  const video = $("cameraVideo");
  const openButton = $("openCameraButton");

  const state = {
    mode: "quick",
    running: false,
    stream: null,
    track: null,
    detector: null,
    reader: null,
    controls: null,
    engine: "",
    raf: 0,
    busy: false,
    starting: false,
    lastBarcode: "",
    lastAt: 0,
    torch: false
  };

  function sendToApp(message) {
    if (!appFrame?.contentWindow) return;
    appFrame.contentWindow.postMessage(message, APP_ORIGIN);
  }

  function setStatus(text) { $("cameraStatus").textContent = text; }
  function setError(text = "") { $("cameraError").textContent = text; }
  function setEngine(text) { $("engineBadge").textContent = text; }

  function beep(ok = true) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = ok ? 980 : 220;
      gain.gain.setValueAtTime(.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + .13);
    } catch (_) {}
  }

  function acceptedBarcode(raw) {
    const barcode = String(raw || "").trim();
    if (!barcode || state.busy) return;

    const now = Date.now();
    const cooldown = Number($("cooldownSelect").value || 1000);
    if (barcode === state.lastBarcode && now - state.lastAt < cooldown) return;

    state.busy = true;
    state.lastBarcode = barcode;
    state.lastAt = now;
    $("lastBarcode").textContent = barcode;
    setStatus("Okundu. Sonraki barkodu bekliyor…");
    beep(true);
    if (navigator.vibrate) navigator.vibrate(70);
    sendToApp({ type: "HOCA_CAMERA_BARCODE", barcode, mode: state.mode });
    setTimeout(() => { state.busy = false; }, 450);
  }

  async function listDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === "videoinput");
      const select = $("cameraSelect");
      const selected = select.value;
      select.innerHTML = '<option value="">Arka kamera (otomatik)</option>';
      cameras.forEach((camera, i) => {
        const option = document.createElement("option");
        option.value = camera.deviceId;
        option.textContent = camera.label || `Kamera ${i + 1}`;
        select.appendChild(option);
      });
      if ([...select.options].some(o => o.value === selected)) select.value = selected;
    } catch (_) {}
  }

  async function openStream() {
    const deviceId = $("cameraSelect").value;
    const attempts = deviceId
      ? [{ video: { deviceId: { exact: deviceId } }, audio: false }]
      : [
          { video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: true, audio: false }
        ];

    let lastError;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
        if (error?.name === "NotAllowedError" || error?.name === "SecurityError") throw error;
      }
    }
    throw lastError || new Error("Kamera açılamadı.");
  }

  async function attachStream() {
    state.stream = await openStream();
    video.srcObject = state.stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    await video.play();
    state.track = state.stream.getVideoTracks()[0] || null;
  }

  async function startNative() {
    await attachStream();
    let formats = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"];
    if (BarcodeDetector.getSupportedFormats) {
      const supported = await BarcodeDetector.getSupportedFormats();
      formats = formats.filter(f => supported.includes(f));
    }
    state.detector = formats.length ? new BarcodeDetector({ formats }) : new BarcodeDetector();
    state.engine = "native";
    setEngine("Yerleşik okuyucu");
    scanNative();
  }

  async function scanNative() {
    if (!state.running || state.engine !== "native") return;
    try {
      if (video.readyState >= 2 && !state.busy) {
        const hits = await state.detector.detect(video);
        if (hits?.[0]) acceptedBarcode(hits[0].rawValue);
      }
    } catch (_) {}
    state.raf = requestAnimationFrame(scanNative);
  }

  async function startZxing() {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      throw new Error("Barkod okuyucu kütüphanesi yüklenemedi.");
    }

    await attachStream();
    state.reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    state.controls = await state.reader.decodeFromStream(state.stream, video, result => {
      if (result) acceptedBarcode(result.getText());
    });
    state.engine = "zxing";
    setEngine("ZXing okuyucu");
  }

  function updateTorch() {
    let supported = false;
    try { supported = Boolean(state.track?.getCapabilities?.().torch); } catch (_) {}
    $("torchButton").disabled = !supported;
    $("torchButton").textContent = state.torch ? "Feneri Kapat" : "Feneri Aç";
  }

  async function startCamera(mode = "quick") {
    if (state.starting) return;
    state.starting = true;

    try {
      await stopCamera(false);
      state.mode = mode === "stock" ? "stock" : "quick";
      state.running = true;
      state.busy = false;
      layer.classList.remove("hidden");
      layer.setAttribute("aria-hidden", "false");
      openButton.hidden = true;
      $("cameraTitle").textContent = state.mode === "stock"
        ? "Stok İşlemi – Canlı Kamera"
        : "Seri Stok +1 – Canlı Kamera";
      setStatus("Kamera izni bekleniyor…");
      setError("");
      setEngine("Hazırlanıyor");

      if (!window.isSecureContext) throw new Error("Kamera HTTPS bağlantısı gerektirir.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Tarayıcı kamera erişimini desteklemiyor.");

      if ("BarcodeDetector" in window) {
        try {
          await startNative();
        } catch (nativeError) {
          await stopTracksOnly();
          state.running = true;
          await startZxing();
        }
      } else {
        await startZxing();
      }

      await listDevices();
      updateTorch();
      setStatus("Barkodu çerçeveye gösterin.");
    } catch (error) {
      const name = error?.name || "";
      let message = error?.message || "Kamera başlatılamadı.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        message = "Kamera izni kapalı. Tarayıcı ayarlarından bu site için Kamera iznini Açık yapın ve tekrar deneyin.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        message = "Uygun kamera bulunamadı. Kamera seçimini Otomatik bırakıp tekrar deneyin.";
      } else if (name === "NotReadableError" || name === "AbortError") {
        message = "Kamera başka bir uygulama tarafından kullanılıyor. Kamera kullanan diğer uygulamaları kapatın.";
      }
      setError(message);
      setStatus("Kamera başlatılamadı.");
      setEngine("Hata");
      state.running = false;
      beep(false);
    } finally {
      state.starting = false;
    }
  }

  async function stopTracksOnly() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    try { state.controls?.stop?.(); } catch (_) {}
    try { state.reader?.reset?.(); } catch (_) {}
    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    video.pause();
    video.srcObject = null;
    state.stream = null;
    state.track = null;
    state.reader = null;
    state.controls = null;
    state.detector = null;
    state.engine = "";
  }

  async function stopCamera(hide = true) {
    state.running = false;
    state.torch = false;
    await stopTracksOnly();
    if (hide) {
      layer.classList.add("hidden");
      layer.setAttribute("aria-hidden", "true");
      openButton.hidden = false;
      sendToApp({ type: "HOCA_CAMERA_CLOSED" });
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== appFrame.contentWindow) return;
    const data = event.data || {};
    if (data.type === "HOCA_APP_READY") sendToApp({ type: "HOCA_CAMERA_READY" });
    if (data.type === "HOCA_CAMERA_OPEN") startCamera(data.mode || "quick");
  });

  openButton.addEventListener("click", () => startCamera("quick"));
  $("closeCamera").addEventListener("click", () => stopCamera(true));
  $("cameraSelect").addEventListener("change", () => {
    if (state.running) startCamera(state.mode);
  });
  $("torchButton").addEventListener("click", async () => {
    if (!state.track) return;
    try {
      state.torch = !state.torch;
      await state.track.applyConstraints({ advanced: [{ torch: state.torch }] });
      updateTorch();
    } catch (_) {
      state.torch = false;
      updateTorch();
    }
  });

  appFrame.addEventListener("load", () => sendToApp({ type: "HOCA_CAMERA_READY" }));
})();
