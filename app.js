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
  return { seats };
}
const settings = loadSettings();
function save() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* 保存できなくても遊べる */ } }

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
   手札は数字だけ。ペリカンの絵は えさのカードにだけ描く (見分けやすく) */
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
  const sc = Core.scores(G);
  $('#players').innerHTML = P.map((p, i) => {
    const r = ui.result;
    const win = r && r.winner === i;
    let slot = '';
    if (ui.plays && ui.plays[i] != null) {
      slot = ui.plays.revealed ? (r && r.cancelled.includes(ui.plays[i])
        ? handCard(ui.plays[i]).replace('class="hc"', 'class="hc out"') + '<div class="x">✕</div>' : handCard(ui.plays[i]))
        : '<div class="hc back"></div>';
    }
    return `<div class="pl ${win ? (r.value >= 0 ? 'win' : 'lose') : ''}" data-p="${i}" style="--pc:${p.c}">
      ${p.you ? '<div class="you">あなた</div>' : ''}
      <img class="face" src="${face(p.av, p.face)}" alt="">
      <div class="nm">${esc(p.name)}</div>
      <div class="sc">${sc[i]}<small> てん</small></div>
      <div class="slot">${slot}</div></div>`;
  }).join('');
  // 場のえさ (もちこしなら重ねて見せる)
  // 結果を見せている間は、とられる前の えさを出したままにする
  const pot = ui.potShow || G.pot;
  if (pot.length) {
    const html = pot.map((v, k) => foodCard(v, k)).join('');
    if ($('#food').dataset.k !== pot.join(',')) {
      $('#food').dataset.k = pot.join(',');
      $('#food').innerHTML = html;
      $('#food').className = pot.length > 1 ? 'n' + Math.min(pot.length, 4) : '';
      const all = document.querySelectorAll('#food .fc'), top = all[all.length - 1];
      if (top && top.animate) top.animate([{ transform: 'scale(.4) rotate(-12deg)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
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
    return r.cancelled.length ? 'うちけし! えさは もちこし' : 'えさは もちこし';
  }
  const p = P[r.winner];
  const v = r.cards.reduce((s, x) => s + x, 0);
  const f = `<img class="face" style="--pc:${p.c}" src="${face(p.av, p.face)}" alt="">`;
  return v >= 0 ? `${f}${esc(p.name)} パクッ! <span style="color:#ffd35c">+${v}</span>`
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
    ui.plays = null; ui.result = null; ui.potShow = null;
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
    // ふせて出す → いっせいに めくる
    ui.plays = plays.slice(); ui.plays.revealed = false;
    render();
    await sleep(500);
    if (!alive()) return;
    ui.plays.revealed = true;
    ui.potShow = G.pot.slice();
    const r = Core.resolve(G, plays);
    ui.result = r;
    if (r.winner !== null) P[r.winner].face = r.value >= 0 ? 'happy' : 'sad';
    else P.forEach((p, i) => { if (r.cancelled.includes(plays[i])) p.face = 'shock'; });
    render();
    for (const el of document.querySelectorAll('#players .slot .hc')) el.animate && el.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: 260 });
    $('#say').innerHTML = sayHTML(r) + '<span class="tap">タップで つぎへ ▸</span>';
    await readPause(2600);
    if (!alive()) return;
  }
  if (alive()) finish();
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
  const k = await modal(`<h2>${title}</h2><div class="rank">${rows}</div>`, ['もういちど', 'タイトルへ']);
  if (k === 0) newGame(); else { G = null; show('title'); }
}

/* ---------------- ルール ---------------- */
function rules() {
  return modal(`<h2>あそびかた</h2><ol class="rules">
    <li>えさの カードを 1まい めくるよ</li>
    <li>みんな 手札から 1まい えらんで、<b>いっせいに 出す</b></li>
    <li>プラスの えさは、<b>いちばん 大きい数</b>の人が パクッ!</li>
    <li>マイナスの えさは、<b>いちばん 小さい数</b>の人が ひきとる…</li>
    <li><b>おなじ数</b>を出した人は うちけし。のこった人で きめるよ</li>
    <li>みんな うちけしなら、えさは <b>もちこし</b>。つぎの えさと いっしょに とりあう</li>
    <li>15かい やったら おしまい。<b>てんが いちばん 多い人</b>の かち!</li></ol>`, ['わかった']);
}

/* ---------------- ボタン ---------------- */
$('#toSetup').onclick = () => { renderSeats(); show('setup'); };
$('#setupBack').onclick = () => show('title');
$('#start').onclick = () => { if (settings.seats.filter((m) => m !== 'おやすみ').length >= 2) newGame(); };
$('#toRules').onclick = rules;
$('#rulesInGame').onclick = rules;
$('#quit').onclick = async () => {
  const k = await modal('<h2>やめる?</h2><p>いまの ゲームは おしまいに なるよ</p>', ['やめる', 'つづける']);
  if (k === 0) { gameId++; G = null; ui.skip = null; show('title'); }
};

// テストからのぞく入口
window.__app = { get G() { return G; }, get P() { return P; }, ui, settings };

layoutTitle();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
