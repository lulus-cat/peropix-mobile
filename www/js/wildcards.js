// 와일드카드 — 프롬프트 안의 토큰을 풀에서 뽑아 바꾼다.
//
// 데스크톱 버전(index.html 의 parseWildcardDoc / resolveWildcards)과 같은 규칙이다.
//   #이름          한 줄에 단독으로 있으면 풀 정의, 프롬프트 안에 있으면 그 풀에서 하나 뽑기
//   //             주석 (줄 시작 또는 공백 뒤. http:// 처럼 붙은 것은 남긴다)
//   ||a|b||        NAI 네이티브 인라인
//   {a|b}          인라인 변형
//
// ★슬롯마다 **따로** 뽑는다. 한 배치 안에서도 장마다 다른 조합이 나와야 대량 생산에 쓸모가 있다.
'use strict';

const Wildcards = (function () {
  const MAX_DEPTH = 20;   // 순환 참조 방어

  /**
   * 정의 문서를 풀로 만든다.
   * @returns {object} { 이름(소문자): [후보, ...] }
   */
  function parse(text) {
    const pools = {};
    if (!text) return pools;
    let current = null;

    text.split('\n').forEach(function (rawLine) {
      // ★주석은 줄 시작 // 또는 공백 뒤 // 만. `http://` 처럼 붙은 것은 건드리지 않는다.
      const line = rawLine.replace(/\r$/, '').replace(/(^|\s)\/\/.*$/, '$1');
      const trimmed = line.trim();
      if (!trimmed) return;

      const header = trimmed.match(/^#([A-Za-z0-9_]+)$/);   // 단독 #이름 = 섹션 헤더
      if (header) {
        current = header[1].toLowerCase();
        if (!pools[current]) pools[current] = [];
        return;
      }
      if (current) {
        const cand = trimmed.replace(/[\s,]+$/, '');
        if (cand) pools[current].push(cand);
      }
      // 헤더가 아직 없으면 본문은 무시한다 (파일 맨 앞의 설명문 등)
    });
    return pools;
  }

  function pick(list, rand) {
    return list[Math.floor((rand || Math.random)() * list.length)];
  }

  /**
   * 프롬프트의 와일드카드를 실제 값으로 바꾼다.
   * @param {string} text
   * @param {object} pools parse() 결과
   * @param {function} [rand] 0~1 난수 (검사에서 고정하려고 주입한다)
   */
  function resolve(text, pools, rand, depth) {
    if (!text) return text;
    depth = depth || 0;
    if (depth > MAX_DEPTH) return text;
    pools = pools || {};
    let result = text;

    // 1) 명명 풀 호출: #이름 (정의가 없으면 원문 그대로 둔다)
    //    ★(?<![A-Za-z0-9_]) — `source#hug` 같은 NAI 액션 태그의 # 은 건드리면 안 된다.
    result = result.replace(/(?<![A-Za-z0-9_])#([A-Za-z0-9_]+)/g, function (m, name) {
      const pool = pools[name.toLowerCase()];
      if (!pool || pool.length === 0) return m;
      return resolve(pick(pool, rand), pools, rand, depth + 1);
    });

    // 2) NAI 네이티브 인라인: ||a|b|c||
    result = result.replace(/\|\|([^]*?)\|\|/g, function (m, body) {
      return resolve(pick(body.split('|'), rand), pools, rand, depth + 1);
    });

    // 3) 인라인 변형: {a|b|c}
    result = result.replace(/\{([^{}]*\|[^{}]*)\}/g, function (m, body) {
      return resolve(pick(body.split('|'), rand), pools, rand, depth + 1);
    });

    return result;
  }

  /** 문서에 쓸 만한 토큰이 하나라도 있나 (있을 때만 화면에 안내를 띄운다). */
  function hasTokens(text) {
    if (!text) return false;
    return /(?<![A-Za-z0-9_])#[A-Za-z0-9_]+/.test(text)
      || text.indexOf('||') !== -1
      || /\{[^{}]*\|[^{}]*\}/.test(text);
  }

  const SAMPLE = [
    '// 한 줄 = 한 후보 / #이름 = 풀 정의 / // = 주석',
    '',
    '#hair',
    'blonde hair',
    '(black hair:1.2)',
    'red twintails, long hair',
    '{silver|pink|blue} hair',
    '',
    '#outfit',
    'school uniform',
    'white dress, frills',
    'black business suit, necktie',
    '',
    '#pose',
    'standing, hands behind back',
    'sitting, legs crossed',
    'leaning on wall, arms folded'
  ].join('\n');

  return {
    parse: parse,
    resolve: resolve,
    hasTokens: hasTokens,
    SAMPLE: SAMPLE
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Wildcards;
