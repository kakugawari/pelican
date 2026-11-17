/*!
 * core.js — ぱくぱくペリカン のルール。DOM を触らないので node でテストできる。
 *
 * ブラウザでは <script> で読み込むと window.Core になり、node からは require() できる。
 *
 * ルール:
 *  - 手札は 1 人 1〜15 の 15 まい。えさのカードは +1〜+10 と -1〜-5 の 15 まい
 *  - えさを 1 まいめくり、みんな いっせいに手札を 1 まい出す
 *  - えさがプラスなら いちばん大きい数の人が、マイナスなら いちばん小さい数の人が とる
 *  - 同じ数を出した人どうしは 打ち消し。残った人で決める
 *  - だれも残らなければ、えさは つぎへ もちこし (つぎのえさと いっしょに取りあう)
 *  - もちこしのときは、場のえさの合計で プラスかマイナスかを決める (合計 0 はプラスあつかい)
 *  - 15 回で おしまい。もらった えさの合計が いちばん多い人の勝ち
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HAND = Array.from({ length: 15 }, (_, i) => i + 1);
  const FOOD = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  /** 決まった順番で数を出す乱数 (mulberry32)。同じ seed からは同じ並びになる */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(array, rng) {
    const random = rng || Math.random;
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = array[i]; array[i] = array[j]; array[j] = t;
    }
    return array;
  }

  const sum = (a) => a.reduce((s, v) => s + v, 0);

  /** 新しいゲーム。n は 2〜4 人 */
  function newGame(n, rng) {
    if (!(n >= 2 && n <= 4)) throw new Error('人数は 2〜4 人');
    return {
      n,
      hands: Array.from({ length: n }, () => HAND.slice()),
      deck: shuffle(FOOD.slice(), rng),
      pot: [],          // 場に出ている えさ (もちこしなら 2 まい以上)
      taken: Array.from({ length: n }, () => []),
      round: 0,         // めくった回数
      over: false
    };
  }

  /** えさを 1 まい めくって場に足す。めくったカードを返す */
  function reveal(g) {
    if (g.over || !g.deck.length) throw new Error('めくる えさが無い');
    const c = g.deck.shift();
    g.pot.push(c);
    g.round++;
    return c;
  }

  /** 場のえさの合計。プラス (0 をふくむ) なら大きい数が、マイナスなら小さい数がとる */
  function potValue(g) { return sum(g.pot); }
  function wantsHigh(g) { return potValue(g) >= 0; }

  /**
   * だれがとるかを決める (手札や場は変えない)。
   * plays[i] は i 番の人が出した数。
   * @returns {{winner: number|null, cancelled: number[]}} cancelled は打ち消しになった数
   */
  function judge(plays, high) {
    const count = new Map();
    for (const v of plays) count.set(v, (count.get(v) || 0) + 1);
    const cancelled = [...count].filter(([, c]) => c > 1).map(([v]) => v).sort((a, b) => a - b);
    let winner = null;
    plays.forEach((v, i) => {
      if (count.get(v) > 1) return;
      if (winner === null || (high ? v > plays[winner] : v < plays[winner])) winner = i;
    });
    return { winner, cancelled };
  }

  /**
   * みんなが出した数で 1 回を終える。出したカードは手札から消える。
   * @returns {{winner, cancelled, cards, value, carried}}
   *   cards: とった えさ (もちこしなら空) / carried: もちこしになったか
   */
  function resolve(g, plays) {
    if (plays.length !== g.n) throw new Error('全員ぶんの数が要る');
    plays.forEach((v, i) => {
      const k = g.hands[i].indexOf(v);
      if (k < 0) throw new Error(`${i} 番の人は ${v} を持っていない`);
    });
    plays.forEach((v, i) => g.hands[i].splice(g.hands[i].indexOf(v), 1));
    const value = potValue(g);
    const { winner, cancelled } = judge(plays, value >= 0);
    let cards = [];
    if (winner !== null) {
      cards = g.pot.slice();
      g.taken[winner].push(...cards);
      g.pot = [];
    }
    if (!g.deck.length) g.over = true;   // 最後のもちこしは だれのものにもならない
    return { winner, cancelled, cards, value, carried: winner === null };
  }

  function scores(g) { return g.taken.map(sum); }

  /** 勝った人 (同点なら全員) */
  function winners(g) {
    const s = scores(g), best = Math.max(...s);
    return s.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
  }

  /**
   * コンピュータの出す数。場のえさが大きいほど大きい手札を、
   * マイナスが大きいほど (いちばん小さくならないよう) 中くらいより上を出す。
   * mood は 0〜1 の性格 (大きいほど強気)
   */
  function cpuPick(g, i, rng, mood) {
    const random = rng || Math.random;
    const hand = g.hands[i].slice().sort((a, b) => a - b);
    if (hand.length === 1) return hand[0];
    const v = potValue(g);
    const m = mood == null ? 0.5 : mood;
    let t;   // 0 (いちばん小さい) 〜 1 (いちばん大きい)
    if (v >= 0) t = Math.min(1, v / 12 + (m - 0.5) * 0.3);
    else t = Math.min(1, 0.25 + (-v) / 8 + (m - 0.5) * 0.2);
    t += (random() - 0.5) * 0.35;
    t = Math.max(0, Math.min(1, t));
    return hand[Math.round(t * (hand.length - 1))];
  }

  return { HAND, FOOD, mulberry32, shuffle, newGame, reveal, potValue, wantsHigh, judge, resolve, scores, winners, cpuPick };
});
