// NovelAI 통신 — 구독 확인, 이미지 생성, ZIP 해제, 기기 저장.
//
// ★안드로이드 WebView 에서 fetch 로 NAI 를 직접 부르면 CORS 에 막힌다.
//   CapacitorHttp(네이티브 HTTP)로 보내면 브라우저 보안정책을 타지 않는다.
//   PC 브라우저 미리보기에서는 fetch 로 떨어지는데, 그때는 CORS 로 막히는 게 정상이다.
// ★NAI 는 PNG 를 ZIP 으로 감싸 돌려준다. 그래서 응답을 바이너리로 받아 풀어야 한다.
'use strict';

const NaiClient = (function () {
  const SUBSCRIPTION_URL = 'https://image.novelai.net/user/subscription';

  function plugins() {
    const C = window.Capacitor;
    return (C && C.Plugins) ? C.Plugins : null;
  }

  function isNative() {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  }

  // ── base64 ↔ 바이트 ──────────────────────────────────────────────────────
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    // ★한 번에 String.fromCharCode 로 넘기면 큰 이미지에서 스택이 터진다. 조각내어 잇는다.
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  // ── 구독 확인 (키 유효성) ────────────────────────────────────────────────
  /**
   * 키가 실제로 통하는지 NAI 에 물어본다.
   * @returns {Promise<{ok: boolean, message: string, tier?: number}>}
   */
  async function checkSubscription(token) {
    const headers = { Authorization: 'Bearer ' + token };
    try {
      let status, body;
      const P = plugins();
      if (isNative() && P && P.CapacitorHttp) {
        const r = await P.CapacitorHttp.request({
          method: 'GET', url: SUBSCRIPTION_URL, headers: headers, connectTimeout: 20000
        });
        status = r.status;
        body = r.data;
      } else {
        const r = await fetch(SUBSCRIPTION_URL, { headers: headers });
        status = r.status;
        body = await r.json().catch(function () { return null; });
      }

      if (status === 200) {
        // ★raw 를 그대로 넘긴다 — Anlas 잔량·Opus 무료 잔량이 여기 들어 있다.
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) { body = null; }
        }
        const tier = body && typeof body === 'object' ? body.tier : undefined;
        return { ok: true, message: '키가 정상 확인되었습니다.', tier: tier, raw: body };
      }
      if (status === 401) return { ok: false, message: '키가 거부되었습니다 (401). 키를 다시 확인해주세요.' };
      return { ok: false, message: 'NAI 서버가 ' + status + ' 를 돌려주었습니다.' };
    } catch (e) {
      return { ok: false, message: '연결 실패: ' + (e && e.message ? e.message : e) };
    }
  }

  // ── 재시도 ───────────────────────────────────────────────────────────────
  // ★대량 생성에서는 폰이 잠깐 네트워크를 놓치는 일이 반드시 생긴다
  //   ("Unable to resolve host" 등). 한 번 실패했다고 그 장을 버리면 안 된다.
  //   ★단, 돈이나 인증 문제(400/401/402)는 다시 보내도 같은 답이다 — 재시도하지 않는다.
  const RETRY_DELAYS = [1500, 4000, 9000];   // 세 번까지 다시 해 본다

  /** 이 오류가 "다시 해 보면 될 수도 있는" 종류인가. */
  function isTransient(err) {
    const msg = String((err && err.message) || err || '');
    if (/\((400|401|402)\)/.test(msg)) return false;
    if (/NAI 오류 4(0[3-9]|1\d|2[0-8])/.test(msg)) return false;   // 그 밖의 4xx 도 대개 영구
    return true;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /**
   * 일시적 오류면 몇 번 더 해 본다.
   * @param {function} fn 실제 요청
   * @param {function} [onRetry] (시도횟수, 남은대기ms, 오류) — 화면에 알릴 때 쓴다
   */
  async function withRetry(fn, onRetry) {
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (attempt === RETRY_DELAYS.length || !isTransient(e)) break;
        const wait = RETRY_DELAYS[attempt];
        if (onRetry) onRetry(attempt + 1, wait, e);
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  // ── 이미지 생성 ──────────────────────────────────────────────────────────
  /**
   * 페이로드 하나를 보내 PNG 한 장을 받는다.
   * @returns {Promise<{bytes: Uint8Array, seed: number}>}
   */
  async function generate(token, built, onRetry) {
    return withRetry(function () { return generateOnce(token, built); }, onRetry);
  }

  async function generateOnce(token, built) {
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    };

    let status, zipBytes;
    const P = plugins();

    if (isNative() && P && P.CapacitorHttp) {
      const r = await P.CapacitorHttp.request({
        method: 'POST',
        url: built.url,
        headers: headers,
        data: built.payload,
        responseType: 'arraybuffer',
        connectTimeout: 120000,
        readTimeout: 120000
      });
      status = r.status;
      // 네이티브는 arraybuffer 를 base64 문자열로 돌려준다.
      if (typeof r.data === 'string') zipBytes = base64ToBytes(r.data);
      else if (r.data instanceof ArrayBuffer) zipBytes = new Uint8Array(r.data);
      else zipBytes = null;
    } else {
      const r = await fetch(built.url, {
        method: 'POST', headers: headers, body: JSON.stringify(built.payload)
      });
      status = r.status;
      zipBytes = new Uint8Array(await r.arrayBuffer());
    }

    if (status !== 200) {
      let detail = '';
      try {
        detail = zipBytes ? new TextDecoder().decode(zipBytes.subarray(0, 500)) : '';
      } catch (e) { /* 본문을 못 읽어도 상태코드는 알린다 */ }
      throw new Error(naiErrorMessage(status, detail));
    }
    if (!zipBytes || !zipBytes.length) throw new Error('NAI 응답이 비어 있습니다.');

    // ZIP 해제 — 첫 항목이 PNG 다.
    let files;
    try {
      files = fflate.unzipSync(zipBytes);
    } catch (e) {
      const head = new TextDecoder().decode(zipBytes.subarray(0, 300));
      throw new Error('NAI 응답이 이미지가 아닙니다: ' + head);
    }
    const names = Object.keys(files);
    if (!names.length) throw new Error('NAI 응답에 이미지가 없습니다.');

    return { bytes: files[names[0]], seed: built.seed };
  }

  /** 네트워크 단에서 난 오류를 알아보기 쉽게 바꾼다. */
  function networkMessage(e) {
    const msg = String((e && e.message) || e || '');
    if (/resolve host|ENOTFOUND|getaddrinfo|No address associated/i.test(msg)) {
      return '인터넷 연결이 끊겼습니다 (주소를 찾지 못함)';
    }
    if (/timed? ?out|ETIMEDOUT/i.test(msg)) return '응답이 없어 시간이 초과되었습니다';
    if (/Failed to fetch|Network|ECONNRESET|ECONNREFUSED/i.test(msg)) return '연결에 실패했습니다';
    return msg;
  }

  function naiErrorMessage(status, detail) {
    if (status === 401) return '키가 거부되었습니다 (401). 설정에서 API 키를 다시 넣어주세요.';
    if (status === 402) return 'Anlas 가 부족하거나 구독이 필요합니다 (402).';
    if (status === 429) return '요청이 너무 잦습니다 (429). 잠시 뒤 다시 시도해주세요.';
    if (status === 400) return '요청이 거부되었습니다 (400): ' + detail;
    return 'NAI 오류 ' + status + ': ' + detail;
  }

  /**
   * NAI 업스케일 (/ai/upscale) — 창작적 변형 없이 해상도만 4배로 올린다.
   * ★생성과 다른 엔드포인트다. 응답은 생성과 같은 ZIP(PNG 한 장).
   * @returns {Promise<{bytes: Uint8Array}>}
   */
  async function upscale(token, built, onRetry) {
    return withRetry(function () { return upscaleOnce(token, built); }, onRetry);
  }

  async function upscaleOnce(token, built) {
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    };

    let status, zipBytes;
    const P = plugins();

    if (isNative() && P && P.CapacitorHttp) {
      const r = await P.CapacitorHttp.request({
        method: 'POST', url: built.url, headers: headers, data: built.payload,
        responseType: 'arraybuffer', connectTimeout: 120000, readTimeout: 180000
      });
      status = r.status;
      if (typeof r.data === 'string') zipBytes = base64ToBytes(r.data);
      else if (r.data instanceof ArrayBuffer) zipBytes = new Uint8Array(r.data);
      else zipBytes = null;
    } else {
      const r = await fetch(built.url, {
        method: 'POST', headers: headers, body: JSON.stringify(built.payload)
      });
      status = r.status;
      zipBytes = new Uint8Array(await r.arrayBuffer());
    }

    if (status !== 200) {
      let detail = '';
      try { detail = zipBytes ? new TextDecoder().decode(zipBytes.subarray(0, 400)) : ''; } catch (e) { /* 무시 */ }
      throw new Error(naiErrorMessage(status, detail));
    }
    if (!zipBytes || !zipBytes.length) throw new Error('업스케일 응답이 비어 있습니다.');

    let files;
    try {
      files = fflate.unzipSync(zipBytes);
    } catch (e) {
      const head = new TextDecoder().decode(zipBytes.subarray(0, 300));
      throw new Error('업스케일 응답이 이미지가 아닙니다: ' + head);
    }
    const names = Object.keys(files);
    if (!names.length) throw new Error('업스케일 응답에 이미지가 없습니다.');
    return { bytes: files[names[0]] };
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────
  /**
   * PNG 를 기기에 저장한다. 안드로이드는 문서 폴더의 PeroPix 아래.
   * PC 미리보기에서는 브라우저 다운로드로 떨어진다.
   * @returns {Promise<string>} 저장 위치 설명
   */
  async function saveImage(bytes, filename) {
    const P = plugins();
    if (isNative() && P && P.Filesystem) {
      await P.Filesystem.writeFile({
        path: 'PeroPix/' + filename,
        data: bytesToBase64(bytes),
        directory: 'DOCUMENTS',
        recursive: true
      });
      return '문서/PeroPix/' + filename;
    }
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // ★브라우저 다운로드는 폴더를 만들지 못한다 — 경로 구분자를 눌러 한 이름으로 만든다.
    a.download = filename.replace(/\//g, '_');
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return a.download + ' (브라우저 다운로드)';
  }

  function toDataUrl(bytes) {
    return 'data:image/png;base64,' + bytesToBase64(bytes);
  }

  return {
    checkSubscription: checkSubscription,
    generate: generate,
    upscale: upscale,
    networkMessage: networkMessage,
    saveImage: saveImage,
    toDataUrl: toDataUrl,
    toBase64: bytesToBase64,
    isNative: isNative
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NaiClient;
