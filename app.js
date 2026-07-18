(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const appFrame = $("appFrame");
  const layer = $("cameraLayer");
  const video = $("cameraVideo");

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
    lastBarcode: "",
    lastAt: 0,
    torch: false
  };

  function sendToApp(message) {
    appFrame.contentWindow.postMessage(message, "*");
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
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + .13);
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
      select.value = selected;
    } catch (_) {}
  }

  async function startNative() {
    let formats = ["ean_13","ean_8","code_128","code_39","upc_a","upc_e","itf"];
    if (BarcodeDetector.getSupportedFormats) {
      const supported = await BarcodeDetector.getSupportedFormats();
      formats = formats.filter(f => supported.includes(f));
    }
    state.detector = formats.length ? new BarcodeDetector({ formats }) : new BarcodeDetector();
    const deviceId = $("cameraSelect").value;
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : {
        facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }
      }, audio: false
    });
    video.srcObject = state.stream;
    await video.play();
    state.track = state.stream.getVideoTracks()[0] || null;
    state.engine = "native";
    setEngine("Yerleşik okuyucu");
    scanNative();
  }

  async function scanNative() {
    if (!state.running || state.engine !== "native") return;
    try {
      if (video.readyState >= 2 && !state.busy) {
        const hits = await state.detector.detect(video);
        if (hits && hits[0]) acceptedBarcode(hits[0].rawValue);
      }
    } catch (_) {}
    state.raf = requestAnimationFrame(scanNative);
  }

  async function startZxing() {
    if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserMultiFormatReader) {
      throw new Error("Barkod okuyucu kütüphanesi yüklenemedi.");
    }
    state.reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    const deviceId = $("cameraSelect").value || undefined;
    state.controls = await state.reader.decodeFromVideoDevice(deviceId, video, result => {
      if (result) acceptedBarcode(result.getText());
    });
    state.stream = video.srcObject;
    state.track = state.stream && state.stream.getVideoTracks ? state.stream.getVideoTracks()[0] : null;
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
    await stopCamera(false);
    state.mode = mode;
    state.running = true;
    state.busy = false;
    layer.classList.remove("hidden");
    layer.setAttribute("aria-hidden", "false");
    $("cameraTitle").textContent = mode === "stock" ? "Stok İşlemi – Canlı Kamera" : "Seri Stok +1 – Canlı Kamera";
    setStatus("Kamera izni bekleniyor…");
    setError("");
    setEngine("Hazırlanıyor");

    try {
      if (!window.isSecureContext) throw new Error("Kamera HTTPS bağlantısı gerektirir.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Tarayıcı kamera erişimini desteklemiyor.");
      if ("BarcodeDetector" in window) {
        try { await startNative(); }
        catch (_) { await stopTracksOnly(); state.running = true; await startZxing(); }
      } else {
        await startZxing();
      }
      await listDevices();
      updateTorch();
      setStatus("Barkodu çerçeveye gösterin.");
    } catch (error) {
      const name = error?.name || "";
      let message = error?.message || "Kamera başlatılamadı.";
      if (name === "NotAllowedError") message = "Kamera izni reddedildi. Adres çubuğundaki kilit simgesinden kameraya izin verin.";
      else if (name === "NotFoundError") message = "Kamera bulunamadı.";
      else if (name === "NotReadableError") message = "Kamera başka bir uygulama tarafından kullanılıyor.";
      setError(message);
      setStatus("Kamera başlatılamadı.");
      state.running = false;
    }
  }

  async function stopTracksOnly() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    try { state.controls?.stop?.(); } catch (_) {}
    try { state.reader?.reset?.(); } catch (_) {}
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    state.stream = state.track = state.reader = state.controls = state.detector = null;
    state.engine = "";
  }

  async function stopCamera(hide = true) {
    state.running = false;
    state.torch = false;
    await stopTracksOnly();
    if (hide) {
      layer.classList.add("hidden");
      layer.setAttribute("aria-hidden", "true");
      sendToApp({ type: "HOCA_CAMERA_CLOSED" });
    }
  }

  window.addEventListener("message", event => {
    const data = event.data || {};
    if (data.type === "HOCA_APP_READY") sendToApp({ type: "HOCA_CAMERA_READY" });
    if (data.type === "HOCA_CAMERA_OPEN") startCamera(data.mode);
  });

  $("closeCamera").addEventListener("click", () => stopCamera(true));
  $("cameraSelect").addEventListener("change", () => startCamera(state.mode));
  $("torchButton").addEventListener("click", async () => {
    if (!state.track) return;
    try {
      state.torch = !state.torch;
      await state.track.applyConstraints({ advanced: [{ torch: state.torch }] });
      updateTorch();
    } catch (_) { state.torch = false; updateTorch(); }
  });

  appFrame.addEventListener("load", () => sendToApp({ type: "HOCA_CAMERA_READY" }));
})();
