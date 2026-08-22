// 결과 분류 검사 — 슬롯 묶기, 파생본 붙이기, 필터.
//
// ★대량 생산 뒤에 훑는 화면이라 여기가 틀리면 "인핸스 했는데 어느 원본 것인지 모르는" 상태가 된다.
// 사용: node mobile/tools/test_results.js
'use strict';

const RM = require('../www/js/results-model.js');

let pass = 0;
const fails = [];

function check(why, cond, extra) {
  if (cond) pass++;
  else fails.push(why + (extra ? '\n     ' + extra : ''));
}

function names(items) {
  return items.map(function (r) { return r.name; }).join(',');
}

// ── 슬롯 2개 × 3배수, 일부는 인핸스·업스케일 ──────────────────────────
RM._resetIds();
const list = [];
['happy', 'sad'].forEach(function (slot) {
  for (let c = 1; c <= 3; c++) {
    list.push(RM.make({ slotLabel: slot, cycle: c, name: slot + '#' + c, bytes: {} }));
  }
});
const happy2 = list.find(function (r) { return r.name === 'happy#2'; });
const enh = RM.make({
  slotLabel: 'happy', cycle: 2, kind: 'enhanced', parentId: happy2.id,
  name: 'happy#2_enh', bytes: {}
});
list.push(enh);
list.push(RM.make({
  slotLabel: 'happy', cycle: 2, kind: 'upscaled', parentId: enh.id,
  name: 'happy#2_enh_x4', bytes: {}
}));
// 실패한 장 (그림이 없다)
list.push(RM.make({ slotLabel: 'sad', cycle: 4, name: 'sad#4', error: '401' }));

// ── 묶기 ──────────────────────────────────────────────────────────────
let groups = RM.groupBySlot(list);
check('슬롯 수', groups.length === 2, groups.map(function (g) { return g.label; }).join(','));
check('슬롯 순서는 나온 순서', groups[0].label === 'happy' && groups[1].label === 'sad');

// ★파생본은 그 원본 **바로 뒤**에 와야 한다. 끝에 몰리면 어느 것의 인핸스인지 모른다.
check('파생본이 원본 바로 뒤에 붙는다',
  names(groups[0].items) === 'happy#1,happy#2,happy#2_enh,happy#2_enh_x4,happy#3',
  names(groups[0].items));
check('손자(업스케일)도 따라온다',
  groups[0].items[3].name === 'happy#2_enh_x4');
check('실패한 장도 목록에는 남는다', names(groups[1].items).indexOf('sad#4') !== -1,
  names(groups[1].items));

// ── 통계 ──────────────────────────────────────────────────────────────
let s = RM.stats(list);
check('전체 수', s.total === 9, JSON.stringify(s));
check('인핸스 수', s.enhanced === 1);
check('업스케일 수', s.upscaled === 1);
check('실패 수', s.failed === 1);
check('아직 안 본 것', s.pending === 8, String(s.pending));

// ── 판정 ──────────────────────────────────────────────────────────────
list.find(function (r) { return r.name === 'happy#1'; }).verdict = 'reject';
list.find(function (r) { return r.name === 'happy#3'; }).verdict = 'keep';
s = RM.stats(list);
check('버릴 것 수', s.reject === 1, JSON.stringify(s));
check('남길 것 수', s.keep === 1);

// ── 필터 ──────────────────────────────────────────────────────────────
// 「인핸스 대상」 = 원본인데 파생본이 아직 없고 버리지 않은 것
let f = RM.applyFilter(list, 'todo');
let flat = f.reduce(function (a, g) { return a.concat(g.items); }, []);
const todo = flat.map(function (r) { return r.name; });
check('인핸스 대상: 이미 인핸스한 happy#2 는 빠진다', todo.indexOf('happy#2') === -1, todo.join(','));
check('인핸스 대상: 버린 happy#1 도 빠진다', todo.indexOf('happy#1') === -1, todo.join(','));
check('인핸스 대상: happy#3 은 들어간다', todo.indexOf('happy#3') !== -1, todo.join(','));
// ★실패해서 그림이 없는 장은 인핸스할 수가 없다.
check('인핸스 대상: 실패한 sad#4 는 빠진다', todo.indexOf('sad#4') === -1, todo.join(','));
check('인핸스 대상: 파생본 자신은 안 들어간다',
  todo.indexOf('happy#2_enh') === -1 && todo.indexOf('happy#2_enh_x4') === -1, todo.join(','));

f = RM.applyFilter(list, 'final');
flat = f.reduce(function (a, g) { return a.concat(g.items); }, []);
check('최종본 = 인핸스·업스케일 결과',
  names(flat) === 'happy#2_enh,happy#2_enh_x4', names(flat));

// 배경을 깐 장도 최종본으로 센다 (인핸스 뒤 마지막 손질이라 여기 있어야 한다).
const composed = RM.make({
  slotLabel: 'sad', cycle: 1, kind: 'composed', name: 'sad#1_bg', bytes: {},
  parentId: list.find(function (r) { return r.name === 'sad#1'; }).id
});
list.push(composed);
f = RM.applyFilter(list, 'final');
flat = f.reduce(function (a, g) { return a.concat(g.items); }, []);
check('최종본에 배경 합성 결과도 들어간다',
  names(flat).indexOf('sad#1_bg') !== -1, names(flat));
f = RM.applyFilter(list, 'todo');
flat = f.reduce(function (a, g) { return a.concat(g.items); }, []);
check('배경을 깐 원본은 인핸스 대상에서 빠진다',
  names(flat).indexOf('sad#1') === -1, names(flat));

f = RM.applyFilter(list, 'reject');
flat = f.reduce(function (a, g) { return a.concat(g.items); }, []);
check('버릴 것 필터', names(flat) === 'happy#1', names(flat));

f = RM.applyFilter(list, 'unsaved');
flat = f.reduce(function (a, g) { return a.concat(g.items); }, []);
check('저장 안 됨 필터가 실패한 장은 빼는지', names(flat).indexOf('sad#4') === -1, names(flat));

// 빈 슬롯은 결과에서 빠진다
list.forEach(function (r) { if (r.slotLabel === 'sad') r.verdict = 'reject'; });
f = RM.applyFilter(list, 'final');
check('필터 결과에 빈 슬롯은 안 남는다',
  f.every(function (g) { return g.items.length > 0; }));

// ── 지우기 ────────────────────────────────────────────────────────────
// 원본을 지우면 그 파생본도 함께 간다 (남으면 부모 없는 고아가 된다)
const ids = RM.withDescendants(list, happy2.id);
check('원본 + 인핸스 + 업스케일 = 3개', ids.length === 3, JSON.stringify(ids));

ids.forEach(function (id) { RM.byId(list, id).deleted = true; });
groups = RM.groupBySlot(list);
check('지운 것은 목록에서 빠진다',
  names(groups[0].items) === 'happy#1,happy#3', names(groups[0].items));
s = RM.stats(list);
check('지운 수를 센다', s.deleted === 3, JSON.stringify(s));

// 파생본만 지우면 원본은 남는다
RM._resetIds();
const l2 = [];
const base = RM.make({ slotLabel: 'a', cycle: 1, name: 'a#1', bytes: {} });
const child = RM.make({ slotLabel: 'a', cycle: 1, kind: 'enhanced', parentId: base.id, name: 'a#1_enh', bytes: {} });
l2.push(base, child);
RM.withDescendants(l2, child.id).forEach(function (id) { RM.byId(l2, id).deleted = true; });
check('파생본만 지우면 원본은 남는다',
  names(RM.groupBySlot(l2)[0].items) === 'a#1', names(RM.groupBySlot(l2)[0].items));
check('원본이 다시 「인핸스 대상」 으로 돌아온다',
  RM.applyFilter(l2, 'todo')[0].items[0].name === 'a#1');

// ── 슬롯 순서는 지워도 흔들리지 않아야 한다 ──────────────────────────
// ★한 슬롯의 첫 장을 지웠다고 그 슬롯이 뒤로 밀리면, 훑던 순서가 통째로 바뀐다.
RM._resetIds();
const ord = [];
['A', 'B'].forEach(function (slot) {
  for (let c = 1; c <= 2; c++) {
    ord.push(RM.make({ slotLabel: slot, cycle: c, name: slot + c, bytes: {} }));
  }
});
// 생성 순서를 A1,B1,A2,B2 로 섞는다 (실제 생성 루프가 이렇게 돈다)
const interleaved = [ord[0], ord[2], ord[1], ord[3]];
check('섞여 들어와도 슬롯 순서는 A,B',
  RM.groupBySlot(interleaved).map(function (g) { return g.label; }).join(',') === 'A,B',
  RM.groupBySlot(interleaved).map(function (g) { return g.label; }).join(','));

interleaved[0].deleted = true;   // A 의 첫 장을 지운다
check('A 의 첫 장을 지워도 순서는 그대로 A,B',
  RM.groupBySlot(interleaved).map(function (g) { return g.label; }).join(',') === 'A,B',
  RM.groupBySlot(interleaved).map(function (g) { return g.label; }).join(','));

interleaved[2].deleted = true;   // A 를 통째로 비운다
check('슬롯이 통째로 비면 목록에서 빠진다',
  RM.groupBySlot(interleaved).map(function (g) { return g.label; }).join(',') === 'B',
  RM.groupBySlot(interleaved).map(function (g) { return g.label; }).join(','));

// ── 부모가 사라진 파생본 ──────────────────────────────────────────────
RM._resetIds();
const l3 = [RM.make({ slotLabel: 'b', cycle: 1, kind: 'enhanced', parentId: 'r999', name: 'b_enh', bytes: {} })];
check('부모를 못 찾아도 목록에서 사라지지 않는다',
  RM.groupBySlot(l3)[0].items.length === 1, JSON.stringify(RM.groupBySlot(l3)));

// ── 슬롯 이름이 없는 경우 ─────────────────────────────────────────────
RM._resetIds();
const l4 = [RM.make({ slotLabel: '', cycle: 1, name: 'x', bytes: {} })];
check('슬롯 이름이 비면 대체 이름을 붙인다',
  RM.groupBySlot(l4)[0].label === '(이름 없음)', RM.groupBySlot(l4)[0].label);

const total = pass + fails.length;
console.log('결과 분류 검사 ' + total + '건 — 통과 ' + pass + '건, 실패 ' + fails.length + '건');
fails.forEach(function (f) { console.log('\n  ▸ ' + f); });
process.exit(fails.length ? 1 : 0);
