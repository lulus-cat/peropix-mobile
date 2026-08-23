// 업데이트 알림 검사 — 버전 견주기, 응답 읽기, 언제 물어볼지.
//
// ★여기가 틀리면 두 가지로 망가진다. 새 버전이 나왔는데 조용하거나 (1.2.10 을 1.2.9 보다
//   작다고 보는 것), 같은 버전을 놓고 매번 새 버전이라고 우기거나.
// 사용: node tools/test_updater.js
'use strict';

const U = require('../www/js/updater.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 주소 ───────────────────────────────────────────────────────────────
check('owner/repo 로 만든다',
  U.latestUrl('lulus-cat/peropix-mobile')
  === 'https://api.github.com/repos/lulus-cat/peropix-mobile/releases/latest',
  U.latestUrl('lulus-cat/peropix-mobile'));
check('주소를 통째로 붙여넣어도 된다',
  U.latestUrl('https://github.com/lulus-cat/peropix-mobile') === U.latestUrl('lulus-cat/peropix-mobile'));
check('.git 이 붙어 있어도 된다',
  U.latestUrl('lulus-cat/peropix-mobile.git') === U.latestUrl('lulus-cat/peropix-mobile'));
check('엉뚱한 것은 빈 주소', U.latestUrl('그냥글자') === '' && U.latestUrl('') === '');
check('★경로가 더 붙은 것은 거절 (엉뚱한 곳을 부르면 안 된다)',
  U.latestUrl('a/b/c') === '', U.latestUrl('a/b/c'));

// ── 2. 버전 견주기 ─────────────────────────────────────────────────────
check('★1.2.10 이 1.2.9 보다 크다 (글자로 견주면 거꾸로 나온다)',
  U.compare('1.2.10', '1.2.9') === 1);
check('같으면 0', U.compare('1.2.5', '1.2.5') === 0);
check('작으면 -1', U.compare('1.2.4', '1.2.5') === -1);
check('v 가 붙어 있어도 같다', U.compare('v1.2.5', '1.2.5') === 0);
check('자리 수가 달라도 본다', U.compare('1.3', '1.2.9') === 1 && U.compare('1.2', '1.2.0') === 0);
check('큰 자리가 먼저', U.compare('2.0.0', '1.99.99') === 1);
check('빈 값은 0 으로 본다', U.compare('', '') === 0 && U.compare('1.0.0', '') === 1);

// ── 3. 응답 읽기 ──────────────────────────────────────────────────────────
const REL = {
  tag_name: 'v1.2.6',
  name: 'PeroPix 1.2.6',
  html_url: 'https://github.com/lulus-cat/peropix-mobile/releases/tag/v1.2.6',
  published_at: '2026-08-23T01:00:00Z',
  body: '## 바뀐 것\n- 서랍에 작가 태그 가져오기\n- receiver.py 꺼내기\n\n<details>\n숨긴 것\n</details>\nhttps://example.com',
  assets: [
    { name: 'source.zip', browser_download_url: 'https://x/source.zip', size: 10 },
    { name: 'peropix-1.2.6.apk', browser_download_url: 'https://x/app.apk', size: 8123456 }
  ]
};

let r = U.parseLatest(REL);
check('버전를 꺼낸다', r.version === '1.2.6' && r.tag === 'v1.2.6');
check('★APK 를 찾아낸다 (소스 zip 이 먼저 와도)', r.apkUrl === 'https://x/app.apk', r.apkUrl);
check('크기도 가져온다', r.apkSize === 8123456);
check('릴리스 쪽 주소도 가져온다', /releases\/tag\/v1\.2\.6$/.test(r.pageUrl));
check('글로 준 것도 읽는다', U.parseLatest(JSON.stringify(REL)).version === '1.2.6');
check('★APK 가 없으면 릴리스 쪽이라도 남긴다 (받기가 아무 데도 안 가면 고장으로 보인다)',
  U.parseLatest(Object.assign({}, REL, { assets: [] })).pageUrl.length > 0
  && U.parseLatest(Object.assign({}, REL, { assets: [] })).apkUrl === '');
check('망가진 응답은 null', U.parseLatest('{{{') === null && U.parseLatest(null) === null
  && U.parseLatest({}) === null);

// ── 4. 언제 물어볼지 ──────────────────────────────────────────────────────
const HOUR = 3600 * 1000;
check('처음에는 본다', U.due(0, 1000 * HOUR) === true);
check('여섯 시간이 안 됐으면 안 본다', U.due(100 * HOUR, 103 * HOUR) === false);
check('여섯 시간이 지나면 본다', U.due(100 * HOUR, 107 * HOUR) === true);
check('간격을 정할 수 있다', U.due(100 * HOUR, 102 * HOUR, 1) === true);
check('★폰 시계를 뒤로 돌려도 막히지 않는다 (미래 시각이 저장돼 있으면 영영 안 본다)',
  U.due(200 * HOUR, 100 * HOUR) === true);

// ── 5. 알릴지 말지 ────────────────────────────────────────────────────────
check('새 버전이면 알린다',
  U.decide({ current: '1.2.5', latest: r }).show === true);
check('같은 버전이면 조용히',
  U.decide({ current: '1.2.6', latest: r }).show === false);
check('앞선 버전을 쓰고 있어도 조용히 (직접 빌드해 깐 경우)',
  U.decide({ current: '1.3.0', latest: r }).show === false);
check('★건너뛰기로 정한 버전은 다시 안 띄운다',
  U.decide({ current: '1.2.5', latest: r, skipped: '1.2.6' }).show === false);
check('건너뛴 버전보다 더 새 버전이 나오면 다시 알린다',
  U.decide({ current: '1.2.5', latest: { version: '1.2.7' }, skipped: '1.2.6' }).show === true);
check('★현재 버전을 모르면 안 알린다 (늘 새 버전이 되어 알림이 무의미해진다)',
  U.decide({ current: '', latest: r }).show === false
  && U.decide({ current: '', latest: r }).reason === 'unknown');
check('받아 온 것이 없으면 안 알린다',
  U.decide({ current: '1.2.5', latest: null }).show === false);
check('왜 안 띄웠는지 남긴다',
  U.decide({ current: '1.2.6', latest: r }).reason === 'current'
  && U.decide({ current: '1.2.5', latest: r, skipped: '1.2.6' }).reason === 'skipped');

// ── 6. 사람이 읽을 것 ─────────────────────────────────────────────────────
check('한 줄 요약', U.summary('1.2.5', r) === '1.2.5 → 1.2.6', U.summary('1.2.5', r));
check('현재 버전을 모르면 이름만', U.summary('', r) === 'PeroPix 1.2.6');
const hi = U.highlights(REL.body);
check('바뀐 것을 줄로 뽑는다', hi[0] === '서랍에 작가 태그 가져오기', JSON.stringify(hi));
check('★제목 줄(#)은 뺀다', hi.every(function (l) { return l.indexOf('#') !== 0; }), JSON.stringify(hi));
check('★접어 둔 것은 뺀다 (릴리스 본문에 커밋 전문이 통째로 들어 있다)',
  hi.every(function (l) { return l !== '숨긴 것'; }), JSON.stringify(hi));
check('주소 줄도 뺀다', hi.every(function (l) { return l.indexOf('http') !== 0; }), JSON.stringify(hi));
check('몇 줄까지만', U.highlights('- a\n- b\n- c\n- d', 2).length === 2);
check('빈 본문이어도 안 터진다', U.highlights('').length === 0 && U.highlights(null).length === 0);

const total = pass + fails.length;
console.log('업데이트 알림 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
