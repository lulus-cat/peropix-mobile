// Danbooru 조회 검사 — 주소 만들기, 응답 해석, 반영율, 작가 통계.
//
// ★여기가 틀리면 엉뚱한 작가를 뽑거나(태그 이름이 어긋난다), 수위 설정을 무시한 그림이
//   화면에 뜬다. 둘 다 조용히 틀리는 자리라 검사로 못 박는다.
// 사용: node tools/test_danbooru.js
'use strict';

const D = require('../www/js/danbooru.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 태그 이름 ──────────────────────────────────────────────────────────
check('대문자를 내린다', D.normalize('WLOP') === 'wlop');
check('띄어쓴 것은 언더스코어로', D.normalize('as 109') === 'as_109');
check('앞뒤 공백을 턴다', D.normalize('  wlop  ') === 'wlop');

check('★프롬프트에 넣을 때는 언더스코어를 띄어쓰기로',
  D.toPrompt('ruu_(tksymkw)') === 'ruu (tksymkw)', D.toPrompt('ruu_(tksymkw)'));
check('★괄호는 그대로 둔다 (NAI 는 {} 와 [] 로 세기를 조절하므로 () 는 글자다)',
  D.toPrompt('ruu_(tksymkw)').indexOf('\\') === -1);
check('되읽으면 원래 태그로', D.fromPrompt('ruu (tksymkw)') === 'ruu_(tksymkw)');

// ── 2. 주소 ───────────────────────────────────────────────────────────────
const tu = D.artistTagsUrl({ min: 300, limit: 1000 });
check('작가만 고른다 (category=1)', tu.indexOf('search%5Bcategory%5D=1') !== -1, tu);
check('많은 순으로', tu.indexOf('search%5Border%5D=count') !== -1);
check('문턱이 들어간다', tu.indexOf('%3E300') !== -1, tu);
check('★한 장 상한 1000 을 넘기지 않는다',
  D.artistTagsUrl({ limit: 99999 }).indexOf('limit=1000') !== -1);
check('이름으로 좁히면 부분 일치',
  D.artistTagsUrl({ name: 'wlop' }).indexOf('name_matches%5D=*wlop*') !== -1,
  D.artistTagsUrl({ name: 'wlop' }));

check('자동완성 주소', D.autocompleteUrl('wlo').indexOf('/autocomplete.json?') !== -1);
check('자동완성은 태그 질의로',
  D.autocompleteUrl('wlo').indexOf('type%5D=tag_query') !== -1);

const pu = D.postsUrl({ name: 'WLOP', rating: 's', limit: 200 });
check('그림 주소에 태그가 정규화되어 들어간다', pu.indexOf('tags=wlop') !== -1, pu);
check('★등급을 최대치로 지정한다 (s 면 g 와 s 까지)',
  decodeURIComponent(pu).indexOf('rating:g,s') !== -1, decodeURIComponent(pu));
check('★전체 이용가만이면 rating:g',
  decodeURIComponent(D.postsUrl({ name: 'a', rating: 'g' })).indexOf('rating:g') !== -1);
check('등급을 안 정하면 거르지 않는다',
  decodeURIComponent(D.postsUrl({ name: 'a' })).indexOf('rating:') === -1);
check('★필요한 칸만 받는다 (한 장에 40칸씩 오면 200장이 수 MB 다)',
  pu.indexOf('only=') !== -1 && pu.indexOf('tag_string_general') !== -1);
check('★그림은 한 장 상한 200',
  D.postsUrl({ name: 'a', limit: 9999 }).indexOf('limit=200') !== -1);
check('사람이 볼 주소', D.webUrl('wlop') === 'https://danbooru.donmai.us/posts?tags=wlop');

// ── 3. 응답 해석 ──────────────────────────────────────────────────────────
// 실제 응답에서 그대로 옮긴 모양
const TAGS = [
  { id: 1, name: 'dairi', post_count: 18783, category: 1, is_deprecated: false },
  { id: 2, name: 'wlop', post_count: 400, category: 1, is_deprecated: false },
  { id: 3, name: '1girl', post_count: 6000000, category: 0, is_deprecated: false }
];
let t = D.parseTags(TAGS);
check('★작가가 아닌 태그는 뺀다', t.length === 2 && t.every(function (x) { return x.name !== '1girl'; }),
  t.map(function (x) { return x.name; }).join(','));
check('장수를 가져온다', t[0].count === 18783);
check('문자열로 줘도 읽는다', D.parseTags(JSON.stringify(TAGS)).length === 2);
check('깨진 응답이면 빈 목록', D.parseTags('깨진').length === 0 && D.parseTags('{}').length === 0);

const AC = [
  { type: 'tag-word', label: 'wlop', value: 'wlop', category: 1, post_count: 400 },
  { type: 'tag-word', label: 'princess aeolian', value: 'princess_aeolian', category: 4,
    post_count: 75, antecedent: 'black-haired_girl_(wlop)' },
  { type: 'tag-word', label: 'sakimichan', value: 'sakimichan', category: 1,
    post_count: 900, antecedent: 'sakimichanart' }
];
const ac = D.parseAutocomplete(AC);
check('★자동완성에서 작가만 남긴다 (캐릭터·판권이 섞여 온다)',
  ac.length === 2 && ac.map(function (x) { return x.name; }).join(',') === 'wlop,sakimichan',
  ac.map(function (x) { return x.name; }).join(','));
check('★별명으로 찾힌 것은 무엇으로 찾혔는지 남긴다',
  ac[1].via === 'sakimichanart', ac[1].via);

const ar = D.parseArtist([{ name: 'wlop', is_banned: false, is_deleted: false,
  other_names: ['wang_ling', 'wlopart', 'zydnq5010@gmail.com'] }]);
check('별명을 가져온다', ar.others.indexOf('wang_ling') !== -1);
check('★이메일처럼 생긴 별명은 뺀다 (Danbooru 에 그대로 실려 있다)',
  ar.others.every(function (n) { return n.indexOf('@') === -1; }), ar.others.join(','));
check('없으면 null', D.parseArtist([]) === null);

// ── 4. 반영율 ─────────────────────────────────────────────────────────────
check('0장은 없음', D.reach(0).level === 0);
check('★버려진(deprecated) 태그는 장수와 상관없이 없음',
  D.reach(9999, { deprecated: true }).level === 0);
check('49장은 거의 안 먹음', D.reach(49).level === 1);
check('120장은 약함', D.reach(120).level === 2);
check('400장은 보통', D.reach(400).level === 3);
check('2000장은 잘 먹음', D.reach(2000).level === 4);
check('18783장은 매우 강함', D.reach(18783).level === 5);
check('★몇 장이라 그 등급인지 같이 알려 준다 (사람이 직접 판단하게)',
  D.reach(400).note.indexOf('400') !== -1, D.reach(400).note);

// ── 5. 작가 통계 ──────────────────────────────────────────────────────────
const POSTS = [
  { id: 1, rating: 's', created_at: '2025-04-01T00:00:00-04:00', image_width: 800, image_height: 1200,
    preview_file_url: 'https://cdn.donmai.us/180x180/a/b/1.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/a/b/1.jpg',
    tag_string_general: '1girl solo long_hair jewelry', tag_string_copyright: 'ghostblade' },
  { id: 2, rating: 's', created_at: '2025-06-01T00:00:00-04:00', image_width: 800, image_height: 1200,
    preview_file_url: 'https://cdn.donmai.us/180x180/a/b/2.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/a/b/2.jpg',
    tag_string_general: '1girl solo jewelry comic', tag_string_copyright: 'ghostblade' },
  { id: 3, rating: 'g', created_at: '2023-01-01T00:00:00-04:00', image_width: 1600, image_height: 900,
    preview_file_url: 'https://cdn.donmai.us/180x180/a/b/3.jpg',
    large_file_url: 'https://cdn.donmai.us/original/a/b/3.mp4',
    tag_string_general: '1girl monochrome', tag_string_copyright: 'original' },
  { id: 4, rating: 'e', created_at: '2021-01-01T00:00:00-04:00', image_width: 800, image_height: 1200,
    preview_file_url: 'https://cdn.donmai.us/180x180/a/b/4.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/a/b/4.jpg',
    tag_string_general: '1girl solo', tag_string_copyright: '' }
];
const st = D.stats(POSTS);
check('표본 수를 적는다', st.sampled === 4);
check('등급 분포', st.rating.map(function (r) { return r.key + r.count; }).join(',') === 'g1,s2,e1',
  st.rating.map(function (r) { return r.key + r.count; }).join(','));
check('등급에 한글 이름이 붙는다', st.rating[0].label === '전체', st.rating[0].label);
check('잦은 태그 1위는 1girl', st.topTags[0].name === '1girl' && st.topTags[0].pct === 100);
check('판권 1위', st.copyright[0].name === 'ghostblade' && st.copyright[0].count === 2);
check('solo 비율', st.solo === 75, String(st.solo));
check('흑백 비율', st.mono === 25, String(st.mono));
check('만화 비율', st.comic === 25, String(st.comic));
check('가로 그림 비율', st.landscape === 25, String(st.landscape));
check('평균 연도(era)', st.era === 2023.5, String(st.era));
check('빈 표본이면 null', D.stats([]) === null && D.stats(null) === null);

const bs = D.beforeShare(POSTS, 2024);
check('★기준 연도 이전 비율을 센다 (새 작가는 장수가 많아도 안 먹을 수 있다)',
  bs.share === 50 && bs.year === 2024, JSON.stringify(bs));
check('기준 연도를 바꿀 수 있다', D.beforeShare(POSTS, 2022).share === 25,
  String(D.beforeShare(POSTS, 2022).share));

// ── 6. 특징 태그 ──────────────────────────────────────────────────────────
// 1girl 은 전체의 60% 라 100% 여도 1.7배뿐 → 특징이 아니다.
// jewelry 는 전체의 3% 인데 이 작가는 50% → 16.7배 → 특징.
const GLOBAL = { '1girl': 5400000, 'jewelry': 270000, 'solo': 3600000, 'comic': 90000,
  'long_hair': 2700000, 'monochrome': 450000 };
const dt = D.distinctive(st.topTags, GLOBAL, 9000000);
check('★흔한 태그를 흔하게 그리는 것은 특징이 아니다 (1girl 이 빠진다)',
  dt.every(function (x) { return x.name !== '1girl'; }),
  dt.map(function (x) { return x.name + '×' + x.times; }).join(','));
check('★남들보다 자주 그리는 것이 위로 온다 (comic 은 전체 1%인데 이 작가는 25% → 25배)',
  dt.length > 0 && dt[0].name === 'comic', JSON.stringify(dt.slice(0, 3)));
check('몇 배인지 적는다', dt[0].times === 25 && dt[1].times === 16.7,
  dt.map(function (x) { return x.name + '×' + x.times; }).join(','));
check('전역 수를 모르면 조용히 뺀다 (0배가 되어 문턱에 걸린다)',
  D.distinctive([{ name: '모르는태그', pct: 90 }], {}, 9000000).length === 0);

// ── 7. 그림 목록 ──────────────────────────────────────────────────────────
const im = D.images(POSTS);
check('★동영상은 뺀다 (화풍을 볼 수 없고 썸네일도 엉뚱하다)',
  im.length === 3 && im.every(function (x) { return x.id !== 3; }),
  im.map(function (x) { return x.id; }).join(','));
check('썸네일과 원본 주소가 온다',
  im[0].thumb.indexOf('180x180') !== -1 && im[0].full.indexOf('sample') !== -1);
check('등급이 따라온다 (화면에서 가릴 수 있게)', im[0].rating === 's');
check('낱장 주소', im[0].web === 'https://danbooru.donmai.us/posts/1');
check('개수를 자를 수 있다', D.images(POSTS, { max: 2 }).length === 2);
check('썸네일이 없으면 뺀다', D.images([{ id: 9, rating: 'g' }]).length === 0);

// ── 8. 전역 장수 (특징 태그의 분모) ───────────────────────────────────────
const cu = D.tagCountsUrl(['1girl', 'Jewelry', 'comic']);
check('★여러 태그를 한 번에 (태그마다 부르면 12번이 든다)',
  decodeURIComponent(cu).indexOf('name_comma]=1girl,jewelry,comic') !== -1, decodeURIComponent(cu));
check('빈 목록이면 빈 주소', D.tagCountsUrl([]) === '');
check('한 번에 40개까지', D.tagCountsUrl(new Array(100).fill('a')).indexOf('limit=40') !== -1);
check('전체 장수 주소', D.totalUrl() === 'https://danbooru.donmai.us/counts/posts.json');
check('전체 장수를 읽는다', D.parseTotal('{"counts":{"posts":11995683}}') === 11995683);
check('이상하면 0', D.parseTotal('{}') === 0 && D.parseTotal('깨진') === 0);
check('장수 표를 만든다',
  D.countMap(D.parseTags([{ name: 'a', post_count: 5 }, { name: 'b', post_count: 7 }])).b === 7);


// ── 9. 추천 — 100장 이상에서 무작위로 ─────────────────────────────────────
// ★추천의 근거는 「장수 100 이상」 이다 (약 2만 4천 명, 100개씩 246쪽).
const du = D.artistTagsUrl({ min: 100, limit: 100, page: 37 });
check('★장수 문턱을 걸어 부른다', decodeURIComponent(du).indexOf('post_count]=>100') !== -1,
  decodeURIComponent(du));
check('무작위 쪽을 부를 수 있다', du.indexOf('page=37') !== -1, du);
check('작가만', du.indexOf('search%5Bcategory%5D=1') !== -1);

// 고르기 — 난수를 넣어 결과를 못 박는다
const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
let calls = 0;
const fake = function () { const v = [0.0, 0.5, 0.9, 0.1, 0.7][calls % 5]; calls++; return v; };
const got = D.sample(TEN, 5, fake);
check('다섯을 고른다', got.length === 5, got.join(','));
check('★같은 것을 두 번 고르지 않는다', new Set(got).size === 5, got.join(','));
check('목록보다 많이 달라고 해도 있는 만큼만', D.sample(['a', 'b'], 5).length === 2);
check('빈 목록이면 빈 결과', D.sample([], 5).length === 0 && D.sample(null, 5).length === 0);
check('원본을 건드리지 않는다', (function () {
  const src = ['a', 'b', 'c'];
  D.sample(src, 2);
  return src.length === 3;
})());

check('★빈 쪽이 나오면 절반으로 줄여 다시 본다', D.backoffPage(246) === 123);
check('1 아래로는 안 내려간다', D.backoffPage(1) === 1 && D.backoffPage(0) === 1);

// ★쪽 차례 — 「기준을 올렸더니 계속 못 찾는다」 가 여기서 났다.
check('★쪽 차례는 반드시 1 에서 끝난다', (function () {
  for (let i = 0; i < 300; i++) {
    const seq = D.pageWalk(246);
    if (seq[seq.length - 1] !== 1) return false;
  }
  return true;
})());
check('★쪽이 일곱뿐이어도 그 안을 본다 (1000장 이상)', (function () {
  // 246쪽 안에서 아무 데나 찍어도 반씩 줄이다 보면 7쪽 안에 반드시 들어온다.
  for (let i = 0; i < 300; i++) {
    if (!D.pageWalk(246).some(function (p) { return p <= 7; })) return false;
  }
  return true;
})());
check('★한 쪽밖에 없어도 찾아낸다 (5000장 이상)',
  D.pageWalk(246, function () { return 0.99; }).indexOf(1) !== -1);
check('맨 위 쪽을 넘겨 찍지 않는다',
  D.pageWalk(7, function () { return 0.999; })[0] <= 7);
check('줄이는 횟수는 열 번을 안 넘는다', D.pageWalk(246, function () { return 0.999; }).length <= 10);
check('한 쪽뿐이면 한 번만 본다', D.pageWalk(1).length === 1);

// ── 10. 장르 자동 분류 ────────────────────────────────────────────────────
function mk(n, general, rating) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: i, rating: rating || 'g', created_at: '2024-01-01T00:00:00-04:00',
      tag_string_general: general, tag_string_copyright: '' });
  }
  return out;
}
const keys = function (g) { return g.map(function (x) { return x.key; }).sort().join(','); };

check('★여성 인물 작가', keys(D.genres(mk(10, '1girl solo long_hair'))) === 'female');
check('★배경 작가', keys(D.genres(mk(10, 'scenery no_humans sky'))) === 'bg');
check('★19금은 등급으로 본다', keys(D.genres(mk(10, '1girl solo', 'e'))) === 'female,nsfw');
check('★남성은 male_focus 로 본다', keys(D.genres(mk(10, '1boy male_focus'))) === 'male');
check('★남녀가 함께 나온 그림은 「인물(남)」 이 아니다 (1boy 만 세면 여성 작가가 전부 남성이 된다)',
  keys(D.genres(mk(10, '1girl 1boy hetero'))) === 'female',
  JSON.stringify(D.genres(mk(10, '1girl 1boy hetero'))));
check('남자만 나온 그림은 남성으로', keys(D.genres(mk(10, '1boy solo'))) === 'male');

// 겹치는 경우 — 한 작가가 여러 장르에 걸친다
const mixed = mk(5, '1girl solo', 'e').concat(mk(5, 'scenery no_humans'));
check('★여러 장르가 함께 붙는다 (하나로 몰아넣으면 「19금도 그리는 배경 작가」 를 못 찾는다)',
  keys(D.genres(mixed)) === 'bg,female,nsfw', keys(D.genres(mixed)));

check('문턱에 못 미치면 안 붙는다', keys(D.genres(mk(9, 'scenery').concat(mk(91, '1girl')))) === 'female',
  keys(D.genres(mk(9, 'scenery').concat(mk(91, '1girl')))));
check('문턱을 바꿀 수 있다',
  keys(D.genres(mk(9, 'scenery').concat(mk(91, '1girl')), { bg: 5 })) === 'bg,female');
check('몇 %인지 함께 준다', D.genres(mk(10, '1girl'))[0].pct === 100);
check('한글 이름이 붙는다', D.genres(mk(10, '1girl'))[0].label === '인물(여)');
check('빈 표본이면 빈 목록', D.genres([]).length === 0 && D.genres(null).length === 0);


// ── 이름 목록으로 한 번에 조회 ────────────────────────────────────────────
// ★대량생성 프롬프트에는 작가와 퀄리티 태그가 섞여 있다. 무엇이 작가인지 가리려면
//   갈래(category)를 함께 받아야 한다 — 장수만 받는 tagCountsUrl 로는 못 가린다.
let u = D.tagsByNameUrl(['wlop', 'masterpiece']);
check('쉼표 목록으로 묻는다', /name_comma%5D=wlop%2Cmasterpiece/.test(u), u);
check('★갈래를 함께 받는다 (작가인지 가려야 한다)', /category/.test(u), u);
check('버려진 태그인지도 받는다', /is_deprecated/.test(u), u);
check('빈 목록이면 부르지 않는다', D.tagsByNameUrl([]) === '' && D.tagsByNameUrl(null) === '');
check('언더스코어로 맞춰 보낸다', /wlop%2Cas109/.test(D.tagsByNameUrl(['WLOP', ' as109 '])),
  D.tagsByNameUrl(['WLOP', ' as109 ']));
// ★only= 에도 쉼표가 들어 있어 주소 전체의 쉼표를 세면 안 된다. 이름 목록만 꺼내 센다.
const nameList = function (url) {
  const m = /name_comma%5D=([^&]*)/.exec(url);
  return m ? decodeURIComponent(m[1]).split(',') : [];
};
check('★한 번에 40개까지만 (주소가 끝없이 길어지면 거절당한다)',
  nameList(D.tagsByNameUrl(Array.from({ length: 60 }, function (_, i) { return 'a' + i; })))
    .length === 40);

// 응답에서 작가만 남는가
const mixedRows = JSON.stringify([
  { name: 'wlop', post_count: 5000, category: 1, is_deprecated: false },
  { name: 'masterpiece', post_count: 900000, category: 0, is_deprecated: false },
  { name: 'as109', post_count: 3000, category: 1, is_deprecated: true }
]);
const onlyArtists = D.parseTags(mixedRows);
check('★퀄리티 태그(갈래 0)는 빠진다', onlyArtists.length === 2 && onlyArtists.every(function (r) {
  return r.name !== 'masterpiece';
}), JSON.stringify(onlyArtists));
check('버려진 것은 표시가 붙는다',
  onlyArtists.find(function (r) { return r.name === 'as109'; }).deprecated === true);

const total = pass + fails.length;
console.log('Danbooru 조회 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
