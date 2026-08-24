// PeroFix 프롬프트 JSON 가져오기.
//
// Claude Code·Codex·Gemini 가 만든 파일을 앱 슬롯으로 옮긴다. 형식:
//   { "name": "...", "prefix": "...",
//     "slots": [ { "name": "{좌표}", "content": "...", "locked": false } ] }
//
// prefix  → 공통 프롬프트
// name    → 슬롯 이름 (= 저장 파일명에 쓰이는 라벨)
// content → 슬롯 프롬프트
//
// ★locked 는 앱이 쓰지 않지만 그대로 보존한다. 내보내기로 되돌릴 때 잃지 않게 한다.
// ★오류 메시지는 사람이 고칠 수 있게 쓴다 — "무엇이 몇 번째에서 잘못됐는지"까지.
'use strict';

const PerofixImport = (function () {

  /**
   * @param {string} text 붙여넣은 JSON 원문
   * @returns {{ok:boolean, error?:string, name?:string, prefix?:string, slots?:Array}}
   */
  function parse(text) {
    const raw = (text || '').trim();
    if (!raw) return { ok: false, error: 'JSON 이 비어 있습니다.' };

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // ★흔한 사고: 코드블록 표시(```json)를 같이 붙여넣는 것. 그때는 벗겨서 다시 시도한다.
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      if (stripped !== raw) {
        try { data = JSON.parse(stripped); } catch (e2) {
          return { ok: false, error: 'JSON 형식이 아닙니다: ' + e2.message };
        }
      } else {
        return { ok: false, error: 'JSON 형식이 아닙니다: ' + e.message };
      }
    }

    if (Array.isArray(data)) {
      // slots 배열만 준 경우도 받아 준다.
      data = { slots: data };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'JSON 최상위가 객체가 아닙니다.' };
    }
    if (!Array.isArray(data.slots)) {
      return { ok: false, error: '"slots" 배열이 없습니다. PeroFix 형식이 맞는지 확인해 주세요.' };
    }
    if (!data.slots.length) {
      return { ok: false, error: '"slots" 가 비어 있습니다.' };
    }

    const slots = [];
    const seen = Object.create(null);
    for (let i = 0; i < data.slots.length; i++) {
      const s = data.slots[i];
      const at = (i + 1) + '번째 슬롯';
      if (!s || typeof s !== 'object') {
        return { ok: false, error: at + ' 이 객체가 아닙니다.' };
      }
      const content = (s.content === undefined || s.content === null) ? '' : String(s.content);
      if (!content.trim()) {
        return { ok: false, error: at + ' 의 "content" 가 비어 있습니다.' };
      }

      let name = (s.name === undefined || s.name === null) ? '' : String(s.name).trim();
      if (!name) name = 'slot' + (i + 1);

      // ★같은 이름이 둘이면 저장할 때 파일이 겹친다. 여기서 미리 갈라 둔다.
      if (seen[name]) {
        seen[name]++;
        name = name + '_' + seen[name];
      } else {
        seen[name] = 1;
      }

      slots.push({
        label: name,
        prompt: content,
        enabled: true,
        locked: !!s.locked
      });
    }

    return {
      ok: true,
      name: typeof data.name === 'string' ? data.name : '',
      prefix: typeof data.prefix === 'string' ? data.prefix : '',
      slots: slots
    };
  }

  /**
   * 캐릭터 프롬프트 JSON 을 읽는다.
   *
   * 데스크톱 버전 캐릭터 프리셋 형식:
   *   { "characters": [ { "content": "...", "uc": "...", "coord": "a1",
   *                       "skipSlotPrompt": false, "name": "...", "enabled": true } ] }
   * ★프롬프트 칸 이름이 슬롯 JSON 과 다르다 (`content`). 둘 다 받아 준다.
   *
   * @returns {{ok:boolean, error?:string, characters?:Array}}
   */
  function parseCharacters(text) {
    const raw = (text || '').trim();
    if (!raw) return { ok: false, error: 'JSON 이 비어 있습니다.' };

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      if (stripped === raw) return { ok: false, error: 'JSON 형식이 아닙니다: ' + e.message };
      try { data = JSON.parse(stripped); } catch (e2) {
        return { ok: false, error: 'JSON 형식이 아닙니다: ' + e2.message };
      }
    }

    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.characters)) list = data.characters;
    else return { ok: false, error: '"characters" 배열이 없습니다. 캐릭터 프리셋이 맞는지 확인해 주세요.' };

    if (!list.length) return { ok: false, error: '캐릭터가 하나도 없습니다.' };

    const out = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const at = (i + 1) + '번째 캐릭터';
      if (!c || typeof c !== 'object') return { ok: false, error: at + ' 가 객체가 아닙니다.' };

      const prompt = String(
        c.content !== undefined && c.content !== null ? c.content
          : (c.prompt !== undefined && c.prompt !== null ? c.prompt : '')
      );
      if (!prompt.trim()) return { ok: false, error: at + ' 의 프롬프트가 비어 있습니다.' };

      // ★좌표는 a1~e5 만 받는다. 이상한 값이 들어오면 위치 지정을 끈다 (조용히 틀리는 것보다 낫다).
      let coord = (c.coord === undefined || c.coord === null) ? null : String(c.coord).trim().toLowerCase();
      if (coord && !/^[a-e][1-5]$/.test(coord)) coord = null;

      out.push({
        prompt: prompt,
        uc: String(c.uc === undefined || c.uc === null ? '' : c.uc),
        coord: coord,
        skipSlotPrompt: !!c.skipSlotPrompt,
        name: String(c.name === undefined || c.name === null ? '' : c.name),
        enabled: c.enabled === undefined ? true : !!c.enabled
      });
    }
    return { ok: true, characters: out };
  }

  /** 캐릭터를 데스크톱 버전 프리셋 형식으로 되돌린다. */
  function buildCharacters(chars) {
    return {
      characters: (chars || []).map(function (c) {
        return {
          content: c.prompt || '',
          uc: c.uc || '',
          coord: c.coord || null,
          skipSlotPrompt: !!c.skipSlotPrompt,
          name: c.name || '',
          enabled: c.enabled !== false
        };
      })
    };
  }

  /** 앱 상태를 PeroFix 형식으로 되돌린다 (내보내기). */
  function build(name, prefix, slots) {
    return {
      name: name || '',
      prefix: prefix || '',
      slots: (slots || []).map(function (s) {
        return {
          name: s.label || '',
          content: s.prompt || '',
          locked: !!s.locked
        };
      })
    };
  }

  return {
    parse: parse, build: build,
    parseCharacters: parseCharacters, buildCharacters: buildCharacters
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PerofixImport;
