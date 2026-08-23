// 업데이트가 있는지 본다 — GitHub Releases 를 그대로 기준으로 쓴다.
//
// ★조용히 알아서 깔리게는 **못 만든다.** 안드로이드는 설치할 때 반드시 사람이 확인
//   화면을 눌러야 한다 (시스템 앱이나 기기 관리자면 예외인데, 옆에서 받아 까는 앱은
//   거기 해당하지 않는다). 그러니 앱이 할 수 있는 것은 여기까지다 —
//   **새 버전이 나온 것을 알아채고, 받는 곳까지 한 번에 데려다주는 것.**
//   그 뒤 "설치" 를 누르는 것은 사람 몫이다.
//
// ★여기는 주소를 만들고 응답을 읽는 일만 한다. 실제로 부르는 것은 app.js — 그래야
//   Node 에서 검사할 수 있다 (다른 조회 계층과 같은 규칙).
'use strict';

const Updater = (function () {
  const API = 'https://api.github.com';

  /**
   * 버전을 숫자 배열로. v1.2.10 → [1,2,10]
   * ★'-' 를 구분자로 쓰면 안 된다. 잘못 붙은 태그 v1.2.-15 가 [1,2,15] 로 읽혀
   *   1.2.12 보다 새 판이 되어 버린다 (실제로 빌드가 그런 태그를 낸 적이 있다).
   *   '-' 뒤는 parseInt 가 알아서 버리므로 v1.2.3-beta 는 [1,2,3] 이 되고,
   *   v1.2.-15 는 [1,2,-15] — 있는 그대로 낮은 판으로 읽힌다.
   */
  function parts(v) {
    return String(v || '').trim().replace(/^v/i, '').split(/[.+]/)
      .map(function (x) { return parseInt(x, 10); })
      .filter(function (n) { return !isNaN(n); });
  }

  /**
   * 버전 비교. a 가 크면 1, 같으면 0, 작으면 -1.
   * ★글자로 견주면 안 된다. '1.2.10' < '1.2.9' 가 되어 새 버전이 나와도 모른다.
   */
  function compare(a, b) {
    const x = parts(a);
    const y = parts(b);
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) {
      const p = x[i] === undefined ? 0 : x[i];
      const q = y[i] === undefined ? 0 : y[i];
      if (p !== q) return p > q ? 1 : -1;
    }
    return 0;
  }

  /** 저장소의 최신 릴리스 주소. 토큰이 필요 없다 (공개 저장소). */
  function latestUrl(repo) {
    const r = String(repo || '').trim().replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(r)) return '';
    return API + '/repos/' + r + '/releases/latest';
  }

  /**
   * 응답에서 쓸 것만 꺼낸다.
   * ★APK 를 못 찾으면 릴리스 쪽(html_url)이라도 준다. 소스만 올라간 릴리스에서 "받기" 가
   *   아무 데도 안 가면 고장으로 보인다.
   */
  function parseLatest(body) {
    let d = body;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (e) { return null; }
    }
    if (!d || !d.tag_name) return null;
    const assets = Array.isArray(d.assets) ? d.assets : [];
    const apk = assets.find(function (a) {
      return a && typeof a.name === 'string' && /\.apk$/i.test(a.name) && a.browser_download_url;
    });
    return {
      tag: String(d.tag_name),
      version: String(d.tag_name).replace(/^v/i, ''),
      name: String(d.name || d.tag_name),
      notes: String(d.body || ''),
      published: String(d.published_at || ''),
      apkUrl: apk ? String(apk.browser_download_url) : '',
      apkSize: apk ? Number(apk.size) || 0 : 0,
      pageUrl: String(d.html_url || '')
    };
  }

  /**
   * 지금 볼 때가 되었는가.
   * ★켤 때마다 물어보지 않는다. 토큰 없이 부르면 한 시간에 60번까지라, 자주 부르면
   *   정작 필요할 때 막힌다. 릴리스가 하루에 몇 번씩 나오지도 않는다.
   */
  function due(lastAt, now, hours) {
    const gap = (hours === undefined ? 6 : hours) * 3600 * 1000;
    const t = Number(lastAt) || 0;
    if (!t) return true;
    // 폰 시계를 뒤로 돌려 놓으면 lastAt 이 미래가 된다. 그때도 막히지 않게 한다.
    if (now < t) return true;
    return (now - t) >= gap;
  }

  /**
   * 알릴 것이 있는가.
   * @param {object} o {current, latest, skipped} 현재 버전 · 받아 온 버전 · 건너뛰기로 정한 버전
   * @returns {{show, version, reason}}
   */
  function decide(o) {
    const opt = o || {};
    const latest = opt.latest;
    if (!latest || !latest.version) return { show: false, reason: 'none' };
    // ★현재 버전을 모르면(브라우저 미리보기 등) 알림을 띄우지 않는다. 늘 "새 버전이다" 가
    //   되어 버려 알림이 무의미해진다.
    if (!opt.current) return { show: false, version: latest.version, reason: 'unknown' };
    if (compare(latest.version, opt.current) <= 0) {
      return { show: false, version: latest.version, reason: 'current' };
    }
    if (opt.skipped && compare(latest.version, opt.skipped) <= 0) {
      return { show: false, version: latest.version, reason: 'skipped' };
    }
    return { show: true, version: latest.version, reason: 'new' };
  }

  /** "1.2.5 → 1.2.6" 처럼 사람이 읽을 한 줄. */
  function summary(current, latest) {
    if (!latest || !latest.version) return '';
    if (!current) return latest.name;
    return current + ' → ' + latest.version;
  }

  /** 릴리스 본문에서 바뀐 것만 몇 줄 뽑는다 (접힌 부분과 꼬리표는 버린다). */
  function highlights(notes, max) {
    return String(notes || '')
      .replace(/<details[\s\S]*?<\/details>/gi, '')
      .split('\n')
      .map(function (l) { return l.replace(/^\s*[-*]\s*/, '').trim(); })
      .filter(function (l) {
        return l && !/^#/.test(l) && !/^https?:\/\//.test(l) && !/^\|/.test(l);
      })
      .slice(0, max || 5);
  }

  return {
    latestUrl: latestUrl,
    parseLatest: parseLatest,
    compare: compare,
    due: due,
    decide: decide,
    summary: summary,
    highlights: highlights
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Updater;
