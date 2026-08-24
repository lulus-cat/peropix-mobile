/**
 * 버그 보고 — 무슨 일이 있었는지 모아서 사람이 붙여넣을 수 있는 글로 만든다.
 *
 * ★"안 돼요" 한 줄로는 아무것도 고칠 수 없다. 어느 판인지, 무엇을 하다가, 무슨 오류가
 *   났는지가 있어야 한다. 그 셋을 사람이 손으로 적게 하면 아무도 안 적는다.
 *
 * ★**나가는 글에는 키가 없어야 한다.** 이 보고서는 공개 저장소의 이슈로 갈 수 있다.
 *   NovelAI 키·GitHub 토큰·SSH 비밀번호·수신함 주소는 지우고 내보낸다. 오류 메시지
 *   안에 섞여 들어오는 것까지 지워야 하므로, 값의 생김새로 찾아 지운다.
 */
const Report = (function () {
  const MAX = 80;          // 남겨 두는 줄 수 (오래된 것부터 버린다)
  const CUT = 6000;        // 이슈 주소에 실어 보낼 수 있는 길이

  let lines = [];

  // ── 지우기 ────────────────────────────────────────────────────────────────
  // 순서가 중요하다. 넓은 것(Bearer 뒤 아무 글자)을 먼저 지우면 좁은 것이 못 걸린다.
  const MASKS = [
    // NovelAI 키 — pst- 로 시작하는 긴 글자
    [/\bpst-[A-Za-z0-9_-]{8,}/g, 'pst-…(지움)'],
    // GitHub 토큰 — 종류별로 접두사가 다르다
    [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, 'gh?_…(지움)'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_…(지움)'],
    // 헤더에 실려 나가는 것
    // ★`Authorization: Bearer xxx` 는 이름·방식·값 셋이다. 방식을 값으로 보면
    //   `Bearer` 만 지우고 진짜 값이 그대로 남는다.
    // ★`…` 가 든 토막은 건너뛴다. 이미 지운 자리를 또 먹으면 `pst-…(지움)` 이라는
    //   표시까지 사라져 `…(지움))` 처럼 괄호만 남는다 — 무엇을 지웠는지 못 읽는다.
    [/\b(Authorization|Bearer|token|api[_-]?key|apikey|password|passwd|pw)\b\s*[:=]?\s*(?:(?:Bearer|Token|Basic)\s+)?["']?(?![^\s"',;)}\]]*…)[^\s"',;)}\]]{6,}/gi,
      '$1 …(지움)'],
    // 수신함 주소 — 사람이 쓰는 VPS 다. 남의 눈에 띄면 곤란하다.
    [/\bhttps?:\/\/[^\s"'<>)]+/g, '(주소 지움)'],
    [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?/g, '(주소 지움)'],
    // 위에 안 걸린 긴 무작위 글자 — 못 알아본 키일 수 있다
    [/\b[A-Za-z0-9_-]{40,}\b/g, '…(긴 글자 지움)']
  ];

  /** 키·토큰·주소를 지운다. 무엇을 지웠는지는 자리에 남겨, 읽는 사람이 알 수 있게 한다. */
  function redact(text) {
    let out = String(text === null || text === undefined ? '' : text);
    MASKS.forEach(function (m) { out = out.replace(m[0], m[1]); });
    return out;
  }

  // ── 모으기 ────────────────────────────────────────────────────────────────
  /**
   * 한 줄 적는다. ★적을 때 이미 지운다. 지우지 않은 것을 들고 있으면 언젠가 샌다.
   * @param {string} kind '오류' | '경고' | '한 일'
   */
  function note(kind, text, at) {
    lines.push({
      at: Number(at) || 0,
      kind: String(kind || '메모'),
      text: redact(text).slice(0, 500)
    });
    if (lines.length > MAX) lines = lines.slice(lines.length - MAX);
    return lines.length;
  }

  function all() { return lines.slice(); }
  function clear() { lines = []; }

  /** 오류 하나를 사람이 읽을 한 줄로. */
  function line(e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    const msg = e.message || e.reason || String(e);
    const where = e.filename ? (' @' + String(e.filename).split('/').pop()
      + ':' + (e.lineno || 0)) : '';
    return String(msg) + where;
  }

  /**
   * 창에서 나는 오류를 자동으로 줍는다.
   * @param {object} win window
   * @param {function} [onNote] 주울 때마다 부른다 (디버깅 모드에서 화면에 띄우려고)
   */
  function capture(win, onNote, now) {
    if (!win) return function () {};
    const clock = now || function () { return 0; };
    const take = function (kind, text) {
      note(kind, text, clock());
      if (onNote) { try { onNote(kind, redact(text)); } catch (e) { /* 보고가 앱을 막지 않는다 */ } }
    };
    const onErr = function (e) { take('오류', line(e)); };
    const onRej = function (e) { take('오류', line(e && e.reason ? e.reason : e)); };
    win.addEventListener('error', onErr);
    win.addEventListener('unhandledrejection', onRej);
    return function () {
      win.removeEventListener('error', onErr);
      win.removeEventListener('unhandledrejection', onRej);
    };
  }

  // ── 내보내기 ──────────────────────────────────────────────────────────────
  function clock(ms) {
    if (!ms) return '--:--:--';
    const d = new Date(ms);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /**
   * 붙여넣을 글을 짓는다.
   * @param {object} o {version, platform, screen, facts: [[이름, 값]], what}
   */
  function build(o) {
    const it = o || {};
    const out = [];
    out.push('## 무슨 일이 있었나');
    out.push('');
    out.push(redact(it.what || '') || '(여기에 무엇을 하다가 그랬는지 적어 주세요)');
    out.push('');
    out.push('## 어디서');
    out.push('');
    out.push('- 판: ' + (it.version || '알 수 없음'));
    out.push('- 기기: ' + (it.platform || '알 수 없음'));
    out.push('- 화면: ' + (it.screen || '알 수 없음'));
    (it.facts || []).forEach(function (f) {
      if (f && f.length >= 2) out.push('- ' + f[0] + ': ' + redact(f[1]));
    });
    out.push('');
    out.push('## 앱이 적어 둔 것');
    out.push('');
    if (!lines.length) {
      out.push('(적힌 오류가 없습니다)');
    } else {
      out.push('```');
      lines.forEach(function (l) { out.push(clock(l.at) + '  ' + l.kind + '  ' + l.text); });
      out.push('```');
    }
    out.push('');
    out.push('<sub>키·토큰·주소는 앱이 지우고 올립니다.</sub>');
    // ★마지막으로 한 번 더 훑는다. 위에서 하나라도 빠뜨렸으면 여기서 걸린다.
    return redact(out.join('\n'));
  }

  /** GitHub 이슈 새로 쓰기 주소. 길면 자른다 — 너무 길면 주소가 통째로 안 열린다. */
  function issueUrl(repo, title, body) {
    const r = String(repo || '').trim() || 'lulus-cat/peropix-mobile';
    const b = String(body || '');
    const cut = b.length > CUT ? (b.slice(0, CUT) + '\n\n…(뒷부분은 잘렸습니다)') : b;
    return 'https://github.com/' + r + '/issues/new?title='
      + encodeURIComponent(String(title || '버그 보고').slice(0, 120))
      + '&body=' + encodeURIComponent(redact(cut));
  }

  return {
    MAX: MAX,
    redact: redact,
    note: note,
    all: all,
    clear: clear,
    line: line,
    capture: capture,
    build: build,
    issueUrl: issueUrl
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Report;
