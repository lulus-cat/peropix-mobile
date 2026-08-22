// GitHub 지시함 검사 — 주소 만들기, 지시 파일 읽기, 이미 한 것 거르기.
//
// ★여기가 틀리면 같은 지시를 두 번 뽑아 돈이 두 번 나가거나, 엉뚱한 저장소를 본다.
// 사용: node tools/test_github.js
'use strict';

const G = require('../www/js/github.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 저장소 적기 ────────────────────────────────────────────────────
const REPOS = [
  ['owner/repo 그대로', 'lulus-cat/peropix-mobile'],
  ['주소를 통째로 붙여넣어도', 'https://github.com/lulus-cat/peropix-mobile'],
  ['끝에 슬래시가 있어도', 'https://github.com/lulus-cat/peropix-mobile/'],
  ['.git 이 붙어 있어도', 'https://github.com/lulus-cat/peropix-mobile.git'],
  ['ssh 주소여도', 'git@github.com:lulus-cat/peropix-mobile.git'],
  ['앞뒤 공백이 있어도', '  lulus-cat/peropix-mobile  ']
];
REPOS.forEach(function (c) {
  const r = G.parseRepo(c[1]);
  check('저장소를 읽는다 — ' + c[0],
    !!r && r.owner === 'lulus-cat' && r.repo === 'peropix-mobile', JSON.stringify(r));
});

[['빈 값', ''], ['소유자만', 'lulus-cat'], ['이상한 글자', 'a b/c d'], ['슬래시만', '///']]
  .forEach(function (c) {
    check('잘못된 저장소는 거절 — ' + c[0], G.parseRepo(c[1]) === null, JSON.stringify(G.parseRepo(c[1])));
  });

// ── 2. 주소 만들기 ────────────────────────────────────────────────────
const CFG = { repo: 'lulus-cat/peropix-mobile', branch: 'main', path: 'perofix/queue.json' };
check('raw 주소 (공개 저장소 · API 한도를 안 쓴다)',
  G.rawUrl(CFG) === 'https://raw.githubusercontent.com/lulus-cat/peropix-mobile/main/perofix/queue.json',
  G.rawUrl(CFG));
check('★캐시를 피하려고 시각을 붙일 수 있다',
  G.rawUrl(CFG, 12345).indexOf('?t=12345') !== -1, G.rawUrl(CFG, 12345));
check('API 주소 (비공개 저장소 · 토큰으로 읽는다)',
  G.apiUrl(CFG) === 'https://api.github.com/repos/lulus-cat/peropix-mobile/contents/perofix/queue.json?ref=main',
  G.apiUrl(CFG));
check('사람이 눈으로 볼 주소',
  G.webUrl(CFG) === 'https://github.com/lulus-cat/peropix-mobile/blob/main/perofix/queue.json',
  G.webUrl(CFG));
check('브랜치를 안 적으면 main',
  G.rawUrl({ repo: 'a/b', path: 'q.json' }).indexOf('/main/') !== -1,
  G.rawUrl({ repo: 'a/b', path: 'q.json' }));
check('경로를 안 적으면 perofix/queue.json',
  G.rawUrl({ repo: 'a/b' }).indexOf('perofix/queue.json') !== -1, G.rawUrl({ repo: 'a/b' }));
check('경로 앞뒤 슬래시는 정리한다',
  G.rawUrl({ repo: 'a/b', path: '/작업/q.json/' }).indexOf('/%EC%9E%91%EC%97%85/q.json') !== -1,
  G.rawUrl({ repo: 'a/b', path: '/작업/q.json/' }));
check('저장소가 잘못되면 빈 주소', G.rawUrl({ repo: 'nope' }) === '');

// ── 3. 지시 파일 읽기 ─────────────────────────────────────────────────
const ONE = JSON.stringify({
  name: '미아 · 일상', folder: '미아', prefix: '1girl',
  slots: [{ name: '1-1', content: 'smile' }]
});
let r = G.parseQueue(ONE);
check('작업 하나만 적어도 읽는다', r.ok && r.jobs.length === 1, JSON.stringify(r.error));
check('이름을 가져온다', r.jobs[0].name === '미아 · 일상', r.jobs[0].name);
check('id 가 없으면 내용에서 만들어 준다', !!r.jobs[0].id, r.jobs[0].id);
const sameId = G.parseQueue(ONE).jobs[0].id;
check('★같은 내용이면 같은 id (두 번 뽑지 않게)', r.jobs[0].id === sameId, r.jobs[0].id + ' vs ' + sameId);

r = G.parseQueue(JSON.stringify([
  { id: 'a1', name: '하나', slots: [{ name: '1-1', content: 'x' }] },
  { id: 'a2', name: '둘', slots: [{ name: '1-2', content: 'y' }] }
]));
check('배열로 여러 개', r.ok && r.jobs.length === 2 && r.jobs[1].id === 'a2', JSON.stringify(r.jobs.map(function (j) { return j.id; })));

r = G.parseQueue(JSON.stringify({ jobs: [{ id: 'b1', spec: { slots: [{ name: '1-1' }] } }] }));
check('{jobs:[{spec}]} 모양도 받는다', r.ok && r.jobs[0].id === 'b1' && !!r.jobs[0].spec.slots);
r = G.parseQueue(JSON.stringify({ queue: [{ id: 'c1', slots: [{ name: '1-1' }] }] }));
check('{queue:[...]} 도 받는다', r.ok && r.jobs[0].id === 'c1');

r = G.parseQueue('```json\n' + ONE + '\n```');
check('코드블록 표시를 같이 커밋해도 벗겨 읽는다', r.ok && r.jobs.length === 1, JSON.stringify(r.error));

check('빈 파일은 오류로 알려 준다', G.parseQueue('').ok === false);
check('JSON 이 아니면 오류로 알려 준다', G.parseQueue('그냥 글').ok === false);
check('지시가 아닌 것(슬롯도 프롬프트도 없음)은 건너뛴다',
  G.parseQueue(JSON.stringify([{ hello: 'world' }])).ok === false);
check('섞여 있으면 지시만 골라 낸다',
  G.parseQueue(JSON.stringify([{ hello: 'x' }, { id: 'd1', slots: [{ name: '1-1' }] }])).jobs.length === 1);

// ── 4. 이미 한 것 거르기 ──────────────────────────────────────────────
const jobs = [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }];
check('안 한 것만 남긴다',
  G.pending(jobs, ['j2']).map(function (j) { return j.id; }).join(',') === 'j1,j3');
check('기억이 없으면 전부 새 것', G.pending(jobs, []).length === 3);
check('전부 했으면 아무것도 안 남는다', G.pending(jobs, ['j1', 'j2', 'j3']).length === 0);

let done = G.rememberDone([], 'j1');
done = G.rememberDone(done, 'j2');
check('한 것을 기억한다', done.join(',') === 'j1,j2', done.join(','));
done = G.rememberDone(done, 'j1');
check('같은 것을 또 기억해도 하나만 남는다', done.join(',') === 'j2,j1', done.join(','));

let many = [];
for (let i = 0; i < 400; i++) many = G.rememberDone(many, 'x' + i, 300);
check('★기억은 무한정 쌓지 않는다 (최근 300개)', many.length === 300, String(many.length));
check('오래된 것부터 버린다', many[0] === 'x100', many[0]);

const total = pass + fails.length;
console.log('GitHub 지시함 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
