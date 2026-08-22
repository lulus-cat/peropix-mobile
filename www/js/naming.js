// 저장 경로·파일 이름 규칙.
//
// PeroFix 정리 관례(폴더 이름 + 라벨 파일명)를 그대로 따른다.
//   기본:  {folder}/{label}.png   →  "미아/happy.png"
// ★같은 라벨이 여러 장 나오면 뒤에 _2, _3 이 붙는다 (덮어쓰지 않는다).
// ★H 장면은 접두를 붙여 한 폴더 안에서 앞뒤로 갈린다.
'use strict';

const Naming = (function () {
  // 파일 이름에 쓸 수 없는 글자. 윈도우 기준이 가장 엄격하므로 거기에 맞춘다.
  // ★하이픈은 바꾸지 않는다 — PeroFix 슬롯 이름이 "1-3" 같은 좌표라
  //   밑줄로 바꾸면 매트릭스 좌표가 어긋난다.
  const BAD_CHARS = /[\/:*?"<>|\s]/g;
  // 윈도우 예약 이름 — 폴더·파일 이름으로 쓰면 저장이 실패한다.
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  // ★{persona} 는 예전 이름이다. 화면에서는 {folder} 로 부르지만, 이미 저장해 둔
  //   규칙이 깨지면 안 되므로 둘 다 같은 값으로 읽는다.
  const TOKENS = ['folder', 'persona', 'label', 'seq', 'seed', 'date', 'time', 'model'];

  /** 경로 한 조각을 안전하게 만든다. 빈 값이면 대체어를 쓴다. */
  function sanitize(part, fallback) {
    let s = String(part === undefined || part === null ? '' : part);
    s = s.replace(BAD_CHARS, '_').trim();
    // ★끝의 점·공백은 윈도우에서 조용히 잘린다 — 미리 없앤다.
    s = s.replace(/[. ]+$/, '');
    if (RESERVED.test(s)) s = s + '_';
    if (!s) s = fallback || 'untitled';
    return s.slice(0, 60);
  }

  function pad(n, w) {
    let s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  function stamps(d) {
    d = d || new Date();
    return {
      date: '' + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2),
      time: pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2)
    };
  }

  /**
   * 규칙 문자열의 토큰을 채운다. 경로 구분자(/)는 폴더 경계로 그대로 남긴다.
   * @param {string} template 예: "{persona}/{label}.png"
   * @param {object} vars {persona,label,seq,seed,model,date,time}
   * @returns {string} 슬래시로 구분된 상대 경로
   */
  function render(template, vars) {
    const st = stamps(vars.now);
    const v = {
      folder: vars.persona,
      persona: vars.persona,
      label: vars.label,
      seq: vars.seq === undefined ? '' : pad(vars.seq, 3),
      seed: vars.seed === undefined ? '' : String(vars.seed),
      model: vars.model,
      date: st.date,
      time: st.time
    };

    // ★토큰을 먼저 치환한 뒤에 조각을 나눠 씻는다. 순서를 뒤집으면 토큰 안의
    //   슬래시(사용자가 라벨에 넣은 것)가 폴더로 잘못 승격된다.
    let out = String(template || '').replace(/\{(\w+)\}/g, function (m, name) {
      if (TOKENS.indexOf(name) === -1) return m;   // 모르는 토큰은 글자 그대로 둔다
      const raw = v[name];
      return (raw === undefined || raw === null) ? '' : String(raw).replace(BAD_CHARS, '_');
    });

    if (vars.hscenePrefix && vars.isHscene) {
      // 마지막 조각(파일명) 앞에만 붙인다.
      const i = out.lastIndexOf('/');
      out = i === -1 ? (vars.hscenePrefix + out)
        : (out.slice(0, i + 1) + vars.hscenePrefix + out.slice(i + 1));
    }

    const parts = out.split('/').filter(function (p) { return p !== '' && p !== '.' && p !== '..'; });
    if (!parts.length) return sanitize('', 'image') + '.png';

    const last = parts.pop();
    const dirs = parts.map(function (p) { return sanitize(p, 'folder'); });

    // 확장자는 씻는 대상에서 분리한다 (점이 사라지면 안 된다).
    const dot = last.lastIndexOf('.');
    const stem = dot > 0 ? last.slice(0, dot) : last;
    const ext = dot > 0 ? last.slice(dot) : '.png';
    const file = sanitize(stem, 'image') + ext.replace(BAD_CHARS, '');

    return dirs.concat([file]).join('/');
  }

  /**
   * 이미 쓴 경로와 겹치면 _2, _3 을 붙여 비켜 준다.
   * @param {string} path render() 결과
   * @param {Set<string>} used 이번 실행에서 이미 쓴 경로들
   */
  function dedupe(path, used) {
    if (!used.has(path)) { used.add(path); return path; }
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash + 1);
    const file = slash === -1 ? path : path.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    let n = 2;
    let candidate;
    do {
      candidate = dir + stem + '_' + n + ext;
      n++;
    } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  }

  const PRESETS = [
    { id: 'matrix', name: '폴더별로 나누기 (PeroFix 관례)', template: '{folder}/{label}.png' },
    { id: 'flat', name: '한 폴더에 모두', template: '{folder}_{label}_{seq}.png' },
    { id: 'dated', name: '날짜별 폴더', template: '{date}/{folder}_{label}.png' },
    { id: 'seeded', name: '시드 포함 (겹침 없음)', template: '{folder}/{label}_{seed}.png' }
  ];

  return {
    render: render,
    dedupe: dedupe,
    sanitize: sanitize,
    TOKENS: TOKENS,
    PRESETS: PRESETS
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Naming;
