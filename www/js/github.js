// GitHub 지시함 — 저장소의 파일 하나를 「이거 뽑으세요」 목록으로 읽는다.
//
// ★서버가 없어도 된다. AI(Claude Code 등)가 저장소에 JSON 을 커밋해 두면 폰이 그것을 읽어 뽑는다.
//   무엇을 언제 지시했는지가 커밋 이력으로 남는 것도 덤이다.
// ★**파일 하나만** 본다 (기본 perofix/queue.json). 폴더 목록을 보려면 GitHub API 를 써야 하는데,
//   토큰 없는 API 는 시간당 60번이라 1분 폴링으로도 한도를 친다. raw 는 CDN 이라 그 제한이 없다.
// ★공개 저장소면 토큰이 필요 없다. 비공개면 읽기 전용 토큰을 넣어 API 로 읽는다.
// ★앱은 저장소에 **쓰지 않는다.** 무엇을 이미 했는지는 폰이 기억한다 (id 목록).
//   폰에 쓰기 권한을 주지 않으려는 것이다 — 지시는 받되 저장소는 건드리지 않는다.
'use strict';

const Github = (function () {
  const RAW = 'https://raw.githubusercontent.com';
  const API = 'https://api.github.com';

  /**
   * "owner/repo", "https://github.com/owner/repo", ".git" 붙은 것까지 받아 준다.
   * @returns {{owner:string, repo:string}|null}
   */
  function parseRepo(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
    s = s.replace(/^git@github\.com:/i, '');
    s = s.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const parts = s.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const ok = /^[A-Za-z0-9._-]+$/;
    if (!ok.test(parts[0]) || !ok.test(parts[1])) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  function cleanPath(p) {
    return String(p || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  }

  /** 공개 저장소용 — CDN 이라 API 한도를 안 쓴다. ★캐시를 피하려고 시각을 붙인다. */
  function rawUrl(cfg, bust) {
    const r = parseRepo(cfg.repo);
    if (!r) return '';
    const branch = (cfg.branch || 'main').trim() || 'main';
    const path = cleanPath(cfg.path) || 'perofix/queue.json';
    const q = bust ? ('?t=' + bust) : '';
    return RAW + '/' + r.owner + '/' + r.repo + '/' + encodeURIComponent(branch) + '/'
      + path.split('/').map(encodeURIComponent).join('/') + q;
  }

  /** 비공개 저장소용 — 토큰이 있어야 하고, Accept 를 raw 로 주면 본문이 그대로 온다. */
  function apiUrl(cfg) {
    const r = parseRepo(cfg.repo);
    if (!r) return '';
    const branch = (cfg.branch || 'main').trim() || 'main';
    const path = cleanPath(cfg.path) || 'perofix/queue.json';
    return API + '/repos/' + r.owner + '/' + r.repo + '/contents/'
      + path.split('/').map(encodeURIComponent).join('/')
      + '?ref=' + encodeURIComponent(branch);
  }

  /** 사람이 눈으로 확인할 주소 (설정 화면에 보여 준다). */
  function webUrl(cfg) {
    const r = parseRepo(cfg.repo);
    if (!r) return '';
    const branch = (cfg.branch || 'main').trim() || 'main';
    const path = cleanPath(cfg.path) || 'perofix/queue.json';
    return 'https://github.com/' + r.owner + '/' + r.repo + '/blob/' + branch + '/' + path;
  }

  // ★내용이 같으면 같은 id 가 나와야 한다. id 를 안 적어 준 지시도 두 번 실행하지 않게.
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /**
   * 지시 파일을 작업 목록으로 읽는다.
   * 받아 주는 모양: 작업 하나 / 배열 / {jobs:[...]} / {queue:[...]}
   * @returns {{ok:boolean, jobs:Array<{id,name,spec}>, error?:string}}
   */
  function parseQueue(text) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, jobs: [], error: '지시 파일이 비어 있습니다.' };

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // ★코드블록 표시를 같이 커밋해 두는 실수가 잦다. 벗겨서 다시 시도한다.
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        data = JSON.parse(stripped);
      } catch (e2) {
        return { ok: false, jobs: [], error: 'JSON 형식이 아닙니다: ' + e2.message };
      }
    }

    let list;
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data.jobs)) list = data.jobs;
    else if (Array.isArray(data.queue)) list = data.queue;
    else list = [data];

    const jobs = [];
    list.forEach(function (item, i) {
      if (!item || typeof item !== 'object') return;
      // 작업이 {id, name, spec} 로 싸여 있어도 되고, 지시 자체(prefix/slots)를 그대로 줘도 된다.
      const spec = (item.spec && typeof item.spec === 'object') ? item.spec : item;
      if (!spec.slots && !spec.prefix && !spec.characters) return;   // 지시가 아닌 것은 건너뛴다
      const name = String(item.name || spec.name || ('작업 ' + (i + 1)));
      const id = String(item.id || spec.id || (hash(JSON.stringify(spec)) + '-' + i));
      jobs.push({ id: id, name: name, spec: spec });
    });

    if (!jobs.length) return { ok: false, jobs: [], error: '읽을 작업이 없습니다 (slots 가 있어야 합니다).' };
    return { ok: true, jobs: jobs };
  }

  /** 아직 안 한 것만. ★한 번 한 작업을 또 하면 돈이 두 번 나간다. */
  function pending(jobs, doneIds) {
    const done = doneIds || [];
    return (jobs || []).filter(function (j) { return done.indexOf(j.id) === -1; });
  }

  /** 기억은 무한정 쌓지 않는다 — 최근 것만 남긴다. */
  function rememberDone(doneIds, id, cap) {
    const max = cap || 300;
    const out = (doneIds || []).filter(function (x) { return x !== id; });
    out.push(id);
    return out.slice(-max);
  }

  return {
    parseRepo: parseRepo,
    rawUrl: rawUrl,
    apiUrl: apiUrl,
    webUrl: webUrl,
    parseQueue: parseQueue,
    pending: pending,
    rememberDone: rememberDone,
    hash: hash
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Github;
