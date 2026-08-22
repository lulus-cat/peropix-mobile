// 배경 합성 검사 — 알파 판별, 알파 경계, 배치 계산, 겹치기.
//
// ★여기가 틀리면 오류가 나지 않고 **그림이 조용히 어긋난다** — 인물이 배경 밖에 서거나,
//   윤곽이 검게 타거나, 슬롯마다 다른 자리에 선다. 눈으로 100장을 확인할 수는 없다.
// 사용: node tools/test_compose.js
'use strict';

const C = require('../www/js/compose.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

function px(list) {
  return new Uint8ClampedArray(list);
}

/** w×h 를 한 색으로 채운다. */
function fill(w, h, r, g, b, a) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
  }
  return out;
}

function at(data, w, x, y) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function same(a, b) {
  return a.length === b.length && a.every(function (v, i) { return v === b[i]; });
}

// ── 1. 알파가 미리 곱해진 것인지 판별 ─────────────────────────────────
check('불투명한 그림은 none',
  C.detectAlpha(fill(2, 2, 200, 100, 50, 255)) === 'none');

// 반투명한데 RGB 가 A 를 넘는다 → straight
check('RGB 가 A 를 넘으면 straight',
  C.detectAlpha(px([255, 0, 0, 128])) === 'straight');

// 반투명이고 RGB ≤ A → 미리 곱해진 것
check('RGB 가 A 이하면 premultiplied',
  C.detectAlpha(px([128, 0, 0, 128])) === 'premultiplied');

check('완전 투명한데 색이 남아 있으면 straight',
  C.detectAlpha(px([10, 0, 0, 0])) === 'straight');

check('8비트 반올림 여유(+1)는 straight 로 보지 않음',
  C.detectAlpha(px([129, 0, 0, 128])) === 'premultiplied');

check('한 픽셀만 넘어도 straight',
  C.detectAlpha(px([10, 0, 0, 128, 255, 255, 255, 200])) === 'straight');

// ── 2. 미리 곱해진 알파 되돌리기 ──────────────────────────────────────
const back = C.toStraight(px([128, 64, 0, 128]), 'premultiplied');
check('되돌리면 원래 색이 나온다 (128/0.5 = 255)', same(Array.from(back), [255, 128, 0, 128]),
  Array.from(back).join(','));

check('straight 는 건드리지 않는다',
  same(Array.from(C.toStraight(px([255, 0, 0, 128]), 'straight')), [255, 0, 0, 128]));

check('완전 투명한 픽셀은 색을 0 으로 정리한다',
  same(Array.from(C.toStraight(px([9, 9, 9, 0]), 'premultiplied')), [0, 0, 0, 0]));

check('불투명한 픽셀은 그대로',
  same(Array.from(C.toStraight(px([200, 100, 50, 255]), 'premultiplied')), [200, 100, 50, 255]));

// ── 3. 알파 경계 ──────────────────────────────────────────────────────
// 6×6 안에 (2,1)~(3,4) 만 불투명
const boxed = new Uint8ClampedArray(6 * 6 * 4);
for (let y = 1; y <= 4; y++) {
  for (let x = 2; x <= 3; x++) {
    const i = (y * 6 + x) * 4;
    boxed[i] = 255; boxed[i + 3] = 255;
  }
}
const b = C.alphaBounds(boxed, 6, 6);
check('경계 x0', b.x0 === 2, String(b.x0));
check('경계 x1 은 배타적', b.x1 === 4, String(b.x1));
check('경계 y0', b.y0 === 1, String(b.y0));
check('경계 y1 은 배타적', b.y1 === 5, String(b.y1));
check('경계 너비', b.width === 2);
check('경계 높이', b.height === 4);
check('비어 있지 않다', b.empty === false);

const ghost = fill(4, 4, 255, 255, 255, 3);   // 알파 3 짜리 후광만 깔린 그림
check('희미한 후광(알파 3)은 경계로 치지 않는다', C.alphaBounds(ghost, 4, 4).empty === true);
check('전부 투명하면 그림 전체를 경계로 삼는다',
  C.alphaBounds(fill(4, 4, 0, 0, 0, 0), 4, 4).width === 4);

// ── 4. 배치 ───────────────────────────────────────────────────────────
// (a) 결과 크기
const p1 = C.placement({ fgW: 832, fgH: 1216, bgW: 1920, bgH: 1080, out: 'fg', fit: 'cover', mode: 'as-is' });
check('결과를 인물 크기로', p1.width === 832 && p1.height === 1216);
const p2 = C.placement({ fgW: 832, fgH: 1216, bgW: 1920, bgH: 1080, out: 'bg', fit: 'cover', mode: 'as-is' });
check('결과를 배경 크기로', p2.width === 1920 && p2.height === 1080);

// (b) 배경 cover — 결과를 완전히 덮고 가운데를 남긴다
check('cover 는 결과를 덮는다',
  p1.bg.w >= p1.width && p1.bg.h >= p1.height,
  p1.bg.w + '×' + p1.bg.h);
check('cover 는 넘치는 쪽을 가운데로 자른다',
  p1.bg.x <= 0 && p1.bg.y <= 0
  && p1.bg.x + p1.bg.w >= p1.width && p1.bg.y + p1.bg.h >= p1.height,
  JSON.stringify(p1.bg));
check('cover 는 배경 비율을 지킨다',
  Math.abs((p1.bg.w / p1.bg.h) - (1920 / 1080)) < 0.01);

const pStretch = C.placement({ fgW: 800, fgH: 1200, bgW: 1920, bgH: 1080, out: 'fg', fit: 'stretch', mode: 'as-is' });
check('늘이기는 결과에 딱 맞춘다',
  pStretch.bg.x === 0 && pStretch.bg.y === 0
  && pStretch.bg.w === 800 && pStretch.bg.h === 1200);

// (c) as-is — 크기가 같으면 1:1 로 겹친다
const pSame = C.placement({ fgW: 512, fgH: 512, bgW: 512, bgH: 512, out: 'fg', fit: 'cover', mode: 'as-is' });
check('크기가 같으면 그대로 겹친다',
  pSame.fg.x === 0 && pSame.fg.y === 0 && pSame.fg.w === 512 && pSame.fg.h === 512);

// (d) 자동 — 경계가 화면 높이의 fill 만큼 되고, 가로 가운데 · 바닥에 선다
const bounds = { x0: 100, y0: 200, x1: 500, y1: 1000, width: 400, height: 800, empty: false };
const pa = C.placement({
  fgW: 800, fgH: 1200, bgW: 1600, bgH: 1200, out: 'fg', fit: 'cover',
  mode: 'auto', bounds: bounds, fill: 0.5, bottom: 0.1, maxWidth: 0.96
});
// 경계 높이 800 → 결과 높이 1200 의 50% = 600 이 되어야 하므로 배율 0.75
check('자동: 경계 높이가 fill 비율이 되게 키운다', Math.abs(pa.scale - 0.75) < 1e-6, String(pa.scale));
const bx0 = pa.fg.x + bounds.x0 * pa.scale;
const bx1 = pa.fg.x + bounds.x1 * pa.scale;
check('자동: 경계의 가운데가 화면 가운데',
  Math.abs((bx0 + bx1) / 2 - 400) <= 1, ((bx0 + bx1) / 2).toFixed(2));
const by1 = pa.fg.y + bounds.y1 * pa.scale;
check('자동: 경계의 바닥이 바닥 여백 위에 선다',
  Math.abs(by1 - 1200 * 0.9) <= 1, by1.toFixed(2));

// (e) 자동 — 가로로 넓은 인물은 가로에 맞춰 줄인다 (높이만 보면 화면 밖으로 나간다)
const wide = { x0: 0, y0: 0, x1: 800, y1: 200, width: 800, height: 200, empty: false };
const pw = C.placement({
  fgW: 800, fgH: 1200, bgW: 800, bgH: 1200, out: 'fg', fit: 'cover',
  mode: 'auto', bounds: wide, fill: 0.9, bottom: 0, maxWidth: 0.96
});
check('자동: 가로가 넘치면 가로에 맞춘다', Math.abs(pw.scale - 0.96) < 1e-6, String(pw.scale));
check('자동: 그래도 화면 안에 들어온다',
  pw.fg.x + wide.x1 * pw.scale <= 800 + 1 && pw.fg.x >= -1);

// (f) 자동인데 경계가 비어 있으면 (전부 투명) 수동 기본값으로 물러난다
const pEmpty = C.placement({
  fgW: 800, fgH: 1200, bgW: 800, bgH: 1200, out: 'fg', fit: 'cover',
  mode: 'auto', bounds: { x0: 0, y0: 0, x1: 800, y1: 1200, width: 800, height: 1200, empty: true }
});
check('경계가 비면 원본 크기 그대로 둔다', pEmpty.scale === 1 && pEmpty.fg.w === 800);

// (g) 수동
const pm = C.placement({
  fgW: 800, fgH: 1200, bgW: 800, bgH: 1200, out: 'fg', fit: 'cover',
  mode: 'manual', scale: 0.5, x: 0, y: 1
});
check('수동: 배율이 그대로 걸린다', pm.fg.w === 400 && pm.fg.h === 600);
check('수동: x=0 은 왼쪽 끝', pm.fg.x === 0);
check('수동: y=1 은 바닥', pm.fg.y === 1200 - 600);

const pmBg = C.placement({
  fgW: 800, fgH: 1200, bgW: 400, bgH: 400, out: 'bg', fit: 'cover',
  mode: 'manual', scale: 1, x: 0.5, y: 0.5
});
check('수동: 결과가 배경 크기면 배율 1 이 화면에 꽉 차는 크기',
  pmBg.fg.h === 400 && pmBg.fg.w === Math.round(800 * (400 / 1200)),
  pmBg.fg.w + '×' + pmBg.fg.h);

check('수동: 말도 안 되는 배율은 잘라 낸다',
  C.placement({ fgW: 100, fgH: 100, bgW: 100, bgH: 100, out: 'fg', mode: 'manual', scale: 99 }).scale === 4);

// (h) 무작위 — 인물이 잘리지 않는 범위 안에서만 뽑는다
const rBounds = { x0: 100, y0: 100, x1: 500, y1: 900, width: 400, height: 800, empty: false };
function randPlace(seed, extra) {
  return C.placement(Object.assign({
    fgW: 800, fgH: 1200, bgW: 800, bgH: 1200, out: 'fg', fit: 'cover',
    mode: 'random', bounds: rBounds, randMin: 0.6, randMax: 0.9, bottom: 0.02,
    rng: C.rngFrom(seed)
  }, extra || {}));
}

function insideFrame(p, W, H) {
  const x0 = p.fg.x + rBounds.x0 * p.scale;
  const x1 = p.fg.x + rBounds.x1 * p.scale;
  const y0 = p.fg.y + rBounds.y0 * p.scale;
  const y1 = p.fg.y + rBounds.y1 * p.scale;
  return x0 >= -1 && y0 >= -1 && x1 <= W + 1 && y1 <= H + 1;
}

let allInside = true;
let allSame = true;
const first = randPlace(1);
for (let seed = 1; seed <= 200; seed++) {
  const p = randPlace(seed);
  if (!insideFrame(p, 800, 1200)) allInside = false;
  if (p.fg.x !== first.fg.x) allSame = false;
}
check('무작위: 200번 뽑아도 인물이 화면 밖으로 나가지 않는다', allInside);
check('무작위: 장마다 자리가 달라진다', allSame === false);

check('무작위: 크기가 정해 준 범위 안에 든다',
  Array.from({ length: 100 }).every(function (_, i) {
    const p = randPlace(i + 1);
    const ratio = (rBounds.height * p.scale) / 1200;
    return ratio >= 0.6 - 1e-6 && ratio <= 0.9 + 1e-6;
  }));

check('무작위: 같은 씨앗이면 같은 자리 (다시 돌려도 같은 그림)',
  randPlace(7).fg.x === randPlace(7).fg.x && randPlace(7).fg.y === randPlace(7).fg.y);
check('무작위: 씨앗이 다르면 다른 자리', randPlace(7).fg.x !== randPlace(8).fg.x);

// 세로를 뽑지 않으면 바닥에 선다 (여백 2% → 경계의 아래가 1176 근처)
const rFixedY = randPlace(3, { randomY: false });
check('무작위: 세로를 끄면 바닥에 세운다',
  Math.abs((rFixedY.fg.y + rBounds.y1 * rFixedY.scale) - 1200 * 0.98) <= 1,
  String(rFixedY.fg.y + rBounds.y1 * rFixedY.scale));

let yVaried = false;
for (let seed = 1; seed <= 50; seed++) {
  if (randPlace(seed, { randomY: true }).fg.y !== randPlace(1, { randomY: true }).fg.y) yVaried = true;
}
check('무작위: 세로를 켜면 위아래로도 움직인다', yVaried);

// 인물이 화면보다 큰 경우 — 뽑을 자리가 없으면 가운데에 둔다 (터지지 않는다)
const rHuge = C.placement({
  fgW: 800, fgH: 1200, bgW: 200, bgH: 200, out: 'bg', fit: 'cover',
  mode: 'random', bounds: rBounds, randMin: 3, randMax: 3, maxWidth: 3, rng: C.rngFrom(5)
});
check('무작위: 자리가 없으면 가운데에 두고 넘어간다',
  Number.isFinite(rHuge.fg.x) && Number.isFinite(rHuge.fg.y));

check('rngFrom: 같은 씨앗은 같은 수열',
  C.rngFrom(42)() === C.rngFrom(42)() && C.rngFrom(42)() !== C.rngFrom(43)());

// ── 5. 겹치기 ─────────────────────────────────────────────────────────
// (a) 불투명한 인물은 배경을 덮는다
let dst = fill(2, 2, 0, 0, 255, 255);
C.over(dst, 2, 2, fill(1, 1, 255, 0, 0, 255), 1, 1, 0, 0);
check('불투명은 그대로 덮는다', same(at(dst, 2, 0, 0), [255, 0, 0, 255]), at(dst, 2, 0, 0).join(','));
check('덮지 않은 자리는 그대로', same(at(dst, 2, 1, 1), [0, 0, 255, 255]));

// (b) 반투명은 절반씩 섞인다 — 흰 배경 위 반투명 빨강 → (255,128,128)
dst = fill(1, 1, 255, 255, 255, 255);
C.over(dst, 1, 1, px([255, 0, 0, 128]), 1, 1, 0, 0);
const mixed = at(dst, 1, 0, 0);
check('반투명은 배경과 섞인다', mixed[0] === 255 && Math.abs(mixed[1] - 128) <= 1 && mixed[3] === 255,
  mixed.join(','));

// (c) 밖으로 나간 부분은 잘라 낸다 (터지지 않는다)
dst = fill(2, 2, 0, 0, 0, 255);
C.over(dst, 2, 2, fill(4, 4, 255, 255, 255, 255), 4, 4, -4, -4);
check('완전히 밖이면 아무것도 안 그린다', same(at(dst, 2, 0, 0), [0, 0, 0, 255]));
C.over(dst, 2, 2, fill(4, 4, 255, 255, 255, 255), 4, 4, 1, 1);
check('걸친 부분만 그린다',
  same(at(dst, 2, 1, 1), [255, 255, 255, 255]) && same(at(dst, 2, 0, 0), [0, 0, 0, 255]));

// (d) 투명한 곳에 반투명을 얹으면 알파가 합쳐진다
dst = fill(1, 1, 0, 0, 0, 0);
C.over(dst, 1, 1, px([255, 0, 0, 128]), 1, 1, 0, 0);
check('빈 곳 위에서는 색이 살아 있다', same(at(dst, 1, 0, 0), [255, 0, 0, 128]), at(dst, 1, 0, 0).join(','));

// ── 6. 합치기 전체 ────────────────────────────────────────────────────
// 미리 곱해진 반투명 빨강(128,0,0,128)을 흰 배경에 얹는다.
// 제대로 되돌리면 (255,0,0) 을 반씩 섞어 (255,128,128).
// 되돌리지 않으면 (128,0,0) 이 섞여 (192,128,128) 이 된다 — 윤곽이 타는 그 증상이다.
const preFg = { data: px([128, 0, 0, 128]), width: 1, height: 1 };
const white = { data: fill(1, 1, 255, 255, 255, 255), width: 1, height: 1 };
const r1 = C.composite({ fg: preFg, bg: white, alpha: 'auto', out: 'fg', fit: 'cover', mode: 'as-is' });
check('합성: 미리 곱해진 알파를 알아본다', r1.alphaMode === 'premultiplied');
check('합성: 되돌린 뒤 섞는다 (윤곽이 타지 않는다)',
  r1.data[0] === 255 && Math.abs(r1.data[1] - 128) <= 1,
  Array.from(r1.data).join(','));

const r2 = C.composite({ fg: preFg, bg: white, alpha: 'straight', out: 'fg', fit: 'cover', mode: 'as-is' });
check('합성: straight 로 못 박으면 되돌리지 않는다',
  Math.abs(r2.data[0] - 192) <= 1, Array.from(r2.data).join(','));

// 결과 크기와 배경 재사용
const fg4 = { data: fill(4, 4, 0, 0, 0, 0), width: 4, height: 4 };
// 가운데 2×2 만 불투명하게
for (let y = 1; y <= 2; y++) {
  for (let x = 1; x <= 2; x++) {
    const i = (y * 4 + x) * 4;
    fg4.data[i] = 0; fg4.data[i + 1] = 255; fg4.data[i + 2] = 0; fg4.data[i + 3] = 255;
  }
}
const bg8 = { data: fill(8, 8, 10, 20, 30, 255), width: 8, height: 8 };
const r3 = C.composite({ fg: fg4, bg: bg8, alpha: 'auto', out: 'fg', fit: 'cover', mode: 'as-is' });
check('합성: 결과 크기는 인물 크기', r3.width === 4 && r3.height === 4);
check('합성: 인물이 없는 자리는 배경이 보인다', same(at(r3.data, 4, 0, 0), [10, 20, 30, 255]),
  at(r3.data, 4, 0, 0).join(','));
check('합성: 인물이 있는 자리는 인물이 보인다', same(at(r3.data, 4, 1, 1), [0, 255, 0, 255]));
check('합성: 결과에 빈 곳이 남지 않는다 (배경이 다 덮는다)',
  Array.from({ length: 16 }).every(function (_, i) { return r3.data[i * 4 + 3] === 255; }));
check('합성: 줄여 둔 배경을 돌려준다 (다음 장에서 재사용)',
  r3.bgScaled.width === r3.place.bg.w && r3.bgScaled.height === r3.place.bg.h);

const r4 = C.composite({
  fg: fg4, bg: bg8, alpha: 'auto', out: 'fg', fit: 'cover', mode: 'as-is', bgScaled: r3.bgScaled
});
check('합성: 재사용해도 같은 그림이 나온다',
  Array.from(r4.data).join(',') === Array.from(r3.data).join(','));

// 자동 배치로 합치면 인물이 커져 바닥에 선다
const r5 = C.composite({
  fg: fg4, bg: bg8, alpha: 'auto', out: 'fg', fit: 'cover',
  mode: 'auto', fill: 1, bottom: 0, maxWidth: 1
});
check('합성: 자동 배치는 경계를 화면에 채운다', r5.place.scale > 1, String(r5.place.scale));
check('합성: 자동 배치 뒤에도 결과 크기는 그대로', r5.width === 4 && r5.height === 4);

const total = pass + fails.length;
console.log('배경 합성 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
