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

const total = pass + fails.length;
console.log('작가 서랍 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
