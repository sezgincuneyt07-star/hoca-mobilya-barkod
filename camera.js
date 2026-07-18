(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const allowedParent = "*";
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "stock" ? "stock" : "quick";
  let reader = null, controls = null, stream = null, track = null, torch = false;
  let devices = [], deviceIndex = 0, busy = false, lastCode = "", lastAt = 0;

  function post(type, extra={}) {
    parent.postMessage({ source:"HOCA_MOBILYA_CAMERA", type, mode, ...extra }, allowedParent);
  }
  function status(title,text){ $("statusTitle").textContent=title; $("statusText").textContent=text; }
  function beep(ok=true){
    try { const C=window.AudioContext||window.webkitAudioContext, c=new C(), o=c.createOscillator(), g=c.createGain(); o.frequency.value=ok?980:260; g.gain.value=.05; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+.09); } catch(e){}
  }
  async function stop(){
    if(controls){ try{controls.stop()}catch(e){} }
    if(reader){ try{reader.reset()}catch(e){} }
    if(stream){ stream.getTracks().forEach(t=>t.stop()); }
    controls=reader=stream=track=null; torch=false; $("torchButton").disabled=true;
  }
  async function start(deviceId){
    await stop(); busy=false; status("Kamera izni bekleniyor","Arka kamera açılıyor...");
    try{
      if(!window.ZXingBrowser || !ZXingBrowser.BrowserMultiFormatReader) throw new Error("Barkod kütüphanesi yüklenemedi.");
      reader=new ZXingBrowser.BrowserMultiFormatReader();
      controls=await reader.decodeFromVideoDevice(deviceId||undefined,$("cameraVideo"),(result,error)=>{
        if(result) onCode(result.getText());
      });
      stream=$("cameraVideo").srcObject;
      track=stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      const caps=track && track.getCapabilities ? track.getCapabilities() : {};
      $("torchButton").disabled=!caps.torch;
      devices=await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
      if(deviceId){ const i=devices.findIndex(d=>d.deviceId===deviceId); if(i>=0) deviceIndex=i; }
      status("Kamera hazır", mode==="stock"?"Barkodu çerçeveye gösterin; ürün forma aktarılacak.":"Barkodu gösterin; stok otomatik +1 artacak.");
      post("CAMERA_READY");
    }catch(e){
      let m=e.message||"Kamera başlatılamadı.";
      if(e.name==="NotAllowedError") m="Kamera izni verilmedi. Tarayıcı ayarlarından kamera iznini açın.";
      status("Kamera başlatılamadı",m); post("CAMERA_ERROR",{message:m});
    }
  }
  function onCode(value){
    const code=String(value||"").trim(), now=Date.now();
    if(!code||busy) return;
    if(code===lastCode && now-lastAt<1400) return;
    lastCode=code; lastAt=now; busy=true; $("lastBarcode").textContent=code;
    status("Barkod okundu",code+" işleniyor..."); beep(true); if(navigator.vibrate) navigator.vibrate(80);
    post("BARCODE_SCANNED",{barcode:code,scanId:String(now)});
    setTimeout(()=>{ busy=false; status("Kamera hazır","Sıradaki barkodu gösterebilirsiniz."); }, mode==="stock"?1800:1100);
  }
  $("closeButton").addEventListener("click",async()=>{ await stop(); post("CAMERA_CLOSED"); });
  $("switchButton").addEventListener("click",async()=>{ if(!devices.length) return; deviceIndex=(deviceIndex+1)%devices.length; await start(devices[deviceIndex].deviceId); });
  $("torchButton").addEventListener("click",async()=>{ if(!track)return; try{torch=!torch; await track.applyConstraints({advanced:[{torch}]}); $("torchButton").textContent=torch?"Feneri Kapat":"Fener";}catch(e){} });
  window.addEventListener("message",e=>{ const d=e.data||{}; if(d.source!=="HOCA_MOBILYA_APP")return; if(d.type==="CLOSE_CAMERA") stop(); if(d.type==="STOCK_RESULT"){ status(d.success?"İşlem başarılı":"İşlem başarısız",d.message||""); beep(!!d.success); } });
  window.addEventListener("beforeunload",stop);
  window.addEventListener("load",()=>start());
})();