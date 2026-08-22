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


const total = pass + fails.length;
console.log('Danbooru 조회 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
