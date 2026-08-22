// 생성 목록 검사 — 몇 장을, 어떤 순서로 뽑는가.
//
// ★여기가 틀리면 돈이 나간다. 인물 8명 × 슬롯 10개를 한 명 모드로 돌리면 80장이고,
//   순서가 어긋나면 중간에 멈췄을 때 어느 인물이 반쯤 찼는지 알 수 없다.
// 사용: node tools/test_jobs.js
'use strict';

const Jobs = require('../www/js/jobs.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

const SLOTS = [
  { label: '1-1', prompt: 'smile' },
  { label: '1-2', prompt: 'angry' },
  { label: '꺼진것', prompt: 'sad', enabled: false },
  { label: '빈칸', prompt: '' }
];
const CHARS = [
  { name: '미아', prompt: '1girl, silver hair' },
  { name: '', prompt: '1girl, black hair' },
  { name: '리사', prompt: '1girl, red hair', enabled: false },
  { name: '유나', prompt: '1girl, blue hair' }
];

// ── 1. 보통 (한 명 모드 꺼짐) ─────────────────────────────────────────
let jobs = Jobs.build({ slots: SLOTS, chars: CHARS, base: '', perSlot: 1, oneChar: false });
check('꺼진 슬롯은 빠진다', jobs.every(function (j) { return j.slotName !== '꺼진것'; }));
check('프롬프트가 비고 공통도 없으면 빠진다',
  jobs.every(function (j) { return j.slotName !== '빈칸'; }), jobs.map(function (j) { return j.slotName; }).join(','));
check('켠 슬롯만큼만 돈다', jobs.length === 2, String(jobs.length));
check('인물은 묶어서 한 번에 나간다 (한 명 모드가 아니므로)',
  jobs.every(function (j) { return j.char === null && j.charName === ''; }));
check('묶음 이름은 슬롯 이름', jobs[0].group === '1-1');
check('배수가 1이면 이름에 # 이 없다', jobs[0].name === '1-1');

// 공통 프롬프트가 있으면 슬롯 프롬프트가 비어도 뽑는다
jobs = Jobs.build({ slots: SLOTS, chars: CHARS, base: '1girl', perSlot: 1, oneChar: false });
check('공통 프롬프트가 있으면 빈 슬롯도 뽑는다', jobs.length === 3,
  jobs.map(function (j) { return j.slotName; }).join(','));

// ── 2. 배수 ───────────────────────────────────────────────────────────
jobs = Jobs.build({ slots: SLOTS, chars: CHARS, base: '', perSlot: 3, oneChar: false });
check('배수만큼 늘어난다', jobs.length === 6, String(jobs.length));
check('★배수가 슬롯보다 바깥이다 (한 바퀴씩 돈다)',
  jobs.map(function (j) { return j.slotName + '/' + j.cycle; }).join(' ')
  === '1-1/1 1-2/1 1-1/2 1-2/2 1-1/3 1-2/3',
  jobs.map(function (j) { return j.slotName + '/' + j.cycle; }).join(' '));
check('배수가 1보다 크면 이름에 #사이클이 붙는다', jobs[0].name === '1-1#1' && jobs[2].name === '1-1#2');

// ── 3. 한 명 모드 ─────────────────────────────────────────────────────
jobs = Jobs.build({ slots: SLOTS, chars: CHARS, base: '', perSlot: 1, oneChar: true });
check('켠 인물 × 켠 슬롯 만큼 돈다 (3 × 2)', jobs.length === 6, String(jobs.length));
check('꺼진 인물은 빠진다', jobs.every(function (j) { return j.charName !== '리사'; }));
check('이름이 없는 인물은 「인물 2」 로 부른다',
  jobs.some(function (j) { return j.charName === '인물 2'; }),
  jobs.map(function (j) { return j.charName; }).join(','));
check('★인물이 제일 바깥이다 (한 인물을 끝내고 다음으로)',
  jobs.map(function (j) { return j.charName + '/' + j.slotName; }).join(' ')
  === '미아/1-1 미아/1-2 인물 2/1-1 인물 2/1-2 유나/1-1 유나/1-2',
  jobs.map(function (j) { return j.charName + '/' + j.slotName; }).join(' '));
check('한 장에 인물 하나만 실린다',
  jobs.every(function (j) { return j.char && j.char.prompt; }));
check('묶음 이름이 「인물 · 슬롯」', jobs[0].group === '미아 · 1-1');
check('원래 인물 자리(index)를 들고 있다', jobs[0].charIndex === 0 && jobs[2].charIndex === 1);

// 인물 × 배수 × 슬롯
jobs = Jobs.build({ slots: SLOTS, chars: CHARS, base: '', perSlot: 2, oneChar: true });
check('인물 × 배수 × 슬롯 (3 × 2 × 2)', jobs.length === 12, String(jobs.length));
check('★한 인물 안에서 배수가 슬롯보다 바깥',
  jobs.slice(0, 4).map(function (j) { return j.slotName + '/' + j.cycle; }).join(' ')
  === '1-1/1 1-2/1 1-1/2 1-2/2',
  jobs.slice(0, 4).map(function (j) { return j.slotName + '/' + j.cycle; }).join(' '));
check('다음 인물로 넘어간 뒤 사이클이 1부터 다시', jobs[4].charName === '인물 2' && jobs[4].cycle === 1);

// ── 4. 가장자리 ───────────────────────────────────────────────────────
check('인물이 하나도 없으면 한 명 모드는 그냥 보통처럼 돈다',
  Jobs.build({ slots: SLOTS, chars: [], base: '', perSlot: 1, oneChar: true }).length === 2);
check('인물을 전부 꺼 두면 보통처럼 돈다',
  Jobs.build({
    slots: SLOTS, chars: [{ name: 'a', enabled: false }], base: '', perSlot: 1, oneChar: true
  }).length === 2);
check('슬롯이 없으면 아무것도 안 돈다',
  Jobs.build({ slots: [], chars: CHARS, base: '1girl', perSlot: 2, oneChar: true }).length === 0);
check('배수가 0이거나 이상해도 1로 본다',
  Jobs.build({ slots: SLOTS, chars: CHARS, base: '', perSlot: 0, oneChar: false }).length === 2
  && Jobs.build({ slots: SLOTS, chars: CHARS, base: '', perSlot: null, oneChar: false }).length === 2);
check('이름 없는 슬롯은 slot1, slot2 로 부른다',
  Jobs.build({ slots: [{ prompt: 'a' }, { prompt: 'b' }], chars: [], base: '', perSlot: 1 })
    .map(function (j) { return j.slotName; }).join(',') === 'slot1,slot2');

check('count() 는 build().length 와 같다',
  Jobs.count({ slots: SLOTS, chars: CHARS, base: '', perSlot: 3, oneChar: true }) === 18);

// 인물 8명 × 슬롯 10개 — 실제로 쓰는 규모에서 수가 맞는지
const many = { slots: [], chars: [] };
for (let i = 0; i < 10; i++) many.slots.push({ label: 's' + i, prompt: 'p' });
for (let i = 0; i < 8; i++) many.chars.push({ name: 'c' + i, prompt: 'p' });
check('8명 × 10슬롯 × 2배수 = 160장',
  Jobs.count({ slots: many.slots, chars: many.chars, base: '', perSlot: 2, oneChar: true }) === 160);
check('같은 설정에서 한 명 모드를 끄면 20장',
  Jobs.count({ slots: many.slots, chars: many.chars, base: '', perSlot: 2, oneChar: false }) === 20);

const total = pass + fails.length;
console.log('생성 목록 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
