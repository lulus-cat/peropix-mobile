// 특징 벡터 뽑기 검사 — 어느 갈래로 갈지, 몇 장씩 끊을지, 순서가 안 어긋나는지.
//
// ★여기가 틀리면 점수가 엉뚱한 그림에 붙는다. 3번 그림의 점수가 5번에 붙어도 화면은
//   멀쩡해 보이므로 아무도 못 알아챈다. 그래서 「개수와 순서」 를 제일 세게 본다.
// 사용: node tools/test_embed.js
'use strict';

const E = require('../www/js/embed.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

// ── 1. 모델 고르기 ────────────────────────────────────────────────────────
check('그림체와 인물은 다른 모델을 쓴다', E.model('style').id !== E.model('identity').id);
check('모르는 것은 그림체로 본다', E.model('엉뚱').id === E.model('style').id);
check('받을 크기를 알려 준다', /MB/.test(E.sizeText(['style'])), E.sizeText(['style']));
check('둘 다 쓰면 합쳐서 알려 준다',
  E.sizeText(['style', 'identity']).indexOf(String(E.MODELS.style.mb + E.MODELS.identity.mb)) >= 0,
  E.sizeText(['style', 'identity']));
check('★같은 것을 두 번 세지 않는다',
  E.sizeText(['style', 'style']) === E.sizeText(['style']), E.sizeText(['style', 'style']));

// ── 2. 어느 갈래로 갈지 ───────────────────────────────────────────────────
check('꺼 두면 안 잰다', E.pick({ mode: 'off' }).how === 'off');
check('아무것도 안 정했으면 안 잰다', E.pick({}).how === 'off' && E.pick(null).how === 'off');
check('폰으로 재기', E.pick({ mode: 'device', ready: true }).how === 'device');
check('★모델을 아직 안 받았으면 안 잰다 (재는 척하면 안 된다)',
  E.pick({ mode: 'device', ready: false }).how === 'off');
check('수신함으로 재기',
  E.pick({ mode: 'server', dest: { canScore: true, score: true } }).how === 'server');
check('★수신함에 검사 기능이 없으면 안 잰다',
  E.pick({ mode: 'server', dest: { canScore: false } }).how === 'off');
check('★수신함 검사를 꺼 두었으면 안 잰다',
  E.pick({ mode: 'server', dest: { canScore: true, score: false } }).how === 'off');
check('수신함이 아예 없으면 안 잰다', E.pick({ mode: 'server' }).how === 'off');
check('★못 재는 이유를 남긴다 (조용히 꺼져 있으면 고장으로 보인다)',
  E.pick({ mode: 'server', dest: { canScore: false } }).why.length > 0
  && E.pick({ mode: 'device', ready: false }).why.length > 0);
check('잴 수 있으면 이유가 없다', E.pick({ mode: 'device', ready: true }).why === '');
// 아직 물어보기 전(undefined)은 막지 않는다 — 물어보고 나서 정하면 된다.
check('아직 안 물어본 수신함은 일단 보내 본다',
  E.pick({ mode: 'server', dest: {} }).how === 'server');

// ── 3. 끊어 보내기 ────────────────────────────────────────────────────────
const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
check('넷씩 끊는다', JSON.stringify(E.chunk(ten, 4))
  === JSON.stringify([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]));
check('★한 장도 안 빠뜨린다',
  E.chunk(ten, 3).reduce(function (s, g) { return s + g.length; }, 0) === 10);
check('빈 목록', E.chunk([], 4).length === 0 && E.chunk(null, 4).length === 0);
check('0 으로 끊자고 해도 안 멈춘다', E.chunk(ten, 0).length === 10);
check('수신함 상한은 서버와 같다 (32)', E.SERVER_CHUNK === 32);

// ── 4. 개수 맞추기 ────────────────────────────────────────────────────────
check('★모자라면 빈 자리로 채운다 (점수가 밀려 붙으면 안 된다)',
  JSON.stringify(E.align([[1], [2]], 4)) === JSON.stringify([[1], [2], [], []]));
check('★넘치면 잘라 낸다', E.align([[1], [2], [3]], 2).length === 2);
check('벡터가 아닌 것이 섞여도 빈 자리', JSON.stringify(E.align([null, 'x', [1]], 3))
  === JSON.stringify([[], [], [1]]));
check('빈 것도 안 터진다', E.align(null, 2).length === 2);

check('잰 장수를 센다', E.usable([[1], [], [2], []]) === 2);
check('아무것도 못 쟀으면 0', E.usable([[], []]) === 0 && E.usable(null) === 0);

// ── 4-2. 모델이 준 것을 한 줄로 펴기 ──────────────────────────────────────
// ★모양이 모델마다 다르다. [1,512] 로 오는 것도 있고 [1,257,384] — 조각마다 한 줄 — 로
//   오는 것도 있다. 뒤엣것을 그대로 쓰면 98,000칸이 되어 느리고, 화풍이 아니라 그림 내용을
//   재게 된다. 그런데 코사인은 그래도 「값이 나오므로」 아무도 이상한 줄 모른다.
check('이미 한 줄이면 그대로', JSON.stringify(E.flatten({ data: [1, 2, 3], dims: [1, 3] }))
  === JSON.stringify([1, 2, 3]));
check('★조각마다 온 것은 평균을 낸다',
  JSON.stringify(E.flatten({ data: [1, 2, 3, 4, 5, 6], dims: [1, 3, 2] }))
  === JSON.stringify([3, 4]), JSON.stringify(E.flatten({ data: [1, 2, 3, 4, 5, 6], dims: [1, 3, 2] })));
check('★평균을 내면 칸 수가 준다 (그대로 두면 98,000칸이 된다)',
  E.flatten({ data: new Array(257 * 384).fill(1), dims: [1, 257, 384] }).length === 384);
check('모양을 모르면 있는 그대로', E.flatten({ data: [1, 2] }).length === 2);
check('숫자가 모자라면 손대지 않는다',
  E.flatten({ data: [1, 2], dims: [1, 3, 2] }).length === 2);
check('빈 것도 안 터진다', E.flatten(null).length === 0 && E.flatten({}).length === 0);
check('그림체와 인물은 꺼내는 자리가 다르다',
  E.model('style').pool !== E.model('identity').pool);

// ── 5. 수신함으로 재기 (가짜 수신함) ──────────────────────────────────────
function fakeApi(reply) {
  const calls = [];
  return {
    calls: calls,
    score: async function (dest, kind, arg) {
      calls.push({ kind: kind, arg: arg });
      const n = (arg.paths || arg.data || []).length;
      return reply ? reply(n, calls.length) : new Array(n).fill([1, 0]);
    }
  };
}

(async function () {
  let api = fakeApi();
  let items = [];
  for (let i = 0; i < 70; i++) items.push({ path: 'a/' + i + '.png' });
  let got = await E.fromServer(api, { url: 'x' }, 'style', items);
  check('★상한을 넘으면 끊어서 여러 번 부른다', api.calls.length === 3, String(api.calls.length));
  check('★끊어 불러도 장수가 맞는다', got.length === 70, String(got.length));
  check('올려 둔 것은 경로만 보낸다', !!api.calls[0].arg.paths && !api.calls[0].arg.data);

  api = fakeApi();
  got = await E.fromServer(api, { url: 'x' }, 'identity',
    [{ b64: 'AAA' }, { b64: 'BBB' }]);
  check('아직 안 올린 것은 본문으로 보낸다', !!api.calls[0].arg.data);
  check('무엇을 재라고 했는지 그대로 넘긴다', api.calls[0].kind === 'identity');

  // ★섞이면 순서가 어긋난다. 경로 것과 본문 것을 한 요청에 같이 담으면 서버가 경로를
  //   먼저 다 처리하고 본문을 뒤에 붙이므로, 결과 순서가 보낸 순서와 달라진다.
  api = fakeApi();
  await E.fromServer(api, { url: 'x' }, 'style', [{ path: 'a.png' }, { b64: 'BBB' }]);
  check('★경로와 본문이 섞이면 전부 본문으로 보낸다 (순서가 어긋나지 않게)',
    !!api.calls[0].arg.data && !api.calls[0].arg.paths,
    JSON.stringify(api.calls[0].arg));

  // 서버가 개수를 덜 줘도 자리가 밀리면 안 된다
  api = fakeApi(function (n) { return new Array(Math.max(0, n - 1)).fill([1, 0]); });
  got = await E.fromServer(api, { url: 'x' }, 'style',
    [{ path: 'a.png' }, { path: 'b.png' }, { path: 'c.png' }]);
  check('★서버가 덜 줘도 장수는 그대로 (밀려 붙으면 멀쩡한 것이 불량이 된다)',
    got.length === 3 && got[2].length === 0, JSON.stringify(got));

  let steps = [];
  api = fakeApi();
  await E.fromServer(api, { url: 'x' }, 'style', items, function (done, all) {
    steps.push(done + '/' + all);
  });
  check('얼마나 됐는지 알려 준다', steps.length === 3 && steps[2] === '70/70',
    steps.join(' '));

  api = fakeApi();
  got = await E.fromServer(api, { url: 'x' }, 'style', []);
  check('빈 목록은 부르지도 않는다', api.calls.length === 0 && got.length === 0);

  const total = pass + fails.length;
  console.log('벡터 뽑기 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
  fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
  process.exit(fails.length ? 1 : 0);
})();
