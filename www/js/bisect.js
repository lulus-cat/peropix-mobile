// 작태 깎기 — 작가 태그 20개 중 **그 요소를 만든 범인**을 찾는다.
//
// 무엇을 푸는가. 작가 태그를 잔뜩 넣고 뽑았는데 그림의 어떤 요소가 마음에 든다(또는
// 거슬린다). 20개 중 누구 때문인가? 하나씩 빼 보면 20장이 들고, 그마저도 조합 효과를
// 놓친다.
//
// ★가짓수를 안 터뜨리는 방법은 **탐색하지 않는 것**이다.
//   · on/off 20개 = 2^20, 거기에 가중치 5단계를 곱하면 5^20. 훑을 수 없다.
//   · 그래서 「누구인가」와 「얼마나」를 **절대 같이 돌리지 않는다.**
//       1단계 — 가중치를 전부 1.0 으로 묶고 on/off 만 이분 탐색 → 20개면 5라운드
//       2단계 — 범인이 정해진 뒤 그 한 명만 1차원으로 훑는다 (artists.js 의 scan) → 5장
//     합쳐 10장 안팎이면 끝난다.
//
// ★「넣기」가 아니라 「빼기」로 가른다.
//   절반만 넣고 뽑으면 그림이 통째로 달라져 무엇 때문에 달라졌는지 알 수 없다. 전체를
//   유지한 채 절반을 **빼야** 나머지 화풍이 남은 상태에서 그 요소만 사라졌는지 보인다.
//
// ★시드를 고정한다. 시드가 바뀌면 그림이 달라진 것이 태그 때문인지 시드 때문인지
//   구분할 방법이 없다. 깎기에서 시드는 설정이 아니라 전제다.
//
// ★단독 범인이 아닐 수 있다. 왼쪽을 빼도 남고 오른쪽을 빼도 남으면 그 요소는 여러 태그가
//   함께 만든 것이다. 이것을 알려 주지 않으면 사람이 이분 탐색을 계속 돌리며 헤맨다.
'use strict';

const Bisect = (function () {
  /** 라운드마다 몇 장을 뽑을지. */
  const SHOTS = {
    fast: 1,     // 한쪽만 빼 본다 — 결론은 나온다 (log2 만큼)
    cross: 2     // 양쪽을 각각 빼 본다 — 합작인지까지 알 수 있다
  };

  function uniq(list) {
    const seen = Object.create(null);
    return (list || []).map(function (t) {
      return String(t && t.tag ? t.tag : t || '').trim().toLowerCase().replace(/\s+/g, '_');
    }).filter(function (t) {
      if (!t || seen[t]) return false;
      seen[t] = true;
      return true;
    });
  }

  /**
   * 깎기를 시작한다.
   *
   * @param {object} o
   *   tags   {Array} 후보 작가 태그 (이 안에 범인이 있다고 본다)
   *   seed   {number} ★고정 시드
   *   seeds  {Array<number>} 시드를 여러 개 쓸 때 (우연을 범인으로 지목하지 않으려고)
   *   cross  {boolean} 양쪽을 다 빼 볼지 (기본 true)
   *   goal   {'keep'|'drop'} 그 요소를 살리고 싶은지 없애고 싶은지 — 문구에만 쓴다
   */
  function start(o) {
    const opt = o || {};
    const tags = uniq(opt.tags);
    const seeds = (opt.seeds && opt.seeds.length) ? opt.seeds.slice()
      : [Number(opt.seed) || 1];
    return {
      base: tags,
      candidates: tags.slice(),
      cleared: [],
      seeds: seeds,
      cross: opt.cross === false ? false : true,
      goal: opt.goal === 'drop' ? 'drop' : 'keep',
      rounds: [],
      round: 0,
      culprit: null,
      shared: false,       // 여럿이 함께 만든 것으로 밝혀졌나
      done: false
    };
  }

  /** 남은 후보로 몇 라운드가 더 필요한가. */
  function roundsLeft(state) {
    const n = (state && state.candidates ? state.candidates.length : 0);
    return n <= 1 ? 0 : Math.ceil(Math.log(n) / Math.log(2));
  }

  /**
   * 이번 라운드에 뽑을 것.
   *
   * 라운드 0 은 **대조군**이다 — 아무것도 빼지 않은 원래 조합. 이것이 없으면 「그 요소가
   * 있다/없다」를 무엇과 견주어 판단할지가 없다.
   *
   * @returns {{kind, group, shots:Array}|null} 끝났으면 null
   */
  function plan(state) {
    if (!state || state.done) return null;
    const cand = state.candidates || [];

    if (!state.rounds.length) {
      return {
        kind: 'reference',
        group: [],
        note: '아무도 빼지 않은 원래 조합입니다. 이 그림을 기준으로 삼습니다.',
        shots: shotsFor(state, [], 'ref')
      };
    }
    if (cand.length <= 1) return null;

    const half = Math.ceil(cand.length / 2);
    const left = cand.slice(0, half);
    const right = cand.slice(half);

    const shots = shotsFor(state, left, 'L');
    if (state.cross && right.length) {
      shotsFor(state, right, 'R').forEach(function (s) { shots.push(s); });
    }
    return {
      kind: 'split',
      group: left,
      other: right,
      note: left.length + '명을 뺀 그림입니다. 찾던 부분이 사라졌으면 범인은 뺀 쪽에 있습니다.',
      shots: shots
    };
  }

  /** 한 무리를 뺀 그림들 (시드마다 한 장씩). */
  function shotsFor(state, group, side) {
    const drop = Object.create(null);
    (group || []).forEach(function (t) { drop[t] = true; });
    const kept = state.base.filter(function (t) { return !drop[t]; });
    const r = state.rounds.length;
    return state.seeds.map(function (sd, i) {
      return {
        id: 'r' + r + side + '-' + i,
        round: r,
        side: side,
        seed: sd,
        removed: (group || []).slice(),
        tags: kept,
        // ★가중치는 건드리지 않는다. 1단계에서는 on/off 만 본다.
        name: r === 0 ? ('원본-' + sd) : ('빼기' + side + '-' + sd)
      };
    });
  }

  /**
   * 이번 라운드를 슬롯 목록으로 굽는다 — 기존 생성 경로를 그대로 타게.
   *
   * @param {object} step plan() 결과
   * @param {function} bake (tags:Array<string>) => string  프롬프트 조각 만드는 함수
   */
  function toSlots(step, bake) {
    if (!step) return [];
    return step.shots.map(function (s) {
      return { name: s.name, content: bake(s.tags), enabled: true, __shot: s.id };
    });
  }

  /**
   * 사람이 그림을 보고 「그 요소가 아직 있나」 를 답한다.
   *
   * @param {object} state
   * @param {object} answers {side: boolean} — 예: {L:true} 또는 {L:true, R:false}
   *   true = 그 무리를 뺐는데도 **요소가 남아 있다** → 범인은 뺀 쪽에 없다
   *   false = 요소가 **사라졌다** → 범인은 뺀 쪽에 있다
   */
  function answer(state, answers) {
    const s = Object.assign({}, state);
    s.rounds = (state.rounds || []).slice();
    s.cleared = (state.cleared || []).slice();

    // 라운드 0(대조군)은 판정이 없다 — 봤다는 표시만 남기고 다음으로.
    if (!s.rounds.length) {
      s.rounds.push({ kind: 'reference' });
      s.round = 1;
      return s;
    }

    const cand = s.candidates.slice();
    const half = Math.ceil(cand.length / 2);
    const left = cand.slice(0, half);
    const right = cand.slice(half);
    const a = answers || {};

    // 양쪽을 다 뽑았는데 **둘 다 남아 있다** → 한 명이 만든 것이 아니다.
    if (s.cross && a.L === true && a.R === true) {
      s.rounds.push({ kind: 'split', left: left, right: right, verdict: 'shared' });
      s.shared = true;
      s.done = true;
      return s;
    }
    // 둘 다 사라졌다 → 양쪽에 하나씩 있거나, 뺀 이미지 수 자체가 그림을 바꾼 것이다.
    if (s.cross && a.L === false && a.R === false) {
      s.rounds.push({ kind: 'split', left: left, right: right, verdict: 'both' });
      s.shared = true;
      s.done = true;
      return s;
    }

    // L 을 뺐더니 요소가 사라졌다 → 범인은 L 안. 남았다 → 범인은 R 안.
    const inLeft = (a.L === false) || (a.R === true && a.L === undefined);
    const next = inLeft ? left : right;
    const out = inLeft ? right : left;

    s.candidates = next;
    out.forEach(function (t) { if (s.cleared.indexOf(t) === -1) s.cleared.push(t); });
    s.rounds.push({ kind: 'split', left: left, right: right, verdict: inLeft ? 'left' : 'right' });
    s.round = s.rounds.length;

    if (s.candidates.length === 1) {
      s.culprit = s.candidates[0];
      s.done = true;
    } else if (s.candidates.length === 0) {
      // ★후보가 비었다 = 이 태그들 때문이 아니다. 조용히 끝내면 사람이 헤맨다.
      s.done = true;
    }
    return s;
  }

  /** 되돌리기 — 마지막 판정을 물린다. 잘못 본 것을 고칠 수 있어야 한다. */
  function undo(state) {
    if (!state || !state.rounds.length) return state;
    const s = Object.assign({}, state);
    const rounds = state.rounds.slice();
    const last = rounds.pop();
    s.rounds = rounds;
    s.round = rounds.length;
    s.done = false;
    s.culprit = null;
    s.shared = false;
    if (last && last.kind === 'split' && last.left && last.right) {
      s.candidates = last.left.concat(last.right);
      const back = Object.create(null);
      (last.verdict === 'left' ? last.right : last.left)
        .forEach(function (t) { back[t] = true; });
      s.cleared = (state.cleared || []).filter(function (t) { return !back[t]; });
    }
    return s;
  }

  /**
   * 몇 장이 들지 — ★실행 전에 반드시 보여 준다. Anlas 가 나가는 일이다.
   * @returns {{rounds:number, shots:number, total:number}}
   */
  function estimate(state) {
    const n = state && state.candidates ? state.candidates.length : 0;
    const rounds = n <= 1 ? 0 : Math.ceil(Math.log(n) / Math.log(2));
    const per = (state && state.cross ? SHOTS.cross : SHOTS.fast)
      * (state && state.seeds ? state.seeds.length : 1);
    const ref = (state && state.rounds && state.rounds.length) ? 0
      : (state && state.seeds ? state.seeds.length : 1);
    return { rounds: rounds, shots: per, total: ref + rounds * per };
  }

  /** 지금 상태를 한 줄로. 화면 맨 위에 그대로 쓴다. */
  function summary(state) {
    if (!state) return '';
    if (state.shared) {
      return '한 명이 만든 게 아닙니다. 여러 작가가 같이 만들어내고 있습니다.';
    }
    if (state.culprit) {
      const who = state.culprit.replace(/_/g, ' ');
      return state.goal === 'drop'
        ? ('범인은 ' + who + ' 입니다. 빼거나 가중치를 낮춰 보세요.')
        : ('그 부분은 ' + who + ' 덕입니다. 가중치를 올려 보세요.');
    }
    if (state.done && !state.candidates.length) {
      return '후보가 다 떨어졌습니다. 작가 태그 때문이 아닐 수도 있습니다.';
    }
    if (!state.rounds.length) {
      return '먼저 원래 조합을 한 장 뽑아서 기준을 잡습니다.';
    }
    return '남은 후보 ' + state.candidates.length + '명 · 앞으로 ' + roundsLeft(state) + '번';
  }

  return {
    SHOTS: SHOTS,
    start: start,
    plan: plan,
    toSlots: toSlots,
    answer: answer,
    undo: undo,
    estimate: estimate,
    roundsLeft: roundsLeft,
    summary: summary
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Bisect;
