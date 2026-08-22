// Danbooru 조회 — 작가 태그를 **실시간으로** 확인한다.
//
// ★왜 실시간인가. 작가 태그는 앱에 박아 두면 늙는다. 새 작가가 계속 생기고 post_count 도
//   매일 는다. 목록을 통째로 받아 두는 대신 필요할 때 물어본다.
// ★토큰이 필요 없다. tags/posts/artists 모두 비로그인으로 열려 있고, 응답에
//   `access-control-allow-origin: *` 가 붙어 오므로 웹뷰에서 그냥 fetch 하면 된다
//   (GitHub 비공개 저장소처럼 CapacitorHttp 로 우회할 필요가 없다).
// ★한 장 최대 1000건. 그 이상은 page= 로 넘긴다.
//
// 여기에는 **주소 만들기와 응답 해석만** 둔다. 실제 통신은 화면 쪽(app.js)이 한다 —
// 그래야 이 파일을 노드에서 통째로 검사할 수 있다 (github.js 와 같은 방식).
'use strict';

const Danbooru = (function () {
  const API = 'https://danbooru.donmai.us';

  // Danbooru 태그 분류. 우리가 쓰는 것은 작가(1)뿐이지만, 자동완성 응답에 다른 것이
  // 섞여 오므로 걸러 내려면 나머지도 알아야 한다.
  const CAT = { general: 0, artist: 1, copyright: 3, character: 4, meta: 5 };

  // 등급. Danbooru 는 g < s < q < e 순으로 수위가 올라간다.
  const RATINGS = ['g', 's', 'q', 'e'];
  const RATING_KO = { g: '전체', s: '가벼움', q: '아슬', e: '노출' };

  // ★동영상·플래시는 화풍을 보는 데 쓸모가 없고 썸네일도 엉뚱하게 나온다. 확장자로 뺀다.
  //   (검색어로 빼면 태그 칸을 하나 잡아먹는다.)
  const NOT_IMAGE = /\.(mp4|webm|zip|swf)$/i;

  // ── 태그 이름 다루기 ──────────────────────────────────────────────────────
  /**
   * 사람이 친 것을 Danbooru 태그 모양으로. "WLOP" → "wlop", "as109 " → "as109",
   * 띄어쓴 것은 언더스코어로.
   */
  function normalize(raw) {
    return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  /**
   * Danbooru 태그를 **프롬프트에 넣을 모양**으로.
   *
   * ★언더스코어만 띄어쓰기로 바꾼다. 괄호는 그대로 둔다 — NAI 는 세기 조절에 {} 와 []
   *   를 쓰므로 () 는 글자로 읽는다. 실제로 기준 페이로드에도 `[[horror (theme)]]` 가
   *   괄호를 벗기지 않은 채 들어 있다. 여기서 괄호를 이스케이프하면 오히려 깨진다.
   */
  function toPrompt(tag) {
    return String(tag || '').replace(/_/g, ' ').trim();
  }

  /** 프롬프트에 적힌 것을 다시 태그 모양으로 (되읽을 때). */
  function fromPrompt(text) {
    return normalize(text);
  }

  // ── 주소 만들기 ───────────────────────────────────────────────────────────
  function qs(params) {
    return Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
  }

  /**
   * 작가 태그 목록. post_count 가 큰 순.
   * @param {object} o {min, limit, page, name} name 은 부분 일치 (`*wlop*`)
   */
  function artistTagsUrl(o) {
    const p = {
      'search[category]': CAT.artist,
      'search[order]': 'count',
      'search[hide_empty]': 'yes',
      limit: Math.min(Math.max((o && o.limit) || 100, 1), 1000),
      only: 'name,post_count,is_deprecated'
    };
    if (o && o.min) p['search[post_count]'] = '>' + o.min;
    if (o && o.name) p['search[name_matches]'] = '*' + normalize(o.name) + '*';
    if (o && o.page) p.page = o.page;
    return API + '/tags.json?' + qs(p);
  }

  /** 태그 하나를 정확히 찾는다 (있는지·몇 장인지 확인용). */
  function tagUrl(name) {
    return API + '/tags.json?' + qs({
      'search[name]': normalize(name),
      limit: 1,
      only: 'name,post_count,category,is_deprecated'
    });
  }

  /** 검색창용 자동완성. 작가만 보고 싶어도 응답에는 다 섞여 온다 — parseAutocomplete 가 거른다. */
  function autocompleteUrl(q, limit) {
    return API + '/autocomplete.json?' + qs({
      'search[query]': normalize(q),
      'search[type]': 'tag_query',
      limit: Math.min(Math.max(limit || 10, 1), 20)
    });
  }

  /** 작가 정보 — 별명(other_names). 픽시브 이름으로 찾아 들어올 때 쓴다. */
  function artistUrl(name) {
    return API + '/artists.json?' + qs({ 'search[name]': normalize(name), limit: 1 });
  }

  /**
   * 그 작가의 그림. 통계와 미리보기를 한 번에 여기서 뽑는다.
   *
   * ★`only` 로 필요한 칸만 받는다. 안 그러면 한 장에 40칸씩 와서 200장이면 수 MB 다.
   * @param {object} o {name, rating: 'g'|'s'|'q'|'e'|'', limit, page, order}
   */
  function postsUrl(o) {
    const tags = [normalize(o.name)];
    // 등급을 최대치로 지정한다 — 'g' 면 전체 이용가만, 's' 면 g+s 까지.
    if (o.rating && RATINGS.indexOf(o.rating) !== -1) {
      const upto = RATINGS.slice(0, RATINGS.indexOf(o.rating) + 1);
      tags.push(upto.length === 1 ? ('rating:' + upto[0]) : ('rating:' + upto.join(',')));
    }
    if (o.order) tags.push('order:' + o.order);
    return API + '/posts.json?' + qs({
      tags: tags.join(' '),
      limit: Math.min(Math.max(o.limit || 100, 1), 200),
      page: o.page || undefined,
      only: 'id,rating,created_at,file_ext,image_width,image_height,preview_file_url,'
        + 'large_file_url,tag_string_general,tag_string_copyright,tag_string_artist'
    });
  }

  /**
   * 여러 태그의 **전역** 장수를 한 번에. 특징 태그(×N)를 재려면 「남들은 얼마나
   * 그리는가」 가 있어야 하는데, 태그마다 부르면 12번이 든다.
   * ★`search[name_comma]` 로 쉼표 목록을 받는다 (`search[name]` 은 쉼표를 안 받는다).
   */
  function tagCountsUrl(names) {
    const list = (names || []).map(normalize).filter(Boolean).slice(0, 40);
    if (!list.length) return '';
    return API + '/tags.json?' + qs({
      'search[name_comma]': list.join(','),
      limit: list.length,
      only: 'name,post_count'
    });
  }

  /** Danbooru 전체 장수 — 특징 태그의 분모다. */
  function totalUrl() {
    return API + '/counts/posts.json';
  }

  function parseTotal(body) {
    const d = asJson(body);
    const n = d && d.counts ? Number(d.counts.posts) : 0;
    return n > 0 ? n : 0;
  }

  /** parseTags 결과를 {태그: 장수} 로. distinctive() 에 그대로 넣는다. */
  function countMap(tags) {
    const m = Object.create(null);
    (tags || []).forEach(function (t) { if (t && t.name) m[t.name] = t.count || 0; });
    return m;
  }

  /** 사람이 눈으로 볼 주소. 「Danbooru 에서 보기」. */
  function webUrl(name) {
    return API + '/posts?tags=' + encodeURIComponent(normalize(name));
  }

  // ── 응답 해석 ─────────────────────────────────────────────────────────────
  function asJson(body) {
    if (typeof body !== 'string') return body;
    try { return JSON.parse(body); } catch (e) { return null; }
  }

  /** 작가 태그만 남긴다. */
  function parseTags(body) {
    const d = asJson(body);
    if (!Array.isArray(d)) return [];
    return d.filter(function (t) {
      return t && t.name && (t.category === undefined || t.category === CAT.artist);
    }).map(function (t) {
      return {
        name: t.name,
        count: t.post_count || 0,
        deprecated: !!t.is_deprecated
      };
    });
  }

  /**
   * 자동완성에서 **작가만** 골라 낸다.
   * ★`antecedent` 가 있으면 별명으로 찾은 것이다 — 사람에게 「무엇으로 찾혔는지」 보여 준다.
   */
  function parseAutocomplete(body) {
    const d = asJson(body);
    if (!Array.isArray(d)) return [];
    return d.filter(function (r) { return r && r.category === CAT.artist && r.value; })
      .map(function (r) {
        return {
          name: r.value,
          count: r.post_count || 0,
          via: r.antecedent || ''
        };
      });
  }

  /** 별명 목록. 이메일처럼 생긴 것은 뺀다 (Danbooru 에 그대로 실려 있다). */
  function parseArtist(body) {
    const d = asJson(body);
    const a = Array.isArray(d) ? d[0] : d;
    if (!a || !a.name) return null;
    return {
      name: a.name,
      banned: !!a.is_banned,
      deleted: !!a.is_deleted,
      others: (a.other_names || []).filter(function (n) { return n && n.indexOf('@') === -1; })
    };
  }

  // ── 반영율 ────────────────────────────────────────────────────────────────
  /**
   * ★「이 작가 태그가 NAI 에 먹힐까」 를 가늠한다.
   *
   * 정직하게 말하면 이것은 **추정**이다. NAI 가 무엇을 얼마나 배웠는지는 공개되지 않았다.
   * 다만 학습이 Danbooru 를 바탕으로 한 이상 **그림 수가 곧 학습량**이고, 그림 수가 적은
   * 작가는 실제로 잘 안 나온다. 그래서 post_count 를 그대로 눈금으로 쓰되, 「몇 장이라
   * 이 등급」 임을 화면에 같이 적어 사람이 직접 판단할 수 있게 한다.
   *
   * @returns {{level:number, label:string, note:string}}
   */
  function reach(count, opts) {
    const n = Number(count) || 0;
    if ((opts && opts.deprecated) || n <= 0) {
      return { level: 0, label: '없음', note: '이 태그로는 아무것도 안 나옵니다.' };
    }
    if (n < 50) return { level: 1, label: '거의 안 먹음', note: n + '장 — 배울 거리가 없습니다.' };
    if (n < 200) return { level: 2, label: '약함', note: n + '장 — 흐릿하게 섞이는 정도입니다.' };
    if (n < 1000) return { level: 3, label: '보통', note: n + '장 — 화풍이 잡힙니다.' };
    if (n < 5000) return { level: 4, label: '잘 먹음', note: n + '장 — 또렷합니다.' };
    return { level: 5, label: '매우 강함', note: n + '장 — 혼자서도 그림을 끌고 갑니다.' };
  }

  /**
   * ★새 작가 경고. 그림이 아무리 많아도 **최근에 몰려 있으면** 학습 시점 이후라
   *   안 먹을 수 있다. 몇 %가 기준 연도 이전인지 세어 준다.
   *   기준 연도는 못 박지 않는다 — 우리가 NAI 의 학습 시점을 알지 못하기 때문이다.
   */
  function beforeShare(posts, year) {
    const list = Array.isArray(posts) ? posts : [];
    if (!list.length) return null;
    const cut = year || 2024;
    let old = 0;
    list.forEach(function (p) {
      const y = parseInt(String(p.created_at || '').slice(0, 4), 10);
      if (y && y < cut) old++;
    });
    return { year: cut, share: Math.round((old / list.length) * 100), sampled: list.length };
  }

  // ── 작가 통계 ─────────────────────────────────────────────────────────────
  /**
   * 그림 표본에서 그 작가가 **무엇을 어떻게 그리는지** 를 뽑는다.
   * booruatlas 의 작가 패널에서 지도·이웃을 뺀 나머지가 여기서 나온다.
   *
   * @param {Array} posts postsUrl 로 받은 것
   * @returns {object|null}
   */
  function stats(posts) {
    const list = (Array.isArray(posts) ? posts : []).filter(Boolean);
    if (!list.length) return null;

    const rating = {}, years = {}, tags = {}, copy = {};
    let solo = 0, mono = 0, comic = 0, wide = 0;

    list.forEach(function (p) {
      const r = p.rating || '?';
      rating[r] = (rating[r] || 0) + 1;

      const y = String(p.created_at || '').slice(0, 4);
      if (y) years[y] = (years[y] || 0) + 1;

      const g = String(p.tag_string_general || '').split(/\s+/).filter(Boolean);
      g.forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
      if (g.indexOf('solo') !== -1) solo++;
      if (g.indexOf('monochrome') !== -1 || g.indexOf('greyscale') !== -1) mono++;
      if (g.indexOf('comic') !== -1) comic++;

      String(p.tag_string_copyright || '').split(/\s+/).filter(Boolean)
        .forEach(function (c) { copy[c] = (copy[c] || 0) + 1; });

      if (p.image_width && p.image_height && p.image_width > p.image_height) wide++;
    });

    const n = list.length;
    const pct = function (x) { return Math.round((x / n) * 100); };
    const top = function (obj, k) {
      return Object.keys(obj).sort(function (a, b) {
        return obj[b] - obj[a] || (a < b ? -1 : 1);
      }).slice(0, k).map(function (name) {
        return { name: name, count: obj[name], pct: pct(obj[name]) };
      });
    };

    // 연도는 평균으로 한 줄 요약한다 (booruatlas 의 era 와 같은 뜻).
    let sum = 0, cnt = 0;
    Object.keys(years).forEach(function (y) { sum += Number(y) * years[y]; cnt += years[y]; });

    return {
      sampled: n,
      rating: RATINGS.map(function (r) {
        return { key: r, label: RATING_KO[r], count: rating[r] || 0, pct: pct(rating[r] || 0) };
      }).filter(function (r) { return r.count > 0; }),
      years: years,
      era: cnt ? Math.round((sum / cnt) * 10) / 10 : null,
      topTags: top(tags, 12),
      copyright: top(copy, 3),
      solo: pct(solo),
      mono: pct(mono),
      comic: pct(comic),
      landscape: pct(wide)
    };
  }

  /**
   * ★특징 태그 — 「남들보다 N배 자주 그리는 것」.
   *
   * 잦은 태그만 보면 어느 작가나 1girl·solo·long_hair 라 아무 정보가 없다. 그 작가의
   * 비율을 **전체 평균과 견주어** 튀는 것만 남긴다. 전체 평균은 태그의 전역 post_count 를
   * Danbooru 전체 장수로 나눈 것이다.
   *
   * @param {Array} topTags stats().topTags
   * @param {object} globalCounts {태그: 전역 post_count}
   * @param {number} totalPosts Danbooru 전체 장수 (대략)
   */
  function distinctive(topTags, globalCounts, totalPosts) {
    const total = totalPosts || 9000000;
    const g = globalCounts || {};
    return (topTags || []).map(function (t) {
      const base = (g[t.name] || 0) / total;      // 전체에서 이 태그가 나오는 비율
      const mine = t.pct / 100;                   // 이 작가에서 나오는 비율
      const ratio = base > 0 ? (mine / base) : 0;
      return { name: t.name, pct: t.pct, times: Math.round(ratio * 10) / 10 };
    }).filter(function (t) {
      // ★2배 미만은 특징이 아니다. 흔한 태그를 흔하게 그리는 것뿐이다.
      return t.times >= 2;
    }).sort(function (a, b) { return b.times - a.times; });
  }

  // ── 그림 목록 ─────────────────────────────────────────────────────────────
  /**
   * 미리보기로 쓸 것만 남긴다.
   * @param {Array} posts
   * @param {object} o {max}
   */
  function images(posts, o) {
    const max = (o && o.max) || 24;
    return (Array.isArray(posts) ? posts : []).filter(function (p) {
      if (!p || !p.preview_file_url) return false;
      if (NOT_IMAGE.test(p.preview_file_url)) return false;
      // large 가 동영상이면 원본이 동영상이다 — 썸네일이 있어도 뺀다.
      if (p.large_file_url && NOT_IMAGE.test(p.large_file_url)) return false;
      return true;
    }).slice(0, max).map(function (p) {
      return {
        id: p.id,
        rating: p.rating || '?',
        thumb: p.preview_file_url,
        full: p.large_file_url || p.preview_file_url,
        web: API + '/posts/' + p.id
      };
    });
  }

  return {
    API: API,
    CAT: CAT,
    RATINGS: RATINGS,
    RATING_KO: RATING_KO,
    normalize: normalize,
    toPrompt: toPrompt,
    fromPrompt: fromPrompt,
    artistTagsUrl: artistTagsUrl,
    tagUrl: tagUrl,
    autocompleteUrl: autocompleteUrl,
    artistUrl: artistUrl,
    postsUrl: postsUrl,
    tagCountsUrl: tagCountsUrl,
    totalUrl: totalUrl,
    parseTotal: parseTotal,
    countMap: countMap,
    webUrl: webUrl,
    parseTags: parseTags,
    parseAutocomplete: parseAutocomplete,
    parseArtist: parseArtist,
    reach: reach,
    beforeShare: beforeShare,
    stats: stats,
    distinctive: distinctive,
    images: images
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Danbooru;
