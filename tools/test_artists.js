// 작가 서랍 검사 — 엄선·갈래·즐겨찾기, 그리고 가중치.
//
// ★가중치가 틀리면 프롬프트가 조용히 망가진다. 세기가 범위를 넘어 작가가 그림을
//   잡아먹거나, 문법(숫자::태그::)이 어긋나 NAI 가 글자로 읽어 버린다.
// 사용: node tools/test_artists.js
'use strict';

const A = require('../www/js/artists.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 서랍에 넣고 빼기 ───────────────────────────────────────────────────
let list = A.add([], { tag: 'WLOP', count: 400 }, 100);
check('대문자로 넣어도 태그 모양으로', list[0].tag === 'wlop', list[0].tag);
check('장수를 들고 있는다', list[0].count === 400);
check('있는지 본다', A.has(list, 'wlop') && !A.has(list, '없는사람'));

list = A.toggleCat(list, 'wlop', '두꺼운 선');
list = A.toggleCat(list, 'wlop', '수채');
list = A.toggleFav(list, 'wlop');
check('갈래를 붙인다', list[0].cats.join(',') === '두꺼운 선,수채', list[0].cats.join(','));
check('즐겨찾기', list[0].fav === true);
list = A.toggleCat(list, 'wlop', '수채');
check('갈래를 다시 누르면 뗀다', list[0].cats.join(',') === '두꺼운 선', list[0].cats.join(','));

// ★같은 작가를 다시 넣을 때 애써 붙여 둔 갈래·메모가 날아가면 안 된다
list = A.add(list, { tag: 'wlop', count: 999 }, 200);
check('★다시 넣어도 갈래와 즐겨찾기는 지킨다',
  list.length === 1 && list[0].cats.join(',') === '두꺼운 선' && list[0].fav === true,
  JSON.stringify(list[0]));
check('장수만 새로 고친다', list[0].count === 999);

// ★장르(앱이 매긴 것)와 갈래(사람이 붙인 것)는 다른 축이다
list = A.add(list, { tag: 'wlop', count: 999, genres: ['female', 'nsfw'] }, 210);
check('★장르는 새로 잰 것으로 갈아 끼운다',
  list[0].genres.join(',') === 'female,nsfw', list[0].genres.join(','));
check('★그래도 사람이 붙인 갈래는 지킨다',
  list[0].cats.join(',') === '두꺼운 선', list[0].cats.join(','));
list = A.add(list, { tag: 'wlop', count: 1000 }, 220);
check('★못 쟀으면 알던 장르를 지킨다 (지워 버리면 서랍에서 사라진다)',
  list[0].genres.join(',') === 'female,nsfw', list[0].genres.join(','));

list = A.add(list, { tag: 'as109', count: 3000 }, 300);
list = A.add(list, { tag: 'sakimichan', count: 900 }, 400);
list = A.toggleCat(list, 'as109', '두꺼운 선');
check('갈래를 많은 순으로 모은다',
  A.categories(list)[0].name === '두꺼운 선' && A.categories(list)[0].count === 2,
  JSON.stringify(A.categories(list)));

check('갈래로 거른다', A.filter(list, { cat: '두꺼운 선' }).length === 2);
check('즐겨찾기만', A.filter(list, { fav: true }).length === 1);
check('이름으로 찾는다', A.filter(list, { q: 'saki' }).length === 1);
check('갈래가 없는 것만', A.filter(list, { cat: '__none__' }).length === 1,
  A.filter(list, { cat: '__none__' }).map(function (e) { return e.tag; }).join(','));

check('빼기', A.remove(list, 'as109').length === 2);
check('없는 것을 빼도 안 터진다', A.remove(list, '없음').length === 3);

// ── 2. 세기 자르기 · 범위 설정 ────────────────────────────────────────────
check('기본은 1.4 를 넘으면 자른다', A.clampWeight(3) === 1.4);
check('기본은 0.6 아래도 자른다', A.clampWeight(0.1) === 0.6);
check('눈금(0.05)에 맞춘다', A.clampWeight(1.113) === 1.1, String(A.clampWeight(1.113)));
check('숫자가 아니면 1.0', A.clampWeight('아무거나') === 1 && A.clampWeight(undefined) === 1);

// ★범위를 사람이 정한다
const WIDE = { min: 0.3, max: 2, step: 0.1 };
check('★범위를 넓히면 그만큼 나간다', A.clampWeight(1.9, WIDE) === 1.9, String(A.clampWeight(1.9, WIDE)));
check('★넓힌 범위의 밖은 여전히 자른다', A.clampWeight(5, WIDE) === 2 && A.clampWeight(0.01, WIDE) === 0.3);
check('★간격도 사람이 정한다 (0.1 이면 1.13 → 1.1)',
  A.clampWeight(1.13, WIDE) === 1.1, String(A.clampWeight(1.13, WIDE)));
check('★눈금은 최소값을 기준으로 센다 (안 그러면 슬라이더가 최소값에 못 닿는다)',
  A.clampWeight(0.65, { min: 0.65, max: 1.35, step: 0.1 }) === 0.65,
  String(A.clampWeight(0.65, { min: 0.65, max: 1.35, step: 0.1 })));

check('★뒤집어 넣어도 받아 준다', A.range({ min: 2, max: 0.5 }).min === 0.5);
check('0이나 글자를 넣으면 기본값으로',
  A.range({ min: 0, max: -3, step: 'x' }).min === 0.6 && A.range({}).step === 0.05);
check('★간격이 범위보다 크면 범위에 맞춘다 (눈금이 하나도 안 생기는 것을 막는다)',
  A.range({ min: 1, max: 1.2, step: 5 }).step === 0.2,
  String(A.range({ min: 1, max: 1.2, step: 5 }).step));

// 훑을 눈금
check('기본 눈금 5칸', A.scanSteps().length === 5, A.scanSteps().join(','));
check('★1.0 이 반드시 들어간다 (원래와 견줄 기준)',
  A.scanSteps().indexOf(1) !== -1 && A.scanSteps(WIDE).indexOf(1) !== -1,
  A.scanSteps(WIDE).join(','));
check('범위 끝을 다 훑는다',
  A.scanSteps(WIDE)[0] === 0.3 && A.scanSteps(WIDE).slice(-1)[0] === 2,
  A.scanSteps(WIDE).join(','));
check('칸 수를 정할 수 있다', A.scanSteps(null, 3).length <= 4 && A.scanSteps(null, 3).length >= 3,
  A.scanSteps(null, 3).join(','));
check('★좁은 범위에서도 눈금이 겹치지 않는다',
  new Set(A.scanSteps({ min: 0.9, max: 1.1, step: 0.05 })).size
    === A.scanSteps({ min: 0.9, max: 1.1, step: 0.05 }).length,
  A.scanSteps({ min: 0.9, max: 1.1, step: 0.05 }).join(','));

// ── 2-b. 작가 수 상한 ─────────────────────────────────────────────────────
const many = [];
for (let i = 0; i < 30; i++) many.push('artist_' + i);
check('★한 조합에 20명까지 (넘으면 화풍이 뭉개져 무엇이 무엇인지 볼 수 없다)',
  A.mix(many).length === A.MAX_TAGS && A.MAX_TAGS === 20, String(A.mix(many).length));
check('20명까지는 그대로 다 들어간다', A.mix(many.slice(0, 20)).length === 20);

// ── 3. 조합 ───────────────────────────────────────────────────────────────
let m = A.mix(['wlop', 'as109', 'sakimichan']);
check('처음에는 모두 1.0', m.every(function (x) { return x.weight === 1 && x.on; }));
check('★같은 작가를 두 번 넣지 않는다 (세기가 두 배가 된다)',
  A.mix(['wlop', 'WLOP', 'wlop']).length === 1);
check('세기를 준 채로 만들 수 있다', A.mix([{ tag: 'a', weight: 1.2 }])[0].weight === 1.2);

m = A.setWeight(m, 'wlop', 1.4);
check('한 명만 세기를 바꾼다',
  m[0].weight === 1.4 && m[1].weight === 1 && m[2].weight === 1);

m = A.toggleOn(m, 'sakimichan');
check('끄고 켤 수 있다', m[2].on === false);
check('켠 사람 수를 센다', A.activeCount(m) === 2);

// ── 4. 합 고정 ────────────────────────────────────────────────────────────
// 세 명 모두 켜고 한 명만 1.4 → 합 3.4 → 3 으로 되돌린다
let m3 = A.normalize(A.setWeight(A.mix(['a', 'b', 'c']), 'a', 1.4));
const sum3 = m3.reduce(function (s, x) { return s + x.weight; }, 0);
check('★한 명을 올리면 나머지가 내려간다',
  m3[0].weight > m3[1].weight && m3[1].weight < 1,
  m3.map(function (x) { return x.tag + ':' + x.weight; }).join(' '));
check('★합이 작가 수 가까이로 돌아온다 (프롬프트가 작가 쪽으로 쏠리지 않게)',
  Math.abs(sum3 - 3) <= 0.15, String(sum3));
check('★모두 1.0 이면 아무것도 안 바뀐다',
  A.normalize(A.mix(['a', 'b'])).every(function (x) { return x.weight === 1; }));
check('★꺼 둔 사람은 셈에 안 들어간다',
  A.normalize(A.toggleOn(A.mix(['a', 'b']), 'b')).filter(function (x) { return x.on; })[0]
    .weight === 1);
// ★혼자면 나눠 가질 상대가 없다. 여기서 합을 맞추면 슬라이더가 죽은 것처럼 보인다.
check('★혼자일 때는 합을 맞추지 않는다 (슬라이더가 살아 있어야 한다)',
  A.normalize(A.setWeight(A.mix(['a']), 'a', 1.4))[0].weight === 1.4,
  String(A.normalize(A.setWeight(A.mix(['a']), 'a', 1.4))[0].weight));
check('★한 명만 켜 두었을 때도 마찬가지',
  A.normalize(A.setWeight(A.toggleOn(A.mix(['a', 'b']), 'b'), 'a', 1.3))[0].weight === 1.3);
check('빈 조합이어도 안 터진다', A.normalize([]).length === 0);

// ── 5. 프롬프트로 굽기 ────────────────────────────────────────────────────
check('★1.0 은 문법을 안 붙인다 (뜻은 같은데 프롬프트만 지저분해진다)',
  A.bake(A.mix(['wlop', 'as109'])) === 'wlop, as109',
  A.bake(A.mix(['wlop', 'as109'])));
check('★세기는 숫자::태그:: 로 (기준 페이로드의 0::ai-generated:: 와 같은 문법)',
  A.bake(A.setWeight(A.mix(['wlop']), 'wlop', 1.2)) === '1.2::wlop::',
  A.bake(A.setWeight(A.mix(['wlop']), 'wlop', 1.2)));
check('★언더스코어는 띄어쓰기로, 괄호는 그대로',
  A.bake(A.mix(['ruu_(tksymkw)'])) === 'ruu (tksymkw)',
  A.bake(A.mix(['ruu_(tksymkw)'])));
check('꺼 둔 사람은 안 실린다',
  A.bake(A.toggleOn(A.mix(['a', 'b']), 'b')) === 'a');
check('빈 조합은 빈 글', A.bake([]) === '' && A.bake(null) === '');
check('합 고정을 켜고 구울 수 있다',
  A.bake(A.setWeight(A.mix(['a', 'b']), 'a', 1.4), { normalize: true }).indexOf('::') !== -1);

// ── 6. 세기 훑기 ──────────────────────────────────────────────────────────
const sc = A.scan(A.mix(['wlop', 'as109']), 'wlop');
check('기본 눈금은 5칸', sc.length === 5, String(sc.length));
check('★1.0 이 가운데 있다 (원래와 견줄 수 있게)',
  sc.some(function (s) { return s.weight === 1; }),
  sc.map(function (s) { return s.weight; }).join(','));
check('훑는 사람만 세기가 바뀐다',
  sc[0].mix.find(function (x) { return x.tag === 'as109'; }).weight === 1);
check('각 칸이 바로 쓸 프롬프트를 들고 있다',
  sc[0].prompt.indexOf('0.6::wlop::') !== -1, sc[0].prompt);
check('★훑기는 설정한 범위의 끝까지 본다 (기본 0.6~1.4)',
  sc[0].weight === 0.6 && sc.slice(-1)[0].weight === 1.4,
  sc.map(function (x) { return x.weight; }).join(','));
check('눈금을 직접 줄 수 있다', A.scan(A.mix(['a']), 'a', [0.8, 1.2]).length === 2);
check('★잘린 뒤 겹치는 값은 하나만 남긴다 (같은 그림을 두 번 뽑으면 Anlas 낭비다)',
  A.scan(A.mix(['a']), 'a', [3, 4, 5]).length === 1,
  String(A.scan(A.mix(['a']), 'a', [3, 4, 5]).length));
check('★훑기도 설정한 범위를 따른다',
  A.scan(A.mix(['a']), 'a', null, { cfg: WIDE }).slice(-1)[0].weight === 2,
  A.scan(A.mix(['a']), 'a', null, { cfg: WIDE }).map(function (x) { return x.weight; }).join(','));
check('굽기도 설정한 범위를 따른다',
  A.bake(A.setWeight(A.mix(['a', 'b']), 'a', 1.9, WIDE), { cfg: WIDE }).indexOf('1.9::a::') === 0,
  A.bake(A.setWeight(A.mix(['a', 'b']), 'a', 1.9, WIDE), { cfg: WIDE }));

// ── 7. 무작위 배합 (조합 시험의 씨앗) ─────────────────────────────────────
// 난수를 넣어 결과를 못 박는다
let n = 0;
const seq = function () { const v = [0, 0.99, 0.5, 0.2, 0.8, 0.35][n % 6]; n++; return v; };

const rm = A.randomize(A.mix(['a', 'b', 'c']), null, seq);
check('★무작위여도 범위 안에서만 나온다',
  rm.every(function (x) { return x.weight >= 0.6 && x.weight <= 1.4; }),
  rm.map(function (x) { return x.weight; }).join(','));
check('★눈금에도 맞는다 (0.05 배수)',
  rm.every(function (x) { return Math.abs(Math.round(x.weight / 0.05) * 0.05 - x.weight) < 1e-9; }),
  rm.map(function (x) { return x.weight; }).join(','));
check('양 끝이 다 나올 수 있다 (0 → 최소, 0.99 → 최대)',
  rm[0].weight === 0.6 && rm[1].weight === 1.4,
  rm.map(function (x) { return x.weight; }).join(','));
check('★꺼 둔 사람은 건드리지 않는다',
  A.randomize(A.toggleOn(A.mix(['a', 'b']), 'b'), null, seq)[1].weight === 1);

const wide = A.randomize(A.mix(['a', 'b']), { min: 0.3, max: 2, step: 0.1 }, seq);
check('넓힌 범위도 따른다',
  wide.every(function (x) { return x.weight >= 0.3 && x.weight <= 2; }),
  wide.map(function (x) { return x.weight; }).join(','));

const cs = A.combos(A.mix(['a', 'b', 'c']), 5);
check('조합을 다섯 벌 만든다', cs.length === 5, String(cs.length));
check('★같은 배합이 두 번 나오지 않는다 (Anlas 를 헛되이 쓴다)',
  new Set(cs.map(function (c) {
    return c.map(function (x) { return x.tag + x.weight; }).join('|');
  })).size === cs.length);
check('각 벌이 그대로 구워진다', A.bake(cs[0]).indexOf('a') !== -1);
check('★만들 수 있는 배합보다 많이 달라고 해도 안 멈춘다',
  A.combos(A.mix(['a']), 30, { min: 1, max: 1.05, step: 0.05 }).length <= 2,
  String(A.combos(A.mix(['a']), 30, { min: 1, max: 1.05, step: 0.05 }).length));
check('상한 30벌', A.combos(A.mix(['a', 'b', 'c']), 999).length <= 30);
check('빈 조합이면 빈 결과', A.combos([], 5).length === 0);


// ── 8. 평가를 반영해 다시 뽑기 ────────────────────────────────────────────
// good 은 5점 조합에서 1.2, bad 는 1.0. 점수로 가중 평균하면 good 1.1 · bad 0.95 로 당겨진다.
const RATED = [
  { mix: [{ tag: 'good', weight: 1.2, on: true }, { tag: 'bad', weight: 1.0, on: true }], score: 5 },
  { mix: [{ tag: 'good', weight: 0.8, on: true }, { tag: 'bad', weight: 1.4, on: true }], score: 1 },
  { mix: [{ tag: 'good', weight: 1.0, on: true }, { tag: 'bad', weight: 0.6, on: true }], score: 2 }
];
const rf = A.refine(RATED, 6);
const wOf = function (c, tag) { return c.find(function (x) { return x.tag === tag; }).weight; };
check('평가를 반영해 새 조합을 만든다', rf.length > 0 && rf.length <= 6, String(rf.length));
check('★높은 점수를 준 값 쪽으로 당겨진다 (good 1.1 ± 한 칸)',
  rf.every(function (c) { return Math.abs(wOf(c, 'good') - 1.1) <= 0.05 + 1e-9; }),
  rf.map(function (c) { return wOf(c, 'good'); }).join(','));
check('★점수가 낮았던 값은 덜 당긴다 (bad 0.95 ± 한 칸)',
  rf.every(function (c) { return Math.abs(wOf(c, 'bad') - 0.95) <= 0.05 + 1e-9; }),
  rf.map(function (c) { return wOf(c, 'bad'); }).join(','));
check('★같은 조합이 두 번 안 나온다',
  new Set(rf.map(function (c) {
    return c.map(function (x) { return x.tag + x.weight; }).join('|');
  })).size === rf.length);
check('★한 번에 다 몰리지 않고 흩어진다 (한 칸 위아래로 흔든다)',
  new Set(A.refine(RATED, 9).map(function (c) { return wOf(c, 'good'); })).size >= 2,
  A.refine(RATED, 9).map(function (c) { return wOf(c, 'good'); }).join(','));
check('범위 밖으로 나가지 않는다',
  A.refine(RATED, 20).every(function (c) {
    return c.every(function (x) { return x.weight >= 0.6 && x.weight <= 1.4; });
  }));
check('넓힌 범위도 따른다',
  A.refine([{ mix: [{ tag: 'a', weight: 2, on: true }], score: 5 }], 3,
    { min: 0.3, max: 2, step: 0.1 })[0][0].weight <= 2);
check('꺼 둔 작가는 꺼진 채로', A.refine([{ mix: [{ tag: 'a', weight: 1, on: false }],
  score: 5 }], 3).every(function (c) { return c[0].on === false; }));
check('평가가 없으면 빈 결과',
  A.refine([], 5).length === 0 && A.refine(null, 5).length === 0
  && A.refine([{ mix: [{ tag: 'a', weight: 1, on: true }], score: 0 }], 5).length === 0);


// ── 라벨 한꺼번에 다루기 ────────────────────────────────────────────────
// ★라벨을 작가마다 손으로 적게 하면 스무 명한테 붙이려고 스무 번을 타이핑하게 된다.
//   그래서 「한 번 고르고 여럿에게」 가 가능해야 한다.
let ls = A.add(A.add(A.add([], { name: 'a' }), { name: 'b' }), { name: 'c' });
ls = A.toggleCat(ls, 'b', '수채');

const catsOf = function (l, t) {
  const e = l.find(function (x) { return x.tag === t; });
  return e ? e.cats.slice() : null;
};

let ls2 = A.setCat(ls, ['a', 'b', 'c'], '수채', true);
check('여럿에게 한 번에 붙는다',
  ['a', 'b', 'c'].every(function (t) { return catsOf(ls2, t).indexOf('수채') !== -1; }));
check('★이미 붙어 있던 사람이 거꾸로 떨어지지 않는다 (토글이 아니라 지정이다)',
  catsOf(ls2, 'b').filter(function (c) { return c === '수채'; }).length === 1,
  JSON.stringify(catsOf(ls2, 'b')));

let ls3 = A.setCat(ls2, ['a', 'b', 'c'], '수채', false);
check('여럿에게서 한 번에 뗀다',
  ['a', 'b', 'c'].every(function (t) { return catsOf(ls3, t).indexOf('수채') === -1; }));
check('고른 사람만 건드린다',
  catsOf(A.setCat(ls2, ['a'], '수채', false), 'b').indexOf('수채') !== -1);
check('빈 이름은 아무것도 안 한다',
  JSON.stringify(A.setCat(ls, ['a'], '  ', true)) === JSON.stringify(ls));

// 이름 바꾸기
let lr = A.setCat(ls, ['a', 'b'], '두꺼운 선', true);
lr = A.setCat(lr, ['b'], '굵은 선', true);
const lr2 = A.renameCat(lr, '두꺼운 선', '굵은 선');
check('이름을 바꾸면 붙어 있던 사람이 따라온다',
  catsOf(lr2, 'a').indexOf('굵은 선') !== -1 && catsOf(lr2, 'a').indexOf('두꺼운 선') === -1);
check('★새 이름을 이미 갖고 있던 사람에게 두 번 들어가지 않는다 (같은 라벨이 둘이면 세는 것이 어긋난다)',
  catsOf(lr2, 'b').filter(function (c) { return c === '굵은 선'; }).length === 1,
  JSON.stringify(catsOf(lr2, 'b')));
check('안 붙어 있던 사람은 그대로', catsOf(lr2, 'c').length === 0);
check('같은 이름으로 바꾸라고 하면 그대로',
  JSON.stringify(A.renameCat(lr, '두꺼운 선', '두꺼운 선')) === JSON.stringify(lr));
check('빈 이름으로는 안 바꾼다',
  JSON.stringify(A.renameCat(lr, '두꺼운 선', ' ')) === JSON.stringify(lr));

// 라벨 지우기
const ld = A.removeCat(lr, '두꺼운 선');
check('라벨을 지우면 전부 떨어진다',
  A.categories(ld).every(function (c) { return c.name !== '두꺼운 선'; }),
  JSON.stringify(A.categories(ld)));
check('★라벨을 지워도 작가는 서랍에 남는다', ld.length === 3);
check('다른 라벨은 안 건드린다', catsOf(ld, 'b').indexOf('굵은 선') !== -1);
check('없는 라벨을 지우라고 해도 안 터진다',
  JSON.stringify(A.removeCat(lr, '없는것')) === JSON.stringify(lr));

// ── 라벨별로 묶어 보여 주기 ──────────────────────────────────────────────
// ★스무 명이 한 줄로 늘어서 있으면 어느 것이 무엇인지 알 수가 없다.
let gl = A.add(A.add(A.add(A.add([], { name: 'w' }), { name: 'x' }), { name: 'y' }), { name: 'z' });
gl = A.setCat(gl, ['w', 'x'], '수채', true);
gl = A.setCat(gl, ['w'], '두꺼운 선', true);
// y 는 라벨 없음, z 는 서랍에 없는 태그로 흉내 낸다

let g = A.groupByLabel(['w', 'x', 'y', '서랍밖'], gl);
const byName = function (n) { return g.find(function (x) { return x.label === n; }); };
check('많이 붙은 라벨이 먼저', g[0].label === '수채', JSON.stringify(g.map(function (x) { return x.label; })));
check('★한 사람이 두 라벨에 걸치면 양쪽에 다 나온다 (하나로 몰면 다른 쪽에서 못 찾는다)',
  byName('수채').tags.indexOf('w') !== -1 && byName('두꺼운 선').tags.indexOf('w') !== -1);
check('라벨 없는 사람은 따로 모은다', byName('라벨 없음').tags.join(',') === 'y');
check('★서랍에 없는 태그도 버리지 않는다 (작가 태그 칸에서 불러온 것이 사라지면 안 된다)',
  byName('서랍에 없음').tags.join(',') === '서랍밖');
check('라벨 없음·서랍에 없음이 맨 뒤',
  g[g.length - 1].label === '서랍에 없음' && g[g.length - 2].label === '라벨 없음',
  JSON.stringify(g.map(function (x) { return x.label; })));
check('빈 목록이면 빈 결과', A.groupByLabel([], gl).length === 0 && A.groupByLabel(null, gl).length === 0);
check('서랍이 비어 있으면 전부 「서랍에 없음」',
  A.groupByLabel(['a', 'b'], []).length === 1
  && A.groupByLabel(['a', 'b'], [])[0].tags.length === 2);
check('★모든 태그가 한 번씩은 나온다 (묶다가 흘리면 고를 수가 없다)',
  ['w', 'x', 'y', '서랍밖'].every(function (t) {
    return g.some(function (x) { return x.tags.indexOf(t) !== -1; });
  }));

// ── 이름 끝이 숫자인 작가 ────────────────────────────────────────────────
// ★NAI 의 `숫자::` 는 여는 괄호가 아니라 "여기서부터 뒤로 이 가중치" 라는 뜻이고,
//   맨 뒤의 `::` 가 되돌린다. 그래서 `::` 바로 앞에 숫자가 오면 그 숫자가 새 가중치로
//   읽힌다. 1.2::artist:119:: 는 "artist: 뒤로 119배" 가 되어 그림이 깨진다.
//   이걸 놓치면 사람은 왜 깨졌는지 알 방법이 없다.
const mk = function (t, w) { return { tag: t, weight: w, on: true }; };

// 굽은 글에 「숫자 바로 뒤에 ::」 가 있으면 안 된다. 이 검사가 이 절의 핵심이다.
// ★맨 앞이나 쉼표 뒤에 오는 「숫자::」 는 정상적인 가중치 시작이다. 그것만 지운 뒤에도
//   숫자+:: 가 남아 있으면, NAI 가 그 숫자를 새 가중치로 읽는다는 뜻이다.
const anyDigitBeforeColons = function (out) {
  return /[0-9]::/.test(out.replace(/(^|,\s)[0-9.]+::/g, '$1'));
};

let out = A.bake([mk('artist:119', 1.2), mk('artist:meola', 1.2)]);
check('★숫자로 끝나는 작가를 무리 앞에 두고 안전한 작가를 뒤에 세운다',
  out === '1.2::artist:119, artist:meola::', out);
check('★그 결과에 「숫자 바로 뒤 ::」 가 없다', !anyDigitBeforeColons(out), out);

out = A.bake([mk('artist:meola', 1.2), mk('artist:119', 1.2)]);
check('★넣은 차례가 반대여도 숫자로 끝나는 쪽이 앞으로 간다',
  out === '1.2::artist:119, artist:meola::', out);

out = A.bake([mk('artist:119', 1.2)]);
check('★혼자면 괄호로 간다 (숫자:: 를 쓸 수가 없다)', /^\{+artist:119\}+$/.test(out), out);
check('1.2 는 괄호 네 겹 (1.05^4 = 1.2155)', out === '{{{{artist:119}}}}', out);
check('★괄호 쪽에도 숫자 뒤 :: 가 없다', out.indexOf('::') === -1, out);

out = A.bake([mk('as109', 0.8)]);
check('내리는 쪽은 대괄호', /^\[+as109\]+$/.test(out), out);
check('0.8 은 다섯 겹 (1.05^-5 = 0.7835)', out === '[[[[[as109]]]]]', out);

check('1.0 이면 괄호도 문법도 안 붙는다', A.bake([mk('artist:119', 1)]) === 'artist:119');

// 여러 무리
out = A.bake([mk('wlop', 1.2), mk('as109', 1.2), mk('sakimichan', 0.9)]);
check('같은 가중치는 한 무리로 묶는다',
  out === '1.2::as109, wlop::, 0.9::sakimichan::', out);
check('★묶어도 숫자 뒤 :: 가 안 생긴다', !anyDigitBeforeColons(out), out);

out = A.bake([mk('a1', 1.2), mk('b2', 1.2), mk('safe', 1.2)]);
check('숫자로 끝나는 것이 여럿이어도 안전한 하나만 뒤에 있으면 된다',
  out === '1.2::a1, b2, safe::', out);
check('그때도 숫자 뒤 :: 없음', !anyDigitBeforeColons(out), out);

out = A.bake([mk('a1', 1.2), mk('b2', 1.2)]);
check('★전부 숫자로 끝나면 통째로 괄호',
  out === '{{{{a1}}}}, {{{{b2}}}}', out);

// 무리 차례는 처음 나온 순서를 지킨다
out = A.bake([mk('zzz', 0.9), mk('aaa', 1.2), mk('yyy', 0.9)]);
check('무리가 나온 차례대로 온다', out === '0.9::zzz, yyy::, 1.2::aaa::', out);

check('꺼 둔 작가는 안 나온다',
  A.bake([mk('wlop', 1.2), { tag: 'as109', weight: 1.2, on: false }]) === '1.2::wlop::');

// 끝이 숫자인지 가리기
check('끝이 숫자면 참', A.endsWithDigit('artist:119') && A.endsWithDigit('as109'));
check('끝이 글자면 거짓', !A.endsWithDigit('wlop') && !A.endsWithDigit('artist:meola'));
check('가운데 숫자는 상관없다', !A.endsWithDigit('as109b'));

// 괄호로 갔을 때 실제 값
check('괄호 값을 알려 준다', A.braceWeight(1.2) === 1.22, String(A.braceWeight(1.2)));
check('1.0 은 그대로', A.braceWeight(1) === 1);

const off = A.approximated([mk('artist:119', 1.2), mk('wlop', 0.9)]);
check('괄호로 나가는 작가만 짚어 준다', off.length === 1 && off[0].tag === 'artist:119',
  JSON.stringify(off));
check('원한 값과 실제 값을 같이 준다', off[0].want === 1.2 && off[0].got === 1.22,
  JSON.stringify(off[0]));
check('★같은 가중치 짝이 있으면 어긋나지 않는다 (정확한 값으로 나간다)',
  A.approximated([mk('artist:119', 1.2), mk('wlop', 1.2)]).length === 0);

// 어떤 조합을 넣어도 「숫자 바로 뒤 ::」 가 안 나오는가 — 이 절의 안전망.
// ★한 건으로 묶어 첫 사고만 알려 준다. 120 줄이 똑같은 말로 지나가면 정작 다른 검사가 묻힌다.
const bad = [];
['artist:119', 'as109', 'wlop', 'meola2', '3', 'x'].forEach(function (t1) {
  ['artist:meola', 'as109', 'wlop', '7'].forEach(function (t2) {
    [0.6, 0.85, 1, 1.2, 1.4, 2].forEach(function (w) {
      [true, false].forEach(function (two) {
        const o = two ? A.bake([mk(t1, w), mk(t2, w)]) : A.bake([mk(t1, w)]);
        if (anyDigitBeforeColons(o)) bad.push(t1 + (two ? ' + ' + t2 : '') + ' @' + w + ' → ' + o);
      });
    });
  });
});
check('★어떤 조합에도 「숫자 바로 뒤 ::」 가 안 나온다 (' + (6 * 4 * 6 * 2) + '가지)',
  bad.length === 0, bad.slice(0, 5).join('\n     '));

const total = pass + fails.length;
console.log('작가 서랍 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
