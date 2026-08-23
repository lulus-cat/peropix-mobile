// GitHub 지시함 검사 — 주소, 트리 읽기, 작품/인물/슬롯 가르기, 바뀐 것 알아보기.
//
// ★여기가 틀리면 같은 지시를 두 번 뽑아 돈이 두 번 나가거나, 인물이 빠진 채로 돈다.
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
  ['owner/repo 그대로', 'lulus-cat/peropix-jobs'],
  ['주소를 통째로 붙여넣어도', 'https://github.com/lulus-cat/peropix-jobs'],
  ['끝에 슬래시가 있어도', 'https://github.com/lulus-cat/peropix-jobs/'],
  ['.git 이 붙어 있어도', 'https://github.com/lulus-cat/peropix-jobs.git'],
  ['ssh 주소여도', 'git@github.com:lulus-cat/peropix-jobs.git'],
  ['앞뒤 공백이 있어도', '  lulus-cat/peropix-jobs  ']
];
REPOS.forEach(function (c) {
  const r = G.parseRepo(c[1]);
  check('저장소를 읽는다 — ' + c[0],
    !!r && r.owner === 'lulus-cat' && r.repo === 'peropix-jobs', JSON.stringify(r));
});
[['빈 값', ''], ['소유자만', 'lulus-cat'], ['이상한 글자', 'a b/c d'], ['슬래시만', '///']]
  .forEach(function (c) {
    check('잘못된 저장소는 거절 — ' + c[0], G.parseRepo(c[1]) === null);
  });

// ── 2. 주소 만들기 ────────────────────────────────────────────────────
const CFG = { repo: 'lulus-cat/peropix-jobs', branch: 'main' };
check('트리 주소는 한 번에 다 가져온다 (recursive=1)',
  G.treeUrl(CFG) === 'https://api.github.com/repos/lulus-cat/peropix-jobs/git/trees/main?recursive=1',
  G.treeUrl(CFG));
check('파일은 raw 로 (API 한도를 안 쓴다)',
  G.rawUrl(CFG, '미아/slots/일상.json') ===
  'https://raw.githubusercontent.com/lulus-cat/peropix-jobs/main/%EB%AF%B8%EC%95%84/slots/%EC%9D%BC%EC%83%81.json',
  G.rawUrl(CFG, '미아/slots/일상.json'));
check('★캐시를 피하려고 시각을 붙일 수 있다',
  G.rawUrl(CFG, 'a/b.json', 1234).indexOf('?t=1234') !== -1);
check('비공개용 API 파일 주소',
  G.apiFileUrl(CFG, 'a/slots/b.json') ===
  'https://api.github.com/repos/lulus-cat/peropix-jobs/contents/a/slots/b.json?ref=main',
  G.apiFileUrl(CFG, 'a/slots/b.json'));
check('브랜치를 안 적으면 main', G.treeUrl({ repo: 'a/b' }).indexOf('/trees/main?') !== -1);
check('사람이 볼 주소 (저장소)', G.webUrl(CFG) === 'https://github.com/lulus-cat/peropix-jobs');
check('사람이 볼 주소 (파일)',
  G.webUrl(CFG, 'a/b.json') === 'https://github.com/lulus-cat/peropix-jobs/blob/main/a/b.json');
check('저장소가 잘못되면 빈 주소', G.treeUrl({ repo: 'nope' }) === '');

// ── 3. 트리에서 쓸 파일만 ─────────────────────────────────────────────
const TREE = {
  tree: [
    { path: 'AGENTS.md', type: 'blob', sha: 'aa' },
    { path: '미아', type: 'tree', sha: 'bb' },
    { path: '미아/characters/미아.json', type: 'blob', sha: 'c1' },
    { path: '미아/slots/일상.json', type: 'blob', sha: 's1' },
    { path: '미아/slots/H.json', type: 'blob', sha: 's2' },
    { path: '리사/characters/리사.json', type: 'blob', sha: 'c2' },
    { path: '리사/slots/교복.json', type: 'blob', sha: 's3' },
    { path: '.github/workflows/x.json', type: 'blob', sha: 'zz' },
    { path: '메모.txt', type: 'blob', sha: 'tt' },
    { path: '루트.json', type: 'blob', sha: 'rr' }
  ]
};
const files = G.parseTree(TREE);
check('JSON 만 고른다', files.every(function (f) { return /\.json$/.test(f.path); }),
  files.map(function (f) { return f.path; }).join(','));
check('폴더(tree)는 뺀다', files.every(function (f) { return f.path !== '미아'; }));
check('★숨은 폴더(.github)는 건드리지 않는다',
  files.every(function (f) { return f.path.indexOf('.github') === -1; }));
check('문자열로 줘도 읽는다', G.parseTree(JSON.stringify(TREE)).length === files.length);
check('이상한 응답이면 빈 목록', G.parseTree('{}').length === 0 && G.parseTree('깨진').length === 0);

// ── 4. 작품 / 인물 / 슬롯 가르기 ──────────────────────────────────────
let p = G.plan(files, []);
check('작품이 둘로 갈린다', Object.keys(p.works).sort().join(',') === '리사,미아',
  Object.keys(p.works).join(','));
check('인물 파일을 인물로 본다', p.works['미아'].chars.length === 1
  && p.works['미아'].chars[0].path === '미아/characters/미아.json');
check('슬롯 파일이 작업이 된다 (미아 2건 + 리사 1건)', p.jobs.length === 3, String(p.jobs.length));
check('★루트에 그냥 놓인 JSON 은 건너뛴다 (어느 작품인지 알 수 없다)',
  p.jobs.every(function (j) { return j.slotPath !== '루트.json'; }));
check('작업 이름은 「작품 · 파일이름」', p.jobs[0].name === '리사 · 교복', p.jobs[0].name);
check('작업이 그 작품의 인물을 들고 있다',
  p.jobs[0].charPaths.join(',') === '리사/characters/리사.json', p.jobs[0].charPaths.join(','));
check('★id 에 내용 SHA 가 들어간다', p.jobs[0].id === '리사/slots/교복.json@s3', p.jobs[0].id);

// 폴더 이름을 한글로 써도 (캐릭터 / 슬롯)
const KO = G.parseTree({ tree: [
  { path: '유나/캐릭터/유나.json', type: 'blob', sha: 'k1' },
  { path: '유나/슬롯/일상.json', type: 'blob', sha: 'k2' }
] });
p = G.plan(KO, []);
check('한글 폴더 이름(캐릭터·슬롯)도 알아본다',
  p.works['유나'].chars.length === 1 && p.jobs.length === 1, JSON.stringify(Object.keys(p.works)));

// 슬롯 폴더 없이 작품 폴더에 바로 둔 것도 슬롯으로 본다
p = G.plan(G.parseTree({ tree: [{ path: '미아/일상.json', type: 'blob', sha: 'f1' }] }), []);
check('슬롯 폴더 없이 바로 둔 JSON 도 작업으로 본다', p.jobs.length === 1 && p.jobs[0].work === '미아');

// 규약 밖(엉뚱한 세 번째 폴더)은 건너뛴다
p = G.plan(G.parseTree({ tree: [{ path: '미아/기타/메모.json', type: 'blob', sha: 'x1' }] }), []);
check('인물도 슬롯도 아닌 폴더는 건너뛴다', p.jobs.length === 0);

// ── 5. 바뀐 것 · 이미 한 것 ───────────────────────────────────────────
p = G.plan(files, ['리사/slots/교복.json@s3']);
check('이미 한 것은 done 으로 표시된다',
  p.jobs.find(function (j) { return j.slotPath === '리사/slots/교복.json'; }).done === true);
check('안 한 것만 남기면 2건', G.pending(p.jobs, ['리사/slots/교복.json@s3']).length === 2);

// ★내용이 바뀌면 SHA 가 바뀌므로 새 작업이 된다
const changed = G.parseTree({ tree: [{ path: '리사/slots/교복.json', type: 'blob', sha: 's9' }] });
const p2 = G.plan(changed, ['리사/slots/교복.json@s3']);
check('★파일을 고치면 다시 뽑을 것이 된다 (SHA 가 바뀐다)',
  G.pending(p2.jobs, ['리사/slots/교복.json@s3']).length === 1, JSON.stringify(p2.jobs[0]));
check('★고치지 않았으면 다시 뽑지 않는다',
  G.pending(G.plan(files, []).jobs, ['리사/slots/교복.json@s3'])
    .every(function (j) { return j.slotPath !== '리사/slots/교복.json'; }));

let done = G.rememberDone([], 'a');
done = G.rememberDone(done, 'b');
done = G.rememberDone(done, 'a');
check('한 것을 기억한다 (같은 것은 하나만)', done.join(',') === 'b,a', done.join(','));
let many = [];
for (let i = 0; i < 400; i++) many = G.rememberDone(many, 'x' + i, 300);
check('★기억은 최근 300개만', many.length === 300 && many[0] === 'x100', String(many.length));

// ── 6. 파일 읽고 합치기 ───────────────────────────────────────────────
check('JSON 을 읽는다', G.parseJson('{"a":1}').data.a === 1);
check('코드블록 표시를 같이 커밋해도 벗겨 읽는다', G.parseJson('```json\n{"a":2}\n```').data.a === 2);
check('빈 파일은 오류', G.parseJson('').ok === false);
check('JSON 이 아니면 오류', G.parseJson('그냥 글').ok === false);

const slotFile = {
  name: '미아 · 일상', prefix: '1girl, silver hair',
  slots: [{ name: '1-1', content: 'smile' }, { name: '1-2', content: 'angry' }],
  options: { count_per_slot: 2 }
};
const charFile = { name: '미아', content: '1girl, silver hair, blue eyes' };
let spec = G.mergeSpec(slotFile, [charFile], '미아');
check('작품 폴더 이름이 저장 폴더가 된다', spec.folder === '미아', spec.folder);
check('슬롯이 그대로 온다', spec.slots.length === 2);
check('공통 프롬프트가 온다', spec.prefix === '1girl, silver hair');
check('옵션이 온다', spec.options.count_per_slot === 2);
check('★인물이 합쳐진다', spec.characters.length === 1 && spec.characters[0].name === '미아');

spec = G.mergeSpec(slotFile, [[{ name: 'a', content: 'x' }, { name: 'b', content: 'y' }],
  { characters: [{ name: 'c', content: 'z' }] }], '작품');
check('인물 파일이 배열이어도, {characters:[]} 여도 읽는다',
  spec.characters.map(function (c) { return c.name; }).join(',') === 'a,b,c',
  spec.characters.map(function (c) { return c.name; }).join(','));

spec = G.mergeSpec({ folder: '다른폴더', slots: [{ name: '1-1' }] }, [], '작품');
check('슬롯 파일이 folder 를 적어 두면 그것이 이긴다', spec.folder === '다른폴더');

spec = G.mergeSpec([{ name: '1-1', content: 'x' }], [], '미아');
check('슬롯 파일이 배열이면 슬롯 목록으로 본다', spec.slots.length === 1 && spec.folder === '미아');

spec = G.mergeSpec({ slots: [{ name: '1-1' }], characters: [{ name: '단역', content: 'q' }] },
  [{ name: '공용', content: 'p' }], '미아');
check('슬롯 파일이 적어 둔 인물은 공용 뒤에 붙는다',
  spec.characters.map(function (c) { return c.name; }).join(',') === '공용,단역',
  spec.characters.map(function (c) { return c.name; }).join(','));

check('파일 이름에서 확장자를 뗀다', G.baseName('a/b/일상.json') === '일상');

const total = pass + fails.length;
console.log('GitHub 지시함 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
