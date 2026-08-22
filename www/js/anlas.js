// Anlas — 잔량 조회와 소모량 계산.
//
// ★backend.py 의 calculate_anlas_cost() 와 **같은 식**이어야 한다. 이 숫자가 틀리면
//   "무료인 줄 알았는데 차감" 또는 그 반대가 되고, 둘 다 실제로 있었던 사고다.
//   대조 검사: mobile/tools/test_anlas.js
'use strict';

const Anlas = (function () {
  // 공홈 웹 번들에서 뽑은 계수 (backend.py 와 같은 값이어야 한다).
  const COST_A = 2.951823174884865e-06;
  const COST_B = 5.753298233447344e-07;
  const MAX_COST_PER_IMAGE = 140;      // 공홈은 이걸 넘으면 생성 자체를 막는다
  const OPUS_FREE_PIXELS = 1048576;    // 1MP
  const VIBE_ENCODE_COST = 2;

  function caps(model) {
    const base = NAI_TABLES.BASE_MODEL[model] || model;
    return NAI_TABLES.MODEL_CAPS[base] || NAI_TABLES.CAPS_FALLBACK;
  }

  /**
   * 장당 원가.
   * ★여기서 올림하지 않는다 — 부르는 쪽이 strength 를 곱한 뒤에 올린다.
   *   여기서 한 번 더 올리면 strength 가 1 이 아닐 때 어긋난다.
   */
  function imageSampleCost(width, height, steps, smea, smeaDyn, model) {
    const px = width * height;
    const base = Math.ceil(COST_A * px + COST_B * px * steps);
    const mult = smeaDyn ? 1.4 : (smea ? 1.2 : 1);
    // ★V5 는 같은 해상도·스텝에서 V4.5 의 1.5배다. 모델을 안 넘기면 표시가 실제의 2/3 이 된다.
    return base * mult * (model ? caps(model).anlas_multiplier : 1);
  }

  /**
   * 한 장의 소모량.
   * @param {object} o {width,height,steps,isOpus,refCount,strength,smea,smeaDyn,model,opusExhausted}
   */
  function perImageCost(o) {
    const pixels = o.width * o.height;
    const strength = (o.strength === undefined) ? 1.0 : o.strength;

    let perSample = imageSampleCost(o.width, o.height, o.steps, !!o.smea, !!o.smeaDyn, o.model);
    perSample = Math.max(Math.ceil(perSample * strength), 2);

    // Opus 무료: 1MP 이하 + 28 스텝 이하면 1장이 공짜.
    // ★★V5 부터 이 무료가 유한하다. 잔량이 바닥났을 때(isNegative)만 꺼진다 —
    //   퍼센트가 낮다고 미리 끄지 않는다. 그리고 opus_usage_limit 능력이 있는 모델에만 걸린다.
    const spent = !!o.opusExhausted && caps(o.model).opus_usage_limit;
    const opusFree = !!o.isOpus && !spent && pixels <= OPUS_FREE_PIXELS && o.steps <= 28;

    let total = opusFree ? 0 : perSample;
    // 참조는 개당 5, 장당. Opus 여부와 무관하다.
    total += 5 * (o.refCount || 0);
    return total;
  }

  /**
   * 배치 전체의 소모량.
   * ★참조·바이브는 그 모델이 지원할 때만 실제로 전송되므로, 계산도 같은 조건으로 끊어야 한다.
   *   표시와 전송이 어긋나면 "무료라고 떴는데 차감"이 된다.
   * @returns {{perImage:number, total:number, free:boolean, overLimit:boolean, count:number}}
   */
  function estimate(o) {
    const cap = caps(o.model);
    const refCount = cap.char_ref ? (o.refCount || 0) : 0;
    const vibeCount = cap.vibe ? (o.vibeCount || 0) : 0;
    const count = Math.max(0, o.count || 0);

    const perImage = perImageCost({
      width: o.width, height: o.height, steps: o.steps,
      isOpus: o.isOpus, refCount: refCount, strength: o.strength,
      smea: o.smea, smeaDyn: o.smeaDyn, model: o.model,
      opusExhausted: o.opusExhausted
    });

    let total = perImage * count;

    // 바이브 인코딩과 4개 초과 가산은 **요청당 한 번**이지 장당이 아니다.
    // ★참조가 하나라도 있거나 인페인트면 공홈은 바이브 비용을 아예 더하지 않는다.
    const vibeBillable = refCount === 0 && !o.hasMask && cap.vibe;
    if (vibeBillable) {
      total += (o.uncachedVibeCount || 0) * VIBE_ENCODE_COST;
      total += Math.max(0, vibeCount - 4) * VIBE_ENCODE_COST;
    }

    // ★1장 상한(140) 판정은 참조비를 뺀 **기본 생성비**로 한다.
    const strength = (o.strength === undefined) ? 1.0 : o.strength;
    const basePerSample = Math.max(Math.ceil(
      imageSampleCost(o.width, o.height, o.steps, !!o.smea, !!o.smeaDyn, o.model) * strength), 2);

    return {
      perImage: perImage,
      total: total,
      count: count,
      free: total === 0,
      overLimit: basePerSample > MAX_COST_PER_IMAGE
    };
  }

  /**
   * /user/subscription 응답을 화면이 쓸 모양으로 정리한다.
   * ★구버전 계정은 trainingStepsLeft 가 숫자다. usage 는 아예 없을 수도 있다.
   */
  function parseSubscription(data) {
    if (!data || typeof data !== 'object') return null;
    const ts = data.trainingStepsLeft;
    let subscription = 0;
    let purchased = 0;

    if (typeof ts === 'number') {
      subscription = ts;
    } else if (ts && typeof ts === 'object') {
      subscription = ts.fixedTrainingStepsLeft || 0;
      purchased = ts.purchasedTrainingSteps || 0;
    }

    const usage = (data.usage && typeof data.usage === 'object') ? data.usage : null;
    const tier = data.tier || 0;

    return {
      anlas: subscription + purchased,
      subscription: subscription,
      purchased: purchased,
      tier: tier,
      tierName: ({ 0: '무료', 1: 'Tablet', 2: 'Scroll', 3: 'Opus' })[tier] || ('tier ' + tier),
      isOpus: tier >= 3,
      active: !!data.active,
      // V5 Opus 무료 잔량. 없는 계정도 있으므로 null 을 그대로 둔다.
      usagePercent: usage && typeof usage.percent === 'number' ? usage.percent : null,
      opusExhausted: usage ? !!usage.isNegative : false
    };
  }

  return {
    imageSampleCost: imageSampleCost,
    perImageCost: perImageCost,
    estimate: estimate,
    parseSubscription: parseSubscription,
    MAX_COST_PER_IMAGE: MAX_COST_PER_IMAGE
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Anlas;
