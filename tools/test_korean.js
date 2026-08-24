/**
 * 화면에 나가는 한글 검사.
 *
 * ★고친 글은 다시 번역체로 돌아간다. 화면 글은 한 줄씩 따로 고치기 때문에, 새로 쓴
 *   한 줄이 예전 버릇을 그대로 들고 온다. 그래서 사람이 아니라 검사가 지킨다.
 *
 * 규칙은 공개된 한국어 스킬들에서 가져와, 이 앱에 맞는 것만 남겼다.
 * - DaleSeo/korean-skills (humanizer) — 번역투·어휘 패턴
 * - snflkd/fluent-korean — 문장 성분을 생략하지 않기
 * - JangHyun-bin/korean-report-skills — 번역투 치환 목록
 *
 * ★안 가져온 것도 있다. 보고서용 「하였다·되었다」 어미 규약은 이 앱과 안 맞는다.
 *   폰 화면은 「합니다」 체다. 「명사구로 문장을 끝내지 말라」 도 단추와 딱지에는
 *   안 쓴다 — 단추 이름은 원래 명사다.
 *
 * 검사 대상은 **사람이 보는 글**뿐이다. 주석·변수명·커밋 메시지는 건드리지 않는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── 사람이 보는 글만 뽑기 ──────────────────────────────────────────────────
function fromHtml(src) {
  const out = [];
  const body = src.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');
  body.split(/<[^>]*>/).forEach(function (t) {
    const v = t.replace(/\s+/g, ' ').trim();
    if (/[가-힣]/.test(v)) out.push({ where: 'index.html', text: v });
  });
  const re = /(placeholder|title|aria-label|alt)\s*=\s*"([^"]*[가-힣][^"]*)"/g;
  let m;
  while ((m = re.exec(src))) out.push({ where: 'index.html', text: m[2] });
  return out;
}

function fromJs(src, name) {
  const out = [];
  src.split('\n').forEach(function (ln, i) {
    // 주석 줄은 건너뛴다. 코드에 속하는 글은 이 검사의 대상이 아니다.
    const code = ln.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(code))) {
      const v = (m[1] !== undefined ? m[1] : m[2]);
      if (/[가-힣]/.test(v)) out.push({ where: name + ':' + (i + 1), text: v });
    }
  });
  return out;
}

// ── 규칙 ──────────────────────────────────────────────────────────────────
// why 는 사람에게 보여 줄 말이다. 「고치라」 가 아니라 「무엇으로 고치라」 를 적는다.
const RULES = [
  { id: '이중 피동', re: /되어[ ]?지|지어지|불려지|보여지|쓰여지|나뉘어져/,
    why: '「되어진다」 는 피동이 두 번이다. 「된다」 로.' },
  { id: '~에 의해', re: /에 의해|에 의하여/,
    why: '영어식 피동이다. 누가 하는지를 주어로 세운다.' },
  { id: '~에 대해', re: /에 대해|에 대하여|에 대한 (?:분석|검토|설명|논의)/,
    why: '「X에 대해 잰다」 보다 「X를 잰다」 가 짧고 분명하다.' },
  { id: '~를 통해', re: /(?:을|를) 통해|(?:을|를) 통하여/,
    why: '「~로」 나 「~해서」 로 줄인다.' },
  { id: '~에 있어서', re: /에 있어서|에 있어/,
    why: '번역투다. 「~에서」 나 「~할 때」 로.' },
  { id: '~와 관련하여', re: /와 관련하여|과 관련하여|관련된 사항/,
    why: '「~의」 나 그냥 빼도 뜻이 산다.' },
  { id: '가지고 있다', re: /가지고 있|갖고 있/,
    why: '「있다」 로 충분하다. 「기능을 가지고 있습니다」 → 「기능이 있습니다」.' },
  { id: '잉여 한자어', re: /진행하(?:여|고|면|겠|십|세|기)|진행합니다|실시하|수행하/,
    why: '「하다」 로 충분하다. 「삭제를 진행합니다」 → 「지웁니다」.' },
  { id: '불필요한 -들', re: /(?:여러|많은|모든|몇[ ]?가지|다양한|각종)\s*\S*들(?:을|이|은|과|에|로|의|도)?\b/,
    why: '「여러」 가 이미 복수다. 「여러 작가들」 → 「여러 작가」.' },
  { id: '해당·본', re: /해당 [가-힣]|본 (?:문서|앱|화면|기능)/,
    why: '「해당 기능」 → 「이 기능」. 「본 앱」 → 「이 앱」.' },
  { id: '~적 N', re: /(?:기본적으로|일반적으로|자동적으로|효과적으로|기술적으로|최종적으로|결과적으로)/,
    why: '「기본적으로」 → 「원래」 나 그냥 뺀다. 「자동적으로」 → 「알아서」.' },
  { id: '결론 관용구', re: /결론적으로|요약하자면|다시 말해서|즉,/,
    why: '앞에서 이미 말했으면 빼고, 안 말했으면 그 자리에서 말한다.' },
  { id: '하십시오체 섞임', re: /하십시오|하시기 바랍니다|주시기 바랍니다/,
    why: '앱은 「합니다·하세요」 체다. 「하십시오」 만 격이 달라 튄다.' },
  { id: '~것입니다', re: /것입니다|할 것입니다/,
    why: '「~합니다」 로 잘라 말한다.' },
  { id: '보조용언 띄어쓰기',
    re: /[가-힣](?:주세요|보세요|드립니다)/,
    why: '앱은 「넣어 주세요」 처럼 띄어 쓴다. 「넣어주세요」 만 붙어 있으면 눈에 걸린다.',
    ok: /(?:해|어|아|워|려|여|라|나) (?:주세요|보세요|드립니다)|건드립니다/ },
  { id: '이중 목적격', re: /(?:을|를)\s+\S*(?:을|를)\s+(?:키워|줄여|바꿔|늘려|높여|낮춰)/,
    why: '「그림을 해상도를 키워」 는 「를」 이 두 번이다. 「그림을 더 큰 해상도로」 로.' },
  { id: '서술격조사 띄어쓰기', re: /[가-힣] (?:입니다|입니까|였습니다|이었습니다)/,
    why: '「프롬프트 입니다」 → 「프롬프트입니다」. 한글 뒤에서는 붙여 쓴다.' },
  { id: '느낌표', re: /!(?!=)/,
    why: '화면 글에 느낌표를 안 쓴다. 말이 세지 않아도 읽힌다.' }
];

// ── 조사 ──────────────────────────────────────────────────────────────────
// ★말을 한꺼번에 바꾸면 조사가 안 따라온다. 「그림」 을 「이미지」 로 바꾼 자리에
//   「이미지을」 이 남았다. 사람 눈에는 잘 안 띄는데 읽으면 바로 걸린다.
function batchim(ch) {
  const c = ch.charCodeAt(0) - 0xAC00;
  if (c < 0 || c > 11171) return null;
  return (c % 28) !== 0;
}

// 앱이 자주 쓰는 이름들. 이 뒤에 붙는 조사는 어미와 헷갈릴 일이 없어 그냥 맞춰 본다.
const NOUNS = ['이미지', '그림', '프롬프트', '슬롯', '폴더', '저장소', '서버', '태그',
  '작가', '인물', '모델', '조합', '파일', '주소', '비밀번호', '수신함', '보고서',
  '버전', '와일드카드', '캐릭터', '서랍', '그림체', '별점', '시드', '토큰'];
const PAIRS = [['을', '를'], ['은', '는'], ['이', '가'], ['과', '와']];

/** ㄹ 받침은 「로」 를 쓴다. 「파일으로」 가 아니라 「파일로」 다. */
function rieul(ch) { return (ch.charCodeAt(0) - 0xAC00) % 28 === 8; }

// 「초과」 처럼 끝 글자가 조사와 같은 낱말. 조사가 아니다.
const NOT_JOSA = ['초과', '통과', '결과', '경과', '사과', '마을', '서울', '가을', '다음',
  '처음', '마음', '모음', '이음', '보은'];

function josaHits(text) {
  const out = [];
  NOUNS.forEach(function (n) {
    const has = batchim(n[n.length - 1]);
    PAIRS.forEach(function (pr) {
      const wrong = has ? pr[1] : pr[0];
      const right = has ? pr[0] : pr[1];
      const re = new RegExp(n + wrong + '(?=[\\s,.·」)\\]]|$)', 'g');
      if (re.test(text)) out.push(n + wrong + ' → ' + n + right);
    });
    const last = n[n.length - 1];
    const badRo = (has && !rieul(last)) ? '로' : '으로';
    if (new RegExp(n + badRo + '(?=[\\s,.·」)\\]]|$)').test(text)) {
      out.push(n + badRo + ' → ' + n + (badRo === '로' ? '으로' : '로'));
    }
  });
  // 받침이 없는데 받침용 조사가 붙은 것 (이름 목록 밖까지 훑는 그물)
  const re = /([가-힣])(을|은|과)(?=[\s,.·」)\]]|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const pair = text.slice(Math.max(0, m.index - 1), m.index + 2);
    if (NOT_JOSA.some(function (w) { return pair.indexOf(w) !== -1; })) continue;
    if (batchim(m[1]) === false) {
      out.push(text.slice(Math.max(0, m.index - 6), m.index + 2) + ' — 받침이 없다');
    }
  }
  return out;
}

// ── 율 · 률 ───────────────────────────────────────────────────────────────
// ★받침이 없거나 ㄴ 받침이면 「율」, 그 밖에는 「률」 이다. 「반영율」 은 「반영률」.
function yulHits(text) {
  const out = [];
  const re = /([가-힣])(율|률)/g;
  let m;
  while ((m = re.exec(text))) {
    const c = m[1].charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) continue;
    const jong = c % 28;
    const want = (jong === 0 || jong === 4) ? '율' : '률';   // 4 = ㄴ
    if (m[2] !== want) out.push(m[1] + m[2] + ' → ' + m[1] + want);
  }
  return out;
}

// ── 용어 ──────────────────────────────────────────────────────────────────
// ★같은 것을 두 가지로 부르면 읽는 사람이 다른 것인 줄 안다. 앱이 이미 많이 쓰는
//   쪽으로 맞춘다. 세는 것이 아니라 정해 둔다.
const WORDS = [
  { bad: /세팅/, good: '설정' },
  { bad: /어플|애플리케이션/, good: '앱' },
  { bad: /휴대폰|스마트폰|단말|(?:이|그) 기기|기기마다|기기에/, good: '폰' },
  { bad: /다운로드하|다운로드 필요|다운로드받/, good: '받기' },
  { bad: /리포지토리/, good: '저장소' }
];

// ★일부러 두는 것. 규칙이 못 가리는 자리다.
const OK = [
  '이 그림체 선택',           // 단추 이름 — 「이」 는 지시관형사지 「해당」 이 아니다
  '다시 보지 않기'
];

// ── 돌린다 ────────────────────────────────────────────────────────────────
let items = fromHtml(fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8'));
['app.js', 'report.js', 'storage.js', 'updater.js', 'notify.js', 'embed.js',
  'consistency.js', 'ssh.js', 'anlas.js', 'folders.js', 'results-model.js',
  'styletest.js', 'artists.js', 'bisect.js', 'danbooru.js', 'github.js',
  'jobs.js', 'naming.js', 'nai-client.js', 'remote-store.js', 'perofix-import.js',
  'wildcards.js', 'compose.js', 'image-util.js'].forEach(function (f) {
  const p = path.join(ROOT, 'www/js', f);
  if (fs.existsSync(p)) items = items.concat(fromJs(fs.readFileSync(p, 'utf8'), f));
});

const hits = [];
items.forEach(function (it) {
  if (OK.indexOf(it.text) !== -1) return;
  RULES.forEach(function (r) {
    if (!r.re.test(it.text)) return;
    // ok 가 있으면 「제대로 쓴 모양」 이다. 그것만 있으면 걸린 것이 아니다.
    if (r.ok && it.text.replace(new RegExp(r.ok.source, 'g'), '').search(r.re) === -1) return;
    hits.push({ rule: r, item: it });
  });
  josaHits(it.text).forEach(function (j) {
    hits.push({ rule: { id: '조사', why: j }, item: it });
  });
  yulHits(it.text).forEach(function (y) {
    hits.push({ rule: { id: '율·률', why: y }, item: it });
  });
  WORDS.forEach(function (w) {
    if (w.bad.test(it.text)) {
      hits.push({ rule: { id: '용어', why: '「' + w.good + '」 로 맞춘다.' }, item: it });
    }
  });
});

if (hits.length) {
  const byRule = {};
  hits.forEach(function (h) { (byRule[h.rule.id] = byRule[h.rule.id] || []).push(h); });
  Object.keys(byRule).forEach(function (k) {
    const list = byRule[k];
    console.log('\n  x ' + k + ' — ' + list.length + '건');
    list.slice(0, 8).forEach(function (h) {
      console.log('      ' + h.item.where + '  ' + h.item.text.slice(0, 62));
      console.log('        → ' + h.rule.why);
    });
    if (list.length > 8) console.log('      … 그 밖에 ' + (list.length - 8) + '건');
  });
  console.log('\n화면 한글 검사 — 조각 ' + items.length + '개 중 걸린 것 ' + hits.length + '건');
  process.exit(1);
}
console.log('화면 한글 검사 ' + items.length + '조각 — 걸린 것 없음');
