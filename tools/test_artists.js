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

// ── 2. 세기 자르기 ────────────────────────────────────────────────────────
check('★1.4 를 넘으면 자른다 (그 위는 작가가 그림을 잡아먹는다)', A.clampWeight(3) === 1.4);
check('★0.6 아래도 자른다 (그 아래는 없는 것과 같다)', A.clampWeight(0.1) === 0.6);
check('눈금(0.05)에 맞춘다', A.clampWeight(1.113) === 1.1, String(A.clampWeight(1.113)));
check('숫자가 아니면 1.0', A.clampWeight('아무거나') === 1 && A.clampWeight(undefined) === 1);

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
  sc[0].prompt.indexOf('0.7::wlop::') !== -1, sc[0].prompt);
check('눈금을 직접 줄 수 있다', A.scan(A.mix(['a']), 'a', [0.8, 1.2]).length === 2);
check('★잘린 뒤 겹치는 값은 하나만 남긴다 (같은 그림을 두 번 뽑으면 Anlas 낭비다)',
  A.scan(A.mix(['a']), 'a', [3, 4, 5]).length === 1,
  String(A.scan(A.mix(['a']), 'a', [3, 4, 5]).length));

const total = pass + fails.length;
console.log('작가 서랍 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
