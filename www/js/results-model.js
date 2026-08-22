// 결과 목록의 상태와 분류 — 화면과 분리된 순수 로직.
//
// 한 슬롯을 N 배수로 뽑으면 한 슬롯 안에 여러 장이 쌓이고, 거기서 다시
// 인핸스·업스케일을 하면 파생본이 붙는다. 그 더미를 사람이 훑으며 걸러내는 게 이 화면의 일이다.
//
// 항목 하나:
//   { id, slotLabel, cycle, kind:'base'|'enhanced'|'upscaled'|'composed', parentId,
//     name, filename, bytes, url, savedTo, error, deleted, verdict, job }
//
//   job      실패한 장에만 있다 — 무엇을 뽑으려던 것인지(슬롯·인물·사이클).
//            ★이게 있어야 인터넷이 끊겨 깨진 장을 **그 장만** 다시 뽑을 수 있다.
//
//   verdict  null      아직 안 봄
//            'keep'    남길 것
//            'reject'  버릴 것 (지우지는 않았고 표시만)
//
// ★deleted 는 "목록에서 뺐다"는 뜻이고, 이미 저장된 파일을 지우는 것은 화면 쪽 일이다.
//   여기서는 파일을 건드리지 않는다.
'use strict';

const ResultsModel = (function () {
  let seq = 0;

  function nextId() {
    seq += 1;
    return 'r' + seq;
  }

  /** 새 항목을 만든다. 빠진 칸은 기본값으로 채운다. */
  function make(fields) {
    return Object.assign({
      id: nextId(),
      slotLabel: '',
      cycle: 1,
      kind: 'base',
      parentId: null,
      name: '',
      filename: null,
      bytes: null,
      url: null,
      savedTo: null,
      error: null,
      deleted: false,
      verdict: null,
      job: null
    }, fields || {});
  }

  function live(list) {
    return (list || []).filter(function (r) { return !r.deleted; });
  }

  /** 볼 수 있는 것 = 지워지지 않았고 그림이 있는 것. */
  function viewable(list) {
    return live(list).filter(function (r) { return !!r.bytes; });
  }

  /**
   * 슬롯별로 묶는다. 슬롯 순서는 **처음 나온 순서**를 지킨다
   * (생성 순서 = 사용자가 슬롯을 늘어놓은 순서라 그게 자연스럽다).
   * 슬롯 안에서는 원본 → 그 파생본 순으로 붙여 둔다.
   * @returns {Array<{label:string, items:Array}>}
   */
  function groupBySlot(list) {
    const order = [];
    const bucket = Object.create(null);

    // ★슬롯 순서는 **지운 것까지 포함해** 처음 나온 순서로 정한다.
    //   살아 있는 것만으로 정하면, 어떤 슬롯의 첫 장을 지우는 순간 그 슬롯이 뒤로 밀려
    //   훑던 순서가 통째로 뒤바뀐다 (실제로 그렇게 났다).
    (list || []).forEach(function (r) {
      const key = r.slotLabel || '(이름 없음)';
      if (!bucket[key]) { bucket[key] = []; order.push(key); }
      if (!r.deleted) bucket[key].push(r);
    });

    return order
      .filter(function (label) { return bucket[label].length > 0; })
      .map(function (label) {
        return { label: label, items: sortWithinSlot(bucket[label]) };
      });
  }

  /**
   * 슬롯 안 정렬: 사이클 순으로, 각 원본 뒤에 그 파생본을 붙인다.
   * ★파생본을 목록 끝에 몰아 두면 "3번째 장의 인핸스"가 어느 것인지 알 수 없다.
   */
  function sortWithinSlot(items) {
    const byId = Object.create(null);
    items.forEach(function (r) { byId[r.id] = r; });

    const roots = items.filter(function (r) {
      return !r.parentId || !byId[r.parentId];
    }).sort(function (a, b) { return (a.cycle || 0) - (b.cycle || 0); });

    const childrenOf = Object.create(null);
    items.forEach(function (r) {
      if (r.parentId && byId[r.parentId]) {
        (childrenOf[r.parentId] = childrenOf[r.parentId] || []).push(r);
      }
    });

    const out = [];
    const pushTree = function (r) {
      out.push(r);
      (childrenOf[r.id] || []).forEach(pushTree);
    };
    roots.forEach(pushTree);

    // 어디에도 안 붙은 것이 남으면 뒤에 붙인다 (부모가 지워진 파생본 등)
    items.forEach(function (r) { if (out.indexOf(r) === -1) out.push(r); });
    return out;
  }

  /**
   * 훑어보기 상태 — 몇 장을 봤고 몇 장이 남았나.
   * @returns {{total,saved,unsaved,keep,reject,pending,enhanced,upscaled,failed}}
   */
  function stats(list) {
    const l = live(list);
    const has = function (k) { return l.filter(function (r) { return r.kind === k; }).length; };
    return {
      total: l.length,
      saved: l.filter(function (r) { return !!r.savedTo; }).length,
      unsaved: l.filter(function (r) { return r.bytes && !r.savedTo; }).length,
      keep: l.filter(function (r) { return r.verdict === 'keep'; }).length,
      reject: l.filter(function (r) { return r.verdict === 'reject'; }).length,
      pending: l.filter(function (r) { return r.bytes && !r.verdict; }).length,
      enhanced: has('enhanced'),
      upscaled: has('upscaled'),
      failed: l.filter(function (r) { return !!r.error && !r.bytes; }).length,
      deleted: (list || []).length - l.length
    };
  }

  // 결과 화면 위쪽 필터. 대량 생산 뒤에 훑을 때 쓰는 축들이다.
  const FILTERS = [
    { id: 'all', name: '전체', test: function () { return true; } },
    // ★"인핸스할 것" — 원본인데 아직 파생본이 없고 버리지 않은 것.
    //   ★실패해서 그림이 없는 장은 뺀다 — 인핸스할 대상이 아니다.
    { id: 'todo', name: '인핸스 대상', test: function (r, ctx) {
      return r.kind === 'base' && !!r.bytes && r.verdict !== 'reject' && !ctx.hasChild[r.id];
    } },
    // ★배경을 깐 것도 최종본이다 — 인핸스 뒤에 배경을 까는 것이 보통 마지막 손질이다.
    { id: 'final', name: '최종본', test: function (r) {
      return (r.kind === 'enhanced' || r.kind === 'upscaled' || r.kind === 'composed')
        && r.verdict !== 'reject';
    } },
    { id: 'reject', name: '버릴 것', test: function (r) { return r.verdict === 'reject'; } },
    // 그림이 없는 장 — 인터넷이 끊겨 깨진 것들. 다시 뽑을 대상이다.
    { id: 'failed', name: '실패', test: function (r) { return !!r.error && !r.bytes; } },
    { id: 'unsaved', name: '저장 안 됨', test: function (r) { return !!r.bytes && !r.savedTo; } }
  ];

  /** 필터를 적용한다. 슬롯 묶음 구조는 유지하고 빈 슬롯은 뺀다. */
  function applyFilter(list, filterId) {
    const f = FILTERS.find(function (x) { return x.id === filterId; }) || FILTERS[0];
    const ctx = { hasChild: Object.create(null) };
    live(list).forEach(function (r) {
      if (r.parentId) ctx.hasChild[r.parentId] = true;
    });

    return groupBySlot(list).map(function (g) {
      return { label: g.label, items: g.items.filter(function (r) { return f.test(r, ctx); }) };
    }).filter(function (g) { return g.items.length > 0; });
  }

  /** 파생본까지 함께 지울 대상 id 목록 (부모를 지우면 자식도 같이 간다). */
  function withDescendants(list, id) {
    const out = [id];
    let added = true;
    while (added) {
      added = false;
      (list || []).forEach(function (r) {
        if (r.parentId && out.indexOf(r.parentId) !== -1 && out.indexOf(r.id) === -1) {
          out.push(r.id);
          added = true;
        }
      });
    }
    return out;
  }

  function byId(list, id) {
    return (list || []).find(function (r) { return r.id === id; }) || null;
  }

  /** 검사에서 id 를 예측 가능하게 만들려고 쓴다. */
  function _resetIds() { seq = 0; }

  return {
    make: make,
    live: live,
    viewable: viewable,
    groupBySlot: groupBySlot,
    sortWithinSlot: sortWithinSlot,
    stats: stats,
    applyFilter: applyFilter,
    withDescendants: withDescendants,
    byId: byId,
    FILTERS: FILTERS,
    _resetIds: _resetIds
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ResultsModel;
