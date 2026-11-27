/*
 * Jentik Debu — jembatan (isolated world).
 * Menyambungkan skrip halaman (inject.js) dengan penyimpanan ekstensi,
 * popup, dan pintasan keyboard.
 */
(() => {
  'use strict';
  if (window.__jentikDebuBridge) return;
  window.__jentikDebuBridge = true;
  const TAG = '__jentikDebu';

  const alive = () => { try { return !!chrome.runtime.id; } catch (_) { return false; } };
  const toMain = (type, payload) => window.postMessage({ [TAG]: 1, dir: 'main', type, payload }, '*');

  async function pushAll() {
    if (!alive()) return;
    try { toMain('assets', { worklet: chrome.runtime.getURL('src/snap-worklet.js') }); } catch (_) {}
    try {
      const { settings, plate } = await chrome.storage.local.get(['settings', 'plate']);
      toMain('settings', settings || {});
      if (plate) toMain('plate', plate);
    } catch (_) {}
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || !d[TAG] || d.dir !== 'bridge' || !alive()) return;
    try {
      if (d.type === 'hello') pushAll();
      else if (d.type === 'savePlate') chrome.storage.local.set({ plate: d.payload });
      else if (d.type === 'state') chrome.runtime.sendMessage({ type: 'state', state: d.payload }).catch(() => {});
    } catch (_) {}
  });

  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.settings) toMain('settings', ch.settings.newValue || {});
      if (ch.plate) toMain('plate', ch.plate.newValue || null);
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.cmd) toMain('cmd', msg);
    });
  } catch (_) {}

  pushAll();
})();
