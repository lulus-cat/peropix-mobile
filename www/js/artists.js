// 작가 서랍 — 엄선한 작가 태그를 모아 두고, 갈래로 나누고, 섞어서 프롬프트로 굽는다.
//
// ★가중치를 어떻게 다룰지가 이 파일의 전부다.
//
//   작가 20명을 on/off 만 해도 2^20 이고, 거기에 세기 5단계를 곱하면 5^20 이다.
//   탐색으로는 못 푼다. 그래서 **탐색하지 않는다** —
//     · 누가 범인인지는 bisect.js 가 on/off 로만 찾고 (세기는 전부 1.0 으로 묶는다),
//     · 세기는 범인이 정해진 **뒤에** 한 명씩 1차원으로 훑는다.
//   여기서는 그 결과를 담아 두고 굽는 일만 한다.
//
// ★세기 범위는 0.6~1.4 로 자른다. 1.5 를 넘으면 그 작가가 그림을 통째로 잡아먹고,
//   0.5 아래면 없는 것과 다르지 않다. 그 밖은 훑을 값어치가 없어서 아예 못 쓰게 막는다.
//
// ★여러 명을 섞을 때는 **합을 작가 수로 고정**한다. 다섯 명한테 전부 1.2 를 주면
//   프롬프트가 작가 쪽으로 쏠려 구도·표정·의상 태그가 밀려난다. 한 명을 올리면 나머지가
//   조금씩 내려가게 해서, 「이 작가를 더 세게」 가 다른 것을 망가뜨리지 않게 한다.
//   끄고 절대값으로 쓸 수도 있다.
'use strict';

const Artists = (function () {
  // 기본 범위. ★사람마다 쓰는 폭이 달라서 **설정으로 바꿀 수 있다** — 여기는 기본값일 뿐이다.
  //   기본을 0.6~1.4 로 둔 이유: 1.5 를 넘으면 그 작가가 그림을 잡아먹고, 0.5 아래면 없는
  //   것과 다르지 않다. 더 넓게 쓰고 싶으면 설정에서 넓히면 된다.
  const RANGE = { min: 0.6, max: 1.4, step: 0.05 };

  // 한 번에 다룰 작가 수 상한. ★20을 넘기면 이분 탐색이 6라운드로 늘고, 무엇보다
  //   한 그림에 작가 20명이 들어가면 화풍이 뭉개져 무엇이 무엇인지 볼 수 없게 된다.
  const MAX_TAGS = 20;

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** 설정을 성한 값으로 다듬는다. 뒤집힌 범위나 0 간격이 들어와도 안 터지게. */
  function range(cfg) {
    const c = cfg || {};
    let min = Number(c.min);
    let max = Number(c.max);
    let step = Number(c.step);
    if (!isFinite(min) || min <= 0) min = RANGE.min;
    if (!isFinite(max) || max <= 0) max = RANGE.max;
    if (min > max) { const t = min; min = max; max = t; }   // 뒤집어 넣어도 받아 준다
    if (!isFinite(step) || step <= 0) step = RANGE.step;
    // ★간격이 범위보다 크면 눈금이 하나도 안 생긴다.
    if (step > (max - min) && max > min) step = max - min;
    return { min: round2(min), max: round2(max), step: round2(step) };
  }

  /** 범위 밖을 잘라 내고 눈금에 맞춘다. */
  function clampWeight(w, cfg) {
    const r = range(cfg);
    let n = Number(w);
    if (!isFinite(n)) n = 1;
    // ★눈금은 최소값을 기준으로 센다. 0 에서 세면 최소가 0.65 인데 눈금이 0.6·0.7 로
    //   떨어져, 슬라이더가 끝까지 가도 최소값에 닿지 않는다.
    n = r.min + Math.round((n - r.min) / r.step) * r.step;
    return round2(Math.min(r.max, Math.max(r.min, n)));
  }

  /**
   * 세기를 훑을 눈금을 만든다.
   * ★1.0 이 범위 안에 있으면 반드시 넣는다 — 원래와 견줄 기준이 없으면 무엇이 나아졌는지
   *   판단할 수 없다.
   */
  function scanSteps(cfg, count) {
    const r = range(cfg);
    const n = Math.max(2, Math.min(count || 5, 9));
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(clampWeight(r.min + ((r.max - r.min) * i) / (n - 1), cfg));
    }
    if (r.min <= 1 && 1 <= r.max) out.push(clampWeight(1, cfg));
    const seen = Object.create(null);
    return out.filter(function (w) {
      if (seen[w]) return false;
      seen[w] = true;
      return true;
    }).sort(function (a, b) { return a - b; });
  }

  // ── 서랍 (엄선 · 갈래 · 즐겨찾기) ────────────────────────────────────────
  /**
   * 저장할 모양으로 다듬는다.
   * @param {object|string} raw
   * @returns {{tag, count, cats:string[], note:string, fav:boolean, at:number}|null}
   */
  function entry(raw) {
    const o = (typeof raw === 'string') ? { tag: raw } : (raw || {});
    const tag = String(o.tag || o.name || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!tag) return null;
    return {
      tag: tag,
      count: Number(o.count) || 0,
      // ★갈래(cats)는 사람이 붙인 것, 장르(genres)는 앱이 그림에서 매긴 것이다.
      //   섞어 두면 다시 잴 때 사람이 붙인 것까지 날아간다.
      cats: Array.isArray(o.cats) ? o.cats.filter(Boolean).map(String) : [],
      genres: Array.isArray(o.genres) ? o.genres.filter(Boolean).map(String) : [],
      note: String(o.note || ''),
      fav: !!o.fav,
      at: Number(o.at) || 0
    };
  }

  function indexOf(list, tag) {
    const want = entry(tag) ? entry(tag).tag : '';
    return (list || []).findIndex(function (e) { return e && e.tag === want; });
  }

  function has(list, tag) {
    return indexOf(list, tag) !== -1;
  }

  /** 넣는다. 이미 있으면 아는 것만 갱신하고 갈래·메모는 지키지 않는다. */
  function add(list, raw, now) {
    const e = entry(raw);
    if (!e) return list || [];
    const out = (list || []).slice();
    const i = indexOf(out, e.tag);
    if (i === -1) {
      e.at = now || 0;
      out.push(e);
      return out;
    }
    // ★이미 있는 것을 다시 넣으면 장수만 새로 고친다. 사람이 붙여 둔 갈래와 메모를
    //   덮어쓰면 애써 정리한 것이 날아간다.
    const old = out[i];
    out[i] = {
      tag: old.tag,
      count: e.count || old.count,
      cats: old.cats,
      // ★장르는 새로 잰 것이 있으면 갈아 끼운다 (그림이 늘면 달라질 수 있다).
      //   못 쟀으면 알던 것을 지키고, 갈래·메모는 언제나 사람 것을 지킨다.
      genres: e.genres.length ? e.genres : (old.genres || []),
      note: old.note,
      fav: old.fav,
      at: old.at
    };
    return out;
  }

  function remove(list, tag) {
    const i = indexOf(list, tag);
    if (i === -1) return (list || []).slice();
    const out = (list || []).slice();
    out.splice(i, 1);
    return out;
  }

  /** 즐겨찾기 토글. */
  function toggleFav(list, tag) {
    const i = indexOf(list, tag);
    if (i === -1) return (list || []).slice();
    const out = (list || []).slice();
    out[i] = Object.assign({}, out[i], { fav: !out[i].fav });
    return out;
  }

  /** 갈래를 붙이거나 뗀다. */
  function toggleCat(list, tag, cat) {
    const i = indexOf(list, tag);
    const name = String(cat || '').trim();
    if (i === -1 || !name) return (list || []).slice();
    const out = (list || []).slice();
    const cats = out[i].cats.slice();
    const at = cats.indexOf(name);
    if (at === -1) cats.push(name); else cats.splice(at, 1);
    out[i] = Object.assign({}, out[i], { cats: cats });
    return out;
  }

  /**
   * 라벨을 붙이거나 뗀다 — 어느 쪽인지 **직접 정해서**.
   * ★토글과 따로 둔 이유. 「보이는 작가 전부에 붙이기」 같은 것을 토글로 하면 이미 붙어
   *   있던 사람은 거꾸로 떨어져 나간다. 여럿을 한꺼번에 다룰 때는 토글이 아니라 지정이다.
   */
  function setCat(list, tags, cat, on) {
    const name = String(cat || '').trim();
    if (!name) return (list || []).slice();
    const want = [].concat(tags || []);
    return (list || []).map(function (e) {
      if (want.indexOf(e.tag) === -1) return e;
      const has = (e.cats || []).indexOf(name) !== -1;
      if (has === !!on) return e;
      const cats = on
        ? (e.cats || []).concat([name])
        : (e.cats || []).filter(function (c) { return c !== name; });
      return Object.assign({}, e, { cats: cats });
    });
  }

  /**
   * 라벨 이름을 바꾼다.
   * ★새 이름이 이미 붙어 있는 사람에게 두 번 들어가지 않게 한다 — 같은 라벨이 두 개
   *   보이면 세는 것도 거르는 것도 어긋난다.
   */
  function renameCat(list, from, to) {
    const a = String(from || '').trim();
    const b = String(to || '').trim();
    if (!a || !b || a === b) return (list || []).slice();
    return (list || []).map(function (e) {
      if ((e.cats || []).indexOf(a) === -1) return e;
      const cats = e.cats.filter(function (c) { return c !== a && c !== b; }).concat([b]);
      return Object.assign({}, e, { cats: cats });
    });
  }

  /** 라벨을 통째로 없앤다 (작가는 그대로 남는다). */
  function removeCat(list, cat) {
    const name = String(cat || '').trim();
    if (!name) return (list || []).slice();
    return (list || []).map(function (e) {
      if ((e.cats || []).indexOf(name) === -1) return e;
      return Object.assign({}, e, {
        cats: e.cats.filter(function (c) { return c !== name; })
      });
    });
  }

  /** 쓰이고 있는 갈래를 많은 순으로. 화면의 갈래 단추를 이걸로 그린다. */
  function categories(list) {
    const n = Object.create(null);
    (list || []).forEach(function (e) {
      (e.cats || []).forEach(function (c) { n[c] = (n[c] || 0) + 1; });
    });
    return Object.keys(n).sort(function (a, b) {
      return n[b] - n[a] || (a < b ? -1 : 1);
    }).map(function (c) { return { name: c, count: n[c] }; });
  }

  /**
   * 걸러 보기.
   * @param {object} o {cat, fav, q} — 갈래 / 즐겨찾기만 / 이름 검색
   */
  function filter(list, o) {
    const f = o || {};
    const q = String(f.q || '').trim().toLowerCase();
    return (list || []).filter(function (e) {
      if (f.fav && !e.fav) return false;
      // ★'__none__' 을 갈래 이름보다 **먼저** 본다. 뒤에 두면 위의 줄이 먼저 걸러 내
      //   아무것도 안 남는다 ('__none__' 이라는 갈래를 가진 사람은 없으니까).
      if (f.cat === '__none__') {
        if ((e.cats || []).length) return false;
      } else if (f.cat && (e.cats || []).indexOf(f.cat) === -1) {
        return false;
      }
      if (q && e.tag.indexOf(q) === -1 && String(e.note || '').toLowerCase().indexOf(q) === -1) {
        return false;
      }
      return true;
    });
  }

  // ── 조합 ─────────────────────────────────────────────────────────────────
  /**
   * 태그 목록을 조합으로. 처음에는 모두 1.0 이다.
   * @param {Array<string|object>} tags
   */
  function mix(tags, cfg) {
    const seen = Object.create(null);
    const out = [];
    (tags || []).forEach(function (t) {
      const e = entry(t);
      if (!e || seen[e.tag]) return;      // ★같은 작가를 두 번 넣으면 세기가 두 배가 된다
      seen[e.tag] = true;
      // ★상한을 넘으면 조용히 버린다. 그림 하나에 작가 20명이 넘게 들어가면 화풍이
      //   뭉개져 무엇이 무엇인지 볼 수 없다 (화면에서 왜 잘렸는지 알려 준다).
      if (out.length >= MAX_TAGS) return;
      const w = (t && t.weight !== undefined) ? clampWeight(t.weight, cfg) : clampWeight(1, cfg);
      out.push({ tag: e.tag, weight: w, on: (t && t.on === false) ? false : true });
    });
    return out;
  }

  function setWeight(m, tag, w, cfg) {
    return (m || []).map(function (x) {
      return x.tag === tag ? { tag: x.tag, weight: clampWeight(w, cfg), on: x.on } : x;
    });
  }

  function toggleOn(m, tag) {
    return (m || []).map(function (x) {
      return x.tag === tag ? { tag: x.tag, weight: x.weight, on: !x.on } : x;
    });
  }

  /**
   * ★합을 켠 작가 수로 맞춘다.
   *
   * 예) 세 명에서 한 명만 1.4 로 올리면 합이 3.4 가 된다. 3 으로 되돌리면
   *     1.24 / 0.88 / 0.88 이 되어, 그 한 명이 **상대적으로** 세지되 프롬프트 전체가
   *     작가 쪽으로 쏠리지는 않는다.
   *
   * 범위 밖으로 나간 값은 잘라 내므로 합이 정확히 맞지는 않는다. 그래도 된다 —
   * 여기서 원하는 것은 산수의 정확함이 아니라 「하나를 올리면 나머지가 내려간다」 는 성질이다.
   */
  function normalize(m, cfg) {
    const on = (m || []).filter(function (x) { return x.on; });
    // ★두 명 미만이면 그대로 둔다. 나눠 가질 상대가 없는데 합을 맞추면 무조건 1.0 이
    //   되어, 슬라이더를 움직여도 아무 일이 없는 것처럼 보인다 — 값을 고쳐 주는 것이
    //   아니라 사람의 입력을 지우는 셈이다.
    if (on.length < 2) return (m || []).slice();
    const sum = on.reduce(function (a, x) { return a + x.weight; }, 0);
    if (sum <= 0) return (m || []).slice();
    const scale = on.length / sum;
    return (m || []).map(function (x) {
      return x.on
        ? { tag: x.tag, weight: clampWeight(x.weight * scale, cfg), on: true }
        : { tag: x.tag, weight: x.weight, on: false };
    });
  }

  /**
   * ★켠 작가마다 세기를 **무작위로** 준다 — 조합 시험의 씨앗이다.
   *
   * 손으로 슬라이더를 다섯 번 움직여 한 조합을 만드는 것보다, 무작위로 여러 벌을 뽑아
   * 그림으로 견주는 편이 빠르다. 어느 배합이 좋은지는 눈으로만 알 수 있기 때문이다.
   *
   * ★난수를 넣어 줄 수 있게 해 두었다. 안에서 Math.random 을 쓰면 검사에서 「정말 범위
   *   안에서만 나오는가」 를 확인할 방법이 없다.
   */
  function randomize(m, cfg, rand) {
    const r = range(cfg);
    const rnd = rand || Math.random;
    const steps = Math.max(1, Math.round((r.max - r.min) / r.step));
    return (m || []).map(function (x) {
      if (!x.on) return x;
      const w = r.min + Math.floor(rnd() * (steps + 1)) * r.step;
      return { tag: x.tag, weight: clampWeight(w, cfg), on: true };
    });
  }

  /**
   * 무작위 조합을 n 벌 만든다. 그대로 슬롯이 되어 한 번에 뽑힌다.
   * ★같은 배합이 두 번 나오면 Anlas 를 헛되이 쓴다 — 겹치면 다시 뽑는다.
   */
  function combos(m, n, cfg, rand) {
    const want = Math.max(1, Math.min(n || 5, 30));
    const seen = Object.create(null);
    const out = [];
    // ★넉넉히 돌되 끝은 있다. 작가가 하나뿐이고 눈금이 두 칸이면 서로 다른 배합이
    //   두 가지뿐이라, 못 채우는 것이 정상이다 — 그때는 만든 만큼만 돌려준다.
    for (let i = 0; i < want * 20 && out.length < want; i++) {
      const c = randomize(m, cfg, rand);
      const key = c.filter(function (x) { return x.on; })
        .map(function (x) { return x.tag + ':' + x.weight; }).join('|');
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(c);
    }
    return out;
  }

  /**
   * 매긴 점수를 반영해 다음 조합을 만든다.
   *
   * 작가마다 **점수로 가중 평균한 세기**를 구해 그 근처에서 다시 뽑는다. 5점을 준 조합의
   * 값이 가장 크게 당겨지고, 1점을 준 값은 거의 안 당겨진다.
   *
   * ★작가를 켜고 끄는 것은 여기서 하지 않는다. 조합 모드는 같은 작가에 세기만 바꿔 가며
   *   뽑으므로 모든 작가가 모든 조합에 들어 있고, 그러면 작가별 평균 점수가 전부 같아져
   *   신호가 되지 않는다. 실제로 움직이는 것은 세기뿐이라 세기만 다룬다. 필요 없는 작가는
   *   세기가 최소값으로 내려가면서 자연히 빠진다.
   *
   * @param {Array} rated [{mix, score}] 점수는 1~5
   */
  function refine(rated, n, cfg, rand) {
    const r = range(cfg);
    const rnd = rand || Math.random;
    const list = (rated || []).filter(function (x) {
      return x && x.mix && x.mix.length && (x.score || 0) > 0;
    });
    if (!list.length) return [];

    // 점수로 가중 평균한 세기
    const num = Object.create(null), den = Object.create(null);
    list.forEach(function (x) {
      x.mix.forEach(function (m) {
        num[m.tag] = (num[m.tag] || 0) + x.score * m.weight;
        den[m.tag] = (den[m.tag] || 0) + x.score;
      });
    });

    const shape = list[0].mix;
    const want = Math.max(1, Math.min(n || 5, 30));
    const seen = Object.create(null);
    const out = [];
    for (let i = 0; i < want * 20 && out.length < want; i++) {
      const c = shape.map(function (m) {
        const aim = den[m.tag] ? (num[m.tag] / den[m.tag]) : m.weight;
        const step = (Math.floor(rnd() * 3) - 1) * r.step;   // 한 칸 위·아래로 흔든다
        return { tag: m.tag, weight: clampWeight(aim + step, cfg), on: m.on };
      });
      const key = c.filter(function (x) { return x.on; })
        .map(function (x) { return x.tag + ':' + x.weight; }).join('|');
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(c);
    }
    return out;
  }

  // ── 프롬프트로 굽기 ───────────────────────────────────────────────────────
  /**
   * NAI 프롬프트 조각으로.
   *
   * ★세기 문법은 `숫자::태그::` 다. 기준 페이로드에 `0::ai-generated::` 가 그대로
   *   들어 있는 것으로 확인했다. 1.0 은 문법을 붙이지 않는다 — 붙여도 뜻은 같은데
   *   프롬프트만 지저분해지고, 나중에 사람이 읽기 어렵다.
   * ★언더스코어는 띄어쓰기로 바꾸되 괄호는 그대로 둔다 (NAI 는 {} 와 [] 로 세기를
   *   조절하므로 () 는 글자다 — `[[horror (theme)]]` 가 기준 페이로드에 있다).
   *
   * @param {Array} m mix()
   * @param {object} o {normalize:boolean}
   */
  function bake(m, o) {
    const opts = o || {};
    const list = opts.normalize ? normalize(m, opts.cfg) : (m || []);
    return list.filter(function (x) { return x.on; }).map(function (x) {
      const name = String(x.tag).replace(/_/g, ' ').trim();
      const w = round2(x.weight);
      return (w === 1) ? name : (w + '::' + name + '::');
    }).join(', ');
  }

  /** 켜져 있는 작가 수 — 화면에 「3명 섞는 중」 을 적으려고. */
  function activeCount(m) {
    return (m || []).filter(function (x) { return x.on; }).length;
  }

  /**
   * 세기 훑기 — 한 명만 놓고 여러 세기로 뽑아 볼 목록을 만든다.
   * ★범인이 정해진 **뒤에만** 쓴다. 여러 명을 동시에 훑으면 가짓수가 곱해진다.
   *
   * @param {Array} m mix()
   * @param {string} tag 훑을 작가
   * @param {Array<number>} steps 안 주면 SCAN
   * @returns {Array<{weight:number, mix:Array, prompt:string}>}
   */
  function scan(m, tag, steps, o) {
    const cfg = (o && o.cfg) || null;
    const use = (steps && steps.length ? steps : scanSteps(cfg))
      .map(function (w) { return clampWeight(w, cfg); });
    const seen = Object.create(null);
    return use.filter(function (w) {
      if (seen[w]) return false;          // 잘린 뒤 겹치는 값이 생길 수 있다
      seen[w] = true;
      return true;
    }).map(function (w) {
      const next = setWeight(m, tag, w, cfg);
      return { weight: w, mix: next, prompt: bake(next, o) };
    });
  }

  return {
    RANGE: RANGE,
    MAX_TAGS: MAX_TAGS,
    range: range,
    scanSteps: scanSteps,
    clampWeight: clampWeight,
    entry: entry,
    has: has,
    indexOf: indexOf,
    add: add,
    remove: remove,
    toggleFav: toggleFav,
    toggleCat: toggleCat,
    setCat: setCat,
    renameCat: renameCat,
    removeCat: removeCat,
    categories: categories,
    filter: filter,
    mix: mix,
    setWeight: setWeight,
    toggleOn: toggleOn,
    normalize: normalize,
    randomize: randomize,
    combos: combos,
    refine: refine,
    bake: bake,
    activeCount: activeCount,
    scan: scan
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Artists;
