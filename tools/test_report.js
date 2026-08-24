// 버그 보고 — 무엇이 나가고 무엇이 안 나가는지.
//
// ★여기서 제일 중요한 것은 **키가 안 나가는 것**이다. 이 글은 공개 저장소의 이슈로
//   갈 수 있다. 한 번 올라가면 지워도 이미 늦다.
const R = require('../www/js/report.js');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; return; }
  fail++;
  console.log('  x ' + name + (extra === undefined ? '' : '  [' + extra + ']'));
}

// ── 1. 지우기 ─────────────────────────────────────────────────────────────
const KEY = 'pst-' + 'AbCd1234'.repeat(8);
const GH = 'ghp_' + 'x'.repeat(36);
const PAT = 'github_pat_' + 'A1b2'.repeat(12);

check('★NovelAI 키가 안 나간다', R.redact('키는 ' + KEY + ' 입니다').indexOf(KEY) === -1);
check('지웠다고 자리에 남긴다', /pst-…\(지움\)/.test(R.redact(KEY)));
check('★GitHub 토큰이 안 나간다', R.redact(GH).indexOf(GH) === -1);
check('★fine-grained 토큰도 안 나간다', R.redact(PAT).indexOf(PAT) === -1);
check('★오류 메시지에 섞여 있어도 지운다',
  R.redact('401 Unauthorized: Bearer ' + KEY + ' rejected').indexOf(KEY) === -1);
check('★헤더 모양도 지운다', R.redact('Authorization: Bearer hunter2hunter2').indexOf('hunter2') === -1);
check('★비밀번호가 안 나간다', R.redact('password=s3cr3t-vps-pw').indexOf('s3cr3t') === -1);
check('★이미 지운 자리를 또 안 먹는다',
  R.redact('Bearer ' + KEY) === 'Bearer pst-…(지움)', R.redact('Bearer ' + KEY));
check('키를 지웠다고 자리에 남는다 (헤더 안에서도)',
  /pst-…\(지움\)/.test(R.redact('401: Bearer ' + KEY + ' 거부')),
  R.redact('401: Bearer ' + KEY + ' 거부'));
check('★수신함 주소가 안 나간다',
  R.redact('http://203.0.113.9:8080/jobs 에 못 붙었습니다').indexOf('203.0.113.9') === -1);
check('★맨 IP 도 지운다', R.redact('192.168.0.42 로 붙는 중').indexOf('192.168.0.42') === -1);
check('못 알아본 긴 글자도 지운다', R.redact('x'.repeat(60)).indexOf('x'.repeat(60)) === -1);
check('짧은 보통 말은 안 건드린다', R.redact('그림체 테스트에서 실패') === '그림체 테스트에서 실패');
check('빈 것도 견딘다', R.redact(null) === '' && R.redact(undefined) === '');

// ── 2. 모으기 ─────────────────────────────────────────────────────────────
R.clear();
check('처음에는 비어 있다', R.all().length === 0);
R.note('오류', 'NAI 가 401 로 답했습니다', 1000);
R.note('한 일', '그림체 테스트 시작', 2000);
check('적은 만큼 쌓인다', R.all().length === 2);
check('종류와 시각이 남는다', R.all()[0].kind === '오류' && R.all()[0].at === 1000);

R.note('오류', '키: ' + KEY, 3000);
check('★적을 때 이미 지운다 — 안 지운 것을 들고 있지 않는다',
  JSON.stringify(R.all()).indexOf(KEY) === -1);

R.clear();
for (let i = 0; i < R.MAX + 30; i++) R.note('오류', 'e' + i, i);
check('★오래된 것부터 버려 무한정 안 쌓인다', R.all().length === R.MAX, R.all().length);
check('남는 것은 최근 것이다', R.all()[R.all().length - 1].text === 'e' + (R.MAX + 29));

R.clear();
R.note('오류', 'y'.repeat(2000), 1);
check('한 줄이 너무 길면 자른다', R.all()[0].text.length <= 500);

// ── 3. 오류를 한 줄로 ─────────────────────────────────────────────────────
check('Error 를 읽는다', R.line(new Error('터졌다')).indexOf('터졌다') !== -1);
check('어느 파일 몇 줄인지 붙인다',
  R.line({ message: '터졌다', filename: 'http://x/js/app.js', lineno: 42 }) === '터졌다 @app.js:42');
check('글자만 줘도 된다', R.line('그냥 글자') === '그냥 글자');
check('없으면 빈 글자', R.line(null) === '');

// ── 4. 창에서 줍기 ────────────────────────────────────────────────────────
function fakeWin() {
  const h = {};
  return {
    addEventListener: function (k, f) { (h[k] = h[k] || []).push(f); },
    removeEventListener: function (k, f) { h[k] = (h[k] || []).filter(function (x) { return x !== f; }); },
    fire: function (k, e) { (h[k] || []).forEach(function (f) { f(e); }); },
    count: function (k) { return (h[k] || []).length; }
  };
}
R.clear();
const w = fakeWin();
const seen = [];
const off = R.capture(w, function (kind, text) { seen.push(kind + ':' + text); }, function () { return 7; });
w.fire('error', { message: '펑', filename: '/js/app.js', lineno: 3 });
check('★창에서 난 오류를 줍는다', R.all().length === 1 && /펑/.test(R.all()[0].text));
check('시각도 같이 적는다', R.all()[0].at === 7);
check('디버깅 모드에 바로 알린다', seen.length === 1 && /펑/.test(seen[0]));

w.fire('unhandledrejection', { reason: new Error('안 잡힌 약속') });
check('★안 잡힌 약속도 줍는다', R.all().length === 2 && /안 잡힌 약속/.test(R.all()[1].text));

w.fire('error', { message: '키 ' + KEY });
check('★주울 때도 키를 지운다', JSON.stringify(R.all()).indexOf(KEY) === -1);

const boom = R.capture(fakeWin(), function () { throw new Error('보고가 터짐'); }, function () { return 0; });
check('보고가 터져도 앱을 안 막는다', (function () {
  try { boom(); return true; } catch (e) { return false; }
})());

off();
check('그만둘 수 있다', w.count('error') === 0 && w.count('unhandledrejection') === 0);
check('창이 없어도 안 터진다', typeof R.capture(null) === 'function');

// ── 5. 글 짓기 ────────────────────────────────────────────────────────────
R.clear();
R.note('오류', 'NAI 가 401 로 답했습니다', 0);
const doc = R.build({
  version: 'v1.2.27',
  platform: 'Android',
  screen: '그림체 테스트',
  what: '조합을 뽑다가 멈췄습니다',
  facts: [['일관성 검사', '이 폰에서'], ['수신함', '있음']]
});
check('★판 번호가 들어간다', /v1\.2\.27/.test(doc));
check('★화면이 들어간다', /그림체 테스트/.test(doc));
check('★사람이 적은 말이 들어간다', /조합을 뽑다가 멈췄습니다/.test(doc));
check('적어 둔 오류가 들어간다', /401/.test(doc));
check('설정 요약이 들어간다', /일관성 검사: 이 폰에서/.test(doc));
check('무엇을 적어야 하는지 알려 준다',
  /여기에 무엇을 하다가 그랬는지/.test(R.build({ version: 'v1' })));

const dirty = R.build({
  version: 'v1', what: '키 ' + KEY + ' 로 http://10.0.0.5:8080 에 붙다가',
  facts: [['수신함', 'http://10.0.0.5:8080']]
});
check('★사람이 적은 말에서도 키를 지운다', dirty.indexOf(KEY) === -1);
check('★설정 요약에서도 주소를 지운다', dirty.indexOf('10.0.0.5') === -1);

R.clear();
check('적힌 것이 없으면 없다고 쓴다', /적힌 오류가 없습니다/.test(R.build({ version: 'v1' })));

// ── 6. 이슈 주소 ──────────────────────────────────────────────────────────
const u = R.issueUrl('lulus-cat/peropix-mobile', '뽑기가 멈춥니다', '## 무슨 일\n\n키 ' + KEY);
check('저장소로 간다', u.indexOf('https://github.com/lulus-cat/peropix-mobile/issues/new') === 0);
check('제목이 실린다', u.indexOf(encodeURIComponent('뽑기가 멈춥니다')) !== -1);
check('★주소에도 키가 안 실린다',
  decodeURIComponent(u).indexOf(KEY) === -1 && u.indexOf(KEY) === -1);
check('★비공개 저장소로 새지 않는다 — 준 곳으로만 간다',
  R.issueUrl('lulus-cat/peropix-Lkit-mobile', 't', 'b').indexOf('/peropix-Lkit-mobile/') !== -1);
check('저장소를 안 주면 공개 저장소로', R.issueUrl('', 't', 'b').indexOf('/peropix-mobile/') !== -1);
const long = R.issueUrl('a/b', 't', '가'.repeat(20000));
check('★너무 길면 잘라서 주소가 열리게 한다', long.length < 60000, long.length);
check('잘랐다고 말해 준다', decodeURIComponent(long).indexOf('뒷부분은 잘렸습니다') !== -1);

console.log('버그 보고 검사 ' + (pass + fail) + '건 — 통과 ' + pass + '건, 실패 ' + fail + '건');
process.exit(fail ? 1 : 0);
