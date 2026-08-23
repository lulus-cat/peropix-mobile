// NAI 생성 페이로드 조립 — backend.py 의 call_nai_api() txt2img 경로를 옮긴 것.
//
// ★상수표는 nai-tables.js 에서 온다 (backend.py 에서 자동 생성). 여기에 값을 적지 말 것.
// ★동작이 원본과 같은지는 mobile/tools/verify_payload.js 가 기준 페이로드와 대조한다.
//   로직을 고치면 반드시 그 검증을 다시 돌릴 것.
'use strict';

const T = (typeof NAI_TABLES !== 'undefined') ? NAI_TABLES : require('./nai-tables.js');

// ★플래그를 빼먹지 말 것. `text:` 는 대소문자를 무시하고(사용자가 teXt: 로 적어도 잡힌다),
//   `teXt:` 되읽기는 대소문자를 구분한다(손으로 적은 text: 와 갈라 보려는 것). 둘 다 표에서 온다.
const TEXT_CLAUSE_RE = new RegExp(T.TEXT_CLAUSE_RE, T.TEXT_CLAUSE_FLAGS);
const NAIT_AUTO_RE = new RegExp(T.NAIT.AUTO_RE, T.NAIT.AUTO_RE_FLAGS);
const NAIT_CJK_RE = new RegExp(T.NAIT.CJK_CLASS, 'gu');
const WORDISH_RE = /[\p{L}\p{N}]/u;

// ── 표 조회 ────────────────────────────────────────────────────────────────
function baseModel(m) { return T.BASE_MODEL[m] || m; }
function caps(m) { return T.MODEL_CAPS[baseModel(m)] || T.CAPS_FALLBACK; }

function usesV4Prompt(m) {
  const b = baseModel(m);
  // ★m.includes('diffusion-4') 로 판정하지 말 것 — V5 는 그 문자열이 없는데도 v4_prompt 를 쓴다.
  return b.startsWith('nai-diffusion-4-') || b.startsWith('nai-diffusion-5');
}

function qualityPresets(m) {
  return T.QUALITY_PRESETS[baseModel(m)] || T.QUALITY_PRESETS['nai-diffusion-4-5-full'];
}

function qualityPresetId(m, preset) {
  const ids = qualityPresets(m).map(function (x) { return x[0]; });
  if (ids.indexOf(preset) !== -1) return preset;
  return preset === 'none' ? 'none' : 'standard';
}

function qualitySuffix(m, preset) {
  const pid = qualityPresetId(m, preset === undefined ? 'standard' : preset);
  const hit = qualityPresets(m).find(function (x) { return x[0] === pid; });
  return hit ? hit[1] : '';
}

function ucPresets(m) {
  return T.UC_PRESETS[baseModel(m)] || T.UC_PRESETS['nai-diffusion-4-5-full'];
}

function ucPresetIndex(m, name) {
  const presets = ucPresets(m);
  for (let i = 0; i < presets.length; i++) if (presets[i][1] === name) return i;
  // 이름이 없다 = 다른 모델의 프리셋이다. 카테고리로 대체를 찾는다.
  let srcCat = null;
  const lists = Object.keys(T.UC_PRESETS).map(function (k) { return T.UC_PRESETS[k]; });
  for (const plist of lists) {
    for (const row of plist) if (row[1] === name) { srcCat = row[0]; break; }
    if (srcCat) break;
  }
  const chain = T.UC_CATEGORY_FALLBACK[srcCat || 'none'] || ['none'];
  for (const cat of chain) {
    for (let i = 0; i < presets.length; i++) if (presets[i][0] === cat) return i;
  }
  return presets.length - 1; // 마지막 = none
}

function ucPresetIdOf(m, name) {
  const cat = ucPresets(m)[ucPresetIndex(m, name)][0];
  return T.UC_PRESET_ID[cat] || 'none';
}

function tagHintUc(m, name) {
  return T.TAG_HINT_ID[ucPresets(m)[ucPresetIndex(m, name)][0]];
}

// ── 프롬프트 가공 ──────────────────────────────────────────────────────────
function appendPrompt(prompt, addition) {
  // `text:` 절이 있으면 그 앞에, 없으면 맨 뒤에 붙인다.
  prompt = prompt || '';
  const m = TEXT_CLAUSE_RE.exec(prompt);
  return m ? prompt.slice(0, m.index) + addition + prompt.slice(m.index) : prompt + addition;
}

function resolveUc(model, presetName, prompt, userNegative) {
  const presets = ucPresets(model);
  const idx = ucPresetIndex(model, presetName);
  let text = presets[idx][2];
  const isNone = idx === presets.length - 1;

  // ★nsfw 검사 대상은 퀄리티 태그가 붙은 베이스 프롬프트 하나뿐이다. 단순 부분문자열 매칭.
  if (text && T.NO_NSFW_PREFIX.indexOf(model) === -1
      && (prompt || '').toLowerCase().indexOf('nsfw') === -1) {
    text = 'nsfw, ' + text;
  }
  if (userNegative) {
    if (isNone) return userNegative;
    return text ? (text + ', ' + userNegative) : userNegative;
  }
  return text;
}

// ── 따옴표 → teXt: 자동 조립 ───────────────────────────────────────────────
function naitSplitParts(prompt) {
  const SEP = T.NAIT.SEP;
  const ESC = T.NAIT.ESCAPED_SEP;
  const MAX = T.NAIT.MAX_PARTS;
  const TMP_SEP = T.NAIT.TMP_SEP;
  const TMP_ESC = T.NAIT.TMP_ESC;

  const swapped = (prompt || '').split(ESC)
    .map(function (part, i) { return (i % 2 === 1) ? part.split(SEP).join(TMP_SEP) : part; })
    .join(TMP_ESC);
  const parts = swapped.split(SEP);
  const out = parts.slice(0, MAX - 1);
  // ★조각이 넘치면 잘라 버리지 않고 마지막 조각에 다시 붙인다.
  if (parts.length > MAX - 1) out.push(parts.slice(MAX - 1).join(SEP));
  return out.map(function (p) {
    return p.split(TMP_SEP).join(SEP).split(TMP_ESC).join(ESC);
  });
}

function wordish(ch) { return !!ch && WORDISH_RE.test(ch); }

function naitQuoted(text) {
  // ★`'` 는 앞 글자가 문자·숫자면 여는 따옴표로 안 본다 (don't 의 아포스트로피).
  // ★짝이 없으면 그 문자는 버리고 다음으로 넘어간다.
  text = text || '';
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const close = T.NAIT.QUOTES[text[i]];
    if (close === undefined || (text[i] === "'" && wordish(i ? text[i - 1] : null))) { i++; continue; }
    const apostrophe = (close === "'" || close === '’');
    let j = i + 1;
    while (j < n && (text[j] !== close
                     || (apostrophe && wordish(j + 1 < n ? text[j + 1] : null)))) j++;
    if (j >= n) { i++; continue; }
    const inner = text.slice(i + 1, j).trim();
    if (inner) out.push(inner);
    i = j + 1;
  }
  return out;
}

function naitRows(chars) {
  const cy = function (c) { const v = (c.center || {}).y; return parseFloat(v === undefined ? 0.5 : v); };
  const cx = function (c) { const v = (c.center || {}).x; return parseFloat(v === undefined ? 0.5 : v); };
  const group = function (items) {
    if (items.length <= 1) return [items];
    const span = cy(items[items.length - 1]) - cy(items[0]);
    let cut = 1, widest = -1.0;
    for (let k = 1; k < items.length; k++) {
      const gap = cy(items[k]) - cy(items[k - 1]);
      if (gap > widest) { widest = gap; cut = k; }
    }
    if (span <= T.NAIT.SPAN_MAX && widest <= T.NAIT.GAP_MAX) return [items];
    return group(items.slice(0, cut)).concat(group(items.slice(cut)));
  };
  const out = [];
  const rows = group(chars.slice().sort(function (a, b) { return cy(a) - cy(b); }));
  for (const row of rows) out.push.apply(out, row.slice().sort(function (a, b) { return cx(a) - cx(b); }));
  return out;
}

function naitCollect(base, chars, useCoords) {
  // ★CJK 가 30% 를 넘으면 각 출처의 조각 순서를 뒤집는다 (세로쓰기 순서).
  //   한글 음절은 이 범위에 없다 — 원본과 같게 두어야 한다.
  const live = (chars || []).filter(function (c) { return (c.prompt || '').trim(); });
  const ordered = useCoords ? naitRows(live) : live;
  const groups = [naitQuoted(base)].concat(ordered.map(function (c) { return naitQuoted(c.prompt || ''); }));
  const flat = function (gs) { return gs.reduce(function (a, g) { return a.concat(g); }, []); };
  const joined = flat(groups).join('');
  if (joined) {
    NAIT_CJK_RE.lastIndex = 0;
    const hits = joined.match(NAIT_CJK_RE);
    if ((hits ? hits.length : 0) / joined.length > T.NAIT.CJK_RATIO) {
      groups.forEach(function (g) { g.reverse(); });
    }
  }
  return flat(groups);
}

function naitBuild(prompt, chars, useCoords) {
  prompt = prompt || '';
  const live = (chars || []).filter(function (c) { return (c.prompt || '').trim(); });
  // ★손으로 적은 `text:` 가 베이스나 어느 캐릭터에라도 있으면 아무것도 안 한다.
  if (TEXT_CLAUSE_RE.test(prompt)
      || live.some(function (c) { return TEXT_CLAUSE_RE.test(c.prompt || ''); })) return prompt;
  const parts = naitSplitParts(prompt);
  const found = naitCollect(parts.length ? parts[0] : '', live, useCoords);
  if (!found.length) return prompt;
  const block = T.NAIT.AUTO_TAG + ' ' + found.join('\n\n');
  const head = (parts.length ? parts[0] : '').replace(/[\s,]+$/, '');
  parts[0] = head ? (head + ', ' + block) : block;
  return parts.join(T.NAIT.SEP);
}

// ── 캐릭터 좌표 ────────────────────────────────────────────────────────────
function coordToXy(coord) {
  // 5x5 격자 좌표(a1~e5) → NAI 좌표. 셀 중심이다.
  // ★0/0.25/…/1.0 을 쓰면 가장자리 칸이 프레임 밖으로 밀린다. 공홈 값은 .1/.3/.5/.7/.9 다.
  if (!coord || String(coord).length !== 2) return { x: 0.5, y: 0.5 };
  const col = String(coord)[0].toLowerCase();
  const row = String(coord)[1];
  const COL = { a: 0.1, b: 0.3, c: 0.5, d: 0.7, e: 0.9 };
  const ROW = { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 };
  return {
    x: COL[col] === undefined ? 0.5 : COL[col],
    y: ROW[row] === undefined ? 0.5 : ROW[row]
  };
}

function snapCenter(center) {
  // ★가까운 단계 찾기가 아니다 — 구간을 5등분해 떨어뜨린다.
  //   0.2 는 가까운 쪽으로 하면 0.1 과 동률이지만 공홈 식으로는 0.3 이다.
  const grid = T.CENTER_GRID;
  const q = function (v) {
    let n = parseFloat(v);
    if (isNaN(n)) n = 0.5;
    return grid[Math.min(4, Math.max(0, Math.floor(5 * n)))];
  };
  center = center || {};
  return {
    x: q(center.x === undefined ? 0.5 : center.x),
    y: q(center.y === undefined ? 0.5 : center.y)
  };
}

// ── 해상도 ────────────────────────────────────────────────────────────────
function align64(v) {
  // ★올림이 아니라 가까운 쪽으로 반올림한다. 동률이면 큰 쪽 (800 -> 832).
  //   올림은 없던 유료 재화 소모를 만든다.
  const lo = Math.floor(v / 64) * 64;
  const hi = Math.ceil(v / 64) * 64;
  const r = (v - lo < hi - v) ? lo : hi;
  return r <= 0 ? 64 : r;
}

// ── 본체 ──────────────────────────────────────────────────────────────────
function buildNaiPayload(req) {
  const cap = caps(req.nai_model);

  const ucPresetValue = ucPresetIndex(req.nai_model, req.uc_preset);
  const ucPresetIdValue = ucPresetIdOf(req.nai_model, req.uc_preset);
  const qualityPid = qualityPresetId(
    req.nai_model,
    req.quality_preset || ((req.quality_tags === false) ? 'none' : 'standard')
  );

  const transparentBg = !!req.transparent_bg && !!cap.transparency;
  const isV4 = usesV4Prompt(req.nai_model);
  const sm = (req.smea === 'SMEA' || req.smea === 'SMEA+DYN') && !isV4;
  const smDyn = req.smea === 'SMEA+DYN' && !isV4;

  // ★-1 은 "랜덤 시드" 표식이다 (공홈엔 없는 PeroPix 표식).
  const seed = (req.seed !== undefined && req.seed >= 0)
    ? req.seed
    : Math.floor(Math.random() * (Math.pow(2, 32) - 1));

  const naiSampler = T.SAMPLER_MAP[req.sampler] || req.sampler;
  let naiScheduler = T.SCHEDULER_MAP[req.scheduler] || req.scheduler;

  // Furry Mode: 이미 그 접두로 시작하면 붙이지 않는다.
  let prompt = req.prompt || '';
  if (req.furry_mode
      && !(prompt.indexOf('fur dataset') === 0 || prompt.indexOf('background dataset') === 0)) {
    prompt = 'fur dataset, ' + prompt;
  }

  let negative;
  if (isV4) {
    let qSuffix = qualitySuffix(req.nai_model, qualityPid);
    // ★투명 배경을 켜면 접미사 앞에 이 한 마디가 끼어든다 (프리셋이 none 이어도 붙는다).
    if (transparentBg) qSuffix = ', ' + T.TRANSPARENT_BG_TAG + (qSuffix ? qSuffix : '');
    if (qSuffix) prompt = appendPrompt(prompt, qSuffix);

    // Enhance 문구는 퀄리티 접미사 뒤에 온다.
    if (req.enhance_prompt_add && cap.enhance_prompt_add
        && prompt.indexOf('upscaled, blurry') === -1) {
      prompt = appendPrompt(prompt, T.ENHANCE_PROMPT_ADD);
    }
    negative = resolveUc(req.nai_model, req.uc_preset, prompt, req.negative_prompt || '');
  } else {
    negative = req.negative_prompt || '';
  }

  let width = align64(req.width);
  let height = align64(req.height);
  if (width <= 0) width = 832;
  if (height <= 0) height = 1216;

  // 스케줄러를 고를 수 없는 모델(V5)은 전송 직전 karras 로 덮어쓴다.
  if (!cap.noise_schedule && naiScheduler !== 'karras') naiScheduler = 'karras';

  const params = {
    params_version: 4,
    width: width,
    height: height,
    scale: req.cfg,
    sampler: naiSampler,
    steps: req.steps,
    seed: seed,
    n_samples: 1,
    ucPreset: ucPresetValue,
    ucPresetId: ucPresetIdValue,
    qualityToggle: qualityPid !== 'none',
    qualityPresetId: qualityPid,
    sm: sm,
    sm_dyn: smDyn,
    dynamic_thresholding: false,
    controlnet_strength: 1.0,
    legacy: false,
    add_original_image: true,
    cfg_rescale: req.cfg_rescale === undefined ? 0.0 : req.cfg_rescale,
    noise_schedule: naiScheduler,
    legacy_v3_extend: false,
    negative_prompt: negative,
    prompt: prompt,
    image_format: 'png',
    inpaintImg2ImgStrength: 1,
    legacy_uc: false
  };

  // ★tag_hint_* 는 전역 번호표다. 목록 인덱스로 계산하면 조용히 틀린다.
  params.tag_hint_qt = (T.TAG_HINT_ID[qualityPid] === undefined) ? 0 : T.TAG_HINT_ID[qualityPid];
  const hintUc = tagHintUc(req.nai_model, req.uc_preset);
  if (hintUc !== undefined && hintUc !== null) params.tag_hint_uc_preset = hintUc;

  if (transparentBg) {
    params.tag_hint_transparent_background = true;
    params.straight_alpha = !!req.straight_alpha;
  }

  params.normalize_reference_strength_multiple =
    (req.normalize_vibe_strength === undefined) ? true : !!req.normalize_vibe_strength;

  // V4+ 는 sm/sm_dyn 대신 autoSmea 를 쓴다.
  if (isV4) {
    delete params.sm;
    delete params.sm_dyn;
    params.autoSmea = false;
  }

  // ── 캐릭터 프롬프트 ──────────────────────────────────────────────────────
  // ★공통 프롬프트와는 완전히 별개다. 공통은 params.prompt 로, 캐릭터는 여기로 나간다.
  let charData = [];
  let useCoords = false;

  if (req.character_prompts_with_coords && req.character_prompts_with_coords.length) {
    req.character_prompts_with_coords.forEach(function (cp) {
      charData.push({
        prompt: cp.prompt || '',
        uc: cp.uc || '',
        coord: cp.coord || null,
        center: cp.coord ? coordToXy(cp.coord) : { x: 0.5, y: 0.5 }
      });
      if (cp.coord) useCoords = true;
    });
  } else if (req.character_prompts && req.character_prompts.length) {
    req.character_prompts.forEach(function (cp) {
      charData.push({ prompt: cp || '', uc: '', coord: null, center: { x: 0.5, y: 0.5 } });
    });
  }

  // ★★모델마다 받는 캐릭터 수가 다르다 (V4.5 6명 · V5 32명). 넘기면 400 이 아니라
  //   500 이 온다. 여기서 자른다.
  if (charData.length > cap.max_characters) charData = charData.slice(0, cap.max_characters);

  // ★좌표 스냅은 v4_prompt 쪽 centers 에만 건다 — characterPrompts[].center 는 날것 그대로다.
  //   둘을 같게 맞추지 말 것.
  const centers = charData.map(function (c) {
    return cap.freeform_position ? c.center : snapCenter(c.center);
  });

  // ★따옴표 → teXt: 자동 조립은 맨 마지막이다. 그래서 nsfw 판정도 uc 도 이 문구를 안 본다.
  if (cap.text) {
    const withText = naitBuild(prompt, charData, useCoords);
    if (withText !== prompt) { prompt = withText; params.prompt = prompt; }
  }

  params.use_coords = useCoords;
  params.characterPrompts = charData.length ? charData.map(function (c) {
    return { prompt: c.prompt, uc: c.uc, center: c.center, enabled: true };
  }) : [];
  params.v4_prompt = {
    use_coords: useCoords,
    use_order: true,
    caption: {
      base_caption: prompt,
      char_captions: charData.length ? charData.map(function (c, i) {
        return { char_caption: c.prompt, centers: [centers[i]] };
      }) : []
    }
  };
  params.v4_negative_prompt = {
    legacy_uc: false,
    caption: {
      base_caption: negative,
      char_captions: charData.length ? charData.map(function (c, i) {
        return { char_caption: c.uc, centers: [centers[i]] };
      }) : []
    }
  };

  // Variety+ — 모델별 기준 시그마에 해상도 보정을 곱한다. V5 에는 이 기능이 없다.
  if (req.variety_plus && cap.cfg_delay) {
    const factor = Math.sqrt(Math.floor(width / 8) * Math.floor(height / 8) / 15808);
    params.skip_cfg_above_sigma = cap.cfg_delay_sigma * factor;
  }

  if (naiSampler === 'k_euler_ancestral' && naiScheduler !== 'native') {
    params.deliberate_euler_ancestral_bug = false;
    params.prefer_brownian = true;
  }

  // ── Precise Reference (director_reference_*) ─────────────────────────────
  // ★참조는 개당 5 Anlas 다. 지원하지 않는 모델(V5)에서는 무시되는 게 아니라
  //   보내지 않아야 한다 — 보내면 돈만 나간다.
  const refs = (req.precise_references || []).filter(function (r) { return r && r.image; });
  if (refs.length && cap.char_ref) {
    params.director_reference_images = refs.map(function (r) { return r.image; });
    params.director_reference_information_extracted = refs.map(function () { return 1; });
    params.director_reference_strength_values = refs.map(function (r) {
      return r.strength === undefined ? 1.0 : r.strength;
    });
    params.director_reference_secondary_strength_values = refs.map(function (r) {
      const fid = r.fidelity === undefined ? 1.0 : r.fidelity;
      return Math.round((1.0 - fid) * 100) / 100;
    });
    params.director_reference_descriptions = refs.map(function (r) {
      return {
        caption: { base_caption: r.mode || 'character&style', char_captions: [] },
        legacy_uc: false
      };
    });
  }

  // ── Base Image (img2img — Enhance 가 쓰는 경로) ──────────────────────────
  // ★이미지는 **이미 요청 해상도로 리샘플·평탄화된 것**을 받는다 (base_image_processed).
  //   리샘플 필터가 다르면 초기 latent 가 달라지므로 전처리는 호출부가 책임진다.
  let action = 'generate';
  const baseImg = req.base_image_processed || null;
  if (baseImg) {
    params.image = baseImg;
    params.strength = req.base_strength === undefined ? 0.7 : req.base_strength;
    // ★공홈은 베이스 이미지가 있을 때만 넣고 값은 seed-1 이다. 음수여도 그대로 보낸다.
    params.extra_noise_seed = seed - 1;

    action = 'img2img';
    params.noise = req.base_noise === undefined ? 0.0 : req.base_noise;
    params.image_format = 'png';
    params.inpaintImg2ImgStrength = 1;
    params.color_correct = false;
  }

  return {
    url: 'https://image.novelai.net/ai/generate-image',
    payload: {
      input: prompt,
      model: req.nai_model,
      action: action,
      use_new_shared_trial: true,
      parameters: params
    },
    seed: seed
  };
}

// ── NAI 업스케일 (/ai/upscale) ────────────────────────────────────────────
// ★생성과 별개의 API 다. 창작적 변형 없이 해상도만 4배로 올린다.
//   PeroPix 데스크톱 버전은 이걸 쓰지 않고 로컬 업스케일러를 쓴다 — 폰에는 그게 없으므로 이쪽을 쓴다.
function buildUpscalePayload(imageBase64, width, height, scale) {
  return {
    url: 'https://image.novelai.net/ai/upscale',
    payload: {
      image: imageBase64,
      width: width,
      height: height,
      scale: scale === undefined ? 4 : scale
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildNaiPayload: buildNaiPayload,
    align64: align64,
    resolveUc: resolveUc,
    naitBuild: naitBuild,
    naitQuoted: naitQuoted,
    buildUpscalePayload: buildUpscalePayload,
    ucPresetIndex: ucPresetIndex,
    qualitySuffix: qualitySuffix,
    caps: caps
  };
}
