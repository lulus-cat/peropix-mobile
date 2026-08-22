// Anlas 계산 대조 — backend.py 와 같은 숫자를 내는가.
//
// ★틀리면 "무료인 줄 알았는데 차감" 또는 그 반대가 된다. 눈으로는 안 보이는 결함이라
//   원본과 기계적으로 맞춘다.
// 사용: node mobile/tools/test_anlas.js
'use strict';

const fs = require('fs');
const path = require('path');

// anlas.js 는 NAI_TABLES 전역을 쓴다 (브라우저에서 스크립트 태그로 먼저 로드되는 구조).
global.NAI_TABLES = require('../www/js/nai-tables.js');
const Anlas = require('../www/js/anlas.js');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference_anlas.json'), 'utf8'));

let pass = 0;
const fails = [];

ref.forEach(function (c, i) {
  const o = c.input;

  const gotSample = Anlas.imageSampleCost(o.width, o.height, o.steps, o.smea, o.smea_dyn, o.model);
  if (Math.abs(gotSample - c.sample_cost) > 1e-9) {
    fails.push(`case ${i} 장당 원가: 기준=${c.sample_cost} 포팅=${gotSample}\n     ${JSON.stringify(o)}`);
    return;
  }

  const got = Anlas.perImageCost({
    width: o.width, height: o.height, steps: o.steps,
    isOpus: o.is_opus, refCount: o.precise_ref_count, strength: o.strength,
    smea: o.smea, smeaDyn: o.smea_dyn, model: o.model, opusExhausted: o.opus_exhausted
  });
  if (got !== c.per_image) {
    fails.push(`case ${i} 장당 비용: 기준=${c.per_image} 포팅=${got}\n     ${JSON.stringify(o)}`);
    return;
  }
  pass++;
});

// ── 배치 합계·상한 ────────────────────────────────────────────────────
function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

const base = { width: 832, height: 1216, steps: 28, model: 'nai-diffusion-4-5-full' };

let e = Anlas.estimate(Object.assign({}, base, { isOpus: true, count: 12 }));
check('Opus·1MP 이하·28스텝은 배치 전체가 무료', e.total === 0 && e.free, JSON.stringify(e));

e = Anlas.estimate(Object.assign({}, base, { isOpus: true, count: 12, refCount: 1 }));
check('참조 1장이면 장당 5 씩 12장 = 60', e.total === 60, JSON.stringify(e));

// ★V5 는 참조를 지원하지 않는다 → 계산에서도 빠져야 한다 (전송 경로와 같은 조건).
e = Anlas.estimate({ width: 832, height: 1216, steps: 28, model: 'nai-diffusion-5-full',
  isOpus: true, count: 3, refCount: 2 });
check('V5 는 참조비가 붙지 않는다 (전송도 안 하므로)', e.total === 0, JSON.stringify(e));

e = Anlas.estimate(Object.assign({}, base, { isOpus: false, count: 3 }));
check('비Opus 는 장당 비용 × 장수', e.total === e.perImage * 3 && e.perImage > 0, JSON.stringify(e));

e = Anlas.estimate({ width: 2048, height: 2048, steps: 50, model: 'nai-diffusion-5-full',
  isOpus: false, count: 1 });
check('1장 140 을 넘으면 상한 표시', e.overLimit === true, JSON.stringify(e));

e = Anlas.estimate(Object.assign({}, base, { isOpus: true, count: 1 }));
check('정상 크기는 상한에 안 걸린다', e.overLimit === false, JSON.stringify(e));

// ── 구독 응답 파싱 ────────────────────────────────────────────────────
let s = Anlas.parseSubscription({
  tier: 3, active: true,
  trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 250 },
  usage: { percent: 42.5, isNegative: false }
});
check('Anlas 합계 = 구독분 + 구매분', s.anlas === 1250, JSON.stringify(s));
check('tier 3 은 Opus', s.isOpus === true && s.tierName === 'Opus');
check('사용률을 읽는다', s.usagePercent === 42.5);
check('소진 여부를 읽는다', s.opusExhausted === false);

s = Anlas.parseSubscription({ tier: 1, trainingStepsLeft: 500 });
check('구버전(숫자) 응답도 읽는다', s.anlas === 500 && s.isOpus === false, JSON.stringify(s));
check('usage 가 없으면 null 로 둔다', s.usagePercent === null && s.opusExhausted === false);

s = Anlas.parseSubscription({ tier: 3, trainingStepsLeft: {}, usage: { isNegative: true } });
check('소진 상태를 잡아낸다', s.opusExhausted === true && s.anlas === 0, JSON.stringify(s));

check('망가진 응답은 null', Anlas.parseSubscription(null) === null);

// 소진되면 Opus 무료가 꺼진다 (V5 만)
const v5 = { width: 832, height: 1216, steps: 28, model: 'nai-diffusion-5-full', isOpus: true, count: 1 };
const alive = Anlas.estimate(Object.assign({}, v5, { opusExhausted: false }));
const dead = Anlas.estimate(Object.assign({}, v5, { opusExhausted: true }));
check('V5: 잔량이 바닥나면 과금으로 바뀐다', alive.total === 0 && dead.total > 0,
  `살아있을때=${alive.total} 바닥=${dead.total}`);

const v45 = Object.assign({}, base, { isOpus: true, count: 1, opusExhausted: true });
check('V4.5 는 잔량과 무관하게 무료 유지', Anlas.estimate(v45).total === 0);

const total = pass + fails.length;
console.log('Anlas 계산 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.slice(0, 10).forEach(function (f) { console.log('\n  ▸ ' + f); });
if (fails.length > 10) console.log(`\n... 외 ${fails.length - 10}건`);
process.exit(fails.length ? 1 : 0);
