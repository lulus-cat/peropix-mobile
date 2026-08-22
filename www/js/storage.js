// 설정 저장 — API 키와 생성 옵션.
//
// ★키는 앱에 박아 넣지 않는다. 첫 실행 때 사용자가 넣고, 설정에서 언제든 바꾼다.
//   APK 를 남에게 주더라도 키가 같이 나가지 않는다.
// ★안드로이드에서는 Capacitor Preferences(네이티브 저장소)를, PC 브라우저 미리보기에서는
//   localStorage 를 쓴다. 같은 API 로 감싸 두어 화면 코드가 둘을 구별하지 않게 한다.
'use strict';

const Store = (function () {
  const KEY_TOKEN = 'nai_token';
  const KEY_OPTS = 'gen_options';

  function nativePrefs() {
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.Preferences) ? C.Plugins.Preferences : null;
  }

  async function getRaw(key) {
    const p = nativePrefs();
    if (p) {
      const r = await p.get({ key: key });
      return r && r.value !== undefined ? r.value : null;
    }
    return window.localStorage.getItem(key);
  }

  async function setRaw(key, value) {
    const p = nativePrefs();
    if (p) return p.set({ key: key, value: value });
    window.localStorage.setItem(key, value);
  }

  async function removeRaw(key) {
    const p = nativePrefs();
    if (p) return p.remove({ key: key });
    window.localStorage.removeItem(key);
  }

  // ── API 키 ───────────────────────────────────────────────────────────────
  async function getToken() {
    return (await getRaw(KEY_TOKEN)) || '';
  }

  async function setToken(token) {
    await setRaw(KEY_TOKEN, (token || '').trim());
  }

  async function clearToken() {
    await removeRaw(KEY_TOKEN);
  }

  async function hasToken() {
    return !!(await getToken());
  }

  /**
   * 저장 전 형식 검사. backend.py 의 설정 저장 경로와 같은 규칙이다.
   * 통신 없이 확인 가능한 것만 본다 — 실제 유효성은 checkSubscription() 이 확인한다.
   * @returns {string|null} 문제가 있으면 사람이 읽을 메시지, 없으면 null
   */
  function validateTokenFormat(token) {
    token = (token || '').trim();
    if (!token) return 'API 키를 입력해주세요.';
    if (/\s/.test(token)) return 'API 키에 공백이나 줄바꿈이 섞여 있습니다. 다시 복사해주세요.';
    // eslint-disable-next-line no-control-regex
    if (!/^[\x00-\x7F]*$/.test(token)) return 'API 키에 한글 등 ASCII 가 아닌 글자가 섞여 있습니다.';
    if (token.indexOf('pst-') !== 0) return 'NovelAI 키는 보통 "pst-" 로 시작합니다. 키를 다시 확인해주세요.';
    return null;
  }

  // ── 생성 옵션 ────────────────────────────────────────────────────────────
  const DEFAULT_OPTIONS = {
    nai_model: 'nai-diffusion-4-5-full',
    uc_preset: 'Heavy',
    quality_preset: 'standard',
    negative_prompt: '',
    width: 832,
    height: 1216,
    steps: 28,
    cfg: 5.0,
    cfg_rescale: 0.0,
    sampler: 'euler_ancestral',
    scheduler: 'karras',
    seed: -1,
    variety_plus: false,
    // ★생성 즉시 기기에 저장할지. 끄면 뷰어에서 골라 저장한다 (마음에 드는 것만 남길 때).
    auto_save: true,
    furry_mode: false,
    // 투명 배경 — transparency 능력이 있는 모델(V5)에서만 실제로 걸린다.
    transparent_bg: false,
    straight_alpha: false,
    // 저장 형식. png 는 재인코딩 없이 NAI 원본 바이트를 그대로 쓴다.
    save_format: 'png',
    jpg_quality: 95,
    // 메타데이터를 지우고 저장할지 (공유용). 끄면 생성 정보가 그림에 남는다.
    strip_metadata: false,
    // 한 배치가 끝나면 알림을 띄울지.
    notify_on_complete: true,
    // ★슬롯 하나당 몇 장을 뽑을지. 2 이상이면 그만큼 사이클이 돈다.
    //   같은 프롬프트라도 시드가 달라 매번 다른 그림이 나오고, 그중에서 골라 쓴다.
    count_per_slot: 1,
    // 인핸스가 성공하면 원본을 지울지. 최종본만 남기고 싶을 때 켠다.
    enhance_replace_original: false,
    // ★한 명 모드 — 켠 인물을 한 명씩 보내고 인물 수만큼 바퀴를 더 돈다
    //   (인물 × 슬롯 × 배수). 인물이 많고 슬롯이 적을 때 인물을 켰다 껐다 하며
    //   여러 번 돌리던 왕복을 없앤다. 저장 경로에는 인물 폴더가 한 겹 끼어든다.
    one_char_mode: false
  };

  async function getOptions() {
    const raw = await getRaw(KEY_OPTS);
    if (!raw) return Object.assign({}, DEFAULT_OPTIONS);
    try {
      return Object.assign({}, DEFAULT_OPTIONS, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULT_OPTIONS);
    }
  }

  async function setOptions(opts) {
    await setRaw(KEY_OPTS, JSON.stringify(opts || {}));
  }

  // ── 저장 위치 (폰 · PC · VPS) ────────────────────────────────────────────
  // 대상: { id, name, url, token }
  // ★'device' 는 예약 id 다 — 폰 자체를 뜻하고 목록에 저장하지 않는다.
  const KEY_DESTS = 'destinations';
  const KEY_ACTIVE_DEST = 'active_dest';
  const KEY_NAMING = 'naming_template';
  const KEY_PERSONA = 'persona';

  const DEVICE_ID = 'device';
  const DEFAULT_TEMPLATE = '{persona}/{label}.png';

  async function getDestinations() {
    const raw = await getRaw(KEY_DESTS);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setDestinations(list) {
    await setRaw(KEY_DESTS, JSON.stringify(list || []));
  }

  async function getActiveDest() {
    return (await getRaw(KEY_ACTIVE_DEST)) || DEVICE_ID;
  }

  async function setActiveDest(id) {
    await setRaw(KEY_ACTIVE_DEST, id || DEVICE_ID);
  }

  async function getNamingTemplate() {
    return (await getRaw(KEY_NAMING)) || DEFAULT_TEMPLATE;
  }

  async function setNamingTemplate(t) {
    await setRaw(KEY_NAMING, (t || '').trim() || DEFAULT_TEMPLATE);
  }

  async function getPersona() {
    return (await getRaw(KEY_PERSONA)) || '';
  }

  async function setPersona(p) {
    await setRaw(KEY_PERSONA, p || '');
  }

  /** 주소·토큰 형식 검사. 통신 없이 알 수 있는 것만 본다. */
  function validateDestination(d) {
    if (!d || !(d.name || '').trim()) return '이름을 지어주세요 (예: 집 PC, VPS).';
    const url = (d.url || '').trim();
    if (!url) return '주소를 넣어주세요 (예: 192.168.0.5:8770).';
    if (/\s/.test(url)) return '주소에 공백이 있습니다.';
    if (!(d.token || '').trim()) return '토큰을 넣어주세요.';
    if ((d.token || '').trim().length < 16) return '토큰이 너무 짧습니다 (16자 이상).';
    return null;
  }

  // ── 캐릭터 프롬프트 ──────────────────────────────────────────────────────
  // ★생성 슬롯과 다른 축이다. 항목: { prompt, uc, coord, skipSlotPrompt }
  const KEY_CHARS = 'character_prompts';
  const KEY_SLOT_TARGET = 'slot_prompt_target';

  async function getCharacters() {
    const raw = await getRaw(KEY_CHARS);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setCharacters(list) {
    await setRaw(KEY_CHARS, JSON.stringify(list || []));
  }

  /** 슬롯 프롬프트를 'base'(공통) 와 'char'(캐릭터) 중 어디에 붙일지.
   *  ★데스크톱판 기본값이 'char' 다 — 여기서 다르면 같은 설정인데 다른 그림이 나온다. */
  async function getSlotTarget() {
    const v = await getRaw(KEY_SLOT_TARGET);
    return (v === 'base' || v === 'char') ? v : 'char';
  }

  async function setSlotTarget(t) {
    await setRaw(KEY_SLOT_TARGET, (t === 'base') ? 'base' : 'char');
  }

  // ── Precise Reference ────────────────────────────────────────────────────
  // 항목: { name, image(base64 png), mode, strength, fidelity }
  // ★이미지를 통째로 들고 있으므로 넣기 전에 긴 변 1024 로 줄인다.
  //   원본을 그대로 저장하면 설정 저장소가 몇 MB 로 불어 앱이 느려진다.
  const KEY_REFS = 'precise_references';

  async function getReferences() {
    const raw = await getRaw(KEY_REFS);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setReferences(list) {
    await setRaw(KEY_REFS, JSON.stringify(list || []));
  }

  // ── 원격 작업 ────────────────────────────────────────────────────────────
  // 어느 수신함에서 「이거 뽑으세요」 를 받아 올지, 받으면 바로 돌릴지.
  // ★자동 실행은 묻지 않고 Anlas 를 쓴다. 그래서 기본값은 꺼짐이다.
  const KEY_JOBS_SOURCE = 'jobs_source';   // 'dest' | 'github'
  const KEY_JOBS_DEST = 'jobs_dest';
  const KEY_JOBS_AUTO = 'jobs_auto';

  async function getJobsSource() {
    return (await getRaw(KEY_JOBS_SOURCE)) === 'github' ? 'github' : 'dest';
  }

  async function setJobsSource(v) {
    await setRaw(KEY_JOBS_SOURCE, v === 'github' ? 'github' : 'dest');
  }

  async function getJobsDest() {
    return (await getRaw(KEY_JOBS_DEST)) || '';
  }

  async function setJobsDest(id) {
    await setRaw(KEY_JOBS_DEST, id || '');
  }

  async function getJobsAuto() {
    return (await getRaw(KEY_JOBS_AUTO)) === '1';
  }

  async function setJobsAuto(on) {
    await setRaw(KEY_JOBS_AUTO, on ? '1' : '0');
  }

  // ── GitHub 지시함 ────────────────────────────────────────────────────────
  // { repo, branch, token } · 그리고 이미 실행한 작업 id 목록 (경로@SHA).
  // ★앱은 저장소에 쓰지 않는다. 무엇을 했는지는 폰이 기억한다 — 지시 파일을 지우지 않아도
  //   같은 작업이 다시 돌지 않게 하려는 것이다.
  const KEY_GH = 'github_inbox';
  const KEY_GH_DONE = 'github_done';

  async function getGithub() {
    const raw = await getRaw(KEY_GH);
    const base = { repo: '', branch: 'main', token: '' };
    if (!raw) return base;
    try {
      return Object.assign(base, JSON.parse(raw) || {});
    } catch (e) {
      return base;
    }
  }

  async function setGithub(cfg) {
    await setRaw(KEY_GH, JSON.stringify(cfg || {}));
  }

  async function getGithubDone() {
    const raw = await getRaw(KEY_GH_DONE);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setGithubDone(list) {
    await setRaw(KEY_GH_DONE, JSON.stringify(list || []));
  }

  // ── 즐겨찾기 폴더 ────────────────────────────────────────────────────────
  // 항목: { destId, path, label }
  const KEY_FAVS = 'folder_favorites';

  async function getFavorites() {
    const raw = await getRaw(KEY_FAVS);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setFavorites(list) {
    await setRaw(KEY_FAVS, JSON.stringify(list || []));
  }

  // ── 와일드카드 ───────────────────────────────────────────────────────────
  const KEY_WILDCARDS = 'wildcards_doc';

  async function getWildcardDoc() {
    const v = await getRaw(KEY_WILDCARDS);
    return v === null || v === undefined ? '' : v;
  }

  async function setWildcardDoc(text) {
    await setRaw(KEY_WILDCARDS, text || '');
  }

  // ── 작가·퀄리티 태그 모음 ────────────────────────────────────────────────
  // ★프리셋(설정 전체)과 별개다. 태그 줄만 갈아 끼우고 싶을 때가 훨씬 잦다.
  //   항목: { id, name, text }
  const KEY_TAGSETS = 'tagsets';

  async function getTagsets() {
    const raw = await getRaw(KEY_TAGSETS);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setTagsets(list) {
    await setRaw(KEY_TAGSETS, JSON.stringify(list || []));
  }

  // ── 프리셋 ───────────────────────────────────────────────────────────────
  // 항목: { id, name, savedAt, data:{ options, persona, basePrompt, characters,
  //                                   slots, slotTarget, namingTemplate } }
  // ★참조 이미지는 넣지 않는다 — 프리셋 하나가 몇 MB 가 되어 저장소를 먹는다.
  const KEY_PRESETS = 'presets';

  async function getPresets() {
    const raw = await getRaw(KEY_PRESETS);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setPresets(list) {
    await setRaw(KEY_PRESETS, JSON.stringify(list || []));
  }

  // ── 슬롯 ─────────────────────────────────────────────────────────────────
  const KEY_SLOTS = 'slots';
  const KEY_BASE = 'base_prompt';

  async function getSlots() {
    const raw = await getRaw(KEY_SLOTS);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  async function setSlots(slots) {
    await setRaw(KEY_SLOTS, JSON.stringify(slots || []));
  }

  async function getBasePrompt() {
    return (await getRaw(KEY_BASE)) || '';
  }

  async function setBasePrompt(text) {
    await setRaw(KEY_BASE, text || '');
  }

  return {
    getWildcardDoc: getWildcardDoc,
    setWildcardDoc: setWildcardDoc,
    getTagsets: getTagsets,
    setTagsets: setTagsets,
    getPresets: getPresets,
    setPresets: setPresets,
    getReferences: getReferences,
    setReferences: setReferences,
    getFavorites: getFavorites,
    setFavorites: setFavorites,
    getGithub: getGithub,
    setGithub: setGithub,
    getGithubDone: getGithubDone,
    setGithubDone: setGithubDone,
    getJobsDest: getJobsDest,
    setJobsDest: setJobsDest,
    getJobsAuto: getJobsAuto,
    setJobsAuto: setJobsAuto,
    getJobsSource: getJobsSource,
    setJobsSource: setJobsSource,
    getCharacters: getCharacters,
    setCharacters: setCharacters,
    getSlotTarget: getSlotTarget,
    setSlotTarget: setSlotTarget,
    DEVICE_ID: DEVICE_ID,
    DEFAULT_TEMPLATE: DEFAULT_TEMPLATE,
    getDestinations: getDestinations,
    setDestinations: setDestinations,
    getActiveDest: getActiveDest,
    setActiveDest: setActiveDest,
    getNamingTemplate: getNamingTemplate,
    setNamingTemplate: setNamingTemplate,
    getPersona: getPersona,
    setPersona: setPersona,
    validateDestination: validateDestination,
    getSlots: getSlots,
    setSlots: setSlots,
    getBasePrompt: getBasePrompt,
    setBasePrompt: setBasePrompt,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    hasToken: hasToken,
    validateTokenFormat: validateTokenFormat,
    getOptions: getOptions,
    setOptions: setOptions,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Store;
