const $ = s => document.querySelector(s);
const sleep = t => new Promise(r => setTimeout(r, t));

// ---- Filters (CSS filter strings: used for the live preview AND the saved photo)
const F = {
  Normal: 'none',
  Milk: 'brightness(1.1) contrast(.9) saturate(.8)',
  Peach: 'sepia(.25) saturate(1.5) hue-rotate(-12deg) brightness(1.05)',
  Lilac: 'saturate(1.25) hue-rotate(-25deg) brightness(1.1) contrast(.95)',
  Film: 'contrast(1.15) saturate(1.2) sepia(.22)',
  Retro: 'sepia(.6) hue-rotate(-30deg) saturate(1.6) contrast(.95)',
  Dreamy: 'blur(.8px) brightness(1.12) saturate(1.4)',
  Fade: 'contrast(.8) brightness(1.15) saturate(.7) sepia(.1)',
  Vivid: 'saturate(1.8) contrast(1.1)',
  Neon: 'saturate(2.3) contrast(1.2) hue-rotate(-25deg)',
  Frost: 'hue-rotate(160deg) saturate(.9) brightness(1.1)',
  Noir: 'grayscale(1) contrast(1.35)',
  Ghost: 'invert(.9) hue-rotate(180deg)'
};
const FRAMES = ['#FF7EB6', '#C9B3FF', '#A8EBD0', '#FFE27A', '#FFFDF9', '#3B1C5A'];

// Shared settings (filter/frame/layout sync between both devices)
const S = { filter: 'Normal', frame: FRAMES[0], layout: 'strip', mirror: true };
let peer, conn, stream, room = '', host = true, busy = false;
const me = $('#me'), fr = $('#friend'), stage = $('.stage');
const status = t => $('#status').textContent = t;
const send = m => conn && conn.open && conn.send(m);

// ---- UI
$('#filters').innerHTML = Object.keys(F).map(k =>
  `<button data-f="${k}"><i style="filter:${F[k]}"></i>${k}</button>`).join('');
$('#frames').innerHTML = FRAMES.map(c =>
  `<button data-c="${c}" style="background:${c}" aria-label="Frame colour ${c}"></button>`).join('');

function render() {
  [me, fr].forEach(v => v.style.filter = F[S.filter]);
  me.style.transform = S.mirror ? 'scaleX(-1)' : '';
  document.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === S.filter));
  document.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === S.frame));
  document.querySelectorAll('[data-l]').forEach(b => b.classList.toggle('on', b.dataset.l === S.layout));
  $('#mirror').checked = S.mirror;
}
function set(o) { Object.assign(S, o); render(); send({ t: 's', S: o }); }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-f],[data-c],[data-l]');
  if (b) set(b.dataset.f ? { filter: b.dataset.f } : b.dataset.c ? { frame: b.dataset.c } : { layout: b.dataset.l });
});
$('#mirror').onchange = e => { S.mirror = e.target.checked; render(); };

// ---- Camera
async function enter() {
  try {
    stream = stream || await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1200 } }, audio: false
    });
  } catch (e) {
    $('#msg').textContent = 'Camera blocked. Allow camera access (the page must be on https) and try again.';
    return false;
  }
  me.srcObject = stream;
  $('#lobby').hidden = true; $('#booth').hidden = false;
  render();
  return true;
}

// ---- Two-device connection (WebRTC through the free PeerJS broker)
const newCode = () => [...Array(5)].map(() => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');

function showFriend(s) {
  fr.srcObject = s; fr.hidden = false; stage.classList.add('duo');
  status('Connected · room ' + room);
}

function wire(c) {
  conn = c;
  const hello = () => {
    status('Connected · room ' + room);
    if (host) send({ t: 's', S: { filter: S.filter, frame: S.frame, layout: S.layout } });
  };
  c.open ? hello() : c.on('open', hello);
  c.on('data', d => {
    if (d.t === 's') { Object.assign(S, d.S); render(); }
    if (d.t === 'go') run();
  });
  c.on('close', () => {
    conn = null; fr.hidden = true; stage.classList.remove('duo');
    status(host ? `Friend left · room ${room} is still open` : 'The host left the room');
  });
}

async function create() {
  if (!await enter()) return;
  room = newCode();
  status('Opening room…');
  peer = new Peer('pb-' + room);
  peer.on('open', () => { status(`Room ${room} · waiting for a friend`); $('#invite').hidden = false; });
  peer.on('error', e => e.type === 'unavailable-id' ? (peer.destroy(), create()) : status('Connection problem: ' + e.type));
  peer.on('connection', c => { if (conn && conn.open) return c.close(); wire(c); });
  peer.on('call', c => { c.answer(stream); c.on('stream', showFriend); });
}

async function join(id) {
  id = id.trim().toUpperCase();
  if (!id) return;
  host = false;
  if (!await enter()) return;
  room = id; stage.classList.add('guest');
  status('Joining room ' + id + '…');
  peer = new Peer();
  peer.on('open', () => {
    wire(peer.connect('pb-' + id, { reliable: true }));
    peer.call('pb-' + id, stream).on('stream', showFriend);
  });
  peer.on('error', e => status(e.type === 'peer-unavailable' ? 'No room with that code.' : 'Connection problem: ' + e.type));
}

$('#solo').onclick = enter;
$('#create').onclick = create;
$('#join').onclick = () => join($('#code').value);
$('#code').onkeydown = e => e.key === 'Enter' && join(e.target.value);
$('#invite').onclick = async () => {
  const url = location.origin + location.pathname + '?room=' + room;
  try {
    navigator.share ? await navigator.share({ title: 'Pairbooth', url }) : await navigator.clipboard.writeText(url);
    $('#invite').textContent = 'Link copied';
  } catch {}
};
const q = new URLSearchParams(location.search).get('room');
if (q) $('#code').value = q.slice(0, 5);

// ---- Taking photos (either person can press the button; both countdowns start together)
$('#shoot').onclick = () => { send({ t: 'go' }); run(); };

async function run() {
  if (busy || !stream) return;
  busy = true; $('#shoot').disabled = true;
  const n = S.layout === 'single' ? 1 : 4, shots = [];
  for (let i = 0; i < n; i++) {
    for (let c = 3; c > 0; c--) { $('#count').textContent = c; await sleep(1000); }
    $('#count').textContent = '';
    $('#flash').classList.add('on');
    shots.push(grab());
    setTimeout(() => $('#flash').classList.remove('on'), 120);
    await sleep(700);
  }
  build(shots);
  busy = false; $('#shoot').disabled = false;
}

// One shot = both cameras side by side (host on the left on both devices)
function grab() {
  const vs = conn && !fr.hidden ? (host ? [me, fr] : [fr, me]) : [me];
  const W = 480, H = 600, c = document.createElement('canvas');
  c.width = W * vs.length; c.height = H;
  const x = c.getContext('2d');
  vs.forEach((v, i) => {
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw) return;
    const s = Math.max(W / vw, H / vh), sw = W / s, sh = H / s, flip = v === me && S.mirror;
    x.save();
    x.filter = F[S.filter];
    x.translate(i * W + (flip ? W : 0), 0);
    if (flip) x.scale(-1, 1);
    x.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
    x.restore();
  });
  return c;
}

function build(sh) {
  const grid = S.layout === 'grid', cols = grid ? 2 : 1, rows = grid ? 2 : sh.length;
  const tw = 600, th = tw * sh[0].height / sh[0].width, p = 36, foot = 100;
  const cv = $('#out'), x = cv.getContext('2d');
  cv.width = cols * tw + (cols + 1) * p;
  cv.height = rows * th + (rows + 1) * p + foot;
  x.fillStyle = S.frame; x.fillRect(0, 0, cv.width, cv.height);
  sh.forEach((s, i) => x.drawImage(s, p + (i % cols) * (tw + p), p + (i / cols | 0) * (th + p), tw, th));
  x.fillStyle = S.frame === '#3B1C5A' ? '#FFFDF9' : '#3B1C5A';
  x.font = "44px 'Bagel Fat One', sans-serif"; x.textAlign = 'center';
  x.fillText('Pairbooth · ' + new Date().toLocaleDateString(), cv.width / 2, cv.height - p - 6);
  $('#dl').href = cv.toDataURL('image/png');
  $('#result').showModal();
}
$('#again').onclick = () => $('#result').close();
