// 일관성 검사 검사 — 견주기와 튀는 장 골라내기.
//
// ★여기가 틀리면 멀쩡한 그림을 불량으로 찍거나, 진짜 튄 장을 놓친다. 사람은 점수만
//   보고 믿으므로 틀린 것을 알아차리지도 못한다.
// 사용: node tools/test_consistency.js
'use strict';

const C = require('../www/js/consistency.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 코사인 ─────────────────────────────────────────────────────────────
check('같은 벡터는 1', Math.abs(C.cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
check('길이만 다르면 여전히 1 (방향만 본다)',
  Math.abs(C.cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-9);
check('직각이면 0', Math.abs(C.cosine([1, 0], [0, 1])) < 1e-9);
check('반대면 -1', Math.abs(C.cosine([1, 0], [-1, 0]) + 1) < 1e-9);
check('★길이가 다르면 0 (짧은 쪽에 맞춰 자르면 엉뚱하게 닮았다고 나온다)',
  C.cosine([1, 2, 3], [1, 2]) === 0);
check('빈 것도 안 터진다', C.cosine([], []) === 0 && C.cosine(null, [1]) === 0);
check('전부 0 이면 0', C.cosine([0, 0], [0, 0]) === 0);

// ── 2. 길이 1 로 만들기 ───────────────────────────────────────────────────
const nv = C.normalize([3, 4]);
check('길이가 1 이 된다', Math.abs(Math.sqrt(nv[0] * nv[0] + nv[1] * nv[1]) - 1) < 1e-9);
check('0 벡터는 0 그대로', C.normalize([0, 0]).every(function (x) { return x === 0; }));

// ── 3. 가운데 ─────────────────────────────────────────────────────────────
check('가운데를 구한다',
  JSON.stringify(C.centroid([[0, 0], [2, 4]])) === JSON.stringify([1, 2]));
check('★길이가 다른 것은 안 섞는다 (섞으면 자릿수가 어긋나 전부 망가진다)',
  JSON.stringify(C.centroid([[0, 0], [2, 4], [9, 9, 9]])) === JSON.stringify([1, 2]));
check('빈 목록은 빈 결과', C.centroid([]).length === 0 && C.centroid(null).length === 0);

// ── 4. 장마다 점수 ────────────────────────────────────────────────────────
// ★자기를 뺀 나머지와 견줘야 한다. 자기가 낀 가운데와 견주면 장수가 적을수록
//   자기 점수가 부풀려져, 두 장뿐일 때는 둘 다 1.0 이 나온다.
const two = C.scores([[1, 0], [0, 1]]);
check('★자기를 빼고 견준다 (두 장이 직각이면 둘 다 0)',
  Math.abs(two[0]) < 1e-9 && Math.abs(two[1]) < 1e-9, JSON.stringify(two));
check('한 장뿐이면 1', C.scores([[1, 2]])[0] === 1);
check('빈 목록', C.scores([]).length === 0);

// 하나만 튀게 심어 두고 그것이 제일 낮은지
const planted = [[1, 0, 0], [0.99, 0.1, 0], [1, 0.05, 0], [0, 1, 0]];
const ps = C.scores(planted);
check('★심어 둔 튀는 장이 제일 낮다',
  ps.indexOf(Math.min.apply(null, ps)) === 3, JSON.stringify(ps.map(function (x) {
    return Math.round(x * 100) / 100;
  })));

// ── 5. 튀는 장 골라내기 ───────────────────────────────────────────────────
let rep = C.report(planted);
check('장수를 센다', rep.count === 4);
check('★튀는 장을 짚어 낸다', rep.items[3].out === true, JSON.stringify(rep.items[3]));
check('멀쩡한 장은 안 짚는다',
  !rep.items[0].out && !rep.items[1].out && !rep.items[2].out,
  JSON.stringify(rep.items.map(function (x) { return x.out; })));

// ★전부 똑같으면 아무도 튄 것이 아니다. σ 가 0 에 가까울 때 z 를 재면 0.001 차이가
//   5σ 로 부풀어 멀쩡한 장이 불량으로 찍힌다. 이 검사가 그것을 막는다.
const same = C.report([[1, 0], [1, 0], [1, 0], [1, 0]]);
check('★다 똑같으면 튀는 것이 없다 (벌어진 정도가 0 인데 z 를 재면 안 된다)',
  same.items.every(function (x) { return !x.out; }) && same.flat === true,
  JSON.stringify(same));

const near = C.report([[1, 0], [1, 0.001], [1, 0.002], [1, 0.0015]]);
check('★거의 똑같은 것도 튀는 것이 없다', near.items.every(function (x) { return !x.out; }),
  JSON.stringify(near.items.map(function (x) { return x.z; })));

check('벌어진 정도를 알려 준다', rep.sd > 0 && isFinite(rep.sd), String(rep.sd));
check('평균도 알려 준다', isFinite(rep.mean), String(rep.mean));

// 절대 기준도 쓸 수 있다
rep = C.report(planted, { min: 0.99 });
check('★기준값을 주면 그 아래는 무조건 짚는다',
  rep.items.filter(function (x) { return x.out; }).length >= 2,
  JSON.stringify(rep.items.map(function (x) { return [x.score, x.out]; })));

// σ 를 좁히면 더 많이 짚는다
check('기준 σ 를 좁히면 더 짚는다',
  C.report(planted, { sigma: 0.5 }).items.filter(function (x) { return x.out; }).length
  >= C.report(planted, { sigma: 3 }).items.filter(function (x) { return x.out; }).length);

check('한 장이면 튀는 것이 없다', C.report([[1, 0]]).items.every(function (x) { return !x.out; }));
check('빈 목록도 안 터진다', C.report([]).count === 0 && C.report(null).count === 0);

// ── 6. 등급 ───────────────────────────────────────────────────────────────
check('고르면 좋은 등급', C.grade(0.01).label === '아주 고름');
check('벌어지면 나쁜 등급', C.grade(0.5).label === '들쭉날쭉');
check('★등급은 평균이 아니라 벌어진 정도로 매긴다 (평균은 모델마다 자릿수가 다르다)',
  C.grade(0.03).label === '고름' && C.grade(0.07).label === '보통');
check('이상한 값도 등급이 나온다', !!C.grade(NaN).label && !!C.grade(Infinity).label);

// ── 7. 한 줄 요약 ─────────────────────────────────────────────────────────
check('요약에 장수가 들어간다', /4장/.test(C.summary(C.report(planted))),
  C.summary(C.report(planted)));
check('튀는 것이 몇 장인지 적는다', /튀는 것 1장/.test(C.summary(C.report(planted))),
  C.summary(C.report(planted)));
check('튀는 것이 없으면 없다고 적는다',
  /튀는 것 없음/.test(C.summary(same)), C.summary(same));
check('한 장뿐이면 그렇다고 말한다',
  /견줄 것이 없/.test(C.summary(C.report([[1, 0]]))), C.summary(C.report([[1, 0]])));
check('빈 것은 빈 글', C.summary(null) === '' && C.summary({ count: 0 }) === '');

// ── 8. 묶음끼리 견주기 ────────────────────────────────────────────────────
const cmp = C.compare([
  { name: '들쭉날쭉', vectors: [[1, 0], [0, 1], [1, 1]] },
  { name: '고름', vectors: [[1, 0], [1, 0.01], [1, 0.02]] }
]);
check('★고른 묶음이 먼저 온다', cmp[0].name === '고름',
  cmp.map(function (x) { return x.name + ':' + x.sd; }).join(' | '));
check('묶음마다 등급이 붙는다', !!cmp[0].label && !!cmp[1].label);
check('묶음마다 장수가 붙는다', cmp[0].count === 3);
check('★못 재는 묶음(한 장)은 뒤로 (0 이라 제일 고른 것처럼 보이면 안 된다)',
  C.compare([
    { name: '한장', vectors: [[1, 0]] },
    { name: '셋', vectors: [[1, 0], [1, 0.5], [1, 0.2]] }
  ])[0].name === '셋');
check('빈 것도 안 터진다', C.compare([]).length === 0 && C.compare(null).length === 0);

// ── 8-2. 한 번에 재고 나눠 담기 ───────────────────────────────────────────
// ★자르는 자리가 한 칸만 밀려도 3번 그림의 점수가 5번에 붙는다. 화면은 멀쩡해 보이므로
//   아무도 못 알아챈다 — 그래서 여기를 따로 검사한다.
const sp = C.split([[1], [2], [3], [4], [5]], [2, 3]);
check('★보낸 순서대로 잘라 담는다',
  JSON.stringify(sp) === JSON.stringify([[[1], [2]], [[3], [4], [5]]]), JSON.stringify(sp));
check('묶음 개수가 맞는다', sp.length === 2);
check('★모자라면 빈 자리로 채운다 (밀려 붙는 것보다 낫다)',
  JSON.stringify(C.split([[1]], [2])) === JSON.stringify([[[1], []]]));
check('남는 것은 버린다', C.split([[1], [2], [3]], [1]).length === 1
  && C.split([[1], [2], [3]], [1])[0].length === 1);
check('벡터가 아닌 것이 섞여도 자리를 지킨다',
  JSON.stringify(C.split([null, [2]], [2])) === JSON.stringify([[[], [2]]]));
check('빈 것도 안 터진다', C.split(null, null).length === 0 && C.split([[1]], []).length === 0);
check('0장짜리 묶음도 자리를 지킨다',
  JSON.stringify(C.split([[1]], [0, 1])) === JSON.stringify([[], [[1]]]));

// ── 9. 표본이 적을 때 ─────────────────────────────────────────────────────
// ★z 는 아무리 튀어도 (n-1)/√n 을 못 넘는다. 4장이면 1.5 다. 그래서 "1.5σ 아래" 를
//   그대로 쓰면 4장짜리 묶음에서는 영영 아무것도 안 걸린다. 조합 모드가 바로 그 자리다.
check('★4장에서 z 는 1.5 를 못 넘는다 (수학적 한계)',
  Math.abs(C.maxZ(4) - 1.5) < 1e-9, String(C.maxZ(4)));
check('3장은 1.155', Math.abs(C.maxZ(3) - 2 / Math.sqrt(3)) < 1e-9);
check('장수가 늘면 한계도 는다', C.maxZ(10) > C.maxZ(4) && C.maxZ(4) > C.maxZ(3));
check('한 장은 0', C.maxZ(1) === 0);

check('★닿을 수 없는 기준은 낮춰 잡는다', C.effectiveSigma(1.5, 4) < 1.5,
  String(C.effectiveSigma(1.5, 4)));
check('장수가 넉넉하면 그대로 쓴다', C.effectiveSigma(1.5, 20) === 1.5,
  String(C.effectiveSigma(1.5, 20)));
check('실제로 쓴 기준을 남긴다', C.report(planted).sigma < 1.5,
  String(C.report(planted).sigma));

// 4장·3장에서도 심어 둔 튀는 장이 실제로 걸리는가
[3, 4, 5, 6, 8].forEach(function (n) {
  const vecs = [];
  for (let i = 0; i < n - 1; i++) vecs.push([1, i * 0.01, 0]);
  vecs.push([0, 1, 0]);                                  // 마지막이 범인
  const r = C.report(vecs);
  check('★' + n + '장에서도 튀는 장을 잡는다',
    r.items[n - 1].out === true,
    JSON.stringify(r.items.map(function (x) { return [x.score, x.z, x.out]; })));
});

check('★장수가 적으면 요약에 그렇다고 적는다 (4장으로 「고르다」 는 우연일 수 있다)',
  /참고만/.test(C.summary(C.report([[1, 0], [1, 0.1], [1, 0.2]]))),
  C.summary(C.report([[1, 0], [1, 0.1], [1, 0.2]])));
check('장수가 넉넉하면 그 말은 안 붙는다',
  !/참고만/.test(C.summary(C.report([[1, 0], [1, 0.1], [1, 0.2], [1, 0.3], [1, 0.15], [1, 0.05]]))));

const total = pass + fails.length;
console.log('일관성 검사 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
