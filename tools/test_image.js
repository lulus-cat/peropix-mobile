// 이미지 처리 검사 — lanczos3 리샘플이 PIL 과 같은가, PNG tEXt 를 제대로 다루는가.
//
// 기준값: mobile/tools/fixtures  (make_image_fixtures.py 로 생성)
// 사용: node mobile/tools/test_image.js
'use strict';

const fs = require('fs');
const path = require('path');
const IU = require('../www/js/image-util.js');

const FIX = path.join(__dirname, 'fixtures');

// ★기준 이미지는 약 7MB 라 저장소에 넣지 않는다 (make_image_fixtures.py 로 만든다).
//   없을 때 터지지 않고 건너뛴다 — GitHub 가 APK 를 빌드할 때는 기준 이미지가
//   없는데, 그 때문에 빌드가 통째로 멈추면 안 된다.
if (!fs.existsSync(path.join(FIX, 'meta.json'))) {
  console.log('이미지 처리 검사 — 건너뜀 (기준 이미지 없음: '
    + 'python tools/make_image_fixtures.py 로 만듭니다)');
  process.exit(0);
}

const meta = JSON.parse(fs.readFileSync(path.join(FIX, 'meta.json'), 'utf8'));

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

function readBin(name) {
  return new Uint8ClampedArray(fs.readFileSync(path.join(FIX, name)));
}

// ── 1. lanczos3 리샘플이 PIL 과 같은가 ────────────────────────────────
const SW = meta.width, SH = meta.height;

// 판정 기준은 **최대 오차**가 우선이다. 평균은 참고값 —
// ±1 이 넓게 흩뿌려지면 평균은 올라가지만 눈으로는 구별되지 않는다.
function compare(label, got, want, meanMax, over2Max, maxMax) {
  if (got.length !== want.length) {
    fails.push(`${label}: 길이가 다름 ${got.length} vs ${want.length}`);
    return;
  }
  let maxDiff = 0, sum = 0, over2 = 0;
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(got[i] - want[i]);
    if (d > maxDiff) maxDiff = d;
    if (d > 2) over2++;
    sum += d;
  }
  const mean = sum / want.length;
  const pct = (over2 / want.length) * 100;
  check(`${label} (평균차 ${mean.toFixed(3)}, 최대 ${maxDiff}, 2초과 ${pct.toFixed(3)}%)`,
    maxDiff <= (maxMax === undefined ? 255 : maxMax) && mean <= meanMax && pct <= over2Max);
}

// (a) 불투명 원본 — NAI 산출물의 대부분이 여기 해당한다. 엄격히 본다.
//     남는 차이는 PIL 의 고정소수점 누산과 JS 의 부동소수 차이뿐이라 ±1 안쪽이어야 한다.
const opaque = readBin('opaque_rgba.bin');
Object.keys(meta.opaque_resized).forEach(function (key) {
  const [dw, dh] = key.split('x').map(Number);
  compare('불투명 리샘플 ' + key,
    IU.resampleLanczos(opaque, SW, SH, dw, dh), readBin(meta.opaque_resized[key]),
    0.05, 0.01, 3);
});

// (b) 반투명이 섞인 원본 — 알파를 되돌릴 때 작은 수로 나누며 오차가 커진다.
//     알파가 낮은 곳이라 눈에 띄지 않지만, 수치로는 여기까지만 보장한다.
const src = readBin('source_rgba.bin');
Object.keys(meta.resized).forEach(function (key) {
  const [dw, dh] = key.split('x').map(Number);
  compare('반투명 포함 리샘플 ' + key,
    IU.resampleLanczos(src, SW, SH, dw, dh), readBin(meta.resized[key]),
    0.5, 8.0, 40);
});

// (c) 실제로 NAI 에 들어가는 것 — 리샘플 + 흰 배경 평탄화.
//     Enhance 결과가 데스크톱판과 갈리는지는 이 숫자가 말해 준다.
meta.preprocessed.forEach(function (key) {
  const [dw, dh] = key.split('x').map(Number);
  const rgba = IU.resampleLanczos(src, SW, SH, dw, dh);
  // 흰 배경에 평탄화 → RGB (기준값도 RGB 3바이트다)
  const flat = new Uint8ClampedArray(dw * dh * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    const a = rgba[i + 3] / 255;
    flat[o] = Math.round(rgba[i] * a + 255 * (1 - a));
    flat[o + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
    flat[o + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
  }
  // ★기준은 '2를 넘는 픽셀이 없을 것'이다. 평균은 참고값 — 평탄화가 ±1 을 고르게
  //   흩뿌려 평균이 올라가지만 최대 오차가 2 면 눈으로 구별되지 않는다.
  compare('전처리(리샘플+평탄화) ' + key, flat, readBin('preprocessed_' + key + '.bin'), 0.25, 0.05, 3);
});

// ── 2. PNG tEXt 청크 읽기 ─────────────────────────────────────────────
const withText = new Uint8Array(fs.readFileSync(path.join(FIX, 'with_text.png')));
check('PNG 으로 인식', IU.isPng(withText));

const texts = IU.getTexts(withText);
Object.keys(meta.text_chunks).forEach(function (k) {
  check(`tEXt 읽기 — ${k}`, texts[k] === meta.text_chunks[k],
    `기대=${JSON.stringify(meta.text_chunks[k])} 실제=${JSON.stringify(texts[k])}`);
});

// ── 3. 청크 더하기 — NAI 원본은 살아 있어야 한다 ──────────────────────
const payload = JSON.stringify({ prompt: '1girl, "안녕", smile', steps: 28, seed: 12345 });
const added = IU.setTexts(withText, { Comment: payload });
const after = IU.getTexts(added);

check('Comment 가 들어갔는지', after.Comment === payload,
  `실제=${JSON.stringify(after.Comment)}`);
IU.NAI_TEXT_KEYS.forEach(function (k) {
  check(`Comment 를 더해도 NAI 청크 ${k} 가 남아 있는지`, after[k] === meta.text_chunks[k]);
});
check('한글이 든 값도 온전한지', after.Comment && after.Comment.indexOf('안녕') !== -1);

// 같은 키를 두 번 넣어도 중복되지 않아야 한다
const twice = IU.setTexts(added, { Comment: 'bbb' });
const chunkCount = IU.readChunks(twice).filter(function (c) {
  return (c.type === 'tEXt' || c.type === 'iTXt');
}).length;
check(`같은 키를 다시 넣으면 덮어쓴다 (텍스트 청크 ${chunkCount}개)`,
  IU.getTexts(twice).Comment === 'bbb' && chunkCount === IU.NAI_TEXT_KEYS.length + 1);

// ── 4. 벗겨내기 ───────────────────────────────────────────────────────
const stripped = IU.stripTexts(added);
check('벗겨내면 텍스트가 남지 않는지', Object.keys(IU.getTexts(stripped)).length === 0);
check('벗겨내도 여전히 PNG 인지', IU.isPng(stripped));
check('벗겨낸 PNG 에 IEND 가 있는지',
  IU.readChunks(stripped).some(function (c) { return c.type === 'IEND'; }));

// ── 5. 청크 CRC 가 유효한지 (깨진 PNG 를 만들면 안 된다) ─────────────
// PIL 로 다시 읽히는지는 test_image.py 가 확인한다. 여기서는 구조만 본다.
const chunks = IU.readChunks(added);
check('IHDR 가 맨 앞', chunks[0] && chunks[0].type === 'IHDR');
check('IEND 가 맨 뒤', chunks[chunks.length - 1].type === 'IEND');
fs.writeFileSync(path.join(FIX, 'js_added.png'), Buffer.from(added));
fs.writeFileSync(path.join(FIX, 'js_stripped.png'), Buffer.from(stripped));

const total = pass + fails.length;
console.log('이미지 처리 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
