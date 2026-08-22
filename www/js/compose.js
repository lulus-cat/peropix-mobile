// 배경 합성 — 투명 배경으로 뽑은 인물을 배경 그림 위에 얹는다.
//
// ★NAI 의 투명 배경 출력은 기본이 **미리 곱해진 알파(premultiplied)** 다.
//   「Straight Alpha」 를 켰을 때만 straight 로 온다. 미리 곱해진 그림을 straight 인 줄 알고
//   `fg*a + bg*(1-a)` 로 합치면 알파가 두 번 곱해져 **윤곽이 검게 탄다.**
//   그래서 합치기 전에 어느 쪽인지 판별해 straight 로 되돌린다 (판별은 detectAlpha).
// ★자리는 **고정(auto)** 과 **무작위(random)** 둘 중에 고른다. 무작위도 아무 데나 두지 않고
//   경계가 화면 안에 들어오는 범위에서만 뽑는다 — 잘린 장이 섞이면 찾아낼 수가 없다.
// ★배치는 **알파 경계(bbox)** 로 계산한다. 슬롯마다 인물이 잡힌 크기·여백이 달라도
//   같은 자리에 서게 하려는 것이다 — 수십 장을 손으로 맞출 수는 없다.
// ★리샘플은 image-util.js 의 lanczos3 를 그대로 쓴다. 캔버스 drawImage 로 줄이면
//   기기마다 필터가 달라 결과가 갈린다 (미리보기에서만 drawImage 를 쓴다).
'use strict';

const Compose = (function () {
  const IU = (typeof ImageUtil !== 'undefined')
    ? ImageUtil
    : (typeof require !== 'undefined' ? require('./image-util.js') : null);

  // 이보다 옅은 픽셀은 "없는 것" 으로 본다. 투명 배경 산출물의 가장자리에는
  // 알파 1~3 짜리 후광이 넓게 깔리는 일이 있어, 0 을 기준으로 잡으면 경계가 그림 전체가 된다.
  const EDGE_ALPHA = 8;

  // 자동 배치 기본값. 인물이 화면 높이의 92% 를 차지하고, 바닥에서 2% 띄운다.
  const AUTO = { fill: 0.92, bottom: 0.02, maxWidth: 0.96 };
  // 무작위 배치 기본값. 크기는 이 범위 안에서 뽑고, 자리는 **잘리지 않는 범위** 안에서 뽑는다.
  const RANDOM = { min: 0.7, max: 0.95 };

  /**
   * 씨앗을 넣으면 늘 같은 순서로 나오는 난수 (mulberry32).
   *
   * ★Math.random 을 그대로 쓰면 미리보기를 다시 그릴 때마다 인물이 튀고, 검사도 못 한다.
   *   씨앗을 장마다 하나씩 주면 "장마다 다른 자리 · 다시 돌려도 같은 결과" 가 된다.
   */
  function rngFrom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── 알파 ────────────────────────────────────────────────────────────────
  /**
   * 이 그림의 알파가 미리 곱해진 것인지 본다.
   *
   * ★미리 곱해진 그림은 **모든 픽셀이 RGB ≤ A** 다 (색에 알파를 곱해 놨으니).
   *   한 픽셀이라도 이걸 넘으면 straight 다. 넘는 픽셀이 하나도 없으면 미리 곱해진 것으로 본다.
   * ★어두운 인물만 있는 straight 그림도 이 조건을 통과할 수 있다. 그러나 그 경우
   *   되돌려 봐야 값이 거의 그대로라(0 ÷ a = 0) 눈에 보이는 차이가 없다.
   * @returns {'premultiplied'|'straight'|'none'} none = 투명한 곳이 없음
   */
  function detectAlpha(px) {
    let hasAlpha = false;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a === 255) continue;
      hasAlpha = true;
      // +1 은 8비트 반올림 여유다. 딱 맞게 곱해도 1 이 튀는 일이 있다.
      if (px[i] > a + 1 || px[i + 1] > a + 1 || px[i + 2] > a + 1) return 'straight';
    }
    return hasAlpha ? 'premultiplied' : 'none';
  }

  /** 미리 곱해진 알파를 되돌린다(RGBa → RGBA). straight 면 원본을 그대로 돌려준다. */
  function toStraight(px, mode) {
    if (mode !== 'premultiplied') return px;
    const out = new Uint8ClampedArray(px.length);
    out.set(px);
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      if (a === 255) continue;
      if (a === 0) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; continue; }
      out[i] = Math.round(out[i] * 255 / a);
      out[i + 1] = Math.round(out[i + 1] * 255 / a);
      out[i + 2] = Math.round(out[i + 2] * 255 / a);
    }
    return out;
  }

  /**
   * 실제로 그려진 부분의 사각형. 자동 배치의 기준이다.
   * @returns {{x0,y0,x1,y1,width,height,empty}} x1·y1 은 배타적
   */
  function alphaBounds(px, w, h, threshold) {
    const t = (threshold === undefined) ? EDGE_ALPHA : threshold;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (px[row + x * 4 + 3] > t) {
          if (x < x0) x0 = x;
          if (x >= x1) x1 = x + 1;
          if (y < y0) y0 = y;
          y1 = y + 1;
        }
      }
    }
    if (x1 <= x0 || y1 <= y0) {
      // 전부 투명하면 그림 전체를 경계로 삼는다 (자동 배치가 0 으로 나누지 않게).
      return { x0: 0, y0: 0, x1: w, y1: h, width: w, height: h, empty: true };
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, width: x1 - x0, height: y1 - y0, empty: false };
  }

  // ── 배치 ────────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * 배경과 인물을 결과 안 어디에 그릴지 정한다. 순수 계산이라 화면 없이 검사할 수 있다.
   *
   * @param {object} o
   *   fgW,fgH,bgW,bgH  원본 크기
   *   out   'fg' 결과를 인물 크기로 | 'bg' 배경 크기로
   *   fit   'cover' 배경을 채우고 넘치는 쪽을 자름 | 'stretch' 비율을 무시하고 늘임
   *   mode  'auto'   알파 경계를 기준으로 크기·자리를 계산 — 모든 장이 같은 자리 (bounds 필요)
   *         'random' 크기와 자리를 뽑되 **인물이 잘리지 않는 범위** 안에서만 (bounds 필요)
   *         'manual' scale·x·y 를 그대로 씀
   *         'as-is'  원본 크기 그대로 가운데 (크기가 같으면 1:1 로 겹침)
   *   bounds  alphaBounds() 결과 (mode 'auto'·'random' 일 때)
   *   fill    인물이 차지할 높이 비율 (0~1)
   *   bottom  바닥에서 띄울 비율 (0~1)
   *   randMin,randMax  무작위일 때 인물 높이 비율의 범위
   *   randomY  무작위일 때 세로도 뽑을지. 끄면 바닥에 세운다
   *   rng     0~1 을 돌려주는 함수 (없으면 Math.random). rngFrom(씨앗) 을 넣으면 늘 같게 나온다
   *   scale,x,y  수동 값. x·y 는 0~1 (0.5 가운데, y 1 이 바닥)
   * @returns {{width,height,bg:{x,y,w,h},fg:{x,y,w,h},scale:number}}
   */
  function placement(o) {
    const fgW = Math.max(1, o.fgW | 0);
    const fgH = Math.max(1, o.fgH | 0);
    const bgW = Math.max(1, o.bgW | 0);
    const bgH = Math.max(1, o.bgH | 0);
    const W = (o.out === 'bg') ? bgW : fgW;
    const H = (o.out === 'bg') ? bgH : fgH;

    // 배경 — 결과를 덮는다. cover 는 넘치는 쪽을 가운데 기준으로 자른다.
    let bg;
    if (o.fit === 'stretch') {
      bg = { x: 0, y: 0, w: W, h: H };
    } else {
      const k = Math.max(W / bgW, H / bgH);
      const w = Math.max(W, Math.round(bgW * k));
      const h = Math.max(H, Math.round(bgH * k));
      bg = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: w, h: h };
    }

    // 인물
    let k;
    let fx;
    let fy;
    if (o.mode === 'as-is') {
      k = 1;
      fx = Math.round((W - fgW) / 2);
      fy = Math.round((H - fgH) / 2);
    } else if (o.mode === 'random' && o.bounds && !o.bounds.empty) {
      // ★인물이 **잘리지 않는 범위** 안에서만 자리를 뽑는다. 경계가 화면 밖으로 나가면
      //   팔다리가 잘린 장이 섞여 들어오는데, 100장 중 몇 장인지 눈으로 찾을 수 없다.
      const rnd = o.rng || Math.random;
      const lo = clamp(o.randMin === undefined ? RANDOM.min : o.randMin, 0.05, 3);
      const hi = clamp(o.randMax === undefined ? RANDOM.max : o.randMax, 0.05, 3);
      const maxW = clamp(o.maxWidth === undefined ? AUTO.maxWidth : o.maxWidth, 0.05, 3);
      const fill = Math.min(lo, hi) + Math.abs(hi - lo) * rnd();
      k = Math.min((fill * H) / o.bounds.height, (maxW * W) / o.bounds.width);

      // 경계가 화면 안에 들어오는 fg.x 의 범위. 그래도 넘치면 가운데에 둔다.
      const xLo = -o.bounds.x0 * k;
      const xHi = W - o.bounds.x1 * k;
      fx = Math.round(xHi < xLo ? (xLo + xHi) / 2 : xLo + (xHi - xLo) * rnd());

      const yLo = -o.bounds.y0 * k;
      const yHi = H - o.bounds.y1 * k;
      if (o.randomY) {
        fy = Math.round(yHi < yLo ? (yLo + yHi) / 2 : yLo + (yHi - yLo) * rnd());
      } else {
        // 세로는 고정 — 바닥에 세운다. 공중에 뜬 인물은 대개 사고지 연출이 아니다.
        const bottom = clamp(o.bottom === undefined ? AUTO.bottom : o.bottom, -1, 1);
        const want = H * (1 - bottom) - o.bounds.y1 * k;
        fy = Math.round(yHi < yLo ? (yLo + yHi) / 2 : clamp(want, yLo, yHi));
      }
    } else if (o.mode === 'auto' && o.bounds && !o.bounds.empty) {
      const fill = clamp(o.fill === undefined ? AUTO.fill : o.fill, 0.05, 3);
      const bottom = clamp(o.bottom === undefined ? AUTO.bottom : o.bottom, -1, 1);
      const maxW = clamp(o.maxWidth === undefined ? AUTO.maxWidth : o.maxWidth, 0.05, 3);
      // 높이를 맞추되, 그러다 가로가 넘치면 가로에 맞춘다.
      k = Math.min((fill * H) / o.bounds.height, (maxW * W) / o.bounds.width);
      // 경계의 가운데를 화면 가운데에, 경계의 아래를 바닥 여백 위에 둔다.
      fx = Math.round(W / 2 - (o.bounds.x0 + o.bounds.width / 2) * k);
      fy = Math.round(H * (1 - bottom) - o.bounds.y1 * k);
    } else {
      // 수동. 결과가 인물 크기면 1.0 이 원본 그대로, 배경 크기면 화면에 꽉 차는 크기가 1.0.
      const base = (o.out === 'bg') ? Math.min(W / fgW, H / fgH) : 1;
      k = base * clamp(o.scale === undefined ? 1 : o.scale, 0.05, 4);
      const w = Math.max(1, Math.round(fgW * k));
      const h = Math.max(1, Math.round(fgH * k));
      fx = Math.round((W - w) * clamp(o.x === undefined ? 0.5 : o.x, 0, 1));
      fy = Math.round((H - h) * clamp(o.y === undefined ? 0.5 : o.y, 0, 1));
    }

    const fw = Math.max(1, Math.round(fgW * k));
    const fh = Math.max(1, Math.round(fgH * k));
    return {
      width: W, height: H,
      bg: bg,
      fg: { x: fx, y: fy, w: fw, h: fh },
      scale: k
    };
  }

  // ── 겹치기 ──────────────────────────────────────────────────────────────
  /**
   * src 를 dst 위에 얹는다 (source-over, straight 알파). 밖으로 나간 부분은 잘라 낸다.
   * ★dst 를 제자리에서 고친다.
   */
  function over(dst, dw, dh, src, sw, sh, dx, dy) {
    const x0 = Math.max(0, dx);
    const y0 = Math.max(0, dy);
    const x1 = Math.min(dw, dx + sw);
    const y1 = Math.min(dh, dy + sh);
    for (let y = y0; y < y1; y++) {
      const srow = (y - dy) * sw * 4;
      const drow = y * dw * 4;
      for (let x = x0; x < x1; x++) {
        const s = srow + (x - dx) * 4;
        const sa = src[s + 3];
        if (sa === 0) continue;
        const d = drow + x * 4;
        if (sa === 255) {
          dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = 255;
          continue;
        }
        const a = sa / 255;
        const da = dst[d + 3] / 255;
        const oa = a + da * (1 - a);
        if (oa <= 0) { dst[d] = 0; dst[d + 1] = 0; dst[d + 2] = 0; dst[d + 3] = 0; continue; }
        for (let c = 0; c < 3; c++) {
          dst[d + c] = Math.round((src[s + c] * a + dst[d + c] * da * (1 - a)) / oa);
        }
        dst[d + 3] = Math.round(oa * 255);
      }
    }
    return dst;
  }

  /** 크기가 같으면 그대로, 다르면 lanczos3 로 다시 표본화한다. */
  function scaleTo(px, w, h, dw, dh) {
    if (w === dw && h === dh) return px;
    if (!IU) throw new Error('image-util.js 가 없습니다.');
    return IU.resampleLanczos(px, w, h, dw, dh);
  }

  /**
   * 한 장을 합친다.
   *
   * @param {object} o
   *   fg {data,width,height}  인물 (투명 배경)
   *   bg {data,width,height}  배경
   *   alpha 'auto'|'straight'|'premultiplied'
   *   bgScaled {data,width,height}  이미 결과 크기로 줄여 둔 배경 (일괄 처리에서 재사용)
   *   그 밖의 값은 placement() 로 그대로 넘어간다.
   * @returns {{data,width,height,place,alphaMode,bounds,bgScaled}}
   */
  function composite(o) {
    const fg = o.fg;
    const bg = o.bg;
    const detected = detectAlpha(fg.data);
    const mode = (!o.alpha || o.alpha === 'auto') ? detected : o.alpha;
    const straight = toStraight(fg.data, mode);
    const bounds = alphaBounds(straight, fg.width, fg.height);

    const place = placement(Object.assign({}, o, {
      fgW: fg.width, fgH: fg.height, bgW: bg.width, bgH: bg.height, bounds: bounds
    }));

    const out = new Uint8ClampedArray(place.width * place.height * 4);

    // 배경 — 같은 배경으로 여러 장을 돌릴 때가 대부분이라 줄여 둔 것을 재사용한다.
    const cached = o.bgScaled;
    const bgPx = (cached && cached.width === place.bg.w && cached.height === place.bg.h)
      ? cached.data
      : scaleTo(bg.data, bg.width, bg.height, place.bg.w, place.bg.h);
    over(out, place.width, place.height, bgPx, place.bg.w, place.bg.h, place.bg.x, place.bg.y);

    const fgPx = scaleTo(straight, fg.width, fg.height, place.fg.w, place.fg.h);
    over(out, place.width, place.height, fgPx, place.fg.w, place.fg.h, place.fg.x, place.fg.y);

    return {
      data: out, width: place.width, height: place.height,
      place: place, alphaMode: mode, detected: detected, bounds: bounds,
      bgScaled: { data: bgPx, width: place.bg.w, height: place.bg.h }
    };
  }

  return {
    EDGE_ALPHA: EDGE_ALPHA,
    AUTO: AUTO,
    RANDOM: RANDOM,
    rngFrom: rngFrom,
    detectAlpha: detectAlpha,
    toStraight: toStraight,
    alphaBounds: alphaBounds,
    placement: placement,
    over: over,
    scaleTo: scaleTo,
    composite: composite
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Compose;
