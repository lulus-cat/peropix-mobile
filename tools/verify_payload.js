// JS 포팅본이 backend.py 와 같은 페이로드를 만드는지 대조한다.
//
// 사용: node mobile/tools/verify_payload.js
// 기준값: mobile/tools/reference_payloads.json  (capture_reference.py 로 생성)
'use strict';

const fs = require('fs');
const path = require('path');
const { buildNaiPayload } = require('../www/js/nai-payload.js');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference_payloads.json'), 'utf8'));

// GenerateRequest 의 기본값 중 페이로드 조립이 읽는 것들.
// 기준값 캡처는 이 기본값 위에서 돌았으므로 여기서도 같게 채워야 한다.
const REQ_DEFAULTS = {
  negative_prompt: '',
  base_strength: 0.7, base_noise: 0.0, base_mode: 'inpaint',
  width: 832, height: 1216, steps: 28, cfg: 5.0, seed: -1,
  sampler: 'euler_ancestral', scheduler: 'normal',
  nai_model: 'nai-diffusion-4-5-full',
  smea: 'none', uc_preset: 'Heavy',
  quality_tags: true, quality_preset: '',
  transparent_bg: false, straight_alpha: false, furry_mode: false,
  cfg_rescale: 0.0, variety_plus: false,
  enhance_prompt_add: false, normalize_vibe_strength: true
};

const EPS = 1e-9;

function diff(a, b, p, out) {
  if (a === b) return;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta === 'number' && tb === 'number') {
    if (Math.abs(a - b) > EPS * Math.max(1, Math.abs(a), Math.abs(b))) {
      out.push(`${p}: 기준=${a} 포팅=${b}`);
    }
    return;
  }
  if (ta !== tb) { out.push(`${p}: 타입 기준=${ta} 포팅=${tb}`); return; }
  if (ta === 'array') {
    if (a.length !== b.length) { out.push(`${p}: 길이 기준=${a.length} 포팅=${b.length}`); return; }
    a.forEach((v, i) => diff(v, b[i], `${p}[${i}]`, out));
    return;
  }
  if (ta === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) { out.push(`${p}.${k}: 기준에 없음 (포팅=${JSON.stringify(b[k])})`); continue; }
      if (!(k in b)) { out.push(`${p}.${k}: 포팅에 없음 (기준=${JSON.stringify(a[k])})`); continue; }
      diff(a[k], b[k], `${p}.${k}`, out);
    }
    return;
  }
  out.push(`${p}: 기준=${JSON.stringify(a)} 포팅=${JSON.stringify(b)}`);
}

let pass = 0;
const failures = [];

for (const c of ref) {
  if (!c.payload) continue;
  const req = Object.assign({}, REQ_DEFAULTS, c.input);

  // ★베이스 이미지 전처리(리샘플·평탄화)는 조립부의 일이 아니라 호출부의 일이다.
  //   여기서는 원본이 실제로 실어 보낸 전처리 결과를 그대로 넣어, 나머지 필드
  //   (strength·extra_noise_seed·action·color_correct 등)가 같은지를 본다.
  if (req.base_image) {
    req.base_image_processed = c.payload.parameters.image;
  }

  let got;
  try {
    got = buildNaiPayload(req);
  } catch (e) {
    failures.push({ case: c.case, input: c.input, diffs: [`예외: ${e.message}`] });
    continue;
  }
  const out = [];
  if (got.url !== c.url) out.push(`url: 기준=${c.url} 포팅=${got.url}`);
  diff(c.payload, got.payload, 'payload', out);
  if (out.length) failures.push({ case: c.case, input: c.input, diffs: out });
  else pass++;
}

console.log(`대조 ${ref.length}건 — 일치 ${pass}건, 불일치 ${failures.length}건`);
for (const f of failures.slice(0, 12)) {
  console.log(`\n── case ${f.case}`);
  console.log('   입력:', JSON.stringify({
    nai_model: f.input.nai_model, uc_preset: f.input.uc_preset,
    quality_preset: f.input.quality_preset, prompt: f.input.prompt,
    sampler: f.input.sampler, scheduler: f.input.scheduler,
    width: f.input.width, height: f.input.height,
    variety_plus: f.input.variety_plus, transparent_bg: f.input.transparent_bg,
    enhance_prompt_add: f.input.enhance_prompt_add, negative_prompt: f.input.negative_prompt
  }));
  f.diffs.slice(0, 8).forEach(d => console.log('   ▸', d));
  if (f.diffs.length > 8) console.log(`   ... 외 ${f.diffs.length - 8}건`);
}
if (failures.length > 12) console.log(`\n... 외 ${failures.length - 12}개 케이스`);

process.exit(failures.length ? 1 : 0);
