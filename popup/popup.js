const DEFAULTS = { enabled: true, soundSnap: true, sensitivity: 0.6, maskThreshold: 0.11, duration: 3, autoReturn: 0 };
const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };

const setFill = (el) => el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
const fmt = {
  sensitivity: (v) => `${Math.round(v * 100)}%`,
  maskThreshold: (v) => Number(v).toFixed(2),
  duration: (v) => `${Number(v).toFixed(1)} dtk`,
};

async function load() {
  const { settings: s } = await chrome.storage.local.get('settings');
  settings = { ...DEFAULTS, ...(s || {}) };
  $('enabled').checked = settings.enabled;
  $('soundSnap').checked = settings.soundSnap;
  for (const k of ['sensitivity', 'maskThreshold', 'duration']) {
    $(k).value = settings[k];
    setFill($(k));
    $(k + 'Out').textContent = fmt[k](settings[k]);
  }
  $('autoReturn').value = String(settings.autoReturn);
  const cmds = await chrome.commands.getAll();
  const snap = cmds.find((c) => c.name === 'snap');
  $('shortcut').textContent = (snap && snap.shortcut) || 'belum diatur';
}

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.local.set({ settings });
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('soundSnap').addEventListener('change', (e) => save({ soundSnap: e.target.checked }));
for (const k of ['sensitivity', 'maskThreshold', 'duration']) {
  $(k).addEventListener('input', (e) => {
    const v = Number(e.target.value);
    setFill(e.target);
    $(k + 'Out').textContent = fmt[k](v);
    save({ [k]: v });
  });
}
$('autoReturn').addEventListener('change', (e) => save({ autoReturn: Number(e.target.value) }));

const send = (cmd) => chrome.runtime.sendMessage({ type: 'broadcast', cmd });
$('capture').addEventListener('click', () => { send('capture'); window.close(); });
$('snap').addEventListener('click', () => send('snap'));
$('clearPlate').addEventListener('click', async (e) => {
  e.preventDefault();
  await chrome.storage.local.remove('plate');
  send('clearPlate');
  renderStatus();
});
$('openShortcuts').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'openShortcuts' }); });
$('openTest').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('test/test.html') }); });

async function renderStatus() {
  const [{ states }, { plate }] = await Promise.all([chrome.storage.session.get('states'), chrome.storage.local.get('plate')]);
  const now = Date.now();
  const live = Object.values(states || {}).filter((s) => s.active > 0 && now - s.at < 15000);
  const cams = live.length;
  $('camDot').className = 'dot ' + (cams ? 'ok' : '');
  if (cams) {
    const hosts = [...new Set(live.map((s) => s.host))].join(', ');
    const phase = live.find((s) => s.phase !== 'visible');
    $('camText').textContent = phase && phase.phase === 'vanished'
      ? `Kamu sedang tak terlihat 👻 (${hosts})`
      : `Kamera aktif: ${hosts}`;
  } else {
    $('camText').textContent = 'Belum ada kamera aktif. Nyalakan kamera di meeting dulu.';
  }
  const micOff = live.some((s) => s.error === 'mic');
  if (micOff) $('camText').textContent += ' · mikrofon untuk deteksi jentikan ditolak';

  $('plateDot').className = 'dot ' + (plate ? 'ok' : 'warn');
  $('plateText').textContent = plate ? `Latar kosong tersimpan (${plate.w}×${plate.h})` : 'Latar kosong belum direkam';
  $('capture').disabled = !cams;
  $('snap').disabled = !cams || !plate;
}

chrome.storage.onChanged.addListener(renderStatus);
load();
renderStatus();
