// GitHub 지시함 — **사용자가 만든 저장소**를 AI 와 앱이 함께 쓰는 약속.
//
//   <저장소>/
//     AGENTS.md · CLAUDE.md      ← AI 가 읽는 규약 (앱이 넣어 주지 않는다. AI 에게 시키면 된다)
//     <작품 이름>/
//       characters/*.json        ← 인물 (그 작품 안에서 공용)
//       slots/*.json             ← 슬롯 묶음. **파일 하나가 작업 하나**
//
// ★슬롯 파일이 **새로 생기거나 내용이 바뀌면** 그 파일이 새 작업이 된다.
//   판단은 GitHub 이 주는 blob SHA 로 한다 — 내용이 같으면 SHA 도 같아서, 커밋을 다시 해도
//   같은 작업을 두 번 뽑지 않는다.
// ★인물 파일이 바뀌는 것은 트리거하지 않는다. 인물을 한 줄 고칠 때마다 그 작품의 슬롯이
//   전부 다시 도는 것은 돈이 나가는 사고다 — 다음에 그 작품을 돌릴 때 최신 인물을 쓴다.
// ★목록은 **트리 API 한 번**으로 가져온다 (recursive=1). 폴더마다 부르면 토큰 없는 한도
//   (시간당 60번)를 금방 친다. 파일 내용은 raw(CDN)로 받아 한도를 쓰지 않는다.
// ★앱은 저장소에 **쓰지 않는다.** 무엇을 이미 했는지는 폰이 기억한다.
'use strict';

const Github = (function () {
  const RAW = 'https://raw.githubusercontent.com';
  const API = 'https://api.github.com';

  // 인물 폴더로 인정하는 이름. 그 밖의 .json 은 슬롯(작업)으로 본다.
  const CHAR_DIRS = ['characters', 'character', '캐릭터', '인물'];
  // 슬롯 폴더 이름 — 없어도 되지만, 있으면 그 안의 것만 슬롯으로 본다.
  const SLOT_DIRS = ['slots', 'slot', '슬롯', '작업', 'jobs'];

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

  function branchOf(cfg) {
    return (cfg && cfg.branch ? String(cfg.branch).trim() : '') || 'main';
  }

  function encPath(path) {
    return String(path || '').split('/').map(encodeURIComponent).join('/');
  }

  /** 저장소 전체 목록을 한 번에 (recursive=1). ★폴더마다 부르지 않는다. */
  function treeUrl(cfg) {
    const r = parseRepo(cfg.repo);
    if (!r) return '';
    return API + '/repos/' + r.owner + '/' + r.repo + '/git/trees/'
      + encodeURIComponent(branchOf(cfg)) + '?recursive=1';
  }

  /** 파일 내용 — CDN 이라 API 한도를 안 쓴다. ★캐시를 피하려고 시각을 붙인다. */
  function rawUrl(cfg, path, bust) {
    const r = parseRepo(cfg.repo);
    if (!r) return '';
    return RAW + '/' + r.owner + '/' + r.repo + '/' + encodeURIComponent(branchOf(cfg)) + '/'
      + encPath(path) + (bust ? ('?t=' + bust) : '');
  }

  /** 비공개 저장소용 — 토큰과 함께 부르고 Accept 를 raw 로 주면 본문이 그대로 온다. */
  function apiFileUrl(cfg, path) {
    const r = parseRepo(cfg.repo);
    if (!r) return '';
    return API + '/repos/' + r.owner + '/' + r.repo + '/contents/' + encPath(path)
      + '?ref=' + encodeURIComponent(branchOf(cfg));
  }

  /** 사람이 눈으로 확인할 주소. */
  function webUrl(cfg, path) {
    const r = parseRepo(cfg.repo);
    if (!r) return '';
    const base = 'https://github.com/' + r.owner + '/' + r.repo;
    return path ? (base + '/blob/' + branchOf(cfg) + '/' + path) : base;
  }

  function baseName(path) {
    const file = String(path || '').split('/').pop() || '';
    return file.replace(/\.json$/i, '');
  }

  // ── 트리 읽기 ───────────────────────────────────────────────────────────
  /**
   * 트리 API 응답에서 쓸 파일만 골라 낸다.
   * @returns {Array<{path,sha}>}
   */
  function parseTree(body) {
    let data = body;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return []; }
    }
    const items = (data && Array.isArray(data.tree)) ? data.tree : [];
    return items.filter(function (t) {
      if (!t || t.type !== 'blob' || !t.path) return false;
      if (!/\.json$/i.test(t.path)) return false;
      // 숨은 폴더·파일(.github 등)은 건드리지 않는다.
      return t.path.split('/').every(function (p) { return p.charAt(0) !== '.'; });
    }).map(function (t) {
      return { path: t.path, sha: String(t.sha || '') };
    });
  }

  /**
   * 파일 목록을 **작품 → 인물·슬롯** 으로 나눈다.
   *
   * 규칙: 첫 조각이 작품 이름. 그 아래 characters/ 는 인물, 나머지 .json 은 슬롯(작업).
   *       루트에 그냥 놓인 .json 은 작품이 없는 것이므로 건너뛴다 (어디에 저장할지 알 수 없다).
   * @returns {{works: Object, jobs: Array}}
   */
  function plan(files, doneIds) {
    const works = Object.create(null);

    (files || []).forEach(function (f) {
      const parts = f.path.split('/');
      if (parts.length < 2) return;              // 루트 파일 — 규약 밖
      if (parts.length > 4) return;              // 너무 깊다
      const work = parts[0];
      const dir = parts.length >= 3 ? parts[1].toLowerCase() : '';
      const isChar = CHAR_DIRS.indexOf(dir) !== -1;
      const isSlotDir = SLOT_DIRS.indexOf(dir) !== -1;
      // 폴더가 세 겹인데 인물도 슬롯도 아니면 규약 밖이다.
      if (parts.length >= 3 && !isChar && !isSlotDir) return;

      if (!works[work]) works[work] = { name: work, chars: [], slots: [] };
      (isChar ? works[work].chars : works[work].slots).push(f);
    });

    const done = doneIds || [];
    const jobs = [];
    Object.keys(works).sort().forEach(function (work) {
      works[work].slots.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
      works[work].slots.forEach(function (s) {
        // ★id 에 SHA 를 넣는다 — 내용이 바뀌면 새 작업, 그대로면 이미 한 작업.
        const id = s.path + '@' + s.sha.slice(0, 8);
        jobs.push({
          id: id,
          name: work + ' · ' + baseName(s.path),
          work: work,
          slotPath: s.path,
          sha: s.sha,
          charPaths: works[work].chars.map(function (c) { return c.path; }),
          done: done.indexOf(id) !== -1
        });
      });
    });

    return { works: works, jobs: jobs };
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

  // ── 파일 읽기 ───────────────────────────────────────────────────────────
  /** JSON 파일 하나. ★코드블록 표시를 같이 커밋해 두는 실수가 잦아 벗겨서도 시도한다. */
  function parseJson(text) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, error: '파일이 비어 있습니다.' };
    try {
      return { ok: true, data: JSON.parse(raw) };
    } catch (e) {
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        return { ok: true, data: JSON.parse(stripped) };
      } catch (e2) {
        return { ok: false, error: 'JSON 형식이 아닙니다: ' + e2.message };
      }
    }
  }

  /**
   * 슬롯 파일 + 그 작품의 인물 파일들을 하나의 지시(spec)로 합친다.
   *
   * @param {object} slotData  슬롯 파일 내용 (배열이면 slots 로 본다)
   * @param {Array}  charDatas 인물 파일 내용들 (각각 객체 또는 배열)
   * @param {string} work      작품 폴더 이름 — 저장 폴더의 기본값
   */
  function mergeSpec(slotData, charDatas, work) {
    const spec = {};
    const s = Array.isArray(slotData) ? { slots: slotData } : (slotData || {});

    spec.name = s.name || work;
    spec.folder = s.folder || s.persona || work;
    if (s.prefix) spec.prefix = s.prefix;
    spec.slots = s.slots || [];
    if (s.options) spec.options = s.options;

    const chars = [];
    (charDatas || []).forEach(function (d) {
      if (!d) return;
      const list = Array.isArray(d) ? d : (Array.isArray(d.characters) ? d.characters : [d]);
      list.forEach(function (c) {
        if (c && typeof c === 'object' && (c.content || c.prompt || c.name)) chars.push(c);
      });
    });
    // 슬롯 파일이 직접 적어 둔 인물이 있으면 뒤에 붙인다 (그 작업에만 쓰는 인물).
    if (Array.isArray(s.characters)) s.characters.forEach(function (c) { chars.push(c); });
    if (chars.length) spec.characters = chars;

    return spec;
  }

  return {
    CHAR_DIRS: CHAR_DIRS,
    SLOT_DIRS: SLOT_DIRS,
    parseRepo: parseRepo,
    treeUrl: treeUrl,
    rawUrl: rawUrl,
    apiFileUrl: apiFileUrl,
    webUrl: webUrl,
    parseTree: parseTree,
    plan: plan,
    pending: pending,
    rememberDone: rememberDone,
    parseJson: parseJson,
    mergeSpec: mergeSpec,
    baseName: baseName
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Github;
