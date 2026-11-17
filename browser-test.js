/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * ★ アプリを作ったら「ここにアプリごとの確認を足す」に書き足すこと。
 *   直した不具合には、かならず見張り役をここに置く。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) {
  console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m');
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/**
 * 何かした直後に、その要素が本来の場所からどれだけずれるかを
 * 1 フレームずつ測る。「置いた瞬間に一瞬とぶ」たぐいの不具合はこれで見つかる。
 *
 * @returns {Promise<number>} 最大のずれ (px)
 */
function measureJump(page, selector, act) {
  return page.evaluate(async ({ sel, code }) => {
    const before = document.querySelector(sel).getBoundingClientRect();
    // eslint-disable-next-line no-new-func
    new Function(code)();
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const el = document.querySelector(sel);
      if (!el) { worst = Infinity; break; }
      const now = el.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(now.left - before.left), Math.abs(now.top - before.top));
    }
    return Math.round(worst);
  }, { sel: selector, code: act });
}

async function run() {
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    section('スマホで開く');
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.goto(URL, { waitUntil: 'load' });
    ok(true, 'ページが開く');

    const fit = await phone.evaluate(() => ({
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.title.trim(),
      painted: document.body.innerText.trim().length + document.querySelectorAll('canvas, svg, img').length
    }));
    ok(fit.wide <= 1, 'スマホ幅で横スクロールが出ない');
    ok(fit.title.length > 0, `ページの名前 (title) がある (${fit.title})`);
    ok(fit.painted > 0, '画面に何か出ている (真っ白ではない)');

    // ホーム画面から開いたとき、時計や電池の帯の下まで描く指定がそろっている
    // (無いと、画面のいちばん上が theme-color の板になる。帯そのものは実機でしか見られない)
    const bar = await phone.evaluate(() => {
      const meta = (n) => (document.querySelector(`meta[name="${n}"]`) || {}).content || '';
      return {
        capable: meta('apple-mobile-web-app-capable'),
        style: meta('apple-mobile-web-app-status-bar-style'),
        cover: /viewport-fit=cover/.test(meta('viewport')),
        theme: meta('theme-color')
      };
    });
    ok(bar.capable === 'yes' && bar.style === 'black-translucent' && bar.cover,
      `ホーム画面から開くと帯の下まで描く指定がある (${JSON.stringify(bar)})`);
    ok(/^#[0-9a-f]{6}$/i.test(bar.theme), `帯の色 (theme-color) が決めてある (${bar.theme})`);

    // ------------------------------------------------ ここにアプリごとの確認を足す
    section('アプリの操作 (ぱくぱくペリカン)');
    {
      // タイトルは絵 1 枚。絵に描いたボタンの上に透明な当たりがあり、指で押すとその当たりに届く (ふつうの高さと低い高さ)
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
      const pg = await ctx.newPage();
      await pg.goto(URL, { waitUntil: 'load' });
      for (const H of [932, 780]) {
        await pg.setViewportSize({ width: 430, height: H });
        await pg.waitForTimeout(100);
        const hits = await pg.evaluate(() => ['#toSetup', '#toRules'].map((q) => {
          const r = document.querySelector(q).getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          return { q, in: r.top >= 0 && r.bottom <= innerHeight, top: document.elementFromPoint(x, y) === document.querySelector(q) };
        }));
        ok(hits.every((h) => h.in && h.top), `高さ ${H}: タイトルの「あそぶ」「ルール」が画面の中にあり、押すと届く`);
      }
      await pg.locator('#toRules').tap();
      ok(/あそびかた/.test(await pg.locator('#modal h2').textContent()), 'タイトルの「ルール」で あそびかたが出る');
      await ctx.close();
    }
    {
      // 乱数を決め打ちにして、毎回おなじ配り方で試す (CLAUDE.md の落とし穴「配り方で道すじが分かれる」)
      const seeded = async (seed, seats) => {
        const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => errors.push('ゲーム: ' + e.message));
        await pg.addInitScript(({ seed, seats }) => {
          let a = seed >>> 0;
          Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
          if (seats) localStorage.setItem('pelican-v1', JSON.stringify({ seats }));
        }, { seed, seats });
        await pg.goto(URL, { waitUntil: 'load' });
        await pg.locator('#toSetup').tap();
        await pg.locator('#start').tap();
        return { ctx, pg };
      };
      const waitPick = (pg) => pg.waitForFunction(() => window.__app.ui.picking != null || !document.querySelector('#modal').hidden, null, { timeout: 8000 });

      // ひとり + CPU 3 人で 15 回あそぶ。読む間はタップで進める
      const { ctx, pg } = await seeded(5, ['ひと', 'CPU', 'CPU', 'CPU']);
      await waitPick(pg);
      const goHidden = await pg.evaluate(() => getComputedStyle(document.querySelector('#go')).display);
      ok(goHidden === 'none', `カードをえらぶまで「これを 出す」は出さない (${goHidden})`);
      // 15 まいの手札が、送らずに全部 画面の中に見える。安全域 (上59・下34) を差し込んでも はみ出さない
      const fit = await pg.evaluate(() => {
        const cells = [...document.querySelectorAll('#hand .cell')].map((c) => c.getBoundingClientRect());
        const g = document.querySelector('#game');
        g.style.paddingTop = '69px'; g.style.paddingBottom = '44px';
        const info = document.querySelector('#info').getBoundingClientRect(), food = document.querySelector('#food .fc').getBoundingClientRect();
        const say = document.querySelector('#say').getBoundingClientRect(), pl = document.querySelector('#players').getBoundingClientRect();
        const hand = document.querySelector('#hand').getBoundingClientRect();
        const r = { n: cells.length, inside: cells.every((b) => b.top >= 0 && b.bottom <= 932 && b.left >= 0 && b.right <= 430),
          bottom: Math.round(info.bottom), over: g.scrollHeight - g.clientHeight, gap: Math.round(food.top - pl.bottom), gap2: Math.round(hand.top - say.bottom),
          fw: Math.round(food.width), fh: Math.round(food.height) };
        g.style.paddingTop = ''; g.style.paddingBottom = '';
        return r;
      });
      ok(fit.n === 15 && fit.inside, `手札 15 まいが 画面の中に見える (${fit.n} まい)`);
      ok(fit.over <= 0 && fit.bottom <= 932 - 34 + 1 && fit.gap >= 0 && fit.gap2 >= 0,
        `安全域を入れても はみ出さず、えさが 人のタイルにも手札にも重ならない (下 ${fit.bottom}pt / あまり ${fit.over} / すき間 上 ${fit.gap}pt・下 ${fit.gap2}pt)`);
      // えさのカードそのものの大きさを見る (高さが足りないと flex で縦につぶれ、すき間だけ見る見張りは通っていた)
      ok(fit.fw === 128 && fit.fh === 166, `安全域を入れても えさのカードが つぶれない (${fit.fw}x${fit.fh}pt / 決めた大きさ 128x166)`);
      // テストプレイ (Claude の中で開く) は画面が低い。そこでは形を保ったまま 小さくなり、重ならない
      await pg.setViewportSize({ width: 430, height: 780 });
      const low = await pg.evaluate(() => {
        const r = (q) => document.querySelector(q).getBoundingClientRect();
        const f = r('#food .fc'), pl = r('#players'), say = r('#say'), hand = r('#hand');
        return { ratio: +(f.width / f.height).toFixed(3), h: Math.round(f.height), up: Math.round(f.top - pl.bottom), down: Math.round(hand.top - say.bottom) };
      });
      ok(Math.abs(low.ratio - 128 / 166) < 0.01 && low.h >= 100 && low.up >= 0 && low.down >= 0,
        `高さ 780 でも えさのカードは形を保って小さくなり (${low.h}pt / 縦横比 ${low.ratio})、タイルと手札に重ならない (すき間 ${low.up}・${low.down}pt)`);
      await pg.setViewportSize({ width: 430, height: 932 });

      let rounds = 0, seen = [];
      for (let k = 0; k < 40 && rounds < 15; k++) {
        if (!(await pg.evaluate(() => document.querySelector('#modal').hidden))) break;
        const n = await pg.evaluate(() => window.__app.G.hands[0][0]);
        await pg.locator(`#hand .cell[data-n="${n}"]`).tap();
        await pg.locator('#go').tap();
        rounds++;
        // めくったあと: 出したカードが 4 人ぶん見え、手札から消えている
        await pg.waitForFunction(() => window.__app.ui.plays && window.__app.ui.plays.revealed, null, { timeout: 4000 });
        seen.push(await pg.evaluate((n) => ({ shown: document.querySelectorAll('#players .slot .hc:not(.back)').length,
          gone: !!document.querySelector(`#hand .cell.used[data-n="${n}"]`), say: document.querySelector('#say').textContent }), n));
        await pg.locator('#field').tap({ position: { x: 20, y: 20 } });
        await pg.waitForFunction(() => window.__app.ui.picking != null || !document.querySelector('#modal').hidden, null, { timeout: 8000 });
      }
      ok(rounds === 15, `15 回 カードを出せる (${rounds} 回)`);
      ok(seen.every((s) => s.shown === 4 && s.gone), '毎回 4 人ぶんのカードが表に出て、出したカードは手札から消える');
      ok(seen.some((s) => /パクッ|ひきとった/.test(s.say)), `だれが とったかを知らせる (${seen[0] && seen[0].say.slice(0, 20)})`);
      const end = await pg.evaluate(() => {
        const G = window.__app.G, sc = Core.scores(G);
        const rows = [...document.querySelectorAll('#modal .rk .pt')].map((e) => +e.textContent);
        return { modal: !document.querySelector('#modal').hidden, rows, sc: sc.slice().sort((a, b) => b - a), left: G.hands.flat().length };
      });
      ok(end.modal && end.left === 0 && JSON.stringify(end.rows) === JSON.stringify(end.sc),
        `おわると 順位が出て、てんが ゲームの記録と合う (${end.rows.join(' / ')})`);
      await ctx.close();
    }
    {
      // もちこし: みんな打ち消しのあと、えさを重ねて「もちこし」と出す
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
      const pg = await ctx.newPage();
      await pg.addInitScript(() => localStorage.setItem('pelican-v1', JSON.stringify({ seats: ['ひと', 'CPU', 'おやすみ', 'おやすみ'] })));
      await pg.goto(URL, { waitUntil: 'load' });
      await pg.locator('#toSetup').tap();
      await pg.locator('#start').tap();
      await pg.waitForFunction(() => window.__app.ui.picking != null);
      // CPU に こちらと同じ数を出させる
      await pg.evaluate(() => { window.__realPick = Core.cpuPick; Core.cpuPick = () => 7; });
      await pg.locator('#hand .cell[data-n="7"]').tap();
      await pg.locator('#go').tap();
      await pg.waitForFunction(() => window.__app.ui.result);
      const tie = await pg.evaluate(() => ({ say: document.querySelector('#say').textContent, x: document.querySelectorAll('#players .x').length }));
      ok(/もちこし/.test(tie.say) && tie.x === 2, `同じ数は ✕ で打ち消し、えさは もちこし (${tie.say.slice(0, 22)} / ✕ ${tie.x})`);
      await pg.evaluate(() => { Core.cpuPick = window.__realPick; });
      await pg.locator('#field').tap({ position: { x: 20, y: 20 } });
      await pg.waitForFunction(() => window.__app.ui.picking != null);
      // もちこしのえさは横に並べ、どのカードも ほかと重ならずに全部見える (重ねていたら後ろのカードが隠れた)
      const look = async () => pg.evaluate(() => {
        const ov = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
        const cs = [...document.querySelectorAll('#food .fc')].map((e) => e.getBoundingClientRect());
        const pl = document.querySelector('#players').getBoundingClientRect(), say = document.querySelector('#say').getBoundingClientRect();
        return { n: cs.length, hit: cs.some((a, i) => cs.some((b, j) => i < j && ov(a, b))),
          inside: cs.every((c) => c.left >= 0 && c.right <= 430 && c.top >= pl.bottom && c.bottom <= say.top),
          h: Math.round(cs[0].height), say: document.querySelector('#say').textContent };
      });
      const carry = await look();
      ok(carry.n === 2 && !carry.hit && carry.inside && carry.h >= 100,
        `もちこしの えさ 2 まいが 横に並び、重ならずに見える (${carry.n} まい・高さ ${carry.h}pt)`);
      ok(/あわせて/.test(carry.say), `もちこしのときは あわせた数を知らせる (${carry.say.slice(0, 24)})`);
      await pg.setViewportSize({ width: 430, height: 780 });
      const carryLow = await look();
      ok(!carryLow.hit && carryLow.inside, `高さ 780 でも もちこしの えさが タイルや字に かからない (高さ ${carryLow.h}pt)`);
      await pg.setViewportSize({ width: 430, height: 932 });
      await ctx.close();
    }
    {
      // みんなで: ひとが 2 人なら、スマホを わたす知らせをはさみ、その人の手札を出す
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
      const pg = await ctx.newPage();
      await pg.addInitScript(() => localStorage.setItem('pelican-v1', JSON.stringify({ seats: ['ひと', 'ひと', 'CPU', 'おやすみ'] })));
      await pg.goto(URL, { waitUntil: 'load' });
      await pg.locator('#toSetup').tap();
      await pg.locator('#start').tap();
      const pass1 = await pg.locator('#modal h2').textContent({ timeout: 4000 });
      await pg.locator('#modal button').first().tap();
      await pg.locator('#hand .cell[data-n="15"]').tap();
      await pg.locator('#go').tap();
      const pass2 = await pg.locator('#modal h2').textContent({ timeout: 4000 });
      await pg.locator('#modal button').first().tap();
      const fresh = await pg.evaluate(() => !document.querySelector('#hand .cell.used') && window.__app.ui.picking === 1);
      ok(/こども/.test(pass1) && /くろねこ/.test(pass2) && fresh,
        `ひとが 2 人のとき、わたす知らせ (${pass1} → ${pass2}) のあと その人の手札 (15 まい) が出る`);
      await ctx.close();
    }
    {
      // えらんだ席は覚えておく。前の版の保存 (足りない・おかしな値) でも開ける
      const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
      const pg = await ctx.newPage();
      await pg.goto(URL, { waitUntil: 'load' });
      await pg.locator('#toSetup').tap();
      await pg.locator('.seat:nth-child(4) button[data-m="おやすみ"]').tap();
      await pg.reload();
      await pg.locator('#toSetup').tap();
      const kept = await pg.locator('.seat:nth-child(4) button.on').textContent();
      await pg.evaluate(() => localStorage.setItem('pelican-v1', JSON.stringify({ seats: ['おやすみ', 'ひと'] })));
      await pg.reload();
      await pg.locator('#toSetup').tap();
      const merged = await pg.evaluate(() => [...document.querySelectorAll('.seat button.on')].map((b) => b.textContent));
      ok(kept === 'おやすみ', `えらんだ席を 開き直しても 覚えている (${kept})`);
      ok(merged.join() === 'ひと,ひと,CPU,CPU', `古い保存でも 足りない席を うめて開ける (${merged.join(' / ')})`);
      await ctx.close();
    }

    // ------------------------------------------------ 明るい画面・暗い画面
    section('明るい画面と暗い画面');
    for (const scheme of ['light', 'dark']) {
      const themed = await browser.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
      const page = await themed.newPage();
      page.on('pageerror', (e) => errors.push(scheme + ': ' + e.message));
      await page.goto(URL, { waitUntil: 'load' });
      const colors = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        fg: getComputedStyle(document.body).color
      }));
      ok(colors.bg !== colors.fg, `${scheme}: 文字と背景の色が違う (${colors.bg} / ${colors.fg})`);
      await themed.close();
    }

    // ------------------------------------------------ アイコン (用意していれば)
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const apple = await desk.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    // 対象は iPhone のホーム画面から開く使い方なので、無ければとばさずに落とす
    // (とばしにしていたら、れんだメーターでアイコンが無いまま公開した。CLAUDE.md の落とし穴)
    ok(!!apple, 'ホーム画面用のアイコン (apple-touch-icon) の指定がある');
    if (apple) {
      // iOS は SVG のアイコンを使えない
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
      const res = await desk.request.get(URL + apple.replace('./', ''));
      ok(res.ok(), `${apple} が配信される`);
    }

    // ------------------------------------------------ 更新とオフライン (sw.js があれば)
    section('更新とオフライン');
    if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
      skip('サービスワーカーはまだ無い (オフライン対応するときに用意する)');
    } else {
      const swCtx = await browser.newContext();
      const swPage = await swCtx.newPage();
      await swPage.goto(URL, { waitUntil: 'load' });
      ok(await swPage.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)),
        'サービスワーカーが動く');
      await swPage.waitForTimeout(800);

      // 直したものが 1 回のリロードで出るか (キャッシュ優先だと古い画面が出る)
      const indexPath = path.join(ROOT, 'index.html');
      const original = fs.readFileSync(indexPath, 'utf8');
      // 画面を JS で描くアプリもあるので、<h1> ではなく <title> を書き換えて見る
      const marker = original.match(/<title[^>]*>([^<]*)<\/title>/);
      fs.writeFileSync(indexPath, original.replace(marker[0], '<title>こうしんかくにん</title>'));
      await swPage.reload();
      await swPage.waitForTimeout(400);
      const title = await swPage.title();
      fs.writeFileSync(indexPath, original);
      ok(title.trim() === 'こうしんかくにん', `直したものが 1 回のリロードで出る (${title.trim()})`);

      await swPage.reload();
      await swPage.waitForTimeout(500);
      await swCtx.setOffline(true);
      await swPage.reload().catch(() => {});
      await swPage.waitForTimeout(400);
      // 画面が絵だけで字が無いアプリもあるので、字の量ではなくページの名前で見る (はんにんダンスで踏んだ)
      ok(await swPage.evaluate(() => document.title.length > 0 && document.body.children.length > 0).catch(() => false),
        'ネットにつながらなくても開ける');
      await swCtx.setOffline(false);
    }

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
