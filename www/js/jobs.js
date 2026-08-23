// 이번 생성이 몇 장을, 어떤 순서로 뽑을지 — 화면과 분리한 순수 계산.
//
// 축이 셋이다: **인물 · 슬롯 · 배수**.
//   보통은 인물을 한 장에 다 넣으므로 「슬롯 × 배수」 만큼 돈다.
//   ★「한 명 모드」 를 켜면 켠 인물을 **한 명씩** 보내고, 인물 수만큼 바퀴를 더 돈다
//     (인물 × 슬롯 × 배수). 인물이 많고 슬롯이 적을 때 인물을 켰다 껐다 하며
//     여러 번 돌리던 왕복을 없애려는 것이다.
//
// ★순서는 **인물 → 배수 → 슬롯** 이다.
//   - 인물이 제일 바깥: 중간에 멈춰도 앞쪽 인물은 통째로 끝나 있다. 사람이 쓰는 단위가
//     인물이라(폴더 하나가 인물 하나) 반쯤 찬 인물 여럿보다 완성된 인물 몇이 낫다.
//   - 배수가 슬롯보다 바깥: 한 슬롯을 몰아서 다 뽑으면 멈췄을 때 뒤 슬롯이 통째로 빈다.
'use strict';

const Jobs = (function () {
  function slotName(s, i) {
    return (s && s.label ? String(s.label).trim() : '') || ('slot' + (i + 1));
  }

  function charName(c, i) {
    return (c && c.name ? String(c.name).trim() : '') || ('인물 ' + (i + 1));
  }

  /** 켠 슬롯. ★프롬프트가 비어도 공통 프롬프트가 있으면 뽑을 것이 있다. */
  function activeSlots(slots, base) {
    const hasBase = !!String(base || '').trim();
    return (slots || []).map(function (s, i) {
      return { slot: s, index: i };
    }).filter(function (e) {
      return e.slot.enabled !== false
        && (!!String(e.slot.prompt || '').trim() || hasBase);
    });
  }

  function activeChars(chars) {
    return (chars || []).map(function (c, i) {
      return { char: c, index: i };
    }).filter(function (e) { return e.char.enabled !== false; });
  }

  /**
   * 뽑을 목록을 만든다.
   *
   * @param {object} o
   *   slots    [{label, prompt, enabled}]
   *   chars    [{name, prompt, uc, coord, enabled, skipSlotPrompt}]
   *   base     공통 프롬프트 (슬롯 프롬프트가 비었을 때 이것만으로 뽑을지 판단한다)
   *   perSlot  슬롯 하나당 몇 장 (배수)
   *   oneChar  한 명 모드
   * @returns {Array<{slot,slotIndex,slotName,cycle,perSlot,char,charIndex,charName,name,group}>}
   *   name   결과 항목 이름 (배수가 1보다 크면 #사이클이 붙는다)
   *   group  결과 화면에서 묶는 이름 (한 명 모드면 「인물 · 슬롯」)
   */
  function build(o) {
    o = o || {};
    const perSlot = Math.max(1, parseInt(o.perSlot, 10) || 1);
    const slots = activeSlots(o.slots, o.base);
    const chars = activeChars(o.chars);
    const oneChar = !!o.oneChar && chars.length > 0;

    // 한 명 모드가 아니면 인물은 한 묶음으로 같이 나간다 — 바퀴는 하나뿐이다.
    const rounds = oneChar ? chars : [null];
    const out = [];

    rounds.forEach(function (entry) {
      for (let cycle = 1; cycle <= perSlot; cycle++) {
        slots.forEach(function (e) {
          const sName = slotName(e.slot, e.index);
          const cName = entry ? charName(entry.char, entry.index) : '';
          out.push({
            slot: e.slot,
            slotIndex: e.index,
            slotName: sName,
            cycle: cycle,
            perSlot: perSlot,
            char: entry ? entry.char : null,
            charIndex: entry ? entry.index : -1,
            charName: cName,
            name: perSlot > 1 ? (sName + '#' + cycle) : sName,
            group: entry ? (cName + ' · ' + sName) : sName
          });
        });
      }
    });
    return out;
  }

  /** 몇 장이 나올지만 알고 싶을 때 (Anlas 어림·화면 문구용). */
  function count(o) {
    return build(o).length;
  }

  return {
    build: build,
    count: count,
    activeSlots: activeSlots,
    activeChars: activeChars,
    slotName: slotName,
    charName: charName
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Jobs;
