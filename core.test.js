const test = require('node:test');
const assert = require('node:assert');
const C = require('./core.js');

test('手札は 1〜15、えさは +1〜+10 と -1〜-5 の 15 まい', () => {
  const g = C.newGame(4, C.mulberry32(1));
  assert.deepStrictEqual(g.hands[3], Array.from({ length: 15 }, (_, i) => i + 1));
  assert.deepStrictEqual(g.deck.slice().sort((a, b) => a - b), [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('プラスは いちばん大きい数、マイナスは いちばん小さい数がとる', () => {
  assert.strictEqual(C.judge([3, 9, 5], true).winner, 1);
  assert.strictEqual(C.judge([3, 9, 5], false).winner, 0);
});

test('同じ数は打ち消し。残った人で決める', () => {
  const r = C.judge([12, 12, 7, 3], true);
  assert.strictEqual(r.winner, 2);
  assert.deepStrictEqual(r.cancelled, [12]);
  assert.strictEqual(C.judge([2, 2, 7, 9], false).winner, 2);
});

test('全員が打ち消しなら、えさは もちこし → つぎに 2 まい まとめて とる', () => {
  const g = C.newGame(2, C.mulberry32(3));
  g.deck = [5, 3, ...g.deck.filter((v) => v !== 5 && v !== 3)];
  C.reveal(g);
  const a = C.resolve(g, [8, 8]);
  assert.strictEqual(a.carried, true);
  assert.deepStrictEqual(g.pot, [5]);
  C.reveal(g);
  const b = C.resolve(g, [1, 15]);
  assert.strictEqual(b.winner, 1);
  assert.deepStrictEqual(b.cards, [5, 3]);
  assert.deepStrictEqual(C.scores(g), [0, 8]);
  assert.deepStrictEqual(g.pot, []);
});

test('もちこしは 場の合計でプラスかマイナスかを決める', () => {
  const g = C.newGame(2, C.mulberry32(4));
  g.pot = [2, -5];
  assert.strictEqual(C.wantsHigh(g), false);
  g.pot = [3, -3];
  assert.strictEqual(C.wantsHigh(g), true);
});

test('出したカードは手札から消え、持っていない数は出せない', () => {
  const g = C.newGame(3, C.mulberry32(5));
  C.reveal(g);
  C.resolve(g, [1, 2, 3]);
  assert.ok(!g.hands[0].includes(1) && g.hands[0].length === 14);
  C.reveal(g);
  assert.throws(() => C.resolve(g, [1, 4, 5]), /持っていない/);
});

test('コンピュータどうしで 15 回遊ぶと、手札もえさも使い切って終わる (1000 ゲーム)', () => {
  const rng = C.mulberry32(7);
  for (let k = 0; k < 1000; k++) {
    const n = 2 + (k % 3);
    const g = C.newGame(n, rng);
    let rounds = 0;
    while (!g.over) {
      C.reveal(g);
      const plays = Array.from({ length: n }, (_, i) => C.cpuPick(g, i, rng, rng()));
      plays.forEach((v, i) => assert.ok(g.hands[i].includes(v)));
      C.resolve(g, plays);
      rounds++;
    }
    assert.strictEqual(rounds, 15);
    assert.ok(g.hands.every((h) => h.length === 0));
    // とった えさ + 最後に残ったもちこし = えさ 15 まい
    assert.strictEqual(g.taken.flat().length + g.pot.length, 15);
    assert.ok(C.winners(g).length >= 1);
  }
});

test('コンピュータは 大きいえさほど 大きい数を出す (平均で)', () => {
  const rng = C.mulberry32(9);
  const avg = (food) => {
    let s = 0;
    for (let k = 0; k < 400; k++) { const g = C.newGame(2, rng); g.pot = [food]; s += C.cpuPick(g, 0, rng, 0.5); }
    return s / 400;
  };
  assert.ok(avg(10) > avg(5) && avg(5) > avg(1), `${avg(10)} > ${avg(5)} > ${avg(1)}`);
});
