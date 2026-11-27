const $ = (id) => document.getElementById(id);
const TAG = '__jentikDebu';
let stream = null;

if (location.search.includes('welcome')) $('welcome').hidden = false;

const cmd = (c) => window.postMessage({ [TAG]: 1, dir: 'main', type: 'cmd', payload: { cmd: c, id: `${c}-${Date.now()}` } }, '*');

$('start').addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    $('preview').srcObject = stream;
    $('placeholder').hidden = true;
    ['capture', 'snap', 'stop'].forEach((id) => ($(id).disabled = false));
  } catch (err) {
    $('state').textContent = 'Kamera tidak bisa dibuka: ' + err.message;
  }
});
$('stop').addEventListener('click', () => {
  stream && stream.getTracks().forEach((t) => t.stop());
  $('preview').srcObject = null;
  $('placeholder').hidden = false;
  ['capture', 'snap', 'stop'].forEach((id) => ($(id).disabled = true));
});
$('capture').addEventListener('click', () => cmd('capture'));
$('snap').addEventListener('click', () => cmd('snap'));

const PHASE = { visible: 'Terlihat', vanishing: 'Sedang jadi debu…', vanished: 'Tak terlihat 👻', appearing: 'Muncul kembali…' };
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || !d[TAG] || d.dir !== 'bridge' || d.type !== 'state') return;
  const s = d.payload;
  if (!s.active) { $('state').textContent = 'Kamera belum menyala.'; return; }
  $('state').textContent = [
    `Status: ${PHASE[s.phase] || s.phase}`,
    s.hasPlate ? `latar tersimpan ${s.plateW}×${s.plateH}` : 'latar belum direkam',
    s.mic ? 'pendengar jentikan aktif 🎙️' : (s.error === 'mic' ? 'mikrofon ditolak, pakai Alt+Shift+S' : 'pendengar jentikan mati'),
  ].join(' · ');
});
