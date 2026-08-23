// 그림체 테스트용 프롬프트 — 작가 태그만 갈아 끼우며 견주기 위한 **깨끗한 한 세트**.
//
// ★왜 따로 두는가.
//   그림체를 견주려면 **작가 말고는 아무것도 달라지면 안 된다.** 그런데 평소 쓰던 슬롯으로
//   돌리면 베이스·네거티브·인물 프롬프트가 전부 딸려 들어와, 그림이 달라진 것이 작가
//   때문인지 원래 쓰던 프롬프트 때문인지 알 수 없다. 그래서 테스트은 **자기 프롬프트 한 세트**을
//   따로 들고 돈다. 평소 것은 손대지 않고, 테스트이 끝나면 그대로 돌려놓는다.
//
// ★구도를 정해 두는 이유.
//   같은 작가라도 상반신이냐 전신이냐에 따라 인상이 크게 달라진다. 구도를 고정해야 작가
//   사이의 차이만 남는다. 배경이 복잡한 프리셋을 따로 둔 것은, 인물만 잘 그리고 배경은 못 그리는
//   작가가 흔해서다 — 인물 위주로만 테스트하면 그것을 못 걸러낸다.
//
// ★구도 태그는 실제로 살아 있는 것만 쓴다. Danbooru 에서 폐기된 태그(이미지 수 0)는 NAI 도
//   모른다. `detailed_background` 가 그렇게 죽어 있어 구체적인 배경 태그로 바꿔 두었다
//   (2026-08 확인). 기본 캐릭터는 사람이 직접 준 것이라 그대로 쓴다.
'use strict';

const StyleTest = (function () {
  /**
   * 구도 프리셋.
   * @property char  인물을 넣는가 (배경만 보는 프리셋은 false)
   * @property tags  베이스에 붙는 구도 태그
   */
  const PRESETS = [
    { key: 'upper', label: '인물 · 상반신', char: true,
      tags: '1girl, solo, upper body, simple background, white background, looking at viewer' },
    { key: 'cowboy', label: '인물 · 카우보이 샷', char: true,
      tags: '1girl, solo, cowboy shot, simple background, white background, standing' },
    { key: 'closeup', label: '인물 · 얼굴 위주', char: true,
      tags: '1girl, solo, portrait, close-up, simple background, looking at viewer' },
    { key: 'scene', label: '배경만 (복잡한 배경)', char: false,
      tags: 'scenery, no humans, outdoors, city, street, building, tree, sky, cloud, depth of field' },
    { key: 'charSceneUpper', label: '인물 + 복잡한 배경 · 상반신', char: true,
      tags: '1girl, solo, upper body, scenery, outdoors, city, street, building, tree, sky, depth of field' },
    { key: 'charSceneCowboy', label: '인물 + 복잡한 배경 · 카우보이 샷', char: true,
      tags: '1girl, solo, cowboy shot, scenery, outdoors, city, street, building, tree, sky, depth of field' },
    { key: 'custom', label: '직접 적기', char: true, tags: '' }
  ];

  // 기본 테스트 캐릭터. 화면에서 바로 고쳐 쓸 수 있다.
  const DEFAULT_CHAR = [
    'girl, loli, petite, solo',
    'pastel blue hair, light blue hair, medium hair',
    'inward curl, sidelocks, hair between eyes, ahoge',
    'glossy hair, detailed hair, hair strand, side ivory hair ribbon',
    'apricot eyes, orange eyes, pale orange eyes',
    'gradient eyes, detailed eyes, long eyelashes',
    'tareme, thin eyebrows, light blush',
    'oversized cardigan, light blue cardigan, open cardigan',
    'off shoulder, long sleeves, sleeves past wrists',
    'white collared shirt, dress shirt, ivory neck ribbon',
    'ivory pleated skirt, thighs'
  ].join(', ');

  // ★퀄리티 태그만 둔다. 화풍을 건드리는 말(예: 작가 이름·질감 묘사)을 여기 넣으면
  //   작가 태그의 차이를 덮어 버린다.
  const DEFAULT_BASE = 'masterpiece, best quality, very aesthetic, absurdres';

  const DEFAULT_NEG = 'lowres, worst quality, bad anatomy, bad hands, watermark, '
    + 'signature, artist name, jpeg artifacts';

  // ── 테스트에 쓰는 이미지 설정 ─────────────────────────────────────────────
  // ★모델·크기·스텝을 바꾸면 그림체 인상이 통째로 달라진다. 그래서 테스트에서도 이 값들을
  //   골라야 하는데, 대량생성 쪽 값을 그대로 고치면 「테스트 좀 해 봤다가 평소 설정이
  //   바뀌어 있는」 일이 생긴다. 그래서 **테스트은 자기 값을 따로 들고 돈다.**
  // ★비워 두면 대량생성 값을 그대로 쓴다. 전부 채우게 하면 모델이 새로 나올 때마다
  //   테스트 쪽이 옛 모델에 묶인다.
  // ★저장 설정(형식·화질·생성 정보 지우기·자동 저장)과 인핸스 설정은 뺐다. 그림이
  //   달라지는 값이 아니라 뽑은 뒤를 다루는 값이라, 테스트에서 따로 들 이유가 없다.
  // ★배수도 뺐다. 테스트은 조합마다 한 장씩 뽑는 것이 전제다 — 한 조합에 여러 장이 나오면
  //   어느 그림에 매긴 별점인지가 어긋난다.
  const OPT_KEYS = ['nai_model', 'sampler', 'uc_preset', 'quality_preset',
    'width', 'height', 'steps', 'cfg', 'cfg_rescale',
    'variety_plus', 'transparent_bg', 'straight_alpha'];
  const OPT_NUM = { width: 0, height: 0, steps: 0, cfg: 0 };
  // ★cfg_rescale 은 0 이 성한 값이다. 위의 「0 이면 없는 것으로 본다」 에 걸리면 안 된다.
  const OPT_ZERO_OK = { cfg_rescale: 0 };
  const OPT_BOOL = { variety_plus: 0, transparent_bg: 0, straight_alpha: 0 };

  /** 저장해 둔 테스트 설정을 성한 값으로. 모르는 열쇠는 버린다. */
  function opts(raw) {
    const o = raw || {};
    const out = {};
    OPT_KEYS.forEach(function (k) {
      const v = o[k];
      if (v === undefined || v === null || v === '') return;
      if (k in OPT_BOOL) { out[k] = !!v; return; }
      if (k in OPT_ZERO_OK) {
        const z = Number(v);
        if (!isFinite(z) || z < 0) return;
        out[k] = z;
        return;
      }
      if (k in OPT_NUM) {
        const n = Number(v);
        // ★0 이나 음수, 글자가 들어오면 없는 것으로 본다. 그대로 내보내면 생성이 터진다.
        if (!isFinite(n) || n <= 0) return;
        out[k] = n;
        return;
      }
      out[k] = String(v);
    });
    return out;
  }

  /**
   * 대량생성 설정 위에 테스트 설정을 덮어쓴 결과.
   * ★비어 있는 열쇠는 그대로 둔다 — 「안 정했다」 와 「0 으로 정했다」 는 다르다.
   */
  function withOpts(base, o) {
    const out = Object.assign({}, base || {});
    const use = opts(o);
    Object.keys(use).forEach(function (k) { out[k] = use[k]; });
    return out;
  }

  function preset(key) {
    return PRESETS.find(function (p) { return p.key === key; }) || PRESETS[0];
  }

  function clean(text) {
    return String(text || '')
      .split(',')
      .map(function (t) { return t.trim(); })
      .filter(Boolean)
      .join(', ');
  }

  /**
   * 테스트 한 세트의 프롬프트 한 세트을 만든다.
   *
   * @param {object} o
   *   preset   구도 열쇠 ('custom' 이면 comp 를 그대로 쓴다)
   *   comp     직접 적은 구도 (custom 일 때)
   *   char     인물 프롬프트 (빈 값이면 기본 인물)
   *   base     퀄리티 프롬프트 (빈 값이면 기본)
   *   negative 네거티브 (빈 값이면 기본)
   * @returns {{base, negative, character, comp, withChar}}
   */
  function build(o) {
    const opt = o || {};
    const p = preset(opt.preset);
    const comp = clean(p.key === 'custom' ? opt.comp : p.tags);
    const base = clean(opt.base || DEFAULT_BASE);
    // ★퀄리티가 앞, 구도가 뒤. 작가 태그는 슬롯으로 따로 들어가므로 여기에 없다.
    const full = [base, comp].filter(Boolean).join(', ');
    return {
      base: full,
      negative: clean(opt.negative || DEFAULT_NEG),
      // 배경만 보는 프리셋에는 인물을 안 싣는다 — 실으면 사람이 나와 배경을 가린다.
      character: p.char ? clean(opt.char || DEFAULT_CHAR) : '',
      comp: comp,
      withChar: p.char
    };
  }

  // ★예전 버전이 넣어 두었던 기본 캐릭터들. 사람이 고친 적이 없다면 새 기본값으로 갈아
  //   끼워야 한다. 안 그러면 한 번 켠 적 있는 폰에서는 기본값을 바꿔도 옛것이 그대로
  //   남아, 「바꿨다는데 왜 그대로냐」 가 된다.
  const OLD_CHARS = [
    '1girl, loli, medium hair, aqua hair, oversized clothes, open cardigan, '
      + 'collared shirt, skirt, barefoot'
  ];

  /**
   * 저장해 둔 설정을 성한 값으로.
   * ★빈 칸으로 저장해 두었다가 기본값이 통째로 사라지는 일을 막는다.
   */
  function settings(raw) {
    const s = raw || {};
    const key = PRESETS.some(function (p) { return p.key === s.preset; }) ? s.preset : 'upper';
    let char = String(s.char === undefined ? DEFAULT_CHAR : s.char);
    if (OLD_CHARS.indexOf(char.trim()) !== -1) char = DEFAULT_CHAR;
    return {
      preset: key,
      comp: String(s.comp === undefined ? '' : s.comp),
      char: char,
      base: String(s.base === undefined ? DEFAULT_BASE : s.base),
      negative: String(s.negative === undefined ? DEFAULT_NEG : s.negative),
      opts: opts(s.opts)
    };
  }

  return {
    PRESETS: PRESETS,
    DEFAULT_CHAR: DEFAULT_CHAR,
    DEFAULT_BASE: DEFAULT_BASE,
    DEFAULT_NEG: DEFAULT_NEG,
    OPT_KEYS: OPT_KEYS,
    preset: preset,
    build: build,
    opts: opts,
    withOpts: withOpts,
    settings: settings
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = StyleTest;
