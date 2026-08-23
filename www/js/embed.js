// 특징 벡터 뽑기 — 일관성 검사의 앞단.
//
// ★뽑기만 한다. 「고르다·튄다」 판정은 consistency.js 가 맡는다. 뽑는 곳은 둘인데
//   (폰 / 수신함) 잣대가 하나여야, 서버를 껐다 켰다 해도 점수가 안 흔들린다.
//
// 두 갈래 —
//   폰에서 (device) : 모델을 한 번 받아 두고 오프라인으로 돌린다. 서버가 필요 없다.
//                     대신 처음 한 번 수십 MB 를 받아야 하고, 오래된 폰에서는 느리다.
//   수신함에서 (server) : PC·VPS 가 대신 잰다. 폰은 아무것도 안 받는다. 대신 그 서버에
//                     score.py 와 pip 몇 개가 깔려 있어야 한다.
//
// ★이 파일에서 실제로 모델을 부르는 것은 fromDevice 하나뿐이다. 나머지(어느 갈래로 갈지,
//   몇 장씩 끊을지, 결과를 어떻게 맞춰 놓을지)는 전부 순수 함수라 Node 에서 검사한다.
'use strict';

const Embed = (function () {
  // transformers.js 를 CDN 에서 그때 가져온다. 앱에 넣어 두지 않는 이유는, 검사를 안 쓰는
  // 사람에게까지 앱 용량을 지우지 않으려는 것이다.
  const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

  // 무엇을 재느냐에 따라 모델이 다르다.
  //  그림체 — CLIP. 화풍·색감·선에 민감하다.
  //  인물   — DINOv2. 배경과 포즈가 달라도 같은 사람인지에 강하다.
  // pool — 모델이 벡터 하나를 바로 주는지, 조각마다 주는지가 다르다.
  //  CLIP  은 image_embeds 로 이미 한 줄(512칸)을 준다.
  //  DINOv2 는 그냥 부르면 조각(patch)마다 한 줄씩, 257줄이 나온다. pooler 를 써야 한다.
  const MODELS = {
    style: { id: 'Xenova/clip-vit-base-patch32', mb: 90, what: '그림체', pool: false },
    identity: { id: 'Xenova/dinov2-small', mb: 45, what: '인물', pool: true }
  };

  function kindOf(kind) { return kind === 'identity' ? 'identity' : 'style'; }
  function model(kind) { return MODELS[kindOf(kind)]; }

  /** 이 갈래를 쓰려면 얼마나 받아야 하는지 — 사람에게 물어볼 때 쓴다. */
  function sizeText(kinds) {
    const list = (kinds && kinds.length ? kinds : ['style', 'identity'])
      .map(kindOf)
      .filter(function (k, i, a) { return a.indexOf(k) === i; });
    const mb = list.reduce(function (s, k) { return s + MODELS[k].mb; }, 0);
    return list.map(function (k) { return MODELS[k].what; }).join('·') + ' 검사용 약 ' + mb + 'MB';
  }

  // 수신함은 한 번에 32장까지 받는다. 그보다 많으면 끊어 보낸다.
  const SERVER_CHUNK = 32;
  // 폰은 한 번에 조금씩. 많이 물리면 화면이 멈춘 것처럼 보인다.
  const DEVICE_CHUNK = 4;

  function chunk(list, n) {
    const out = [];
    const size = n > 0 ? n : 1;
    for (let i = 0; i < (list || []).length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  /**
   * 어느 갈래로 갈지 정한다.
   * ★여기서 미리 막아야 한다. 켜 두기만 하고 실제로는 못 재는 상태로 두면, 결과 화면이
   *   늘 「잴 것이 없음」 이라 사람은 기능이 고장 난 줄 안다.
   * @param {object} o {mode, dest, ready} mode: 'off'|'device'|'server'
   * @returns {{how:'off'|'device'|'server', why:string}}
   */
  function pick(o) {
    const opt = o || {};
    const mode = opt.mode;
    if (mode !== 'device' && mode !== 'server') return { how: 'off', why: '검사를 꺼 두었습니다.' };
    if (mode === 'server') {
      if (!opt.dest) return { how: 'off', why: '검사를 맡길 수신함이 없습니다.' };
      if (opt.dest.score === false) return { how: 'off', why: '이 수신함은 검사를 끄셨습니다.' };
      if (opt.dest.canScore === false) {
        return { how: 'off', why: '이 수신함에 검사 기능(score.py)이 없습니다.' };
      }
      return { how: 'server', why: '' };
    }
    if (opt.ready === false) return { how: 'off', why: '아직 모델을 안 받았습니다.' };
    return { how: 'device', why: '' };
  }

  /**
   * 넣은 순서와 개수를 그대로 맞춰 돌려준다.
   * ★서버나 모델이 개수를 덜 주는 일이 있다. 그대로 두면 3번 그림의 점수가 5번 그림에
   *   붙는다 — 멀쩡한 것을 불량으로 찍는데 아무도 못 알아챈다.
   */
  function align(vectors, want) {
    const out = [];
    for (let i = 0; i < want; i++) {
      const v = (vectors || [])[i];
      out.push(Array.isArray(v) ? v : []);
    }
    return out;
  }

  /** 잰 것이 몇 장이나 되는지 — 너무 적으면 판정을 띄우지 않는다. */
  function usable(vectors) {
    return (vectors || []).filter(function (v) { return v && v.length; }).length;
  }

  /**
   * 모델이 돌려준 것을 벡터 한 줄로 편다.
   * ★모델마다 모양이 다르다. [1, 512] 로 오는 것도 있고 [1, 257, 384] — 조각마다 한 줄 —
   *   로 오는 것도 있다. 뒤엣것을 그대로 쓰면 98,000칸짜리가 되어 느린 데다, 그림 내용이
   *   화풍보다 크게 먹혀 엉뚱한 답이 나온다. 조각으로 오면 여기서 평균을 낸다.
   * @param {object} t {data, dims}
   */
  function flatten(t) {
    if (!t) return [];
    const data = Array.prototype.slice.call(t.data || t || []);
    const dims = t.dims || [];
    if (dims.length < 3) return data;
    const tokens = dims[dims.length - 2];
    const width = dims[dims.length - 1];
    if (!(tokens > 0) || !(width > 0) || data.length < tokens * width) return data;
    const out = new Array(width).fill(0);
    for (let i = 0; i < tokens; i++) {
      for (let k = 0; k < width; k++) out[k] += data[i * width + k];
    }
    return out.map(function (x) { return x / tokens; });
  }

  // ── 수신함에서 재기 ──────────────────────────────────────────────────
  /**
   * @param {object} api RemoteStore
   * @param {object} dest {url, token}
   * @param {string} kind
   * @param {Array<{path?:string, b64?:string}>} items
   */
  async function fromServer(api, dest, kind, items, onStep) {
    const list = items || [];
    const out = [];
    const groups = chunk(list, SERVER_CHUNK);
    for (let g = 0; g < groups.length; g++) {
      const part = groups[g];
      // ★이미 올려 둔 그림은 경로만 보낸다. 올린 것을 다시 올려보내는 것은 낭비다.
      //   한 묶음 안에 경로짜리와 본문짜리가 섞이면 순서가 어긋나므로, 섞인 묶음은
      //   전부 본문으로 보낸다.
      const allPaths = part.every(function (x) { return x && x.path; });
      const arg = allPaths
        ? { paths: part.map(function (x) { return x.path; }) }
        : { data: part.map(function (x) { return x.b64 || ''; }) };
      const got = await api.score(dest, kind, arg);
      align(got, part.length).forEach(function (v) { out.push(v); });
      if (onStep) onStep(out.length, list.length);
    }
    return align(out, list.length);
  }

  // ── 폰에서 재기 ──────────────────────────────────────────────────────
  const loaded = {};

  /**
   * 받는 진행을 한 줄로 정리한다.
   *
   * ★transformers.js 는 파일마다 따로 알려 준다 (모델 · 토크나이저 · 설정…). 그걸
   *   그대로 띄우면 퍼센트가 0 → 100 → 0 → 100 으로 왔다 갔다 해 사람이 못 믿는다.
   *   받은 바이트를 다 더해서 **전체 기준 한 개의 퍼센트**로 만든다.
   * @param {object} bag 파일별 진행을 모아 두는 곳 (호출 쪽이 들고 있는다)
   * @param {object} ev  transformers.js 가 준 것
   * @returns {{percent:number, loaded:number, total:number, file:string}}
   */
  function tally(bag, ev) {
    const e = ev || {};
    if (e.file && (e.total || e.loaded)) {
      bag[e.file] = { loaded: Number(e.loaded) || 0, total: Number(e.total) || 0 };
    }
    let loaded = 0;
    let total = 0;
    Object.keys(bag).forEach(function (k) {
      loaded += bag[k].loaded;
      total += bag[k].total;
    });
    // ★총량을 모르면 퍼센트를 지어내지 않는다. -1 로 「아직 모른다」 를 알린다.
    const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : -1;
    return { percent: percent, loaded: loaded, total: total, file: String(e.file || '') };
  }

  /** 바이트를 사람이 읽는 크기로. */
  function mb(bytes) {
    const n = Number(bytes) || 0;
    return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + 'MB';
  }

  /** 모델을 한 번만 받아 두고 재사용한다. 매번 받으면 통신비가 계속 나간다. */
  async function pipe(kind, onProgress) {
    const k = kindOf(kind);
    if (loaded[k]) return loaded[k];
    const lib = await import(/* webpackIgnore: true */ CDN);
    loaded[k] = await lib.pipeline('image-feature-extraction', model(k).id, {
      dtype: 'q8',                       // 8비트로 줄인 것. 폰에서 이만한 것이 현실적이다.
      progress_callback: onProgress || undefined
    });
    return loaded[k];
  }

  /** 이미 받아 둔 것이 있는가 (다시 물어보지 않으려고). */
  function have(kind) { return !!loaded[kindOf(kind)]; }

  async function fromDevice(kind, items, onStep, onProgress) {
    const list = items || [];
    const run = await pipe(kind, onProgress);
    const out = [];
    const groups = chunk(list, DEVICE_CHUNK);
    for (let g = 0; g < groups.length; g++) {
      for (let i = 0; i < groups[g].length; i++) {
        const src = groups[g][i];
        try {
          const r = await run(src.url || src.b64, { pool: model(kind).pool });
          out.push(flatten(r));
        } catch (e) {
          // 한 장이 안 읽힌다고 전체를 버리지 않는다. 그 자리만 비운다.
          out.push([]);
        }
      }
      if (onStep) onStep(out.length, list.length);
      // ★한 숨 쉬어 준다. 안 그러면 화면이 통째로 멈춰 「앱이 죽었다」 로 보인다.
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    return align(out, list.length);
  }

  return {
    MODELS: MODELS,
    CDN: CDN,
    SERVER_CHUNK: SERVER_CHUNK,
    DEVICE_CHUNK: DEVICE_CHUNK,
    model: model,
    sizeText: sizeText,
    chunk: chunk,
    pick: pick,
    align: align,
    usable: usable,
    flatten: flatten,
    tally: tally,
    mb: mb,
    have: have,
    fromServer: fromServer,
    fromDevice: fromDevice
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Embed;
