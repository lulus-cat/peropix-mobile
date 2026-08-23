// 일관성 검사 — 뽑은 이미지들이 서로 얼마나 같은가.
//
// ★여기는 **견주기와 판정만** 한다. 특징 벡터를 어떻게 뽑는지(폰의 모델이냐 수신함의
//   모델이냐)는 밖에서 정한다. 그래야 두 길이 같은 잣대로 채점하고, 이 파일을 Node 에서
//   그대로 검사할 수 있다. 다른 조회 계층과 같은 규칙이다.
//
// ★"일관성" 은 두 가지로 쓴다. 재는 방법은 같고 무엇을 재느냐가 다르다.
//   - 그림체(style)  : 같은 작가 조합으로 뽑은 것들이 서로 같은 화풍인가. 테스트 모드.
//   - 인물(identity) : 대량으로 뽑은 것들이 같은 캐릭터인가. 대량생성.
//
// ★기준을 하나로 못 박지 않는다. 어떤 판은 원래 다양하게 나오는 것이 맞고(포즈가 다
//   다른 배치), 어떤 판은 똑같아야 맞다(같은 캐릭터 표정 세트). 그래서 **평균에서 얼마나
//   떨어졌는지**로 본다. 절대값 0.8 같은 것을 못 박으면 판마다 엉뚱한 답이 나온다.
'use strict';

const Consistency = (function () {
  /** 벡터 하나를 길이 1 로. 코사인 유사도를 내적 한 번으로 끝내려는 것이다. */
  function normalize(v) {
    const a = toArray(v);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
    const len = Math.sqrt(sum);
    if (!(len > 0)) return a.map(function () { return 0; });
    return a.map(function (x) { return x / len; });
  }

  function toArray(v) {
    if (!v) return [];
    return Array.prototype.slice.call(v).map(function (x) {
      const n = Number(x);
      return isFinite(n) ? n : 0;
    });
  }

  /**
   * 코사인 유사도. -1 ~ 1.
   * ★길이가 다르면 0 을 준다. 짧은 쪽에 맞춰 자르면 "조금 닮았다" 는 엉뚱한 답이 나온다.
   */
  function cosine(a, b) {
    const x = toArray(a);
    const y = toArray(b);
    if (!x.length || x.length !== y.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < x.length; i++) {
      dot += x[i] * y[i];
      na += x[i] * x[i];
      nb += y[i] * y[i];
    }
    if (!(na > 0) || !(nb > 0)) return 0;
    return dot / Math.sqrt(na * nb);
  }

  /** 벡터들의 한가운데. 여기서 얼마나 떨어졌는지가 곧 "튀는 정도" 다. */
  function centroid(vecs) {
    const list = (vecs || []).filter(function (v) { return v && v.length; });
    if (!list.length) return [];
    const n = list[0].length;
    const out = [];
    for (let i = 0; i < n; i++) out.push(0);
    let used = 0;
    list.forEach(function (v) {
      if (v.length !== n) return;      // 길이가 다른 것은 섞지 않는다
      const a = toArray(v);
      for (let i = 0; i < n; i++) out[i] += a[i];
      used++;
    });
    if (!used) return [];
    return out.map(function (x) { return x / used; });
  }

  /**
   * 한 장씩 "가운데와 얼마나 같은가" 를 잰다.
   * ★자기 자신을 가운데에 넣은 채로 재면, 장수가 적을수록 자기 점수가 부풀려진다.
   *   그래서 **자기를 뺀 나머지의 가운데**와 견준다 (leave-one-out).
   */
  function scores(vecs) {
    const list = (vecs || []).map(toArray);
    const n = list.length;
    if (n < 2) return list.map(function () { return 1; });
    return list.map(function (v, i) {
      const others = list.filter(function (_, k) { return k !== i; });
      return cosine(v, centroid(others));
    });
  }

  function mean(nums) {
    const a = (nums || []).filter(function (x) { return isFinite(x); });
    if (!a.length) return 0;
    return a.reduce(function (s, x) { return s + x; }, 0) / a.length;
  }

  function stdev(nums) {
    const a = (nums || []).filter(function (x) { return isFinite(x); });
    if (a.length < 2) return 0;
    const m = mean(a);
    const v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1);
    return Math.sqrt(v);
  }

  // 몇 σ 아래면 "튀었다" 로 볼지. 1.5 면 정규분포에서 대략 아래 7%.
  const SIGMA = 1.5;
  // 벌어진 정도가 이보다 작으면 어차피 다 비슷한 것이다. σ 로 나누면 잡음만 커진다.
  const FLAT = 0.01;

  /**
   * 이 장수에서 나올 수 있는 z 의 최대값.
   *
   * ★표본이 적으면 z 는 아무리 튀어도 (n-1)/√n 을 못 넘는다. 수학적으로 막혀 있다.
   *   4장이면 1.5, 3장이면 1.155 다. 그래서 "1.5σ 아래" 같은 기준을 그대로 쓰면
   *   4장짜리 묶음에서는 **영영 아무것도 안 걸린다.** 검사가 이것을 잡아냈다.
   *   조합 모드는 한 조합에 1~4장을 뽑으니 바로 그 자리다.
   */
  function maxZ(n) {
    return n >= 2 ? (n - 1) / Math.sqrt(n) : 0;
  }

  /** 이 장수에서 실제로 쓸 기준. 닿을 수 없는 기준을 들이대지 않는다. */
  function effectiveSigma(sigma, n) {
    const cap = maxZ(n) * 0.9;
    return Math.min(sigma, cap);
  }

  /**
   * 튀는 장 골라내기.
   *
   * @param {Array<Array<number>>} vecs 장마다의 특징 벡터
   * @param {object} [o] {sigma, min} sigma: 기준 σ, min: 이 값보다 낮으면 무조건 튄 것
   * @returns {{count, mean, sd, items:[{index, score, z, out}]}}
   */
  function report(vecs, o) {
    const opt = o || {};
    const want = isFinite(opt.sigma) ? opt.sigma : SIGMA;
    const sc = scores(vecs);
    const sigma = effectiveSigma(want, sc.length);
    const m = mean(sc);
    const sd = stdev(sc);
    // ★다 고만고만하면 아무도 튄 것이 아니다. σ 가 0 에 가까울 때 z 를 재면
    //   0.001 차이가 5σ 로 부풀어, 멀쩡한 장이 불량으로 찍힌다.
    const flat = sd < FLAT;
    const items = sc.map(function (s, i) {
      const z = flat ? 0 : (s - m) / sd;
      const low = isFinite(opt.min) && s < opt.min;
      return { index: i, score: round3(s), z: round2(z), out: low || (!flat && z <= -sigma) };
    });
    return {
      count: sc.length,
      mean: round3(m),
      sd: round3(sd),
      flat: flat,
      // 실제로 쓴 기준. 장수가 적어 낮춰 잡았으면 여기에 그 값이 남는다.
      sigma: round2(sigma),
      items: items
    };
  }

  function round2(x) { return Math.round(x * 100) / 100; }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  // 얼마나 고른가 — 사람이 읽을 등급. 평균이 아니라 **벌어진 정도**로 매긴다.
  // 평균은 모델마다 자릿수가 달라 비교가 안 되지만, 흩어진 정도는 뜻이 통한다.
  const GRADES = [
    { max: 0.02, label: '아주 고름', hint: '거의 같은 그림입니다.' },
    { max: 0.05, label: '고름', hint: '쓸 만합니다.' },
    { max: 0.10, label: '보통', hint: '몇 장이 튑니다. 아래 목록을 보세요.' },
    { max: Infinity, label: '들쭉날쭉', hint: '한 묶음으로 쓰기 어렵습니다.' }
  ];

  function grade(sd) {
    const v = isFinite(sd) ? sd : Infinity;
    return GRADES.find(function (g) { return v <= g.max; }) || GRADES[GRADES.length - 1];
  }

  // 이 아래로는 표본이 적어 판정을 믿기 어렵다. 숨기지 말고 그렇다고 적는다.
  const FEW = 5;

  /** 한 줄 요약. */
  function summary(rep) {
    if (!rep || !rep.count) return '';
    if (rep.count < 2) return '한 장뿐이라 견줄 것이 없습니다.';
    const g = grade(rep.sd);
    const bad = rep.items.filter(function (x) { return x.out; }).length;
    return rep.count + '장 · ' + g.label
      + (bad ? (' · 튀는 것 ' + bad + '장') : ' · 튀는 것 없음')
      // ★적은 장수로 낸 판정임을 밝힌다. 4장으로 "고르다" 고 해 봐야 우연일 수 있다.
      + (rep.count < FEW ? ' (장수가 적어 참고만 하세요)' : '');
  }

  /**
   * 한 번에 잰 것을 다시 묶음별로 나눈다.
   *
   * ★묶음마다 따로 부르면 요청이 묶음 수만큼 늘어난다. 그래서 전부 한 줄로 이어 보내고
   *   돌아온 것을 여기서 자른다. **자르는 자리가 한 칸이라도 밀리면 3번 그림의 점수가
   *   5번에 붙는다.** 화면은 멀쩡해 보이므로 아무도 못 알아챈다. 그래서 따로 떼어
   *   검사한다.
   * @param {Array} vectors 이어 붙여 잰 결과
   * @param {Array<number>} sizes 묶음마다 몇 장이었는지
   */
  function split(vectors, sizes) {
    const all = vectors || [];
    const out = [];
    let at = 0;
    (sizes || []).forEach(function (n) {
      const want = n > 0 ? n : 0;
      const part = [];
      for (let i = 0; i < want; i++) {
        const v = all[at + i];
        part.push(Array.isArray(v) ? v : []);
      }
      at += want;
      out.push(part);
    });
    return out;
  }

  /**
   * 두 묶음을 견준다 — 조합 A 와 조합 B 중 어느 쪽이 더 고른가.
   * ★테스트 모드에서 쓴다. 조합마다 여러 장 뽑았을 때 어느 조합이 안정적인지 보는 것이다.
   */
  function compare(groups) {
    return (groups || []).map(function (g) {
      const rep = report(g.vectors);
      return {
        name: g.name,
        count: rep.count,
        sd: rep.sd,
        mean: rep.mean,
        label: grade(rep.sd).label,
        report: rep
      };
    }).sort(function (a, b) {
      // 고른 것이 먼저. 장수가 적어 못 재는 것은 뒤로.
      if (a.count < 2 && b.count >= 2) return 1;
      if (b.count < 2 && a.count >= 2) return -1;
      return a.sd - b.sd;
    });
  }

  return {
    normalize: normalize,
    cosine: cosine,
    centroid: centroid,
    scores: scores,
    mean: mean,
    stdev: stdev,
    report: report,
    grade: grade,
    summary: summary,
    compare: compare,
    split: split,
    maxZ: maxZ,
    effectiveSigma: effectiveSigma,
    FEW: FEW,
    SIGMA: SIGMA,
    GRADES: GRADES
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Consistency;
