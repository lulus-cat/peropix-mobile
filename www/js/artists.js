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
  const W_MIN = 0.6;
  const W_MAX = 1.4;
  const W_STEP = 0.05;

  // 세기를 훑을 때 쓰는 기본 눈금. ★1.0 을 가운데 두어 원래와 견줄 수 있게 한다.
  const SCAN = [0.7, 0.85, 1.0, 1.15, 1.3];

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** 범위 밖을 잘라 낸다. 눈금(0.05)에도 맞춘다. */
  function clampWeight(w) {
    let n = Number(w);
    if (!isFinite(n)) n = 1;
    n = Math.round(n / W_STEP) * W_STEP;
    return round2(Math.min(W_MAX, Math.max(W_MIN, n)));
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
      cats: Array.isArray(o.cats) ? o.cats.filter(Boolean).map(String) : [],
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
  function mix(tags) {
    const seen = Object.create(null);
    const out = [];
    (tags || []).forEach(function (t) {
      const e = entry(t);
      if (!e || seen[e.tag]) return;      // ★같은 작가를 두 번 넣으면 세기가 두 배가 된다
      seen[e.tag] = true;
      const w = (t && t.weight !== undefined) ? clampWeight(t.weight) : 1;
      out.push({ tag: e.tag, weight: w, on: (t && t.on === false) ? false : true });
    });
    return out;
  }

  function setWeight(m, tag, w) {
    return (m || []).map(function (x) {
      return x.tag === tag ? { tag: x.tag, weight: clampWeight(w), on: x.on } : x;
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
  function normalize(m) {
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
        ? { tag: x.tag, weight: clampWeight(x.weight * scale), on: true }
        : { tag: x.tag, weight: x.weight, on: false };
    });
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
    const list = opts.normalize ? normalize(m) : (m || []);
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
    const use = (steps && steps.length ? steps : SCAN).map(clampWeight);
    const seen = Object.create(null);
    return use.filter(function (w) {
      if (seen[w]) return false;          // 잘린 뒤 겹치는 값이 생길 수 있다
      seen[w] = true;
      return true;
    }).map(function (w) {
      const next = setWeight(m, tag, w);
      return { weight: w, mix: next, prompt: bake(next, o) };
    });
  }

  return {
    W_MIN: W_MIN,
    W_MAX: W_MAX,
    W_STEP: W_STEP,
    SCAN: SCAN,
    clampWeight: clampWeight,
    entry: entry,
    has: has,
    indexOf: indexOf,
    add: add,
    remove: remove,
    toggleFav: toggleFav,
    toggleCat: toggleCat,
    categories: categories,
    filter: filter,
    mix: mix,
    setWeight: setWeight,
    toggleOn: toggleOn,
    normalize: normalize,
    bake: bake,
    activeCount: activeCount,
    scan: scan
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Artists;
