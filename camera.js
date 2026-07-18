(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "stock" ? "stock" : "quick";
  const returnUrl = params.get("returnUrl") || "https://script.google.com/macros/s/AKfycbzKW87lp7ZpwzvrJr0W36rj_VCScP2MCZJBOdUnU4NX_i2K0fJeUUsjzZapnsT1kjrc/exec";

  let reader = null;
  let controls = null;
  let stream = null;
  let track = null;
  let torch = false;
  let devices = [];
  let deviceIndex = 0;
  let busy = false;
  let lastCode = "";
  let lastAt = 0;

  function status(title, text) {
    $("statusTitle").textContent = title;
    $("statusText").textContent = text;
  }

  function beep(ok = true) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = ok ? 980 : 260;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.09);
    } catch (error) {}
  }

  function buildReturnUrl(extra = {}) {
    const url = new URL(returnUrl);
    Object.entries(extra).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("cameraMode", mode);
    url.searchParams.set("cameraTime", String(Date.now()));
    return url.toString();
  }

  async function stop() {
    if (controls) {
      try { controls.stop(); } catch (error) {}
    }
    if (reader) {
      try { reader.reset(); } catch (error) {}
    }
    if (stream) stream.getTracks().forEach(item => item.stop());
    controls = null;
    reader = null;
    stream = null;
    track = null;
    torch = false;
    $("torchButton").disabled = true;
  }

  async function start(deviceId) {
    await stop();
    busy = false;
    status("Kamera izni bekleniyor", "Arka kamera açılıyor...");

    try {
      if (!window.ZXingBrowser || !ZXingBrowser.BrowserMultiFormatReader) {
        throw new Error("Barkod kütüphanesi yüklenemedi.");
      }

      reader = new ZXingBrowser.BrowserMultiFormatReader();
      controls = await reader.decodeFromVideoDevice(
        deviceId || undefined,
        $("cameraVideo"),
        result => {
          if (result) onCode(result.getText());
        }
      );

      stream = $("cameraVideo").srcObject;
      track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      const capabilities = track && track.getCapabilities ? track.getCapabilities() : {};
      $("torchButton").disabled = !capabilities.torch;

      devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
      if (deviceId) {
        const index = devices.findIndex(device => device.deviceId === deviceId);
        if (index >= 0) deviceIndex = index;
      }

      status(
        "Kamera hazır",
        mode === "stock"
          ? "Barkodu gösterin; ürün stok formuna aktarılacak."
          : "Barkodu gösterin; stok +1 yapılıp kamera yeniden açılacak."
      );
    } catch (error) {
      let message = error.message || "Kamera başlatılamadı.";
      if (error.name === "NotAllowedError") {
        message = "Kamera izni verilmedi. Tarayıcı ayarlarından kamera iznini açın.";
      }
      status("Kamera başlatılamadı", message);
      beep(false);
    }
  }

  async function onCode(value) {
    const code = String(value || "").trim();
    const now = Date.now();
    if (!code || busy) return;
    if (code === lastCode && now - lastAt < 1600) return;

    lastCode = code;
    lastAt = now;
    busy = true;
    $("lastBarcode").textContent = code;
    status("Barkod okundu", "Stok uygulamasına dönülüyor...");
    beep(true);
    if (navigator.vibrate) navigator.vibrate(80);

    await stop();
    window.location.replace(buildReturnUrl({ cameraBarcode: code }));
  }

  $("closeButton").addEventListener("click", async () => {
    await stop();
    window.location.replace(buildReturnUrl({ cameraCancelled: "1" }));
  });

  $("switchButton").addEventListener("click", async () => {
    if (!devices.length) return;
    deviceIndex = (deviceIndex + 1) % devices.length;
    await start(devices[deviceIndex].deviceId);
  });

  $("torchButton").addEventListener("click", async () => {
    if (!track) return;
    try {
      torch = !torch;
      await track.applyConstraints({ advanced: [{ torch }] });
      $("torchButton").textContent = torch ? "Feneri Kapat" : "Fener";
    } catch (error) {}
  });

  window.addEventListener("beforeunload", stop);
  window.addEventListener("load", () => start());
})();
