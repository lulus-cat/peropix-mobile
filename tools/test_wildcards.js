// 와일드카드 검사 — 데스크톱판과 같은 규칙으로 뽑는가.
// 사용: node mobile/tools/test_wildcards.js
'use strict';

const W = require('../www/js/wildcards.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// 난수를 고정해 결과를 확정한다 (항상 첫 후보 / 항상 마지막 후보).
const first = function () { return 0; };
const last = function () { return 0.999999; };

// ── 정의 문서 읽기 ────────────────────────────────────────────────────
const doc = [
  '// 맨 앞 설명은 무시된다',
  '헤더 없는 본문도 무시된다',
  '',
  '#hair',
  'blonde hair',
  '(black hair:1.2)',
  'red twintails, long hair   // 줄 끝 주석',
  '',
  '#outfit',
  'school uniform',
  'white dress,',
  '',
  '#EMPTY'
].join('\n');

const pools = W.parse(doc);
check('풀 이름을 소문자로 모은다', Object.keys(pools).sort().join(',') === 'empty,hair,outfit',
  Object.keys(pools).join(','));
check('후보 수', pools.hair.length === 3, JSON.stringify(pools.hair));
check('줄 끝 주석을 떼어낸다', pools.hair[2] === 'red twintails, long hair', JSON.stringify(pools.hair[2]));
check('후보 끝 쉼표를 정리한다', pools.outfit[1] === 'white dress', JSON.stringify(pools.outfit[1]));
check('헤더 없는 본문은 버린다', !Object.keys(pools).includes('헤더'), Object.keys(pools).join(','));
check('빈 풀도 만들어 둔다', Array.isArray(pools.empty) && pools.empty.length === 0);

// ── 치환 ──────────────────────────────────────────────────────────────
check('#이름 을 첫 후보로', W.resolve('1girl, #hair', pools, first) === '1girl, blonde hair',
  W.resolve('1girl, #hair', pools, first));
check('#이름 을 마지막 후보로',
  W.resolve('1girl, #hair', pools, last) === '1girl, red twintails, long hair',
  W.resolve('1girl, #hair', pools, last));
check('정의가 없으면 원문 유지', W.resolve('1girl, #nope', pools, first) === '1girl, #nope');
check('빈 풀도 원문 유지', W.resolve('1girl, #empty', pools, first) === '1girl, #empty');

// ★NAI 액션 태그의 # 은 건드리면 안 된다 — 다인물 상호작용이 통째로 깨진다.
check('source#hug 를 건드리지 않는다',
  W.resolve('girl, source#hug, target#hug', pools, first) === 'girl, source#hug, target#hug',
  W.resolve('girl, source#hug, target#hug', pools, first));
check('mutual#holding hands 도 안전',
  W.resolve('mutual#holding hands', pools, first) === 'mutual#holding hands');

// 인라인
check('{a|b} 첫 번째', W.resolve('{red|blue} dress', pools, first) === 'red dress');
check('{a|b} 마지막', W.resolve('{red|blue} dress', pools, last) === 'blue dress');
check('||a|b|| 첫 번째', W.resolve('||x|y||', pools, first) === 'x');
check('||a|b|| 마지막', W.resolve('||x|y||', pools, last) === 'y');

// 중첩
const nested = W.parse(['#scene', '1girl, #hair, #outfit', '', '#hair', '{silver|pink} hair',
  '', '#outfit', 'school uniform'].join('\n'));
check('풀 안에서 다른 풀을 부른다',
  W.resolve('#scene', nested, first) === '1girl, silver hair, school uniform',
  W.resolve('#scene', nested, first));

// 순환 참조 — 멈춰야 한다 (무한 재귀로 앱이 죽으면 안 된다)
const cyc = W.parse(['#a', '#b', '', '#b', '#a'].join('\n'));
let cycOut = null;
try {
  cycOut = W.resolve('#a', cyc, first);
  check('순환 참조에서 멈춘다 (앱이 죽지 않는다)', typeof cycOut === 'string');
} catch (e) {
  fails.push('순환 참조에서 예외: ' + e.message);
}

// ── 토큰 감지 ─────────────────────────────────────────────────────────
check('토큰 감지 — #이름', W.hasTokens('1girl, #hair') === true);
check('토큰 감지 — {a|b}', W.hasTokens('{a|b}') === true);
check('토큰 감지 — ||a|b||', W.hasTokens('||a|b||') === true);
check('토큰 없음', W.hasTokens('1girl, smile') === false);
check('액션 태그는 토큰이 아니다', W.hasTokens('source#hug') === false);

// 기본 샘플이 실제로 읽히는지
const sample = W.parse(W.SAMPLE);
check('기본 샘플이 풀 3개를 만든다', Object.keys(sample).length === 3, Object.keys(sample).join(','));

const total = pass + fails.length;
console.log('와일드카드 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
