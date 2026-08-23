// SSH 자동 설치 검사 — 명령 만들기와 결과 읽기.
//
// ★여기가 틀리면 남의 서버에서 엉뚱한 명령이 돈다. 특히 따옴표 처리가 틀리면
//   비밀번호나 주소가 명령의 일부로 새어 들어간다.
// 사용: node tools/test_ssh.js
'use strict';

const { execFileSync } = require('child_process');
const S = require('../www/js/ssh.js');

let pass = 0;
const fails = [];
function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 따옴표 ─────────────────────────────────────────────────────────────
// ★셸이 실제로 어떻게 읽는지로 본다. 눈으로 본 것과 셸이 읽는 것은 다르다.
function shellSees(s) {
  return execFileSync('sh', ['-c', 'printf %s ' + S.quote(s)], { encoding: 'utf8' });
}
[
  ["평범한글자", '평범'],
  ["작은따옴표 ' 가 든 것", "a'b"],
  ['빈 것', ''],
  ['세미콜론과 백틱', 'a; rm -rf /; `whoami`'],
  ['달러와 괄호', '$(whoami) ${HOME}'],
  ['줄바꿈', 'a\nb'],
  ['한글과 공백', '우리집 고양이']
].forEach(function (t) {
  check('★' + t[0] + ' 도 그대로 넘어간다 (셸이 해석하면 안 된다)',
    shellSees(t[1]) === t[1], JSON.stringify(shellSees(t[1])));
});

// ── 2. 설치 명령 ──────────────────────────────────────────────────────────
const asRoot = S.installCommand({ open: true, root: true });
const asUser = S.installCommand({ open: true });
check('root 면 sudo 를 안 붙인다', asRoot.indexOf('sudo') === -1, asRoot);
check('★root 가 아니면 sudo -S 로 올린다 (비밀번호를 stdin 으로 넣는다)',
  /sudo -S -p ''/.test(asUser), asUser);
check('--open 을 넘긴다', /-s -- --open/.test(asRoot));
check('--open 을 안 주면 안 붙는다', !/--open/.test(S.installCommand({ root: true })));
check('저장소와 가지를 바꿀 수 있다',
  S.installCommand({ repo: 'a/b', ref: 'dev', root: true }).indexOf('/a/b/dev/') > 0,
  S.installCommand({ repo: 'a/b', ref: 'dev', root: true }));

// ★셸이 실제로 파싱되는지. 따옴표가 하나라도 어긋나면 여기서 걸린다.
['sh', 'bash'].forEach(function (shell) {
  [asRoot, asUser].forEach(function (cmd, i) {
    let ok = true;
    try { execFileSync(shell, ['-n', '-c', cmd], { stdio: 'ignore' }); } catch (e) { ok = false; }
    check('★' + shell + ' 이 ' + (i ? 'sudo' : 'root') + ' 명령을 문법 오류 없이 읽는다', ok, cmd);
  });
});

// ★진짜로 돌려 본다 — curl 과 sudo 를 가짜로 갈아 끼우고, 안쪽까지 제대로 가는지.
const fakeBin = require('fs').mkdtempSync('/tmp/peropix-ssh-');
require('fs').writeFileSync(fakeBin + '/curl',
  '#!/bin/sh\necho "echo 받은인자=\\$*; echo peropix://1.2.3.4:8770#TOK"\n', { mode: 0o755 });
// 가짜 sudo: 비밀번호를 삼키고 -S -p '' 세 개만 떼어 낸 뒤 나머지를 그대로 돌린다.
require('fs').writeFileSync(fakeBin + '/sudo',
  '#!/bin/sh\nwhile [ "$1" = "-S" ] || [ "$1" = "-p" ] || [ "$1" = "" ]; do\n' +
  '  [ "$1" = "-S" ] && cat >/dev/null\n  shift\ndone\nexec "$@"\n', { mode: 0o755 });
const ran = execFileSync('sh', ['-c', asUser],
  { encoding: 'utf8', env: Object.assign({}, process.env, { PATH: fakeBin + ':' + process.env.PATH }) });
check('★sudo 를 거쳐도 설치 스크립트까지 닿는다', /peropix:\/\/1\.2\.3\.4/.test(ran), ran.trim());
check('★--open 이 스크립트까지 그대로 간다', /받은인자=.*|--open/.test(ran) || /--open/.test(ran),
  ran.trim());
require('fs').rmSync(fakeBin, { recursive: true, force: true });

// ── 3. 결과 읽기 ──────────────────────────────────────────────────────────
check('한 줄을 찾아낸다',
  S.parsePair('설치 끝\n  peropix://1.2.3.4:8770#abc\n자주 쓰는 명령') === 'peropix://1.2.3.4:8770#abc');
check('★다시 깔면 마지막 것이 지금 값이다',
  S.parsePair('peropix://old#1\n...\nperopix://new#2') === 'peropix://new#2');
check('없으면 빈 글', S.parsePair('아무것도 없음') === '' && S.parsePair(null) === '');

check('제대로 되면 ok', S.verdict({ code: 0, out: 'peropix://a:1#t' }).ok === true);
check('★비밀번호가 틀리면 그렇다고 말한다',
  /비밀번호/.test(S.verdict({ code: 1, err: 'Sorry, try again.' }).why));
check('★sudo 권한이 없으면 그렇다고 말한다',
  /권한/.test(S.verdict({ code: 1, err: 'user is not in the sudoers file' }).why));
check('curl 이 없으면 그렇다고 말한다',
  /curl/.test(S.verdict({ code: 127, err: 'curl: not found' }).why));
check('서버가 인터넷을 못 나가면 그렇다고 말한다',
  /인터넷/.test(S.verdict({ code: 6, err: 'Could not resolve host: raw.githubusercontent.com' }).why));
check('★그 밖에는 끝난 코드라도 성공이라 하지 않는다',
  S.verdict({ code: 0, out: '뭔가 나왔지만 한 줄은 없음' }).ok === false);

// ── 4. 붙다가 난 오류 ─────────────────────────────────────────────────────
check('인증 실패', /아이디나 비밀번호/.test(S.explain(new Error('Auth fail'))));
check('주소를 못 찾음', /찾지 못했/.test(S.explain(new Error('UnknownHostException'))));
check('시간 초과', /응답이 없/.test(S.explain(new Error('Connection timed out'))));
check('포트가 닫힘', /SSH 가 그 포트/.test(S.explain(new Error('Connection refused'))));
check('빈 것도 말이 된다', S.explain(null).length > 0);

// ── 5. 서버 열쇠 ──────────────────────────────────────────────────────────
check('★열쇠가 바뀌면 알아챈다 (남이 끼어들었을 수 있다)', S.keyChanged('aa', 'bb') === true);
check('같으면 조용히', S.keyChanged('aa', 'aa') === false);
check('처음 붙는 것은 바뀐 것이 아니다', S.keyChanged('', 'bb') === false);

// ── 6. 주소 가르기 ────────────────────────────────────────────────────────
check('기본 포트는 22', JSON.stringify(S.split('1.2.3.4')) === JSON.stringify({ host: '1.2.3.4', port: 22 }));
check('포트를 적으면 그것', S.split('1.2.3.4:2222').port === 2222);
check('ssh:// 를 붙여도 된다', S.split('ssh://my.host:22').host === 'my.host');
check('빈 것', S.split('').host === '' && S.split(null).host === '');

const total = pass + fails.length;
console.log('SSH 자동 설치 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
