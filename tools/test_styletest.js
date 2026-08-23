// 그림체 시험 프롬프트 검사 — 구도 판, 기본 인물, 프롬프트 조립.
//
// ★여기가 틀리면 시험이 시험이 아니게 된다. 인물 프롬프트가 배경 판에 섞여 들어가거나
//   품질 태그에 화풍을 건드리는 말이 끼면, 그림이 달라진 것이 작가 때문인지 알 수 없다.
// 사용: node tools/test_styletest.js
'use strict';

const S = require('../www/js/styletest.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 구도 판 ────────────────────────────────────────────────────────────
check('판이 일곱 가지', S.PRESETS.length === 7, String(S.PRESETS.length));
check('열쇠가 겹치지 않는다',
  new Set(S.PRESETS.map(function (p) { return p.key; })).size === S.PRESETS.length);
check('모두 이름이 있다', S.PRESETS.every(function (p) { return !!p.label; }));
check('모르는 열쇠를 주면 첫 판으로', S.preset('없는것').key === 'upper');

const scene = S.preset('scene');
check('★배경만 보는 판에는 인물을 안 싣는다', scene.char === false);
check('배경 판에 no humans 가 들어간다', /no humans/.test(scene.tags), scene.tags);
check('인물 판에는 1girl 이 들어간다', /1girl/.test(S.preset('upper').tags));

// ── 2. 기본 인물 (자캐) ───────────────────────────────────────────────────
const c = S.DEFAULT_CHAR;
[['여캐', 'girl'], ['로리', 'loli'], ['작은 키', 'petite'], ['혼자', 'solo'],
 ['하늘색 머리', 'pastel blue hair'], ['중단발', 'medium hair'], ['안말음', 'inward curl'],
 ['아호게', 'ahoge'], ['머리 리본', 'side ivory hair ribbon'],
 ['살구색 눈', 'apricot eyes'], ['처진 눈', 'tareme'],
 ['오버핏 가디건', 'oversized cardigan'], ['벌어진 가디건', 'open cardigan'],
 ['손 덮는 소매', 'sleeves past wrists'], ['셔츠', 'white collared shirt'],
 ['목 리본', 'ivory neck ribbon'], ['주름치마', 'ivory pleated skirt']]
  .forEach(function (pair) {
    check('기본 캐릭터에 ' + pair[0] + ' 가 있다', c.indexOf(pair[1]) !== -1, c);
  });
check('★줄바꿈으로 갈렸던 ivory 와 pleated skirt 가 한 태그로 붙는다',
  c.indexOf('ivory pleated skirt') !== -1 && !/,\s*ivory\s*,/.test(c), c);
check('쉼표가 겹치거나 끝에 남지 않는다',
  c.indexOf(',,') === -1 && !/,\s*$/.test(c), c.slice(-40));
check('★버려진 배경 태그를 안 쓴다 (detailed background 는 장수 0)',
  S.PRESETS.every(function (p) { return p.tags.indexOf('detailed background') === -1; }));

// ── 3. 품질 프롬프트 ──────────────────────────────────────────────────────
check('★품질 태그만 둔다 (화풍을 건드리면 작가 차이가 덮인다)',
  !/artist|painterly|watercolor|sketch/i.test(S.DEFAULT_BASE), S.DEFAULT_BASE);
check('네거티브 기본값이 있다', S.DEFAULT_NEG.length > 10);

// ── 4. 조립 ───────────────────────────────────────────────────────────────
let b = S.build({ preset: 'upper' });
check('품질이 앞, 구도가 뒤', b.base.indexOf('masterpiece') === 0, b.base);
check('구도가 붙는다', /upper body/.test(b.base), b.base);
check('★작가 태그는 여기 없다 (슬롯으로 따로 들어간다)',
  !/wlop|artist:/.test(b.base));
check('캐릭터가 실린다', b.character.indexOf('pastel blue hair') !== -1 && b.withChar === true);
check('네거티브가 온다', b.negative === S.DEFAULT_NEG);

b = S.build({ preset: 'scene' });
check('★배경 판에는 인물 프롬프트가 비어 있다 (실으면 사람이 나와 배경을 가린다)',
  b.character === '' && b.withChar === false, JSON.stringify(b.character));
check('배경 판에도 품질은 붙는다', /masterpiece/.test(b.base));

b = S.build({ preset: 'custom', comp: ' 2girls ,  kiss ,, ' });
check('직접 적은 구도를 쓴다', /2girls, kiss/.test(b.base), b.base);
check('★쉼표와 공백을 다듬는다 (빈 칸이 남으면 프롬프트에 ,, 가 들어간다)',
  b.base.indexOf(',,') === -1 && !/,\s*$/.test(b.base), b.base);

b = S.build({ preset: 'upper', char: '1boy, short hair', base: 'best quality',
  negative: 'blurry' });
check('인물을 갈아 끼울 수 있다', b.character === '1boy, short hair');
check('품질을 갈아 끼울 수 있다', b.base.indexOf('best quality') === 0, b.base);
check('네거티브를 갈아 끼울 수 있다', b.negative === 'blurry');
check('빈 값을 주면 기본값으로',
  S.build({ preset: 'upper', char: '', base: '' }).character === S.DEFAULT_CHAR);

// ── 5. 저장한 설정 되읽기 ─────────────────────────────────────────────────
let st = S.settings(null);
check('처음에는 상반신 판', st.preset === 'upper');
check('처음에는 기본 인물', st.char === S.DEFAULT_CHAR);
check('모르는 판이 저장돼 있으면 첫 판으로', S.settings({ preset: '엉뚱' }).preset === 'upper');
check('★빈 글로 저장해 둔 것은 빈 글로 지킨다 (기본값이 되살아나면 지운 뜻이 없어진다)',
  S.settings({ char: '' }).char === '', JSON.stringify(S.settings({ char: '' }).char));
// ★한 번 켠 적 있는 폰에는 옛 기본 캐릭터가 저장돼 있다. 손대지 않은 것이면 새것으로.
check('★옛 기본 캐릭터가 저장돼 있으면 새 기본값으로 갈아 끼운다',
  S.settings({ char: '1girl, loli, medium hair, aqua hair, oversized clothes, '
    + 'open cardigan, collared shirt, skirt, barefoot' }).char === S.DEFAULT_CHAR);
check('★사람이 고쳐 둔 것은 건드리지 않는다',
  S.settings({ char: '1boy, my own' }).char === '1boy, my own');
check('저장한 것을 그대로 돌려준다',
  S.settings({ preset: 'scene', comp: 'x', char: 'y', base: 'z', negative: 'w' }).comp === 'x');

// ── 6. 시험용 이미지 설정 ─────────────────────────────────────────────────
// ★모델·크기·스텝을 바꾸면 그림체 인상이 통째로 달라진다. 그런데 대량생성 값을 직접
//   고치면 「시험 좀 해 봤다가 평소 설정이 바뀌어 있는」 일이 생긴다. 따로 들고 돈다.
check('처음에는 아무것도 안 정한 상태', Object.keys(S.settings(null).opts).length === 0);
check('모르는 열쇠는 버린다',
  S.opts({ nai_model: 'x', 없는것: 1 }).없는것 === undefined);
check('숫자로 바꿔 담는다', S.opts({ steps: '28' }).steps === 28);
check('★0 이나 음수는 없는 것으로 본다 (그대로 내보내면 생성이 터진다)',
  S.opts({ steps: 0, width: -1 }).steps === undefined
  && S.opts({ width: -1 }).width === undefined);
check('★글자가 들어와도 안 터진다', S.opts({ steps: '스물여덟' }).steps === undefined);
check('빈 값은 「안 정했다」 로 둔다',
  S.opts({ nai_model: '', steps: '' }).nai_model === undefined);
check('켜고 끄는 것은 참·거짓으로', S.opts({ variety_plus: 1 }).variety_plus === true);

const base = { nai_model: 'A', width: 832, height: 1216, steps: 28, cfg: 5, sampler: 's' };
let w = S.withOpts(base, { steps: 50 });
check('정한 것만 덮어쓴다', w.steps === 50 && w.width === 832 && w.nai_model === 'A');
check('★안 정한 것은 대량생성 값 그대로 (안 그러면 모델이 새로 나와도 옛것에 묶인다)',
  S.withOpts(base, {}).nai_model === 'A' && S.withOpts(base, null).steps === 28);
check('원본을 건드리지 않는다', base.steps === 28);
check('★거짓으로 정한 것도 덮어쓴다 (「끄기」 가 「안 정했다」 가 되면 못 끈다)',
  S.withOpts({ variety_plus: true }, { variety_plus: false }).variety_plus === false);
check('저장했다 되읽어도 남는다',
  S.settings({ opts: { steps: 40, nai_model: 'B' } }).opts.steps === 40);

// 남은 생성 옵션까지 (저장 설정·인핸스·배수는 일부러 뺐다)
['nai_model', 'sampler', 'uc_preset', 'quality_preset', 'width', 'height', 'steps',
 'cfg', 'cfg_rescale', 'variety_plus', 'transparent_bg', 'straight_alpha']
  .forEach(function (k) {
    check(k + ' 을 시험에서 정할 수 있다', S.OPT_KEYS.indexOf(k) !== -1);
  });
['save_format', 'jpg_quality', 'strip_metadata', 'auto_save', 'enhance_replace_original',
 'count_per_slot']
  .forEach(function (k) {
    check('★' + k + ' 는 안 든다 (그림이 달라지는 값이 아니다)', S.OPT_KEYS.indexOf(k) === -1);
  });
check('★가이던스 리스케일은 0 이 성한 값이다 (0 을 버리면 0 으로 못 돌린다)',
  S.opts({ cfg_rescale: 0 }).cfg_rescale === 0);
check('음수 리스케일은 버린다', S.opts({ cfg_rescale: -0.5 }).cfg_rescale === undefined);
check('투명 배경은 참·거짓으로', S.opts({ transparent_bg: 'yes' }).transparent_bg === true);
check('★끔으로 정한 것도 살아남는다 (「끄기」 가 「안 정했다」 가 되면 못 끈다)',
  S.opts({ transparent_bg: false }).transparent_bg === false);
check('UC·퀄리티는 글로 담는다',
  S.opts({ uc_preset: 'Heavy', quality_preset: 'light' }).uc_preset === 'Heavy');

const total = pass + fails.length;
console.log('그림체 테스트 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
