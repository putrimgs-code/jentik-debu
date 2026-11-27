/*
 * Jentik Debu — berjalan di "MAIN world" halaman.
 * Mengait navigator.mediaDevices.getUserMedia, mengganti track kamera dengan
 * track hasil olahan: normalnya diteruskan apa adanya, dan saat jentikan
 * terdeteksi, badan pengguna hancur jadi debu (WebGL) lalu hilang, diganti
 * foto latar kosong yang sudah direkam.
 */
(() => {
  'use strict';
  if (window.__jentikDebuInstalled) return;
  window.__jentikDebuInstalled = true;

  const TAG = '__jentikDebu';
  const LOG = (...a) => console.log('%c[Jentik Debu]', 'color:#f0a050', ...a);

  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') return;
  const origGUM = MediaDevices.prototype.getUserMedia;
  const callGUM = (c) => origGUM.call(navigator.mediaDevices, c);

  // ---------------------------------------------------------------- settings
  const settings = {
    enabled: true,
    soundSnap: true,
    sensitivity: 0.6,    // 0..1
    maskThreshold: 0.11, // 0.04..0.3, perbedaan warna badan vs latar
    duration: 3,         // detik
    autoReturn: 0,       // detik; 0 = muncul lagi hanya dengan jentikan
  };

  // ---------------------------------------------------------------- global state
  const processors = new Set();
  const effect = { phase: 'visible', id: 0, t0: 0, seed: 0, vanishedAt: 0 };
  const plate = { source: null, w: 0, h: 0, version: 0, id: null };
  let capture = null; // { remaining, canvas, ctx, count, w, h }
  let countdownBusy = false;
  const seenCmd = new Set();
  let lastError = null;
  let workletUrl = null; // URL snap-worklet.js, dikirim oleh bridge

  const totalTime = () => settings.duration * 1.1;
  const bodyTime = () => settings.duration * 0.6;
  const lifeTime = () => settings.duration * 0.5;

  // ---------------------------------------------------------------- bridge messaging
  function toBridge(type, payload) {
    try { window.postMessage({ [TAG]: 1, dir: 'bridge', type, payload }, '*'); } catch (_) {}
  }
  function reportState() {
    toBridge('state', {
      active: processors.size,
      phase: effect.phase,
      hasPlate: !!plate.source,
      plateW: plate.w,
      plateH: plate.h,
      mic: detector.running,
      error: lastError,
      host: location.hostname || location.protocol,
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || !d[TAG] || d.dir !== 'main') return;
    if (d.type === 'settings') applySettings(d.payload || {});
    else if (d.type === 'plate') loadPlate(d.payload);
    else if (d.type === 'cmd') handleCmd(d.payload || {});
    else if (d.type === 'assets' && d.payload && d.payload.worklet) workletUrl = d.payload.worklet;
  });
  window.addEventListener('pagehide', () => toBridge('state', { active: 0 }));
  setInterval(() => { if (processors.size) reportState(); }, 5000); // detak status untuk popup

  function applySettings(s) {
    for (const k of Object.keys(settings)) if (k in s) settings[k] = s[k];
    detector.setSensitivity(settings.sensitivity);
    syncDetector();
  }

  function handleCmd(c) {
    if (c.id) {
      if (seenCmd.has(c.id)) return;
      seenCmd.add(c.id);
      if (seenCmd.size > 50) seenCmd.delete(seenCmd.values().next().value);
    }
    if (c.cmd === 'snap') { if (processors.size) trigger('pintasan'); }
    else if (c.cmd === 'capture') { if (processors.size) startCapture(); }
    else if (c.cmd === 'clearPlate') { plate.source = null; plate.id = null; plate.version++; reportState(); }
    else if (c.cmd === 'ping') reportState();
  }

  // ---------------------------------------------------------------- plate (latar kosong)
  async function loadPlate(p) {
    if (!p || !p.data) {
      if (plate.id) { plate.source = null; plate.id = null; plate.version++; reportState(); }
      return;
    }
    if (p.id && p.id === plate.id) return;
    try {
      const b64 = p.data.slice(p.data.indexOf(',') + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mime = (p.data.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
      plate.source = bmp; plate.w = bmp.width; plate.h = bmp.height;
      plate.id = p.id || String(Date.now()); plate.version++;
      reportState();
    } catch (err) { LOG('gagal memuat latar', err); }
  }

  function startCapture() {
    if (countdownBusy || capture) return;
    countdownBusy = true;
    let n = 5;
    ui.countdown(n, 'Keluar dari frame kamera…');
    const iv = setInterval(() => {
      n--;
      if (n > 0) { ui.countdown(n, 'Keluar dari frame kamera…'); return; }
      clearInterval(iv);
      ui.countdown('📸', 'Merekam latar…');
      capture = { remaining: 14, count: 0, canvas: null, ctx: null };
    }, 1000);
  }

  function feedCapture(src, w, h) {
    if (!capture) return;
    if (!capture.canvas) {
      capture.canvas = new OffscreenCanvas(w, h);
      capture.ctx = capture.canvas.getContext('2d');
      capture.w = w; capture.h = h;
    }
    if (capture.w !== w || capture.h !== h) return;
    capture.count++;
    capture.ctx.globalAlpha = 1 / capture.count; // rata-rata berjalan, mengurangi noise
    capture.ctx.drawImage(src, 0, 0, w, h);
    if (--capture.remaining > 0) return;
    const cv = capture.canvas;
    capture = null;
    countdownBusy = false;
    plate.source = cv; plate.w = cv.width; plate.h = cv.height;
    plate.id = 'p' + Date.now(); plate.version++;
    ui.hideCountdown();
    ui.toast('Latar kosong tersimpan ✓ Silakan kembali ke kamera.');
    reportState();
    cv.convertToBlob({ type: 'image/jpeg', quality: 0.93 }).then((blob) => {
      const fr = new FileReader();
      const id = plate.id;
      fr.onload = () => toBridge('savePlate', { id, w: cv.width, h: cv.height, data: fr.result });
      fr.readAsDataURL(blob);
    });
  }

  // ---------------------------------------------------------------- trigger
  function trigger(source) {
    if (!processors.size) return;
    LOG('jentik:', source, '| fase:', effect.phase);
    const now = performance.now();
    if (effect.phase === 'visible') {
      if (!plate.source) {
        ui.toast('Rekam latar kosong dulu lewat popup ekstensi Jentik Debu.');
        return;
      }
      effect.phase = 'vanishing';
    } else if (effect.phase === 'vanished') {
      effect.phase = 'appearing';
    } else return; // efek sedang jalan
    effect.id++; effect.t0 = now; effect.seed = Math.random() * 100;
    ui.toast(effect.phase === 'vanishing' ? `✨ Jentik! (${source})` : `✨ Kembali! (${source})`);
    reportState();
  }

  function tickEffect(now) {
    const el = (now - effect.t0) / 1000;
    if (effect.phase === 'vanishing' && el >= totalTime()) {
      effect.phase = 'vanished'; effect.vanishedAt = now; reportState();
    } else if (effect.phase === 'appearing' && el >= totalTime()) {
      effect.phase = 'visible'; reportState();
    } else if (effect.phase === 'vanished' && settings.autoReturn > 0 &&
               now - effect.vanishedAt > settings.autoReturn * 1000) {
      trigger('otomatis');
    }
  }

  // ---------------------------------------------------------------- UI overlay (hanya terlihat oleh kamu)
  const ui = (() => {
    let toastEl, toastTimer, cdEl;
    const root = () => document.body || document.documentElement;
    function toast(text) {
      if (!root()) return;
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483647;' +
          'background:linear-gradient(160deg,rgba(40,24,78,.72),rgba(18,10,38,.66));color:#f1ecff;' +
          'font:600 13px/1.4 ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;letter-spacing:.02em;padding:10px 16px;' +
          'border-radius:12px;backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);' +
          'box-shadow:0 0 0 1px rgba(196,167,255,.35),0 8px 30px rgba(139,92,246,.4),inset 0 1px 0 rgba(255,255,255,.1);' +
          'pointer-events:none;transition:opacity .3s';
      }
      toastEl.textContent = text;
      toastEl.style.opacity = '1';
      if (!toastEl.isConnected) root().appendChild(toastEl);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2600);
    }
    function countdown(n, label) {
      if (!root()) return;
      if (!cdEl) {
        cdEl = document.createElement('div');
        cdEl.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;' +
          'justify-content:center;background:radial-gradient(circle at 50% 45%,rgba(139,92,246,.35),rgba(10,7,20,.7) 70%);' +
          'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:#fff;font-family:system-ui,sans-serif;pointer-events:none';
        const big = document.createElement('div');
        big.style.cssText = 'font:800 120px/1 ui-monospace,"JetBrains Mono",Menlo,monospace;color:#f5efff;' +
          'text-shadow:0 0 24px rgba(167,139,250,.9),0 0 60px rgba(217,70,239,.6)';
        const small = document.createElement('div');
        small.style.cssText = 'margin-top:18px;font:600 15px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#67e8f9';
        cdEl.append(big, small);
      }
      cdEl.firstChild.textContent = String(n);
      cdEl.lastChild.textContent = label;
      if (!cdEl.isConnected) root().appendChild(cdEl);
    }
    function hideCountdown() { if (cdEl) cdEl.remove(); }
    return { toast, countdown, hideCountdown };
  })();

  // ---------------------------------------------------------------- snap detector (audio)
  const detector = (() => {
    let stream = null, ctx = null, proc = null, starting = false;
    let floor = 0.002, prevRms = 0, cooldownUntil = 0, pending = null;
    const history = []; // rms sub-blok terakhir (≈ 200 ms)
    let K = 14, absMin = 0.015;
    const api = { running: false, start, stop, setSensitivity };

    function setSensitivity(s) {
      s = Math.min(1, Math.max(0, s));
      K = 30 - 24 * s;            // rasio terhadap noise floor
      absMin = 0.04 - 0.035 * s;  // amplitudo minimum
    }

    async function start() {
      if (api.running || starting) return;
      starting = true;
      try {
        try {
          stream = await callGUM({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        } catch (_) {
          stream = await callGUM({ audio: true, video: false });
        }
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 2200; hp.Q.value = 0.7;
        const merger = ctx.createChannelMerger(2);
        src.connect(merger, 0, 0);
        src.connect(hp); hp.connect(merger, 0, 1);
        const mute = ctx.createGain(); mute.gain.value = 0;
        mute.connect(ctx.destination);
        const sr = ctx.sampleRate;
        try {
          if (!workletUrl || !ctx.audioWorklet) throw new Error('worklet tidak tersedia');
          await ctx.audioWorklet.addModule(workletUrl);
          proc = new AudioWorkletNode(ctx, 'jentik-snap', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
            channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete',
          });
          proc.port.onmessage = (ev) => { const { rms, sub } = ev.data; analyseRms(rms, sub, sr); };
        } catch (err) {
          // cadangan bila halaman menolak worklet: API lama (Chrome memberi peringatan "deprecated")
          LOG('AudioWorklet tidak bisa dipakai, pakai cadangan', err);
          proc = ctx.createScriptProcessor(512, 2, 1);
          proc.onaudioprocess = (ev) => analyse(ev.inputBuffer.getChannelData(0), ev.inputBuffer.getChannelData(1), sr);
        }
        merger.connect(proc);
        proc.connect(mute);
        if (ctx.state !== 'running') {
          ctx.resume().catch(() => {});
          const resume = () => { ctx && ctx.resume().catch(() => {}); };
          window.addEventListener('pointerdown', resume, { capture: true, once: true });
          window.addEventListener('keydown', resume, { capture: true, once: true });
        }
        api.running = true;
        LOG('detektor jentikan aktif');
      } catch (err) {
        LOG('mikrofon tidak bisa dipakai untuk deteksi jentikan', err);
        lastError = 'mic';
        stop();
      } finally {
        starting = false;
        reportState();
      }
    }

    function stop() {
      api.running = false;
      try { proc && (proc.onaudioprocess = null); } catch (_) {}
      try { proc && proc.port && (proc.port.onmessage = null); } catch (_) {}
      try { ctx && ctx.close(); } catch (_) {}
      try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      stream = ctx = proc = null;
      reportState();
    }

    // dari ScriptProcessor (cadangan): sampel mentah → RMS per sub-blok 128
    function analyse(full, hi, sr) {
      const SUB = 128;
      const subMs = (SUB / sr) * 1000;
      for (let o = 0; o + SUB <= hi.length; o += SUB) {
        let eh = 0, ef = 0;
        for (let i = o; i < o + SUB; i++) { eh += hi[i] * hi[i]; ef += full[i] * full[i]; }
        step(Math.sqrt(eh / SUB), Math.sqrt(ef / SUB), subMs);
      }
    }

    // dari AudioWorklet: pasangan [rmsTinggi, rmsPenuh, ...] per render quantum
    function analyseRms(pairs, sub, sr) {
      const subMs = (sub / sr) * 1000;
      for (let i = 0; i + 1 < pairs.length; i += 2) step(pairs[i], pairs[i + 1], subMs);
    }

    function step(rms, frmsRaw, subMs) {
      {
        const frms = frmsRaw + 1e-9;
        const now = performance.now();

        if (pending) {
          pending.age += subMs;
          if (rms > pending.peak) pending.peak = rms;
          if (pending.age >= 70 && pending.age < 70 + subMs) pending.at70 = rms;
          if (!pending.decayed && pending.age >= 130) {
            // jentikan = transien singkat: energi harus sudah turun jauh
            if (pending.at70 < pending.peak * 0.22 && rms < pending.peak * 0.15) pending.decayed = true;
            else pending = null;
          } else if (pending.decayed) {
            // ketikan keyboard = klik beruntun; jentikan = satu bunyi lalu sunyi
            if (rms > pending.peak * 0.35 && rms > prevRms * 1.8) pending = null;
            else if (pending.age >= 380) {
              if (now > cooldownUntil) {
                cooldownUntil = now + 1300;
                setTimeout(() => trigger('jentikan'), 0);
              }
              pending = null;
            }
          }
        } else {
          let before = 0;
          for (let i = 0; i < history.length - 1; i++) if (history[i] > before) before = history[i];
          const onset = rms > Math.max(floor * K, absMin) &&
                        rms > prevRms * 2.2 &&            // naik tajam
                        rms / frms > 0.3 &&               // kaya frekuensi tinggi
                        before < rms * 0.3;               // ±300 ms sebelumnya sunyi (bukan ketikan beruntun)
          if (onset && now > cooldownUntil) pending = { age: 0, peak: rms, at70: rms };
          else floor = floor * 0.996 + Math.min(rms, floor * 4) * 0.004;
          if (floor < 0.0003) floor = 0.0003;
        }
        prevRms = rms;
        history.push(rms);
        if (history.length > 112) history.shift();
      }
    }

    return api;
  })();

  function syncDetector() {
    const want = settings.enabled && settings.soundSnap && processors.size > 0;
    if (want && !detector.running) detector.start();
    else if (!want && detector.running) detector.stop();
  }

  // ---------------------------------------------------------------- WebGL renderer
  const GLSL_COMMON = `
    precision highp float;
    uniform float uSeed;
    uniform float uAspect;
    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
    float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s/0.9375; }
    // 0..1: kapan sebuah sel badan berubah jadi debu
    float dissolve(vec2 cuv, vec2 cell){
      float n = fbm(cuv*vec2(uAspect,1.0)*3.0 + uSeed);
      float dir = 1.0 - cuv.x;
      float r = 0.55*n + 0.45*dir + (hash(cell + uSeed) - 0.5)*0.14;
      return clamp((r - 0.12)/0.76, 0.0, 1.0);
    }
  `;
  const VS_QUAD = `#version 300 es
    out vec2 vUv;
    void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
  const FS_DIFF = `#version 300 es
    precision highp float;
    in vec2 vUv; out vec4 o;
    uniform sampler2D uSrc, uPlate; uniform vec2 uTexel; uniform float uTh;
    float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
    void main(){
      float d = 0.0;
      for (int i=0;i<4;i++){
        vec2 off = (vec2(float(i&1), float(i>>1)) - 0.5) * uTexel * 0.5;
        vec3 a = texture(uSrc, vUv+off).rgb, b = texture(uPlate, vUv+off).rgb;
        float la = lum(a), lb = lum(b);
        float dc = length((a-la) - (b-lb));
        d += 0.75*abs(la-lb) + 1.3*dc;
      }
      d *= 0.25;
      float m = smoothstep(uTh*0.55, uTh*1.45, d);
      o = vec4(m, m, m, 1.0);
    }`;
  const FS_BLUR = `#version 300 es
    precision highp float;
    in vec2 vUv; out vec4 o;
    uniform sampler2D uTex; uniform vec2 uDir;
    const float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    void main(){
      float s = texture(uTex, vUv).r * w[0];
      for (int i=1;i<5;i++){ s += texture(uTex, vUv + uDir*float(i)).r*w[i]; s += texture(uTex, vUv - uDir*float(i)).r*w[i]; }
      o = vec4(s, s, s, 1.0);
    }`;
  const FS_THRESH = `#version 300 es
    precision highp float;
    in vec2 vUv; out vec4 o;
    uniform sampler2D uTex; uniform vec2 uRange;
    void main(){ float m = smoothstep(uRange.x, uRange.y, texture(uTex, vUv).r); o = vec4(m, m, m, 1.0); }`;
  const FS_COMPOSITE = `#version 300 es
    ${GLSL_COMMON}
    in vec2 vUv; out vec4 o;
    uniform sampler2D uLive, uPlate, uSnap, uLiveMask, uSnapMask;
    uniform int uMode; uniform float uTe, uDBody; uniform vec2 uGrid;
    void main(){
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
      vec3 live = texture(uLive, uv).rgb;
      if (uMode == 0) { o = vec4(live, 1.0); return; }
      float lm = texture(uLiveMask, uv).r;
      vec3 base = mix(live, texture(uPlate, uv).rgb, lm);
      if (uMode == 1) { o = vec4(base, 1.0); return; }
      vec2 cell = floor(uv*uGrid);
      vec2 cuv = (cell + 0.5)/uGrid;
      float ti = dissolve(cuv, cell) * uDBody;
      float sm = texture(uSnapMask, uv).r;
      float solid = step(uTe, ti);
      vec3 sc = texture(uSnap, uv).rgb;
      float burn = 1.0 - smoothstep(0.0, 0.35, ti - uTe);
      float g = dot(sc, vec3(0.333));
      sc = mix(sc, vec3(g)*vec3(0.62,0.55,0.5), burn*0.75);
      o = vec4(mix(base, sc, sm*solid), 1.0);
    }`;
  const VS_PARTICLES = `#version 300 es
    ${GLSL_COMMON}
    uniform sampler2D uSnap, uSnapMask;
    uniform vec2 uGrid; uniform float uTe, uDBody, uLife, uCellPx;
    out vec4 vColor; out float vLifeK;
    void main(){
      int gw = int(uGrid.x);
      vec2 cell = vec2(float(gl_VertexID % gw), float(gl_VertexID / gw));
      vec2 cuv = (cell + 0.5)/uGrid;
      float m = textureLod(uSnapMask, cuv, 0.0).r;
      float ti = dissolve(cuv, cell) * uDBody;
      float a = uTe - ti;
      if (m < 0.5 || a < 0.0 || a > uLife) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; vColor = vec4(0.0); vLifeK = 0.0; return; }
      float s1 = hash(cell), s2 = hash(cell + 17.3), s3 = hash(cell + 41.7);
      vec2 wind = vec2(0.20 + 0.28*s1, -0.08 - 0.14*s2);
      vec2 off = wind*a + vec2(0.12, -0.07)*a*a*(0.4 + s3);
      off += 0.03*a*vec2(sin(a*4.0 + s1*6.283 + cuv.y*12.0), cos(a*3.3 + s2*6.283 + cuv.x*9.0));
      vec2 p = cuv + off;
      gl_Position = vec4(p.x*2.0 - 1.0, 1.0 - p.y*2.0, 0.0, 1.0);
      float k = a/uLife;
      vLifeK = k;
      gl_PointSize = uCellPx * mix(1.25, 0.4, k) * (0.7 + 0.6*s3);
      vec3 c = textureLod(uSnap, cuv, 0.0).rgb;
      vec3 ash = vec3(0.34, 0.30, 0.27) * (0.7 + 0.6*s2);
      c = mix(c, ash, smoothstep(0.0, 0.55*uLife, a)*0.8);
      vColor = vec4(c, 1.0 - smoothstep(0.35*uLife, uLife, a));
    }`;
  const FS_PARTICLES = `#version 300 es
    precision highp float;
    in vec4 vColor; in float vLifeK; out vec4 o;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      float sq = max(abs(d.x), abs(d.y));
      float r = mix(sq, length(d), clamp(vLifeK*3.0, 0.0, 1.0));
      if (r > 0.5) discard;
      o = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.38, 0.5, r)*vLifeK));
    }`;

  class Renderer {
    constructor() {
      this.canvas = document.createElement('canvas');
      const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, desynchronized: false });
      if (!gl) throw new Error('WebGL2 tidak tersedia');
      this.gl = gl;
      this.lost = false;
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
      const mk = (vs, fs) => this.program(vs, fs);
      this.pDiff = mk(VS_QUAD, FS_DIFF);
      this.pBlur = mk(VS_QUAD, FS_BLUR);
      this.pThresh = mk(VS_QUAD, FS_THRESH);
      this.pComp = mk(VS_QUAD, FS_COMPOSITE);
      this.pPart = mk(VS_PARTICLES, FS_PARTICLES);
      this.vao = gl.createVertexArray();
      this.texLive = this.texture();
      this.texPlate = this.texture();
      this.texSnap = this.texture();
      this.plateVersion = -1;
      this.w = this.h = 0;
      this.mw = this.mh = 0;
      this.liveMaskFresh = false;
    }
    program(vsSrc, fsSrc) {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    }
    texture() {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return t;
    }
    target(w, h) {
      const gl = this.gl, tex = this.texture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    }
    ensureSize(w, h) {
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      this.canvas.width = w; this.canvas.height = h;
      const mw = 320, mh = Math.max(2, Math.round(320 * h / w));
      this.mw = mw; this.mh = mh;
      this.mA = this.target(mw, mh); this.mB = this.target(mw, mh);
      this.mLive = this.target(mw, mh); this.mSnap = this.target(mw, mh);
      this.gw = Math.min(480, Math.max(60, Math.round(w / 4)));
      this.gh = Math.max(34, Math.round(this.gw * h / w));
      this.liveMaskFresh = false;
    }
    upload(tex, src) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    syncPlate() {
      if (this.plateVersion === plate.version) return;
      this.plateVersion = plate.version;
      if (plate.source) this.upload(this.texPlate, plate.source);
    }
    bindTex(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
    pass(prog, out, setup) {
      const gl = this.gl;
      gl.useProgram(prog.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
      gl.viewport(0, 0, out ? out.w : this.w, out ? out.h : this.h);
      setup(prog.u);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    computeMask(srcTex, dest, blendPrev) {
      const gl = this.gl, tx = 1 / this.mw, ty = 1 / this.mh;
      gl.disable(gl.BLEND);
      this.pass(this.pDiff, this.mA, (u) => {
        this.bindTex(0, srcTex); this.bindTex(1, this.texPlate);
        gl.uniform1i(u.uSrc, 0); gl.uniform1i(u.uPlate, 1);
        gl.uniform2f(u.uTexel, tx, ty); gl.uniform1f(u.uTh, settings.maskThreshold);
      });
      const blur = (from, to, dx, dy) => this.pass(this.pBlur, to, (u) => {
        this.bindTex(0, from.tex); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uDir, dx, dy);
      });
      // tutup lubang + lebarkan masker supaya tidak tersisa garis bayangan badan
      blur(this.mA, this.mB, tx * 1.6, 0); blur(this.mB, this.mA, 0, ty * 1.6);
      this.pass(this.pThresh, this.mB, (u) => { this.bindTex(0, this.mA.tex); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uRange, 0.2, 0.45); });
      blur(this.mB, this.mA, tx * 2.2, 0); blur(this.mA, this.mB, 0, ty * 2.2);
      this.pass(this.pThresh, this.mA, (u) => { this.bindTex(0, this.mB.tex); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uRange, 0.04, 0.3); });
      this.pass(this.pThresh, this.mB, (u) => { this.bindTex(0, this.mA.tex); gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uRange, 0.0, 1.0); });
      blur(this.mB, this.mA, tx * 0.9, 0);
      if (blendPrev) {
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, 0.55);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      }
      blur(this.mA, dest, 0, ty * 0.9);
      gl.disable(gl.BLEND);
    }
    render(src, w, h, mode, snapNow, te) {
      const gl = this.gl;
      this.ensureSize(w, h);
      this.upload(this.texLive, src);
      if (mode > 0) {
        this.syncPlate();
        if (snapNow) { this.upload(this.texSnap, src); this.computeMask(this.texSnap, this.mSnap, false); }
        this.computeMask(this.texLive, this.mLive, this.liveMaskFresh);
        this.liveMaskFresh = true;
      } else this.liveMaskFresh = false;

      const common = (u) => {
        gl.uniform1f(u.uSeed, effect.seed); gl.uniform1f(u.uAspect, w / h);
        gl.uniform2f(u.uGrid, this.gw, this.gh); gl.uniform1f(u.uTe, te); gl.uniform1f(u.uDBody, bodyTime());
      };
      this.pass(this.pComp, null, (u) => {
        this.bindTex(0, this.texLive); this.bindTex(1, this.texPlate); this.bindTex(2, this.texSnap);
        this.bindTex(3, this.mLive.tex); this.bindTex(4, this.mSnap.tex);
        gl.uniform1i(u.uLive, 0); gl.uniform1i(u.uPlate, 1); gl.uniform1i(u.uSnap, 2);
        gl.uniform1i(u.uLiveMask, 3); gl.uniform1i(u.uSnapMask, 4);
        gl.uniform1i(u.uMode, mode); common(u);
      });
      if (mode === 2) {
        const pp = this.pPart;
        gl.useProgram(pp.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        this.bindTex(0, this.texSnap); this.bindTex(1, this.mSnap.tex);
        gl.uniform1i(pp.u.uSnap, 0); gl.uniform1i(pp.u.uSnapMask, 1);
        common(pp.u);
        gl.uniform1f(pp.u.uLife, lifeTime());
        gl.uniform1f(pp.u.uCellPx, w / this.gw);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.POINTS, 0, this.gw * this.gh);
        gl.disable(gl.BLEND);
      }
    }
  }

  // ---------------------------------------------------------------- per-track processor
  const hasMSTP = typeof window.MediaStreamTrackProcessor === 'function';
  const hasMSTG = typeof window.MediaStreamTrackGenerator === 'function';

  class Processor {
    constructor(src) {
      this.src = src;
      this.renderer = null;
      this.effectId = 0;
      this.closed = false;
      this.plateWarned = false;

      if (hasMSTG) {
        this.gen = new MediaStreamTrackGenerator({ kind: 'video' });
        this.writer = this.gen.writable.getWriter();
        this.out = this.gen;
      } else {
        this.sinkCanvas = null; // dibuat bersama renderer
        this.ensureRenderer();
        this.capStream = this.renderer.canvas.captureStream(0);
        this.out = this.capStream.getVideoTracks()[0];
      }
      this.patchOutTrack();
      src.addEventListener('ended', () => this.close());
      processors.add(this);
      syncDetector();
      reportState();
      this.run();
    }

    ensureRenderer() {
      if (this.renderer && !this.renderer.lost) return true;
      try { this.renderer = new Renderer(); return true; }
      catch (err) { lastError = String(err.message || err); LOG('renderer gagal', err); this.renderer = null; return false; }
    }

    patchOutTrack() {
      const src = this.src, out = this.out, self = this;
      const origStop = out.stop.bind(out);
      const def = (name, value) => { try { Object.defineProperty(out, name, { configurable: true, value }); } catch (_) {} };
      def('stop', function () { origStop(); self.close(); });
      def('getSettings', function () { return src.getSettings(); });
      def('getCapabilities', function () { return src.getCapabilities ? src.getCapabilities() : {}; });
      def('getConstraints', function () { return src.getConstraints(); });
      def('applyConstraints', function (c) { return src.applyConstraints(c); });
      try { Object.defineProperty(out, 'label', { configurable: true, get: () => src.label }); } catch (_) {}
      try { out.contentHint = src.contentHint; } catch (_) {}
    }

    async run() {
      if (hasMSTP) {
        const reader = new MediaStreamTrackProcessor({ track: this.src }).readable.getReader();
        this.reader = reader;
        while (!this.closed) {
          let r;
          try { r = await reader.read(); } catch (_) { break; }
          if (r.done) break;
          const frame = r.value;
          try { await this.handle(frame, frame.displayWidth, frame.displayHeight, frame.timestamp); }
          catch (err) { try { frame.close(); } catch (_) {} if (this.closed) break; LOG('frame error', err); }
        }
      } else {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([this.src]);
        await v.play().catch(() => {});
        const loop = async () => {
          if (this.closed) return;
          if (v.videoWidth) await this.handle(v, v.videoWidth, v.videoHeight, performance.now() * 1000).catch(() => {});
          setTimeout(loop, 1000 / 30);
        };
        loop();
      }
      this.close();
    }

    async handle(src, w, h, ts) {
      const now = performance.now();
      if (capture) feedCapture(src, w, h);
      tickEffect(now);

      let mode = 0, te = 0, snapNow = false;
      const ph = effect.phase;
      if (settings.enabled && ph !== 'visible' && plate.source) {
        if (Math.abs(plate.w / plate.h - w / h) > 0.02) {
          if (!this.plateWarned) { this.plateWarned = true; ui.toast('Ukuran kamera berubah. Rekam ulang latar kosong.'); }
        } else if (ph === 'vanished') mode = 1;
        else {
          mode = 2;
          const el = Math.min((now - effect.t0) / 1000, totalTime());
          te = ph === 'vanishing' ? el : totalTime() - el;
          if (this.effectId !== effect.id) { this.effectId = effect.id; snapNow = true; }
        }
      }

      const isFrame = typeof VideoFrame !== 'undefined' && src instanceof VideoFrame;
      if (mode === 0 && hasMSTG && isFrame) {
        await this.writer.write(src); // lolos tanpa diproses: kualitas 100%
        return;
      }
      if (!this.ensureRenderer()) {
        if (hasMSTG && isFrame) await this.writer.write(src);
        return;
      }
      this.renderer.render(src, w, h, mode, snapNow, te);
      if (hasMSTG) {
        const outFrame = new VideoFrame(this.renderer.canvas, { timestamp: ts });
        if (isFrame) src.close();
        await this.writer.write(outFrame);
      } else {
        if (isFrame) src.close();
        this.out.requestFrame && this.out.requestFrame();
      }
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      processors.delete(this);
      try { this.reader && this.reader.cancel(); } catch (_) {}
      try { this.writer && this.writer.close(); } catch (_) {}
      try { this.src.stop(); } catch (_) {}
      try { this.gen && this.gen.stop(); } catch (_) {}
      if (!processors.size && effect.phase !== 'visible') effect.phase = 'visible';
      syncDetector();
      reportState();
    }
  }

  // ---------------------------------------------------------------- the hook
  function wrapStream(stream) {
    const vts = stream.getVideoTracks();
    if (!vts.length) return stream;
    const proc = new Processor(vts[0]);
    return new MediaStream([...stream.getAudioTracks(), proc.out, ...vts.slice(1)]);
  }

  async function getUserMediaHooked(constraints) {
    const stream = await origGUM.call(this, constraints);
    if (!settings.enabled || !constraints || !constraints.video) return stream;
    try { return wrapStream(stream); }
    catch (err) { LOG('tidak bisa membungkus kamera, pakai kamera asli', err); return stream; }
  }
  Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
    configurable: true, writable: true,
    value: function getUserMedia(c) { return getUserMediaHooked.call(this, c); },
  });

  toBridge('hello');
  window.__jentikDebu = { trigger: () => trigger('konsol'), effect, settings, processors };
})();
