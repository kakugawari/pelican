/* ぱくぱくペリカン ― 画面と操作。ルールは core.js */
'use strict';
const $ = (q) => document.querySelector(q);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// キャラ (はんにんダンスと同じ 4 人)。色は名札と顔の輪
const CHARS = [
  { av: 'kid', name: 'こども', c: '#3d8bf2' },
  { av: 'cat', name: 'くろねこ', c: '#8058b3' },
  { av: 'fox', name: 'きつね', c: '#3e965f' },
  { av: 'owl', name: 'ふくろう', c: '#a0624e' }
];
// 絵の場所。1 枚の HTML にまとめたとき (テストプレイ用) は、埋め込んだ絵 (window.__IMG) を使う
const pic = (p) => (window.__IMG && window.__IMG[p]) || p;
const face = (av, mood) => pic(`img/f_${av}_${mood || 'normal'}.webp`);
const STORE = 'pelican-v1';
const MODES = ['ひと', 'CPU', 'おやすみ'];

function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
  const seats = ['ひと', 'CPU', 'CPU', 'CPU'];
  // 保存があっても、足りない所は初期値で埋める (CLAUDE.md の落とし穴「初期値は、保存があっても足す」)
  if (s && Array.isArray(s.seats)) s.seats.forEach((m, i) => { if (i < 4 && MODES.includes(m)) seats[i] = m; });
  seats[0] = seats[0] === 'おやすみ' ? 'ひと' : seats[0];
  return { seats, sound: !(s && s.sound === false) };
}
const settings = loadSettings();
function save() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* 保存できなくても遊べる */ } }

/* ---------------- 効果音 (その場で合成する。音の絵は持たない) ---------------- */
let AC = null;
function ac() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
// 1 音。止めるときは値を読まずに予定で落とす (CLAUDE.md の落とし穴「音を止めるとバチッ」)
function tone(f, d, type, v, when, slide) {
  const a = settings.sound && ac(); if (!a) return;
  const t = a.currentTime + (when || 0), o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.15, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.03);
}
function noise(d, v, f, when) {
  const a = settings.sound && ac(); if (!a) return;
  const t = a.currentTime + (when || 0), n = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, n, a.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = f || 2400; g.gain.value = v || 0.12;
  src.connect(bp).connect(g).connect(a.destination); src.start(t);
}
const SFX = {
  tap: () => tone(880, 0.06, 'triangle', 0.08),
  pick: () => tone(660, 0.07, 'triangle', 0.1, 0, 220),
  place: () => noise(0.09, 0.16, 1800),                       // カードを置く「シュッ」
  drum: () => { for (let i = 0; i < 5; i++) noise(0.05, 0.08 + i * 0.02, 900, i * 0.07); },   // めくる前の「ドロロ」
  flip: () => { noise(0.05, 0.2, 3200); tone(1046, 0.08, 'triangle', 0.09, 0.02); },
  reveal: () => { tone(600, 0.25, 'sine', 0.12, 0, 500); },  // 新しいペリカンが出る
  get: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.18, 'triangle', 0.13, i * 0.07)),
  bad: () => { tone(392, 0.35, 'sawtooth', 0.05, 0, -160); tone(294, 0.45, 'sine', 0.1, 0.18, -90); },
  cancel: () => { tone(220, 0.18, 'square', 0.06, 0, 120); tone(330, 0.2, 'square', 0.05, 0.14, -100); },
  carry: () => tone(440, 0.4, 'sine', 0.1, 0, 440),
  win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i > 4 ? 0.5 : 0.2, 'triangle', 0.13, i * 0.11)),
  lose: () => [523, 440, 392, 330].forEach((f, i) => tone(f, 0.35, 'sine', 0.11, i * 0.16))
};
const SND_ON = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SND_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function drawSnd() { const b = $('#snd'); b.innerHTML = settings.sound ? SND_ON : SND_OFF; b.setAttribute('aria-label', settings.sound ? 'おと オン' : 'おと オフ'); b.classList.toggle('off', !settings.sound); }

/* ---------------- 飛ぶカード ---------------- */
// 位置は left/top、動きは transform だけ (CLAUDE.md の落とし穴「置いた直後に要素が一瞬とぶ」)
const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; };
let flights = 0;
function fly(from, to, html, ms, opt) {
  const o = opt || {};
  const f = document.createElement('div'); f.className = 'fly'; f.innerHTML = html;
  f.style.left = from.x + 'px'; f.style.top = from.y + 'px'; f.style.width = (o.w || 48) + 'px'; f.style.height = (o.h || 64) + 'px';
  document.body.appendChild(f);
  const dx = to.x - from.x, dy = to.y - from.y, s0 = o.s0 || 1, s1 = o.s1 || 1;
  if (f.animate) f.animate([
    { transform: `translate(-50%,-50%) scale(${s0}) rotate(${o.rot || -8}deg)` },
    { transform: `translate(calc(-50% + ${dx / 2}px),calc(-50% + ${dy / 2 - (o.arc == null ? 40 : o.arc)}px)) scale(${(s0 + s1) / 2 * 1.08}) rotate(4deg)`, offset: 0.5 },
    { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(${s1}) rotate(0)` }], { duration: ms, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
  flights++;
  return new Promise((r) => setTimeout(() => { f.remove(); r(); }, ms));
}
function bump(el, big) { if (el && el.animate) el.animate([{ transform: 'scale(1)' }, { transform: `scale(${big || 1.35})` }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' }); }

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  // いちばん上に見えている色に合わせる (ホーム画面から開いたときの帯)
  const tc = document.querySelector('meta[name=theme-color]');
  if (tc) tc.content = id === 'title' ? '#0883f2' : '#7fd3f5';
  if (id === 'title') layoutTitle();
}

// タイトルの絵を画面いっぱいに敷く (cover)。当たりは絵と同じ入れ物の中なので、いっしょに動く
const TITLE_W = 853, TITLE_H = 1844;
function layoutTitle() {
  const box = $('#title'), W = box.clientWidth, H = box.clientHeight;
  if (!(W >= 1 && H >= 1)) return;   // 一瞬 0 で渡ってくることがある (CLAUDE.md の落とし穴)
  const k = Math.max(W / TITLE_W, H / TITLE_H), w = TITLE_W * k, h = TITLE_H * k;
  const t = $('#tart');
  t.style.width = w + 'px'; t.style.height = h + 'px';
  t.style.left = (W - w) / 2 + 'px';
  t.style.top = (H - h) * 0.7 + 'px';   // 余りは上を 7 割・下を 3 割切る
}
window.addEventListener('resize', layoutTitle);

/* ---------------- カードの絵 ----------------
   手札は数字だけ。ペリカンの絵は ペリカンのカードにだけ描く (見分けやすく) */
function handCard(n) {
  return `<div class="hc" data-k="${(n - 1) % 5}"><div class="n">${n}</div></div>`;
}
function foodCard(v, k, cls) {
  const neg = v < 0;
  const img = neg ? (k % 2 ? 'm2' : 'm1') : (k % 2 ? 'p2' : 'p1');
  return `<div class="fc ${neg ? 'neg' : ''} ${cls || ''}"><div class="n">${v > 0 ? '+' + v : '−' + -v}</div><img src="${pic(`img/${img}.webp`)}" alt=""></div>`;
}

/* ---------------- だれと あそぶか ---------------- */
function renderSeats() {
  $('#seats').innerHTML = CHARS.map((ch, i) => `
    <div class="seat ${settings.seats[i] === 'おやすみ' ? 'off' : ''}" style="--pc:${ch.c}">
      <img class="face" src="${face(ch.av)}" alt="">
      <div class="nm">${ch.name}</div>
      <div class="seg">${MODES.filter((m) => i > 0 || m !== 'おやすみ').map((m) =>
        `<button data-i="${i}" data-m="${m}" class="${settings.seats[i] === m ? 'on' : ''}">${m}</button>`).join('')}</div>
    </div>`).join('');
  const n = settings.seats.filter((m) => m !== 'おやすみ').length;
  $('#setupNote').textContent = n < 2 ? 'ふたり いじょうで あそぼう' : `${n}にんで あそぶ`;
  $('#start').disabled = n < 2;
  $('#start').style.opacity = n < 2 ? 0.5 : 1;
}
$('#seats').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  settings.seats[+b.dataset.i] = b.dataset.m;
  save();
  renderSeats();
});

/* ---------------- ゲーム ---------------- */
let G = null;        // core の状態
let P = [];          // 遊ぶ人 [{av,name,c,cpu,mood,face}]
const ui = { potShow: null, sel: null, picking: null, plays: null, result: null, skip: null };

function newGame() {
  const act = CHARS.map((ch, i) => ({ ...ch, mode: settings.seats[i] })).filter((p) => p.mode !== 'おやすみ');
  const humans = act.filter((p) => p.mode === 'ひと').length;
  P = act.map((p) => ({
    av: p.av, c: p.c, cpu: p.mode === 'CPU',
    // ひとりで遊ぶときは「あなた」と呼ぶ
    name: p.mode === 'ひと' && humans === 1 ? 'あなた' : p.name,
    you: p.mode === 'ひと' && humans === 1,
    mood: Math.random(), face: 'normal'
  }));
  G = Core.newGame(P.length);
  ui.sel = null; ui.picking = null; ui.plays = null; ui.result = null; ui.potShow = null;
  show('game');
  render();
  loop();
}

function render() {
  if (!G) return;
  $('#round').textContent = `${Math.min(G.round, 15)} / 15 かいめ`;
  const sc = ui.scoreHold || Core.scores(G);
  $('#players').innerHTML = P.map((p, i) => {
    const r = ui.result;
    const win = r && r.winner === i;
    let slot = '';
    if (ui.plays && ui.plays[i] != null && (!ui.landed || ui.landed.has(i))) {
      slot = ui.plays.revealed ? (r && r.cancelled.includes(ui.plays[i])
        ? handCard(ui.plays[i]).replace('class="hc"', 'class="hc out"') + '<div class="x">✕</div>' : handCard(ui.plays[i]))
        : '<div class="hc back"></div>';
    }
    return `<div class="pl ${win ? (r.value >= 0 ? 'win' : 'lose') : ''}" data-p="${i}" style="--pc:${p.c}">
      <img class="face" src="${face(p.av, p.face)}" alt="">
      <div class="nm">${esc(p.name)}</div>
      <div class="sc">${sc[i]}<small> てん</small></div>
      <div class="slot">${slot}</div></div>`;
  }).join('');
  // 場のペリカンのカード (もちこしなら横に並べる)
  // 結果を見せている間は、とられる前の ペリカンを出したままにする
  const pot = ui.potHide ? [] : (ui.potShow || G.pot);
  if (pot.length) {
    const html = pot.map((v, k) => foodCard(v, k)).join('');
    if ($('#food').dataset.k !== pot.join(',')) {
      $('#food').dataset.k = pot.join(',');
      $('#food').innerHTML = html;
      $('#food').className = pot.length > 1 ? 'n' + Math.min(pot.length, 4) : '';
      const all = document.querySelectorAll('#food .fc'), top = all[all.length - 1];
      // 新しいペリカンは、山から くるっと めくれて出る
      if (top && top.animate && !ui.potShow) { top.animate([{ transform: 'translateY(-60px) rotateY(90deg) scale(.6)', opacity: 0 }, { transform: 'translateY(0) rotateY(0) scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' }); SFX.reveal(); }
    }
  } else { $('#food').innerHTML = ''; $('#food').dataset.k = ''; }
  renderHand();
}

function renderHand() {
  const i = ui.picking;
  const who = i != null ? i : P.findIndex((p) => !p.cpu);
  const hand = who >= 0 ? G.hands[who] : [];
  const cells = Core.HAND.map((n) => {
    const has = hand.includes(n);
    return `<div class="cell ${has ? '' : 'used'} ${ui.sel === n && i != null ? 'sel' : ''}" data-n="${n}">${has ? handCard(n) : ''}</div>`;
  }).join('');
  if ($('#hand').dataset.k !== cells) { $('#hand').innerHTML = cells; $('#hand').dataset.k = cells; }
  $('#hand').classList.toggle('wait', i == null);
  const go = $('#go');
  if (i != null && ui.sel != null) { go.hidden = false; $('#infoTxt').textContent = ''; }
  else if (i != null) { go.hidden = true; $('#infoTxt').textContent = ui.hint || ''; }
  else { go.hidden = true; }
}

$('#hand').addEventListener('click', (e) => {
  const c = e.target.closest('.cell:not(.used)');
  if (!c || ui.picking == null) return;
  ui.sel = +c.dataset.n;
  SFX.pick();
  renderHand();
});

// ひとりが 1 まい えらぶのを待つ
function humanPick(i) {
  return new Promise((resolve) => {
    ui.picking = i; ui.sel = null;
    const p = P[i];
    // 案内は決定の帯に 1 行だけ (高さを食わないように)
    ui.hint = p.you ? '↑ カードを 1まい えらんでね' : `↑ ${p.name} の カードを えらんでね`;
    $('#infoTxt').textContent = ui.hint;
    renderHand();
    $('#go').onclick = () => {
      if (ui.sel == null) return;
      const v = ui.sel;
      ui.picking = null; ui.sel = null; $('#go').onclick = null;
      $('#infoTxt').textContent = '';
      renderHand();
      resolve(v);
    };
  });
}

// スマホを次の人へわたす (ひとが 2 人以上のとき)
function passTo(i) {
  const p = P[i];
  return modal(`<img class="big-face" style="--pc:${p.c}" src="${face(p.av)}" alt="">
    <h2>${esc(p.name)} の番</h2><p>スマホを ${esc(p.name)} に わたしてね。<br>ほかの人は 見ないでね!</p>`, [`${esc(p.name)} だよ`]);
}

function modal(html, buttons) {
  return new Promise((resolve) => {
    $('#modalBox').innerHTML = html + `<div class="btns">${buttons.map((b, k) => `<button class="btn ${k ? 'ghost' : ''}" data-k="${k}">${b}</button>`).join('')}</div>`;
    $('#modal').hidden = false;
    $('#modalBox').onclick = (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      $('#modal').hidden = true;
      resolve(+b.dataset.k);
    };
  });
}

// 読む間。タップすれば待たずに次へ
function readPause(ms) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); ui.skip = null; resolve(); };
    const t = setTimeout(done, ms);
    ui.skip = done;
  });
}
$('#field').addEventListener('click', () => { if (ui.skip) ui.skip(); });

function sayHTML(r) {
  if (r.winner === null) {
    // 字を大きくしたので 1 行に収まる長さにする (3 行になると手札にかかった)
    return r.cancelled.length ? 'うちけし! ペリカンは もちこし' : 'ペリカンは もちこし';
  }
  const p = P[r.winner];
  const v = r.cards.reduce((s, x) => s + x, 0);
  const f = `<img class="face" style="--pc:${p.c}" src="${face(p.av, p.face)}" alt="">`;
  return v >= 0 ? `${f}${esc(p.name)} ゲット! <span style="color:#ffd35c">+${v}</span>`
    : `${f}${esc(p.name)} ひきとり… <span style="color:#d9c2ff">−${-v}</span>`;
}

let gameId = 0;
async function loop() {
  const id = ++gameId;
  const alive = () => id === gameId && G;
  const humans = P.map((p, i) => (p.cpu ? -1 : i)).filter((i) => i >= 0);
  while (alive() && !G.over) {
    Core.reveal(G);
    P.forEach((p) => { p.face = 'normal'; });
    ui.plays = null; ui.result = null; ui.potShow = null; ui.potHide = false; ui.scoreHold = null; ui.landed = null;
    const v = Core.potValue(G);
    // もちこしなら、まず「あわせていくつか」を知らせる (場の合計で大きい数か小さい数かが決まる)
    const sub = G.pot.length > 1 ? `<span class="sub">もちこし ${G.pot.length}まい ・ あわせて ${v >= 0 ? '+' + v : '−' + -v}</span>` : '';
    $('#say').innerHTML = sub + (v >= 0 ? '<span style="color:#ffd35c">大きい数</span>の人が もらえる!' : '<span style="color:#d9c2ff">小さい数</span>の人が ひきとる…');
    render();
    await sleep(450);
    if (!alive()) return;
    const plays = new Array(P.length).fill(null);
    for (const i of humans) {
      if (humans.length > 1) { await passTo(i); if (!alive()) return; }
      plays[i] = await humanPick(i);
      if (!alive()) return;
    }
    P.forEach((p, i) => { if (p.cpu) plays[i] = Core.cpuPick(G, i, Math.random, p.mood); });
    // ふせたカードが、出した人の所から 自分の台へ飛んでくる (ひとの手札からは手札の場所から)
    ui.plays = plays.slice(); ui.plays.revealed = false; ui.landed = new Set();
    render();
    await Promise.all(P.map((p, i) => sleep(i * 90).then(() => {
      const slot = document.querySelector(`#players .pl[data-p="${i}"] .slot`);
      const cell = p.you && document.querySelector(`#hand .cell[data-n="${plays[i]}"]`);
      const from = cell ? center(cell) : center(document.querySelector(`#players .pl[data-p="${i}"] .face`));
      SFX.place();
      return fly(from, center(slot), '<div class="hc back"></div>', 330, { s0: cell ? 1.4 : 0.6, arc: cell ? 70 : 24 }).then(() => { ui.landed.add(i); render(); });
    })));
    ui.landed = null;
    if (!alive()) return;
    // せーの… (ドロロ) → いっせいに めくる
    $('#say').innerHTML = 'せーの…';
    SFX.drum();
    await sleep(340);
    if (!alive()) return;
    ui.plays.revealed = true;
    ui.potShow = G.pot.slice();
    ui.scoreHold = Core.scores(G);
    const r = Core.resolve(G, plays);
    ui.result = r;
    if (r.winner !== null) P[r.winner].face = r.value >= 0 ? 'happy' : 'sad';
    else P.forEach((p, i) => { if (r.cancelled.includes(plays[i])) p.face = 'shock'; });
    ui.result = Object.assign({}, r, { winner: null });   // とった人の光は、ペリカンが届いてから
    render();
    SFX.flip();
    document.querySelectorAll('#players .slot .hc').forEach((el, k) => el.animate && el.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: 260, delay: k * 60, fill: 'backwards' }));
    if (r.cancelled.length) setTimeout(() => SFX.cancel(), 300);
    await sleep(r.cancelled.length ? 650 : 380);
    if (!alive()) return;
    if (r.winner !== null) {
      // とったペリカンが、場から その人の所へ飛んでいく。届いたら点がはねる
      const tile = document.querySelector(`#players .pl[data-p="${r.winner}"] .face`);
      const cards = [...document.querySelectorAll('#food .fc')].map((el) => ({ c: center(el), html: el.outerHTML }));
      ui.potHide = true; render();
      await Promise.all(cards.map((k, j) => sleep(j * 90).then(() => fly(k.c, center(tile), k.html, 460, { w: k.c.w, h: k.c.h, s0: 1, s1: 0.28, arc: 60, rot: 0 }))));
      ui.potHide = false; ui.potShow = null; ui.scoreHold = null; ui.result = r;   // とられたペリカンは場に戻さない
      if (!alive()) return;
      render();
      bump(document.querySelector(`#players .pl[data-p="${r.winner}"] .sc`), 1.5);
      (r.value >= 0 ? SFX.get : SFX.bad)();
    } else { ui.scoreHold = null; SFX.carry(); render(); }
    $('#say').innerHTML = sayHTML(r) + '<span class="tap">タップで つぎへ ▸</span>';
    // 結果は動き (ペリカンが飛ぶ・点がはねる) でも見えているので、読む間は 1.9 秒 (前は 2.6 秒)
    await readPause(1900);
    if (!alive()) return;
  }
  if (alive()) finish();
}

// 紙ふぶき (勝ったとき)。CSS で落とすだけで、毎コマ描かない
function confetti() {
  const box = document.createElement('div'); box.className = 'confetti';
  const cols = ['#ffd35c', '#ff8a1f', '#5fc3ee', '#8fd46a', '#f9a6c4', '#bf9cf0'];
  box.innerHTML = Array.from({ length: 36 }, (_, k) => `<i style="left:${(k * 37) % 100}%;background:${cols[k % 6]};animation-delay:${(k % 9) * 0.12}s;animation-duration:${2.2 + (k % 5) * 0.3}s"></i>`).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

async function finish() {
  const sc = Core.scores(G);
  const order = P.map((p, i) => i).sort((a, b) => sc[b] - sc[a]);
  const wins = Core.winners(G);
  wins.forEach((i) => { P[i].face = 'happy'; });
  render();
  let no = 0, prev = null;
  const rows = order.map((i, k) => {
    if (sc[i] !== prev) { no = k + 1; prev = sc[i]; }
    const p = P[i];
    return `<div class="rk ${wins.includes(i) ? 'top' : ''}" style="--pc:${p.c}"><div class="no">${no}</div>
      <img class="face" src="${face(p.av, wins.includes(i) ? 'happy' : 'normal')}" alt=""><div class="nm">${esc(p.name)}</div><div class="pt">${sc[i]}</div></div>`;
  }).join('');
  const title = wins.length > 1 ? 'ひきわけ!' : `${esc(P[wins[0]].name)} の かち!`;
  const me = P.findIndex((p) => p.you);
  const myRank = me >= 0 ? order.findIndex((i) => sc[i] === sc[me]) + 1 : 0;
  (me < 0 || wins.includes(me) ? SFX.win : SFX.lose)();
  if (me < 0 || wins.includes(me)) confetti();
  const big = wins.length === 1 ? `<img class="big-face win" style="--pc:${P[wins[0]].c}" src="${face(P[wins[0]].av, 'happy')}" alt="">` : '';
  const mine = me >= 0 ? `<p class="mine">あなたは <b>${myRank}い</b>${wins.includes(me) ? '!' : ''}</p>` : '';
  const k = await modal(`${big}<h2>${title}</h2>${mine}<div class="rank">${rows}</div>`, ['もういちど', 'タイトルへ']);
  if (k === 0) newGame(); else { G = null; show('title'); }
}

/* ---------------- ルール ---------------- */
function rules() {
  return modal(`<h2>あそびかた</h2><ol class="rules">
    <li>ペリカンの カードを 1まい めくるよ</li>
    <li>みんな 手札から 1まい えらんで、<b>いっせいに 出す</b></li>
    <li>プラスの ペリカンは、<b>いちばん 大きい数</b>の人が ゲット!</li>
    <li>マイナスの ペリカンは、<b>いちばん 小さい数</b>の人が ひきとる…</li>
    <li><b>おなじ数</b>を出した人は うちけし。のこった人で きめるよ</li>
    <li>みんな うちけしなら、ペリカンは <b>もちこし</b>。つぎの ペリカンと いっしょに とりあう</li>
    <li>15かい やったら おしまい。<b>てんが いちばん 多い人</b>の かち!</li></ol>`, ['わかった']);
}

/* ---------------- ボタン ---------------- */
$('#toSetup').onclick = () => { ac(); SFX.tap(); renderSeats(); show('setup'); };
$('#snd').onclick = () => { settings.sound = !settings.sound; save(); drawSnd(); if (settings.sound) { ac(); SFX.tap(); } };
drawSnd();
$('#setupBack').onclick = () => show('title');
$('#start').onclick = () => { if (settings.seats.filter((m) => m !== 'おやすみ').length >= 2) newGame(); };
$('#toRules').onclick = rules;
$('#rulesInGame').onclick = rules;
$('#quit').onclick = async () => {
  const k = await modal('<h2>やめる?</h2><p>いまの ゲームは おしまいに なるよ</p>', ['やめる', 'つづける']);
  if (k === 0) { gameId++; G = null; ui.skip = null; show('title'); }
};

// テストからのぞく入口
window.__app = { get G() { return G; }, get P() { return P; }, ui, settings, get flights() { return flights; } };

layoutTitle();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
