// 저장 경로 규칙 검사.
//
// 이름 규칙이 틀리면 파일이 조용히 덮어써지거나(같은 이름) 저장이 실패한다(금지 문자).
// 둘 다 눈에 안 띄므로 여기서 잡는다.
//
// 사용: node mobile/tools/test_naming.js
'use strict';

const Naming = require('../www/js/naming.js');

const NOW = new Date(2026, 7, 21, 9, 5, 3); // 2026-08-21 09:05:03

const cases = [
  {
    why: '기본 — 폴더 이름 + 라벨',
    t: '{folder}/{label}.png',
    v: { persona: '미아', label: 'happy' },
    want: '미아/happy.png'
  },
  {
    // ★{persona} 는 예전 이름이다. 이미 저장해 둔 규칙이 깨지면 안 된다.
    why: '예전 이름 {persona} 도 그대로 읽힌다',
    t: '{persona}/{label}.png',
    v: { persona: '미아', label: 'happy' },
    want: '미아/happy.png'
  },
  {
    why: '{folder} 와 {persona} 를 섞어 써도 같은 값이 들어간다',
    t: '{folder}/{persona}_{label}.png',
    v: { persona: '미아', label: 'happy' },
    want: '미아/미아_happy.png'
  },
  {
    why: '좌표형 라벨의 하이픈은 살아 있어야 한다',
    t: '{persona}/{label}.png',
    v: { persona: '미아', label: '1-3' },
    want: '미아/1-3.png'
  },
  {
    why: '라벨 안의 슬래시가 폴더로 승격되면 안 된다',
    t: '{persona}/{label}.png',
    v: { persona: '미아', label: 'happy/sad' },
    want: '미아/happy_sad.png'
  },
  {
    why: '공백은 밑줄로',
    t: '{persona}/{label}.png',
    v: { persona: '미 아', label: 'half closed eyes' },
    want: '미_아/half_closed_eyes.png'
  },
  {
    why: '윈도우 금지 문자',
    t: '{persona}/{label}.png',
    v: { persona: 'a:b*c', label: 'q?"<>|' },
    want: 'a_b_c/q_____.png'
  },
  {
    why: '윈도우 예약 이름은 저장이 실패한다 — 비켜 준다',
    t: '{persona}/{label}.png',
    v: { persona: 'CON', label: 'nul' },
    want: 'CON_/nul_.png'
  },
  {
    why: '경로 탈출 시도는 조각째 버린다',
    t: '{persona}/{label}.png',
    v: { persona: '..', label: 'x' },
    want: 'x.png'
  },
  {
    why: '시드·순번·날짜 토큰',
    t: '{date}/{persona}_{label}_{seq}_{seed}.png',
    v: { persona: '미아', label: 'happy', seq: 7, seed: 12345, now: NOW },
    want: '20260821/미아_happy_007_12345.png'
  },
  {
    why: '모르는 토큰은 글자 그대로 둔다',
    t: '{persona}/{nope}.png',
    v: { persona: '미아' },
    want: '미아/{nope}.png'
  },
  {
    why: '빈 규칙이어도 저장 가능한 이름이 나와야 한다',
    t: '',
    v: { persona: '미아', label: 'happy' },
    want: 'image.png'
  },
  {
    why: 'H 접두는 폴더가 아니라 파일명 앞에 붙는다',
    t: '{persona}/{label}.png',
    v: { persona: '미아', label: 'kiss', isHscene: true, hscenePrefix: 'H_' },
    want: '미아/H_kiss.png'
  },
  {
    why: 'H가 아니면 접두를 붙이지 않는다',
    t: '{persona}/{label}.png',
    v: { persona: '미아', label: 'kiss', isHscene: false, hscenePrefix: 'H_' },
    want: '미아/kiss.png'
  },
  {
    why: '끝의 점은 윈도우에서 잘린다 — 미리 없앤다',
    t: '{persona}/{label}.png',
    v: { persona: '미아...', label: 'happy' },
    want: '미아/happy.png'
  }
];

let pass = 0;
const fails = [];

cases.forEach(function (c) {
  let got;
  try {
    got = Naming.render(c.t, Object.assign({ now: NOW }, c.v));
  } catch (e) {
    fails.push(c.why + ' → 예외: ' + e.message);
    return;
  }
  if (got === c.want) pass++;
  else fails.push(c.why + '\n     기대=' + JSON.stringify(c.want) + '\n     실제=' + JSON.stringify(got));
});

// 겹침 회피
const used = new Set();
const dedupeGot = [
  Naming.dedupe('미아/happy.png', used),
  Naming.dedupe('미아/happy.png', used),
  Naming.dedupe('미아/happy.png', used),
  Naming.dedupe('미아/sad.png', used)
];
const dedupeWant = ['미아/happy.png', '미아/happy_2.png', '미아/happy_3.png', '미아/sad.png'];
if (JSON.stringify(dedupeGot) === JSON.stringify(dedupeWant)) pass++;
else fails.push('같은 이름은 _2, _3 으로 비켜야 한다\n     기대=' + JSON.stringify(dedupeWant) +
                '\n     실제=' + JSON.stringify(dedupeGot));

// 프리셋이 전부 유효한 경로를 내는지
Naming.PRESETS.forEach(function (p) {
  const out = Naming.render(p.template, { persona: '미아', label: 'happy', seq: 1, seed: 9, now: NOW });
  if (/[\\:*?"<>|]/.test(out) || !out.endsWith('.png')) {
    fails.push('프리셋 "' + p.name + '" 이 이상한 경로를 냄: ' + out);
  } else pass++;
});

const total = cases.length + 1 + Naming.PRESETS.length;
console.log('이름 규칙 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
