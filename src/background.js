/* Jentik Debu — service worker: pintasan keyboard, siaran perintah, status kamera per tab. */

const keyOf = (tabId, frameId) => `${tabId}:${frameId}`;

async function getStates() {
  const { states } = await chrome.storage.session.get('states');
  return states || {};
}

let writeChain = Promise.resolve();
function updateStates(fn) {
  writeChain = writeChain.then(async () => {
    const states = await getStates();
    fn(states);
    await chrome.storage.session.set({ states });
  }).catch(() => {});
  return writeChain;
}

async function broadcast(cmd, extra = {}) {
  const msg = { cmd, id: `${cmd}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...extra };
  const states = await getStates();
  const tabIds = new Set(Object.keys(states).map((k) => Number(k.split(':')[0])));
  if (!tabIds.size) (await chrome.tabs.query({})).forEach((t) => tabIds.add(t.id));
  for (const id of tabIds) chrome.tabs.sendMessage(id, msg).catch(() => {});
  // halaman uji milik ekstensi menerima lewat runtime
  chrome.runtime.sendMessage(msg).catch(() => {});
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'snap') broadcast('snap');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'state' && sender.tab) {
    const k = keyOf(sender.tab.id, sender.frameId || 0);
    updateStates((s) => {
      if (msg.state && msg.state.active > 0) s[k] = { ...msg.state, tabTitle: sender.tab.title || '', at: Date.now() };
      else delete s[k];
    });
  } else if (msg.type === 'broadcast') {
    broadcast(msg.cmd).then(() => sendResponse({ ok: true }));
    return true;
  } else if (msg.type === 'openShortcuts') {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateStates((s) => { for (const k of Object.keys(s)) if (k.startsWith(`${tabId}:`)) delete s[k]; });
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('test/test.html?welcome=1') });
});
