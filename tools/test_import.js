// PeroFix JSON 가져오기 검사.
// 사용: node mobile/tools/test_import.js
'use strict';

const PI = require('../www/js/perofix-import.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 정상 ────────────────────────────────────────────────────────────
const good = JSON.stringify({
  name: '미아 · 일상 모드',
  prefix: '1girl, silver hair',
  slots: [
    { name: '1-1', content: 'bedroom, soft light, smile', locked: false },
    { name: '1-2', content: 'kitchen, warm light, laughing', locked: true }
  ]
});
let r = PI.parse(good);
check('정상 JSON 을 읽는다', r.ok, r.error);
check('prefix → 공통 프롬프트', r.ok && r.prefix === '1girl, silver hair');
check('name → 슬롯 라벨', r.ok && r.slots[0].label === '1-1');
check('content → 슬롯 프롬프트', r.ok && r.slots[0].prompt === 'bedroom, soft light, smile');
check('locked 를 보존한다', r.ok && r.slots[1].locked === true);
check('가져온 슬롯은 켜진 상태', r.ok && r.slots[0].enabled === true);

// ── 코드블록째 붙여넣기 (아주 흔한 사고) ────────────────────────────
r = PI.parse('```json\n' + good + '\n```');
check('```json 표시를 붙여넣어도 읽는다', r.ok, r.error);

// ── slots 배열만 준 경우 ────────────────────────────────────────────
r = PI.parse(JSON.stringify([{ name: 'a', content: 'x' }]));
check('slots 배열만 줘도 읽는다', r.ok && r.slots.length === 1, r.error);

// ── 이름 겹침 ───────────────────────────────────────────────────────
r = PI.parse(JSON.stringify({
  slots: [
    { name: 'happy', content: 'a' },
    { name: 'happy', content: 'b' },
    { name: 'happy', content: 'c' }
  ]
}));
check('같은 이름은 갈라 준다 (파일 겹침 방지)',
  r.ok && r.slots.map(function (s) { return s.label; }).join(',') === 'happy,happy_2,happy_3',
  r.ok ? r.slots.map(function (s) { return s.label; }).join(',') : r.error);

// ── 이름이 없는 슬롯 ────────────────────────────────────────────────
r = PI.parse(JSON.stringify({ slots: [{ content: 'x' }] }));
check('이름이 없으면 slot1 로 채운다', r.ok && r.slots[0].label === 'slot1', r.error);

// ── 오류 ────────────────────────────────────────────────────────────
const bad = [
  ['빈 입력', '', /비어/],
  ['JSON 아님', '이건 그냥 글', /JSON 형식/],
  ['slots 없음', '{"prefix":"x"}', /slots/],
  ['slots 비어 있음', '{"slots":[]}', /비어/],
  ['content 비어 있음', '{"slots":[{"name":"a","content":"  "}]}', /1번째 슬롯/],
  ['슬롯이 객체가 아님', '{"slots":["문자열"]}', /1번째 슬롯/]
];
bad.forEach(function (b) {
  const res = PI.parse(b[1]);
  check('거부해야 함 — ' + b[0], !res.ok && b[2].test(res.error || ''),
    '실제 오류: ' + (res.error || '(없음, ok=' + res.ok + ')'));
});

// ── 왕복 ────────────────────────────────────────────────────────────
const back = PI.build('n', 'p', [{ label: 'a', prompt: 'x', locked: true }]);
const round = PI.parse(JSON.stringify(back));
check('내보냈다 다시 읽어도 같다',
  round.ok && round.prefix === 'p' && round.slots[0].label === 'a' && round.slots[0].locked === true,
  JSON.stringify(back));

// ── 캐릭터 프롬프트 JSON ────────────────────────────────────────────
const chars = JSON.stringify({
  characters: [
    { content: '1girl, blonde', uc: 'bad hands', coord: 'a1', skipSlotPrompt: false, name: '미아', enabled: true },
    { content: '1boy, black hair', uc: '', coord: 'E5', skipSlotPrompt: true, name: '', enabled: false }
  ]
});
let rc = PI.parseCharacters(chars);
check('캐릭터 JSON 을 읽는다', rc.ok, rc.error);
check('content → 프롬프트', rc.ok && rc.characters[0].prompt === '1girl, blonde');
check('인물별 UC 를 읽는다', rc.ok && rc.characters[0].uc === 'bad hands');
check('좌표를 읽는다', rc.ok && rc.characters[0].coord === 'a1');
check('대문자 좌표도 소문자로 맞춘다', rc.ok && rc.characters[1].coord === 'e5');
check('skipSlotPrompt 를 읽는다', rc.ok && rc.characters[1].skipSlotPrompt === true);
check('enabled 를 읽는다', rc.ok && rc.characters[1].enabled === false);

rc = PI.parseCharacters(JSON.stringify([{ prompt: '1girl' }]));
check('배열만 줘도 읽고 prompt 칸도 받는다', rc.ok && rc.characters[0].prompt === '1girl', rc.error);

rc = PI.parseCharacters(JSON.stringify({ characters: [{ content: 'x', coord: 'z9' }] }));
check('이상한 좌표는 위치 지정을 끈다', rc.ok && rc.characters[0].coord === null,
  rc.ok ? String(rc.characters[0].coord) : rc.error);

[['빈 입력', '', /비어/],
 ['characters 없음', '{"slots":[]}', /characters/],
 ['빈 목록', '{"characters":[]}', /하나도 없/],
 ['프롬프트 비어 있음', '{"characters":[{"content":"  "}]}', /1번째 캐릭터/]
].forEach(function (b) {
  const res = PI.parseCharacters(b[1]);
  check('캐릭터 거부 — ' + b[0], !res.ok && b[2].test(res.error || ''),
    '실제: ' + (res.error || 'ok'));
});

const cback = PI.buildCharacters([{ prompt: 'a', uc: 'b', coord: 'c3', skipSlotPrompt: true, name: 'n' }]);
const cround = PI.parseCharacters(JSON.stringify(cback));
check('캐릭터 왕복', cround.ok && cround.characters[0].prompt === 'a'
  && cround.characters[0].coord === 'c3' && cround.characters[0].skipSlotPrompt === true);

const total = pass + fails.length;
console.log('JSON 가져오기 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
