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

const total = pass + fails.length;
console.log('그림체 시험 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
