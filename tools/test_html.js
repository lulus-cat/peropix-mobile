// 화면 뼈대 검사 — 태그가 짝이 맞는가.
//
// ★안 맞으면 브라우저가 알아서 고쳐 그리는데, 그 고친 모양이 내가 짠 것과 다르다.
//   실제로 설정 화면에서 </div> 하나가 남아 스크롤 칸이 일찍 닫히는 바람에,
//   마지막 칸(버전)이 화면 맨 아래에 박혀 내비게이션 바에 가렸다. 오류도 안 났다.
// 사용: node tools/test_html.js
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'www', 'index.html');
const html = fs.readFileSync(file, 'utf8');

let pass = 0;
const fails = [];
function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// 스스로 닫는 것들은 짝이 없다.
const VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'];

/** 화면(section) 하나씩 태그 깊이를 따라간다. */
function walk(chunk) {
  const stack = [];
  const errs = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClose = /\/\s*$/.test(m[3]);
    if (VOID.indexOf(tag) !== -1 || selfClose) continue;
    if (!closing) {
      stack.push(tag);
    } else {
      if (!stack.length) { errs.push('짝 없는 </' + tag + '>'); continue; }
      const open = stack.pop();
      if (open !== tag) errs.push('<' + open + '> 을 </' + tag + '> 로 닫음');
    }
  }
  stack.forEach(function (t) { errs.push('<' + t + '> 이 안 닫힘'); });
  return errs;
}

// ── 화면마다 ──────────────────────────────────────────────────────────────
const sections = html.match(/<section\b[\s\S]*?\n<\/section>/g) || [];
check('화면(section)을 찾았다', sections.length >= 8, String(sections.length));

sections.forEach(function (sec) {
  const id = (sec.match(/id="([^"]+)"/) || [])[1] || '?';
  const errs = walk(sec);
  check('★' + id + ' 의 태그 짝이 맞는다', errs.length === 0, errs.slice(0, 4).join(' · '));
});

// ── 문서 전체 ─────────────────────────────────────────────────────────────
const bodyOnly = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
check('★문서 전체의 태그 짝이 맞는다', walk(bodyOnly).length === 0,
  walk(bodyOnly).slice(0, 5).join(' · '));

// ── id 가 겹치지 않는가 ───────────────────────────────────────────────────
// ★같은 id 가 둘이면 getElementById 는 앞엣것만 준다. 뒤엣것은 영영 안 움직이는데
//   오류도 안 나서, 「눌러도 아무 일이 없다」 로만 보인다.
const ids = {};
const dup = [];
(html.match(/\bid="([^"]+)"/g) || []).forEach(function (raw) {
  const id = raw.slice(4, -1);
  if (ids[id]) dup.push(id);
  ids[id] = true;
});
check('★같은 id 가 두 번 나오지 않는다', dup.length === 0, dup.join(', '));

// ── 화면이 다 등록돼 있는가 ───────────────────────────────────────────────
// ★show() 목록에 빠지면 그 화면은 열리지도 닫히지도 않는다.
const app = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'app.js'), 'utf8');
const listed = (app.match(/\$\('screen-' \+ n\)/) ? app : '').length > 0;
check('show() 가 화면 목록으로 돈다', listed);
const screenIds = (html.match(/id="screen-([a-z-]+)"/g) || [])
  .map(function (x) { return x.slice(11, -1); });
const missing = screenIds.filter(function (n) {
  return app.indexOf("'" + n + "'") === -1;
});
check('★모든 화면이 show() 목록에 있다', missing.length === 0, missing.join(', '));

// ── 오래 걸리는 일의 짝 맞추기 ────────────────────────────────────────────
// ★running 을 직접 대입하면 붙잡기·놓기의 짝이 언젠가 어긋난다. 놓기를 한 번 빠뜨리면
//   알림이 안 사라지고 배터리를 계속 먹는다. 드나드는 문을 하나(setRunning)로 못 박는다.
const direct = (app.match(/^\s*running = (?:true|false);/gm) || []);
check('★running 을 직접 대입하는 곳이 없다 (setRunning 만 쓴다)',
  direct.length === 0, direct.join(' · '));
const ons = (app.match(/setRunning\(true/g) || []).length;
const offs = (app.match(/setRunning\(false/g) || []).length;
check('★시작과 끝의 개수가 같다', ons === offs && ons > 0, ons + ' / ' + offs);
check('붙잡기와 놓기가 짝을 이룬다',
  (app.match(/keepAwake\(/g) || []).length > 0
  && (app.match(/releaseAwake\(/g) || []).length > 0);

const total = pass + fails.length;
console.log('화면 뼈대 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
