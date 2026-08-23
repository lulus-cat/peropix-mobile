// 작가 태그 깎기 검사 — 이분 탐색이 정말로 범인을 찾아내는가.
//
// ★여기가 틀리면 엉뚱한 작가를 범인으로 지목한다. 사람은 그 말을 믿고 태그를 빼므로
//   틀린 것을 알아차리지도 못한다. 그래서 「범인을 심어 두고 끝까지 돌려 보는」 검사를 둔다.
// 사용: node tools/test_bisect.js
'use strict';

const B = require('../www/js/bisect.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

const TWENTY = [];
for (let i = 0; i < 20; i++) TWENTY.push('artist_' + i);

// ── 1. 시작 ───────────────────────────────────────────────────────────────
let s = B.start({ tags: ['a', 'b', 'c'], seed: 42 });
check('후보를 들고 시작한다', s.candidates.length === 3);
check('★시드가 고정된다 (안 그러면 태그 탓인지 시드 탓인지 알 수 없다)',
  s.seeds.length === 1 && s.seeds[0] === 42);
check('같은 태그를 두 번 주면 하나만', B.start({ tags: ['a', 'A', 'a'] }).candidates.length === 1);
check('기본은 교차 확인 켜짐', s.cross === true);

// ── 2. 대조군이 먼저 ──────────────────────────────────────────────────────
let step = B.plan(s);
check('★첫 라운드는 대조군이다 (기준 그림이 없으면 비교할 것이 없다)',
  step.kind === 'reference' && step.group.length === 0, step.kind);
check('대조군은 아무것도 빼지 않는다',
  step.shots[0].tags.length === 3 && step.shots[0].removed.length === 0);
check('대조군도 같은 시드로', step.shots[0].seed === 42);

// ── 3. 가르기 ─────────────────────────────────────────────────────────────
s = B.answer(s, {});                 // 대조군을 봤다
step = B.plan(s);
check('두 번째부터 가른다', step.kind === 'split', step.kind);
check('★빼기다 — 남는 쪽이 원래 조합에서 그 무리만 빠진 것',
  step.shots[0].tags.length === 1 && step.shots[0].removed.length === 2,
  JSON.stringify({ tags: step.shots[0].tags, removed: step.shots[0].removed }));
check('교차 확인이면 양쪽을 다 뽑는다',
  step.shots.length === 2 && step.shots[0].side === 'L' && step.shots[1].side === 'R');
check('양쪽을 합치면 원래 후보', step.group.concat(step.other).sort().join(',') === 'a,b,c');

// 한쪽만 뽑는 모드
const fast = B.answer(B.start({ tags: ['a', 'b', 'c'], seed: 1, cross: false }), {});
check('빠르게 모드는 라운드당 한 장', B.plan(fast).shots.length === 1);

// ── 4. 끝까지 돌려 범인을 찾는다 ──────────────────────────────────────────
/**
 * 범인을 심어 두고, 「그 요소가 남아 있나」 를 기계적으로 답해 준다.
 * 뺀 무리에 범인이 들어 있으면 요소는 사라진다(false).
 */
function solve(tags, culprit, opts) {
  let st = B.start(Object.assign({ tags: tags, seed: 7 }, opts || {}));
  let guard = 0;
  while (!st.done && guard++ < 50) {
    const p = B.plan(st);
    if (!p) break;
    if (p.kind === 'reference') { st = B.answer(st, {}); continue; }
    const ans = {};
    ans.L = p.group.indexOf(culprit) === -1;        // 범인이 안 빠졌으면 요소가 남는다
    if (st.cross) ans.R = p.other.indexOf(culprit) === -1;
    st = B.answer(st, ans);
  }
  return st;
}

let done = solve(TWENTY, 'artist_13');
check('★20명 중에서 범인을 찾아낸다', done.culprit === 'artist_13', String(done.culprit));
check('찾으면 끝난다', done.done === true);
check('★20명이면 5라운드 안에 (대조군 제외)',
  done.rounds.filter(function (r) { return r.kind === 'split'; }).length <= 5,
  String(done.rounds.length));

// 모든 자리의 범인을 다 찾아내는가 — 하나라도 놓치면 안 된다
let missed = [];
TWENTY.forEach(function (c) {
  if (solve(TWENTY, c).culprit !== c) missed.push(c);
});
check('★20명 어느 자리에 있어도 다 찾는다', missed.length === 0, missed.join(','));

// 빠르게 모드에서도
missed = [];
TWENTY.forEach(function (c) {
  if (solve(TWENTY, c, { cross: false }).culprit !== c) missed.push(c);
});
check('★한쪽만 뽑는 모드에서도 다 찾는다', missed.length === 0, missed.join(','));

// 크기가 어중간해도 (2의 거듭제곱이 아닌 수)
[2, 3, 5, 7, 9, 13, 17].forEach(function (n) {
  const t = TWENTY.slice(0, n);
  const bad = t.filter(function (c) { return solve(t, c).culprit !== c; });
  check(n + '명이어도 다 찾는다', bad.length === 0, bad.join(','));
});

check('한 명뿐이면 가를 것이 없다',
  B.plan(B.answer(B.start({ tags: ['a'] }), {})) === null);

// ── 5. 합작 알아보기 ──────────────────────────────────────────────────────
// ★양쪽을 다 빼도 요소가 남으면 한 명이 만든 것이 아니다.
let sh = B.answer(B.start({ tags: ['a', 'b', 'c', 'd'], seed: 1 }), {});
sh = B.answer(sh, { L: true, R: true });
check('★양쪽 다 남으면 합작으로 본다', sh.shared === true && sh.done === true);
check('합작이면 범인을 지목하지 않는다', sh.culprit === null);
check('합작을 말로 알려 준다', /여러 작가가 같이/.test(B.summary(sh)), B.summary(sh));

let bo = B.answer(B.start({ tags: ['a', 'b', 'c', 'd'], seed: 1 }), {});
bo = B.answer(bo, { L: false, R: false });
check('★양쪽 다 사라져도 단독 범인이 아니다', bo.shared === true && bo.culprit === null);

// ── 6. 되돌리기 ───────────────────────────────────────────────────────────
let u = B.answer(B.start({ tags: TWENTY.slice(0, 8), seed: 1 }), {});
const before = u.candidates.slice();
u = B.answer(u, { L: false, R: true });
check('판정하면 후보가 준다', u.candidates.length === 4, String(u.candidates.length));
u = B.undo(u);
check('★되돌리면 후보가 돌아온다 (잘못 본 것을 고칠 수 있어야 한다)',
  u.candidates.sort().join(',') === before.sort().join(','),
  u.candidates.join(','));
check('되돌리면 걸러 둔 것도 돌아온다', u.cleared.length === 0, u.cleared.join(','));
check('아무것도 없을 때 되돌려도 안 터진다', B.undo(B.start({ tags: ['a'] })).candidates.length === 1);

// ── 7. 장수 예측 ──────────────────────────────────────────────────────────
let e = B.estimate(B.start({ tags: TWENTY, seed: 1 }));
check('★20명 · 교차 = 대조군 1 + 5라운드 × 2 = 11장', e.total === 11, JSON.stringify(e));
check('한쪽만이면 절반 가까이',
  B.estimate(B.start({ tags: TWENTY, seed: 1, cross: false })).total === 6,
  JSON.stringify(B.estimate(B.start({ tags: TWENTY, seed: 1, cross: false }))));
check('★시드를 둘 쓰면 두 배 (우연을 범인으로 지목하지 않으려는 값)',
  B.estimate(B.start({ tags: TWENTY, seeds: [1, 2] })).total === 22,
  String(B.estimate(B.start({ tags: TWENTY, seeds: [1, 2] })).total));

// ── 8. 슬롯으로 굽기 ──────────────────────────────────────────────────────
const st2 = B.answer(B.start({ tags: ['a', 'b', 'c', 'd'], seed: 5 }), {});
const slots = B.toSlots(B.plan(st2), function (tags) { return tags.join(', '); });
check('★슬롯으로 구워 기존 생성 경로를 그대로 탄다', slots.length === 2);
check('슬롯에 이름이 붙는다', /빼기[LR]-5/.test(slots[0].name), slots[0].name);
check('슬롯 내용이 남은 태그들', slots[0].content.split(', ').length === 2, slots[0].content);
check('어느 그림이 어느 컷인지 남긴다', !!slots[0].__shot, slots[0].__shot);

// ── 9. 안내 문구 ──────────────────────────────────────────────────────────
check('처음에는 기준부터 잡으라고',
  /기준/.test(B.summary(B.start({ tags: ['a', 'b'] }))),
  B.summary(B.start({ tags: ['a', 'b'] })));
check('도는 중에는 남은 후보 수를 알려 준다',
  /남은 후보 2명/.test(B.summary(B.answer(B.start({ tags: ['a', 'b'] }), {}))),
  B.summary(B.answer(B.start({ tags: ['a', 'b'] }), {})));
check('★없애려던 것이면 「빼라」 고 말한다',
  /빼거나 가중치를 낮춰/.test(B.summary(solve(['a', 'b'], 'a', { goal: 'drop' }))),
  B.summary(solve(['a', 'b'], 'a', { goal: 'drop' })));
check('★살리려던 것이면 「올려 보라」 고 말한다',
  /가중치를 올려/.test(B.summary(solve(['a', 'b'], 'a', { goal: 'keep' }))),
  B.summary(solve(['a', 'b'], 'a', { goal: 'keep' })));

const total = pass + fails.length;
console.log('작가 태그 깎기 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
