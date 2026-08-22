// 원격 저장 대상(PC·VPS)과 통신한다. 상대는 tools/receiver.py 다.
//
// ★JSON+base64 모드를 쓴다. 네이티브 HTTP 로 바이너리를 그대로 흘려보내는 것보다 안정적이고,
//   경로를 본문에 담으므로 헤더가 latin-1 만 담는 문제(한글 페르소나!)를 아예 피한다.
'use strict';

const RemoteStore = (function () {
  function plugins() {
    const C = window.Capacitor;
    return (C && C.Plugins) ? C.Plugins : null;
  }

  function isNative() {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  }

  function baseUrl(dest) {
    let u = (dest.url || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '');
  }

  async function request(dest, method, path, bodyObj) {
    const url = baseUrl(dest) + path;
    const headers = { Authorization: 'Bearer ' + (dest.token || '') };
    if (bodyObj) headers['Content-Type'] = 'application/json';

    const P = plugins();
    if (isNative() && P && P.CapacitorHttp) {
      const r = await P.CapacitorHttp.request({
        method: method,
        url: url,
        headers: headers,
        data: bodyObj,
        connectTimeout: 30000,
        readTimeout: 120000
      });
      let body = r.data;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = { raw: body }; }
      }
      return { status: r.status, body: body || {} };
    }

    const r = await fetch(url, {
      method: method,
      headers: headers,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined
    });
    let body = {};
    try { body = await r.json(); } catch (e) { /* 본문이 JSON 이 아니면 상태코드만 쓴다 */ }
    return { status: r.status, body: body };
  }

  function explain(status, body) {
    if (body && body.error) return body.error;
    if (status === 401) return '토큰이 맞지 않습니다.';
    if (status === 404) return '주소는 닿았지만 수신함이 아닙니다 (경로를 확인하세요).';
    if (status === 413) return '이미지가 너무 큽니다.';
    return '서버가 ' + status + ' 를 돌려주었습니다.';
  }

  /** 연결·토큰 확인. @returns {Promise<{ok:boolean,message:string,root?:string}>} */
  async function ping(dest) {
    if (!baseUrl(dest)) return { ok: false, message: '주소가 비어 있습니다.' };
    if (!dest.token) return { ok: false, message: '토큰이 비어 있습니다.' };
    try {
      const r = await request(dest, 'GET', '/ping', null);
      if (r.status === 200 && r.body.ok) {
        return { ok: true, message: '연결됨 · 저장 폴더: ' + (r.body.root || '?'), root: r.body.root };
      }
      return { ok: false, message: explain(r.status, r.body) };
    } catch (e) {
      return { ok: false, message: '연결 실패: ' + (e && e.message ? e.message : e) };
    }
  }

  /**
   * 이미지 한 장을 올린다.
   * @param {object} dest {url, token}
   * @param {string} relPath "미아/happy.png"
   * @param {string} b64 base64 로 만든 PNG
   * @returns {Promise<string>} 서버가 실제로 저장한 상대 경로
   */
  async function upload(dest, relPath, b64) {
    const r = await request(dest, 'POST', '/upload', { path: relPath, data: b64 });
    if (r.status === 200 && r.body.ok) return r.body.path;
    throw new Error(explain(r.status, r.body));
  }

  /** 저장된 파일 목록 — 매트릭스가 얼마나 찼는지 볼 때 쓴다. */
  async function list(dest, prefix) {
    const q = prefix ? ('?prefix=' + encodeURIComponent(prefix)) : '';
    const r = await request(dest, 'GET', '/list' + q, null);
    if (r.status === 200 && r.body.ok) return r.body.files || [];
    throw new Error(explain(r.status, r.body));
  }

  // ── 폴더 관리 ────────────────────────────────────────────────────────────
  /** 한 폴더의 바로 아래. @returns {Promise<{path:string,dirs:Array,files:Array}>} */
  async function browse(dest, path) {
    const q = '?path=' + encodeURIComponent(path || '');
    const r = await request(dest, 'GET', '/browse' + q, null);
    if (r.status === 200 && r.body.ok) {
      return { path: r.body.path || '', dirs: r.body.dirs || [], files: r.body.files || [] };
    }
    throw new Error(explain(r.status, r.body));
  }

  async function mkdir(dest, path) {
    const r = await request(dest, 'POST', '/mkdir', { path: path });
    if (r.status === 200 && r.body.ok) return r.body.path;
    if (r.status === 409) throw new Error('같은 이름이 이미 있습니다.');
    throw new Error(explain(r.status, r.body));
  }

  async function rename(dest, from, to) {
    const r = await request(dest, 'POST', '/rename', { from: from, to: to });
    if (r.status === 200 && r.body.ok) return r.body.path;
    if (r.status === 409) throw new Error('그 이름이 이미 있습니다.');
    throw new Error(explain(r.status, r.body));
  }

  /**
   * 지운다. 비어 있지 않은 폴더는 recursive 를 켜야 지워진다.
   * @returns {Promise<{ok:boolean, needsConfirm?:boolean, count?:number}>}
   */
  async function remove(dest, path, recursive) {
    const r = await request(dest, 'POST', '/delete', { path: path, recursive: !!recursive });
    if (r.status === 200 && r.body.ok) return { ok: true };
    // ★비어 있지 않은 폴더는 서버가 한 번 되묻는다. 실수로 수백 장을 날리지 않기 위해서다.
    if (r.status === 409 && r.body.needs_confirm) {
      return { ok: false, needsConfirm: true, count: r.body.count };
    }
    throw new Error(explain(r.status, r.body));
  }

  // ── 작업 큐 ─────────────────────────────────────────────────────────────
  // ★「이거 뽑으세요」 쪽지를 받아 오고, 진행·결과를 알린다. 키는 이 폰에만 있으므로
  //   실제로 NovelAI 를 부르고 Anlas 를 쓰는 것은 언제나 이쪽이다.

  /** 기다리는 작업 목록. @returns {Promise<Array>} */
  async function listJobs(dest, status) {
    const q = status ? ('?status=' + encodeURIComponent(status)) : '';
    const r = await request(dest, 'GET', '/jobs' + q, null);
    if (r.status === 200 && r.body.ok) return r.body.jobs || [];
    throw new Error(explain(r.status, r.body));
  }

  /**
   * 기다리는 것 하나를 집어 온다 (없으면 null).
   * ★집는 순간 서버가 running 으로 바꾼다 — 폰이 둘이어도 같은 작업을 두 번 뽑지 않는다.
   */
  async function claimJob(dest) {
    const r = await request(dest, 'POST', '/jobs/claim', {});
    if (r.status === 200 && r.body.ok) return r.body.job || null;
    throw new Error(explain(r.status, r.body));
  }

  /** 진행·결과를 알린다. {id, status, progress:{done,total}, files, error} */
  async function updateJob(dest, patch) {
    const r = await request(dest, 'POST', '/jobs/update', patch || {});
    if (r.status === 200 && r.body.ok) return r.body.job;
    throw new Error(explain(r.status, r.body));
  }

  async function deleteJob(dest, id) {
    const r = await request(dest, 'POST', '/jobs/delete', { id: id });
    if (r.status === 200 && r.body.ok) return true;
    throw new Error(explain(r.status, r.body));
  }

  return {
    ping: ping, upload: upload, list: list, baseUrl: baseUrl,
    browse: browse, mkdir: mkdir, rename: rename, remove: remove,
    listJobs: listJobs, claimJob: claimJob, updateJob: updateJob, deleteJob: deleteJob
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RemoteStore;
