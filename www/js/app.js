// 화면 동작 — 첫 실행 키 입력, 슬롯 편집, 순차 생성, 설정.
'use strict';

(function () {
  const $ = function (id) { return document.getElementById(id); };

  let slots = [];
  let options = null;
  let running = false;
  let cancelRequested = false;

  let references = [];          // Precise Reference [{name,image,mode,strength,fidelity}]
  let favorites = [];           // 즐겨찾기 폴더 [{destId,path,label}]
  // [{prompt, uc, coord, enabled, skipSlotPrompt}] — 공통 프롬프트와 별개 축
  // ★skipSlotPrompt 는 화면에 조작이 없다. 가져온 JSON 이 정해 둔 값을 그대로 지킬 뿐이다
  //   (PC 에서 JSON 을 쓰는 쪽이 인물별로 정한다). 폰에서는 건드리지 않는다.
  let characters = [];
  let slotTarget = 'char';      // 슬롯 프롬프트를 'base'(공통) / 'char'(캐릭터) 중 어디에 붙일지
  let destinations = [];        // [{id, name, url, token}]
  let activeDestId = Store.DEVICE_ID;
  let namingTemplate = Store.DEFAULT_TEMPLATE;
  let persona = '';
  // 이번 실행에서 이미 쓴 경로. 같은 이름이 겹치면 _2, _3 으로 비켜 준다.
  let usedPaths = new Set();
  let wildcardDoc = '';
  let wildcardPools = {};
  let presets = [];
  let subscription = null;      // Anlas 잔량 (없으면 표시 안 함)

  // ── 화면 전환 ────────────────────────────────────────────────────────────
  // ★뒤로가기가 "어디서 눌렸는지" 알아야 해서 지금 화면을 들고 있는다.
  let currentScreen = 'main';

  function show(which) {
    currentScreen = which;
    ['setup', 'perms', 'main', 'settings', 'import', 'folders', 'results',
     'wildcards', 'enhance', 'compose', 'jobs', 'artists'].forEach(function (n) {
      $('screen-' + n).hidden = (n !== which);
    });
    window.scrollTo(0, 0);
  }

  // ── 안드로이드 뒤로가기 ──────────────────────────────────────────────────
  // ★기본 동작은 "앱 종료" 다. 갤럭시 네비게이션 바로 뒤로 가면 작업 중이던 것이
  //   통째로 날아간다. 그래서 직접 가로채, 열린 것부터 차례로 닫는다.
  //     덮개(편집기·뷰어) → 하위 화면 → 메인 → (한 번 더 누르면) 종료
  let backExitArmed = false;
  let backExitTimer = null;

  function handleBack() {
    // 1) 덮개가 떠 있으면 그것부터 닫는다. 겹쳐 있으면 위에 있는 것부터.
    if (!$('editor').hidden) { closeEditor(); return; }
    if (!$('item-edit').hidden) { closeItemEdit(); return; }
    if (openDrawerName) { closeDrawer(); return; }
    if (!$('viewer').hidden) { closeViewer(); return; }

    // 2) 하위 화면이면 메인으로.
    if (currentScreen !== 'main' && currentScreen !== 'setup' && currentScreen !== 'perms') {
      show('main');
      return;
    }

    // 3) 첫 설정 중에는 돌아갈 곳이 없다 — 그냥 내려놓는다(종료가 아니다).
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (currentScreen === 'setup' || currentScreen === 'perms') {
      if (App && App.minimizeApp) App.minimizeApp();
      return;
    }

    // 4) 메인에서는 한 번 더 눌러야 나간다 — 실수로 나가는 일을 막는다.
    if (backExitArmed) {
      if (App && App.exitApp) App.exitApp();
      return;
    }
    backExitArmed = true;
    toast('한 번 더 누르면 앱이 닫힙니다.', 2000);
    clearTimeout(backExitTimer);
    backExitTimer = setTimeout(function () { backExitArmed = false; }, 2000);
  }

  function setupBackButton() {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && App.addListener) App.addListener('backButton', handleBack);
    // PC 미리보기에서도 같은 길을 확인할 수 있게 브라우저 뒤로가기를 묶어 둔다.
    window.addEventListener('popstate', function () {
      history.pushState(null, '', location.href);
      handleBack();
    });
    history.pushState(null, '', location.href);
  }

  // ── 서랍 여닫기 ─────────────────────────────────────────────────────────
  let openDrawerName = null;    // 'chars' | 'slots' | null

  function openDrawer(which) {
    if (openDrawerName === which) return;
    closeDrawer();
    openDrawerName = which;
    if (which === 'chars') renderCharDrawer(); else renderSlotDrawer();
    $('drawer-' + which).hidden = false;
    $('drawer-scrim').hidden = false;
    // ★서랍이 떠 있는 동안 뒤쪽 본문이 따라 스크롤되면 어디를 보는지 헷갈린다.
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (!openDrawerName) return;
    $('drawer-' + openDrawerName).hidden = true;
    $('drawer-scrim').hidden = true;
    openDrawerName = null;
    // 수정창이 함께 떠 있으면 스크롤 잠금을 풀지 않는다.
    if ($('item-edit').hidden && $('editor').hidden) document.body.style.overflow = '';
  }

  /**
   * 메인 화면에서 옆으로 밀어 서랍을 연다.
   * ★오른쪽으로 밀면 인물(왼쪽 서랍), 왼쪽으로 밀면 슬롯(오른쪽 서랍).
   *   세로로 긋는 것은 그냥 스크롤이므로, 가로 이동이 세로보다 확실히 클 때만 연다.
   */
  function setupDrawerSwipe() {
    const area = $('screen-main');
    let x0 = 0, y0 = 0, tracking = false;

    area.addEventListener('touchstart', function (e) {
      if (openDrawerName || e.touches.length !== 1) { tracking = false; return; }
      // 글자를 고르는 중이거나 가로 스크롤되는 칸 위에서는 잡지 않는다.
      const t = e.target;
      if (t.closest('input, textarea, select, .drawer')) { tracking = false; return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    area.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      // 90px 이상 가로로, 그리고 세로 이동의 2배 넘게 움직였을 때만.
      if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 2) return;
      openDrawer(dx > 0 ? 'chars' : 'slots');
    }, { passive: true });
  }

  // ── 쓸어서 여러 줄 한꺼번에 켜고 끄기 ───────────────────────────────────
  // ★「전체 켜기/끄기」 는 전부 아니면 전무다. 실제로는 "이 구간만" 이 잦다.
  //   원을 누른 채 위아래로 쓸면 지나간 줄이 전부 첫 줄과 같은 상태가 된다.
  //   ─ 켜진 줄에서 시작하면 쓸고 간 자리가 꺼지고, 꺼진 줄에서 시작하면 켜진다.
  //
  // ★칠하는 동안에는 목록을 다시 그리지 않는다. 다시 그리면 손가락 밑의 요소가
  //   사라져 그 뒤로는 아무것도 안 칠해진다. 화면만 그 자리에서 고치고,
  //   저장과 다시 그리기는 손을 뗄 때 한 번만 한다.
  let paint = null;   // { kind, to, seen:Set }

  function paintRowAt(x, y) {
    if (!paint) return;
    const el = document.elementFromPoint(x, y);
    const row = el && el.closest ? el.closest('.drow') : null;
    if (!row || row.dataset.kind !== paint.kind) return;

    const i = Number(row.dataset.index);
    if (paint.seen.has(i)) return;
    paint.seen.add(i);

    const list = (paint.kind === 'chars') ? characters : slots;
    if (!list[i]) return;
    list[i].enabled = paint.to;

    row.classList.toggle('off', !paint.to);
    const dot = row.querySelector('.btn.icon');
    if (dot) dot.textContent = paint.to ? '●' : '○';
  }

  function startPaint(kind, i, ev) {
    const list = (kind === 'chars') ? characters : slots;
    if (!list[i]) return;
    // 첫 줄은 뒤집는다. 나머지는 그 결과를 따라간다.
    const to = (list[i].enabled === false);
    paint = { kind: kind, to: to, seen: new Set() };

    const pt = ev.touches ? ev.touches[0] : ev;
    paintRowAt(pt.clientX, pt.clientY);
  }

  function endPaint() {
    if (!paint) return;
    const kind = paint.kind;
    const n = paint.seen.size;
    paint = null;

    if (kind === 'chars') {
      Store.setCharacters(characters);
      renderCharDrawer();
      renderSlotTargetHint();
    } else {
      Store.setSlots(slots);
      renderSlotDrawer();
    }
    renderAnlas();

    // 여러 줄을 칠했을 때만 알린다 — 한 줄은 그냥 누른 것이라 말이 필요 없다.
    if (n > 1) {
      const list = (kind === 'chars') ? characters : slots;
      const on = list.filter(function (x) { return x.enabled !== false; }).length;
      toast(n + '개 바꿈 · ' + on + ' / ' + list.length + ' 켜짐');
    }
  }

  /** 서랍 목록에 칠하기 손짓을 건다. 목록마다 한 번만 부른다. */
  function setupPaint(listId, kind) {
    const box = $(listId);

    // ★passive:false 여야 preventDefault 가 듣는다. 안 그러면 칠하는 동안
    //   목록이 같이 스크롤되어 엉뚱한 줄이 칠해진다.
    box.addEventListener('touchmove', function (e) {
      if (!paint) return;
      e.preventDefault();
      const t = e.touches[0];
      paintRowAt(t.clientX, t.clientY);
    }, { passive: false });

    box.addEventListener('touchend', endPaint);
    box.addEventListener('touchcancel', endPaint);

    // PC 미리보기에서도 같은 손짓을 확인할 수 있게 마우스도 받는다.
    box.addEventListener('mousemove', function (e) {
      if (!paint || !e.buttons) return;
      paintRowAt(e.clientX, e.clientY);
    });
    box.addEventListener('mouseup', endPaint);
    box.addEventListener('mouseleave', endPaint);

    box.__paintKind = kind;
  }

  // ── 한꺼번에 켜고 끄기 ──────────────────────────────────────────────────
  // ★한 JSON 안에서도 일부만 쓰는 일이 잦다. 하나씩 누르는 것은 고통이다.
  function bulkSet(kind, mode) {
    const list = (kind === 'chars') ? characters : slots;
    if (!list.length) { toast('바꿀 것이 없습니다.'); return; }

    list.forEach(function (it) {
      if (mode === 'all') it.enabled = true;
      else if (mode === 'none') it.enabled = false;
      else it.enabled = (it.enabled === false);      // 반전
    });

    if (kind === 'chars') {
      Store.setCharacters(characters);
      renderCharDrawer();
      renderSlotTargetHint();
    } else {
      Store.setSlots(slots);
      renderSlotDrawer();
    }
    renderAnlas();

    const on = list.filter(function (x) { return x.enabled !== false; }).length;
    toast(on + ' / ' + list.length + ' 켜짐');
  }

  /** 인물을 하나 만들고 바로 고칠 수 있게 연다. */
  function addCharacter() {
    characters.push({ prompt: '', uc: '', coord: null, name: '', skipSlotPrompt: false, enabled: true });
    Store.setCharacters(characters);
    openDrawer('chars');
    renderCharDrawer();
    renderSlotTargetHint();
    openItemEdit('char', characters.length - 1);
  }

  /** 슬롯을 하나 만들고 바로 고칠 수 있게 연다. */
  function addSlot() {
    slots.push({ label: '', prompt: '', enabled: true });
    Store.setSlots(slots);
    openDrawer('slots');
    renderSlotDrawer();
    renderAnlas();
    openItemEdit('slot', slots.length - 1);
  }

  // ── 한 항목 수정창 ──────────────────────────────────────────────────────
  let editKind = null, editIndex = -1;

  function openItemEdit(kind, i) {
    editKind = kind;
    editIndex = i;

    const isChar = (kind === 'char');
    const list = isChar ? characters : slots;
    const it = list[i];
    if (!it) return;

    $('item-edit-title').textContent = isChar ? charName(it, i) : slotName(it, i);

    const box = $('item-edit-fields');
    box.innerHTML = '';

    const save = function () {
      if (isChar) Store.setCharacters(characters); else Store.setSlots(slots);
    };

    // 한 줄짜리 칸
    const mkText = function (labelText, key, placeholder, hint) {
      const f = document.createElement('label');
      f.className = 'field';
      const sp = document.createElement('span');
      sp.className = 'label';
      sp.textContent = labelText;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = it[key] || '';
      inp.placeholder = placeholder;
      inp.addEventListener('input', function () {
        it[key] = inp.value;
        save();
        $('item-edit-title').textContent = isChar ? charName(it, i) : slotName(it, i);
      });
      f.appendChild(sp);
      f.appendChild(inp);
      if (hint) {
        const hz = document.createElement('span');
        hz.className = 'hint';
        hz.textContent = hint;
        f.appendChild(hz);
      }
      return f;
    };

    // 여러 줄 칸 — 누르면 전체화면 편집기가 열린다
    const mkArea = function (labelText, key, rows, placeholder) {
      const f = document.createElement('label');
      f.className = 'field';
      const sp = document.createElement('span');
      sp.className = 'label';
      sp.textContent = labelText;
      const ta = document.createElement('textarea');
      ta.rows = rows;
      ta.value = it[key] || '';
      ta.placeholder = placeholder;
      ta.addEventListener('input', function () {
        it[key] = ta.value;
        save();
        if (!isChar) renderAnlas();
      });
      makeExpandable(ta, function () {
        return (isChar ? charName(it, i) : slotName(it, i)) + ' · ' + labelText;
      });
      f.appendChild(sp);
      f.appendChild(ta);
      return f;
    };

    if (isChar) {
      box.appendChild(mkText('이름', 'name', '예: 미아 — 비워 두면 「인물 ' + (i + 1) + '」',
        '목록에서 이 이름으로 보입니다. 그림에는 들어가지 않습니다.'));
      box.appendChild(mkArea('프롬프트', 'prompt', 3, '예: 1girl, blonde hair, red dress'));
      box.appendChild(mkArea('네거티브 (UC)', 'uc', 2, '이 인물에만 걸리는 네거티브'));

      const f = document.createElement('label');
      f.className = 'field';
      const sp = document.createElement('span');
      sp.className = 'label';
      sp.textContent = '위치';
      const sel = document.createElement('select');
      COORDS.forEach(function (o) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.text;
        sel.appendChild(opt);
      });
      sel.value = it.coord || '';
      sel.addEventListener('change', function () {
        it.coord = sel.value || null;
        save();
      });
      f.appendChild(sp);
      f.appendChild(sel);
      box.appendChild(f);
    } else {
      box.appendChild(mkText('이름', 'label', '예: happy', '저장 파일 이름에 쓰입니다.'));
      box.appendChild(mkArea('프롬프트', 'prompt', 4, '이 슬롯의 프롬프트 (예: smile, happy)'));
    }

    $('item-edit').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeItemEdit() {
    $('item-edit').hidden = true;
    editKind = null;
    editIndex = -1;
    // 서랍이 아직 떠 있으면 잠금을 유지한다.
    if (!openDrawerName && $('editor').hidden) document.body.style.overflow = '';
    renderCharDrawer();
    renderSlotDrawer();
    renderAnlas();
  }

  function deleteEditedItem() {
    if (editIndex < 0) return;
    const isChar = (editKind === 'char');
    const list = isChar ? characters : slots;
    const it = list[editIndex];
    const nm = isChar ? charName(it, editIndex) : slotName(it, editIndex);
    if (!window.confirm('「' + nm + '」 을(를) 지울까요?')) return;

    list.splice(editIndex, 1);
    if (isChar) Store.setCharacters(characters); else Store.setSlots(slots);
    closeItemEdit();
    renderSlotTargetHint();
    toast('지웠습니다.');
  }

  // ── 저장 위치 ────────────────────────────────────────────────────────────
  function activeDest() {
    if (activeDestId === Store.DEVICE_ID) return null;   // null = 폰
    return destinations.find(function (d) { return d.id === activeDestId; }) || null;
  }

  /**
   * 한 장을 정해진 위치에 저장한다.
   * @returns {Promise<string>} 어디에 저장했는지 사람이 읽을 문구
   */
  /**
   * 저장 직전 손질 — 생성 정보 기록/삭제, 형식 변환.
   * ★PNG 는 재인코딩하지 않는다. NAI 가 붙여 보낸 tEXt 청크(Title/Source 등)가
   *   살아 있어야 나중에 그 그림을 NAI 산출물로 되읽을 수 있다.
   * @returns {Promise<{bytes: Uint8Array, path: string}>}
   */
  async function prepareForSave(bytes, relPath, info) {
    let out = bytes;

    if (ImageUtil.isPng(out)) {
      try {
        out = options.strip_metadata
          ? ImageUtil.stripTexts(out)
          : ImageUtil.setTexts(out, { Comment: JSON.stringify(info) });
      } catch (e) {
        // 청크를 못 다뤄도 그림 자체는 저장한다.
      }
    }

    const fmt = options.save_format || 'png';
    if (fmt !== 'png') {
      const conv = await ImageUtil.convert(out, fmt, options.jpg_quality);
      out = conv.bytes;
      relPath = relPath.replace(/\.[^./]*$/, '') + conv.ext;
    }
    return { bytes: out, path: relPath };
  }

  /**
   * NAI 가 붙여 둔 tEXt(Title·Source 등)를 원본에서 옮겨 심는다.
   * ★다시 인코딩하면 사라지는데, 사라지면 그 그림을 NAI 산출물로 되읽지 못한다.
   */
  function copyNaiTexts(outBytes, srcBytes) {
    try {
      const texts = ImageUtil.getTexts(srcBytes);
      const keep = {};
      ImageUtil.NAI_TEXT_KEYS.forEach(function (k) {
        if (texts[k] !== undefined) keep[k] = texts[k];
      });
      return Object.keys(keep).length ? ImageUtil.setTexts(outBytes, keep) : outBytes;
    } catch (e) {
      return outBytes;   // 메타데이터를 못 옮겨도 그림은 그대로 쓴다.
    }
  }

  /**
   * 인핸스·업스케일 결과에 **원본의 투명도를 되살린다.**
   *
   * ★NAI 에 보내는 베이스 이미지는 알파를 흰 배경에 평탄화해서 보낸다 (backend.py 와
   *   같은 절차). 그래서 투명 배경으로 뽑은 그림을 인핸스하면 배경이 하얗게 붙어 돌아온다.
   * ★NAI 가 알파를 담아 돌려주면 그것을 그대로 쓰고, 불투명하게 왔을 때만 되살린다.
   * ★모양이 크게 달라지는 편집에는 쓸 수 없다 — 인핸스는 같은 그림을 다시 그리는 것이라
   *   실루엣이 거의 그대로여서 성립한다.
   */
  async function keepTransparency(outBytes, srcBytes) {
    try {
      const src = await ImageUtil.toImageData(srcBytes, 'image/png');
      if (Compose.detectAlpha(src.data) === 'none') return outBytes;   // 원본이 불투명하면 할 일이 없다
      const out = await ImageUtil.toImageData(outBytes, 'image/png');
      if (Compose.detectAlpha(out.data) !== 'none') return outBytes;   // 알파가 살아 왔으면 건드리지 않는다

      const fixed = Compose.restoreAlpha(
        { data: out.data, width: out.width, height: out.height },
        { data: src.data, width: src.width, height: src.height });
      const cv = ImageUtil.fromImageData(new ImageData(fixed.data, fixed.width, fixed.height));
      return copyNaiTexts(await ImageUtil.canvasToBytes(cv, 'image/png'), outBytes);
    } catch (e) {
      return outBytes;   // 되살리지 못해도 그림 자체는 내준다
    }
  }

  async function saveOne(bytes, relPath) {
    const dest = activeDest();
    if (!dest) {
      // 폰: Filesystem 은 폴더를 만들어 주므로 상대 경로를 그대로 넘긴다.
      return await NaiClient.saveImage(bytes, relPath);
    }
    const saved = await RemoteStore.upload(dest, relPath, NaiClient.toBase64(bytes));
    return dest.name + ' · ' + saved;
  }

  function renderDestSelect() {
    const sel = $('dest-select');
    sel.innerHTML = '';
    const items = [{ value: Store.DEVICE_ID, text: '이 폰' }].concat(
      destinations.map(function (d) { return { value: d.id, text: d.name }; })
    );
    items.forEach(function (it) {
      const o = document.createElement('option');
      o.value = it.value;
      o.textContent = it.text;
      sel.appendChild(o);
    });
    sel.value = items.some(function (i) { return i.value === activeDestId; })
      ? activeDestId : Store.DEVICE_ID;
    activeDestId = sel.value;

    const d = activeDest();
    $('dest-hint').textContent = d
      ? ('보낼 곳: ' + RemoteStore.baseUrl(d))
      : (NaiClient.isNative() ? '폰의 문서/PeroPix 아래에 저장합니다.'
        : '브라우저 미리보기에서는 다운로드로 떨어집니다.');
  }

  function say(el, text, kind) {
    el.textContent = text;
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.hidden = !text;
  }

  /** 잠깐 떴다 사라지는 알림. 화면 아래 고정이라 어디서 눌러도 보인다. */
  let toastTimer = null;
  function toast(text, ms) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 1800);
  }

  // ── 옵션 드롭다운 ────────────────────────────────────────────────────────
  function baseModelOf(m) { return NAI_TABLES.BASE_MODEL[m] || m; }

  function fillSelect(sel, items, value) {
    sel.innerHTML = '';
    items.forEach(function (it) {
      const o = document.createElement('option');
      o.value = it.value;
      o.textContent = it.text;
      sel.appendChild(o);
    });
    if (value !== undefined && items.some(function (i) { return i.value === value; })) {
      sel.value = value;
    }
  }

  const MODEL_LABELS = {
    'nai-diffusion-5-full': 'V5 Full',
    'nai-diffusion-5-curated': 'V5 Curated',
    'nai-diffusion-4-5-full': 'V4.5 Full',
    'nai-diffusion-4-5-curated': 'V4.5 Curated',
    'nai-diffusion-4-full': 'V4 Full',
    'nai-diffusion-4-curated-preview': 'V4 Curated'
  };

  function refreshModelDependent() {
    const model = $('opt-model').value;
    const base = baseModelOf(model);

    const ucList = NAI_TABLES.UC_PRESETS[base] || NAI_TABLES.UC_PRESETS['nai-diffusion-4-5-full'];
    fillSelect($('opt-uc'), ucList.map(function (r) {
      return { value: r[1], text: r[1] };
    }), options.uc_preset);
    // ★그 모델에 없는 프리셋이면 폴백된 것을 화면에도 반영한다 (조립부와 같은 규칙).
    if ($('opt-uc').value !== options.uc_preset) {
      const idx = ucList.findIndex(function (r) { return r[1] === $('opt-uc').value; });
      if (idx < 0) $('opt-uc').value = ucList[ucList.length - 1][1];
    }

    const qList = NAI_TABLES.QUALITY_PRESETS[base] || NAI_TABLES.QUALITY_PRESETS['nai-diffusion-4-5-full'];
    const QLABEL = { standard: '표준', light: '가볍게', none: '끔' };
    fillSelect($('opt-quality'), qList.map(function (r) {
      return { value: r[0], text: QLABEL[r[0]] || r[0] };
    }), options.quality_preset);

    // 모델이 못 하는 것은 화면에서 잠근다 (보내 봐야 무시되거나 돈만 나간다).
    const cap = NAI_TABLES.MODEL_CAPS[base] || NAI_TABLES.CAPS_FALLBACK;
    $('opt-variety').disabled = !cap.cfg_delay;
    if (!cap.cfg_delay) $('opt-variety').checked = false;

    // ★투명 배경은 transparency 능력이 있는 모델(V5)에서만 걸린다.
    $('opt-transparent').disabled = !cap.transparency;
    if (!cap.transparency) $('opt-transparent').checked = false;
    $('opt-transparent-row').title = cap.transparency ? '' : '이 모델은 투명 배경을 지원하지 않습니다';
    refreshTransparentRow();
    // 네거티브 칸 아래 안내에 지금 UC 프리셋을 그대로 비춰 준다.
    $('uc-preset-echo').textContent = $('opt-uc').value;
  }

  function refreshTransparentRow() {
    // Straight Alpha 는 투명 배경을 켰을 때만 의미가 있다.
    const on = $('opt-transparent').checked && !$('opt-transparent').disabled;
    $('opt-straight-alpha-row').hidden = !on;
  }

  function refreshQualityRow() {
    const f = $('opt-format').value;
    const show = (f === 'jpg' || f === 'webp');
    $('opt-quality-field').hidden = !show;
    $('opt-quality-val').textContent = show ? ('· ' + $('opt-jpg-quality').value) : '';
  }

  function fillOptionUI() {
    // ★표의 키 순서를 그대로 쓰면 V5 Curated 가 맨 뒤로 간다 (원본이 별도 대입으로 붙인다).
    //   화면에서는 신형→구형 순으로 보이게 MODEL_LABELS 의 순서를 따른다.
    const known = Object.keys(MODEL_LABELS).filter(function (m) {
      return NAI_TABLES.QUALITY_PRESETS[m];
    });
    const extra = Object.keys(NAI_TABLES.QUALITY_PRESETS).filter(function (m) {
      return known.indexOf(m) === -1;
    });
    fillSelect($('opt-model'), known.concat(extra).map(function (m) {
      return { value: m, text: MODEL_LABELS[m] || m };
    }), options.nai_model);
    fillSelect($('opt-sampler'), Object.keys(NAI_TABLES.SAMPLER_MAP).map(function (s) {
      return { value: s, text: s };
    }), options.sampler);
    refreshModelDependent();

    $('opt-width').value = options.width;
    $('opt-height').value = options.height;
    $('opt-steps').value = options.steps;
    $('opt-cfg').value = options.cfg;
    $('opt-negative').value = options.negative_prompt;
    $('opt-variety').checked = !!options.variety_plus;
    $('opt-autosave').checked = options.auto_save !== false;
    $('opt-cfg-rescale').value = options.cfg_rescale;
    $('opt-count').value = options.count_per_slot;
    $('opt-enh-replace').checked = !!options.enhance_replace_original;
    $('opt-one-char').checked = !!options.one_char_mode;
    $('drawer-one-char').checked = !!options.one_char_mode;
    $('opt-transparent').checked = !!options.transparent_bg;
    $('opt-straight-alpha').checked = !!options.straight_alpha;
    $('opt-format').value = options.save_format || 'png';
    $('opt-jpg-quality').value = options.jpg_quality || 95;
    $('opt-strip-meta').checked = !!options.strip_metadata;
    $('opt-notify').checked = options.notify_on_complete !== false;
    refreshTransparentRow();
    refreshQualityRow();
  }

  function readOptionUI() {
    options.nai_model = $('opt-model').value;
    options.uc_preset = $('opt-uc').value;
    options.quality_preset = $('opt-quality').value;
    options.sampler = $('opt-sampler').value;
    options.width = parseInt($('opt-width').value, 10) || 832;
    options.height = parseInt($('opt-height').value, 10) || 1216;
    options.steps = parseInt($('opt-steps').value, 10) || 28;
    options.cfg = parseFloat($('opt-cfg').value) || 5.0;
    options.negative_prompt = $('opt-negative').value;
    options.variety_plus = $('opt-variety').checked;
    options.auto_save = $('opt-autosave').checked;
    options.cfg_rescale = parseFloat($('opt-cfg-rescale').value) || 0.0;
    options.transparent_bg = $('opt-transparent').checked;
    options.straight_alpha = $('opt-straight-alpha').checked;
    options.save_format = $('opt-format').value;
    options.jpg_quality = parseInt($('opt-jpg-quality').value, 10) || 95;
    options.strip_metadata = $('opt-strip-meta').checked;
    options.notify_on_complete = $('opt-notify').checked;
    // ★1 미만이나 50 초과는 사고다. 조용히 잘라 준다.
    options.count_per_slot = Math.min(50, Math.max(1, parseInt($('opt-count').value, 10) || 1));
    options.enhance_replace_original = $('opt-enh-replace').checked;
    renderAnlas();
    renderOneChar();
    return Store.setOptions(options);
  }

  // ── 이름 규칙 ────────────────────────────────────────────────────────────
  /**
   * 지금 실제로 쓸 이름 규칙.
   * ★한 명 모드면 인물 이름을 폴더 한 겹으로 끼운다 — 안 그러면 미아의 1-1 과 리사의 1-1 이
   *   같은 경로가 되어 `_2` 가 붙고, 나중에 어느 것이 누구인지 알 수 없다.
   */
  function namingTemplateNow() {
    return oneCharOn() ? Naming.withChar(namingTemplate) : namingTemplate;
  }

  function renderNamingUI() {
    const sel = $('naming-preset');
    if (!sel.options.length) {
      Naming.PRESETS.forEach(function (p) {
        const o = document.createElement('option');
        o.value = p.template;
        o.textContent = p.name;
        sel.appendChild(o);
      });
      const custom = document.createElement('option');
      custom.value = '__custom__';
      custom.textContent = '직접 쓰기';
      sel.appendChild(custom);
    }
    const known = Naming.PRESETS.some(function (p) { return p.template === namingTemplate; });
    sel.value = known ? namingTemplate : '__custom__';
    $('naming-template').value = namingTemplate;
    renderNamingPreview();
  }

  function renderNamingPreview() {
    const first = slots.filter(function (s) { return s.enabled !== false; })[0];
    const firstChar = activeChars()[0];
    const sample = Naming.render(namingTemplateNow(), {
      persona: persona || '폴더이름',
      char: oneCharOn()
        ? charName(firstChar, characters.indexOf(firstChar))
        : undefined,
      label: (first && first.label) || 'happy',
      seq: 1,
      seed: 1234567,
      model: options ? options.nai_model : ''
    });
    const dest = activeDest();
    $('naming-preview').textContent =
      '예: ' + (dest ? (dest.name + ' · ') : '') + sample;
  }

  /**
   * 수신함이 찍어 주는 한 줄을 읽는다.
   *   peropix://호스트:포트#토큰      (http 기본)
   *   peropix+https://호스트#토큰     (https 강제)
   * ★주소와 토큰을 따로 옮겨 적게 하면 반드시 오타가 난다. 한 번에 받는다.
   * @returns {{ok:boolean, error?:string, url?:string, token?:string, name?:string}}
   */
  function parsePairString(raw) {
    const text = (raw || '').trim();
    if (!text) return { ok: false, error: '붙여넣은 것이 없습니다.' };

    const m = text.match(/^peropix(\+https)?:\/\/([^#\s]+)#(.+)$/i);
    if (!m) {
      return { ok: false, error: 'peropix:// 로 시작하는 한 줄이어야 합니다. 수신함 화면을 다시 보세요.' };
    }
    const scheme = m[1] ? 'https' : 'http';
    const hostPort = m[2].replace(/\/+$/, '');
    const token = m[3].trim();

    if (/이서버주소/.test(hostPort)) {
      return { ok: false, error: '주소가 아직 예시 그대로입니다. 폰에서 닿는 실제 주소로 바꿔서 붙여넣으세요.' };
    }
    if (token.length < 16) return { ok: false, error: '토큰이 너무 짧습니다 (16자 이상).' };

    return {
      ok: true,
      url: scheme + '://' + hostPort,
      token: token,
      name: hostPort.split(':')[0]
    };
  }

  async function applyPairString() {
    const box = $('dest-paste-msg');
    const r = parsePairString($('dest-paste').value);
    if (!r.ok) { say(box, r.error, 'err'); return; }

    // 같은 주소가 이미 있으면 토큰만 갈아 끼운다 (중복 등록을 막는다).
    const existing = destinations.find(function (d) {
      return RemoteStore.baseUrl(d) === RemoteStore.baseUrl({ url: r.url });
    });
    let dest;
    if (existing) {
      existing.token = r.token;
      dest = existing;
    } else {
      dest = { id: 'd' + Date.now().toString(36), name: r.name, url: r.url, token: r.token };
      destinations.push(dest);
    }
    await Store.setDestinations(destinations);

    say(box, '연결을 확인하는 중…');
    const ping = await RemoteStore.ping(dest);
    say(box, (existing ? '기존 대상의 토큰을 갱신했습니다. ' : '대상을 추가했습니다. ') + ping.message,
      ping.ok ? 'ok' : 'err');

    $('dest-paste').value = '';
    renderDestList();
    renderDestSelect();
    renderNamingPreview();
  }

  // ── 원격 저장 대상 관리 (설정 화면) ──────────────────────────────────────
  function renderDestList() {
    const box = $('dest-list');
    box.innerHTML = '';

    if (!destinations.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '등록된 대상이 없습니다. PC 나 VPS 를 추가해보세요.';
      box.appendChild(e);
      return;
    }

    destinations.forEach(function (d, i) {
      const el = document.createElement('div');
      el.className = 'slot';

      const mk = function (labelText, key, type, placeholder) {
        const f = document.createElement('label');
        f.className = 'field';
        const sp = document.createElement('span');
        sp.className = 'label';
        sp.textContent = labelText;
        const inp = document.createElement('input');
        inp.type = type;
        inp.value = d[key] || '';
        inp.placeholder = placeholder || '';
        inp.autocapitalize = 'off';
        inp.spellcheck = false;
        inp.addEventListener('input', function () {
          destinations[i][key] = inp.value;
          Store.setDestinations(destinations);
          renderDestSelect();
          renderNamingPreview();
        });
        f.appendChild(sp);
        f.appendChild(inp);
        return f;
      };

      el.appendChild(mk('이름', 'name', 'text', '예: 집 PC'));
      el.appendChild(mk('주소', 'url', 'text', '예: 192.168.0.5:8770'));
      el.appendChild(mk('토큰', 'token', 'text', 'receiver.py --new-token 으로 만든 값'));

      const msg = document.createElement('div');
      msg.className = 'msg';
      msg.hidden = true;

      const test = document.createElement('button');
      test.className = 'btn block';
      test.textContent = '연결 확인';
      test.addEventListener('click', async function () {
        const problem = Store.validateDestination(destinations[i]);
        if (problem) { say(msg, problem, 'err'); return; }
        say(msg, '확인하는 중…');
        const r = await RemoteStore.ping(destinations[i]);
        say(msg, r.message, r.ok ? 'ok' : 'err');
      });

      const del = document.createElement('button');
      del.className = 'btn danger block';
      del.textContent = '이 대상 삭제';
      del.addEventListener('click', function () {
        destinations.splice(i, 1);
        Store.setDestinations(destinations);
        if (!destinations.some(function (x) { return x.id === activeDestId; })) {
          activeDestId = Store.DEVICE_ID;
          Store.setActiveDest(activeDestId);
        }
        renderDestList();
        renderDestSelect();
        renderNamingPreview();
      });

      el.appendChild(msg);
      el.appendChild(test);
      el.appendChild(del);
      box.appendChild(el);
    });
  }

  // ── 폴더 관리 ────────────────────────────────────────────────────────────
  let folderDestId = Store.DEVICE_ID;
  let folderPath = '';

  function folderDest() {
    if (folderDestId === Store.DEVICE_ID) return null;
    return destinations.find(function (d) { return d.id === folderDestId; }) || null;
  }

  function renderFolderDestSelect() {
    const sel = $('folders-dest');
    sel.innerHTML = '';
    [{ value: Store.DEVICE_ID, text: '이 폰' }].concat(
      destinations.map(function (d) { return { value: d.id, text: d.name || '(이름 없음)' }; })
    ).forEach(function (it) {
      const o = document.createElement('option');
      o.value = it.value;
      o.textContent = it.text;
      sel.appendChild(o);
    });
    sel.value = folderDestId;
  }

  async function loadFolder(path) {
    const dest = folderDest();
    say($('folders-msg'), '읽는 중…');
    $('folders-list').innerHTML = '';
    try {
      const r = await Folders.browse(dest, path);
      folderPath = r.path || '';
      say($('folders-msg'), '');
      renderFolder(r);
      renderFavs();
      renderStar();
    } catch (e) {
      say($('folders-msg'), (e && e.message ? e.message : String(e)), 'err');
      $('folders-summary').textContent = '';
      $('folders-path').textContent = '/' + (path || '');
    }
  }

  function renderFolder(r) {
    $('folders-path').textContent = '/' + (r.path || '');
    $('folders-up').disabled = !r.path;
    $('folders-summary').textContent =
      '폴더 ' + r.dirs.length + ' · 파일 ' + r.files.length;

    const box = $('folders-list');
    box.innerHTML = '';

    if (!r.dirs.length && !r.files.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '비어 있습니다.';
      box.appendChild(e);
      return;
    }

    r.dirs.forEach(function (d) {
      box.appendChild(entryRow({
        name: d.name,
        isDir: true,
        sub: (d.count === null || d.count === undefined) ? '폴더' : (d.count + '장'),
        path: Folders.join(r.path, d.name)
      }));
    });

    r.files.forEach(function (f) {
      box.appendChild(entryRow({
        name: f.name,
        isDir: false,
        sub: Folders.humanSize(f.size),
        path: Folders.join(r.path, f.name)
      }));
    });
  }

  function entryRow(item) {
    const row = document.createElement('div');
    row.className = 'entry' + (item.isDir ? ' dir' : '');

    const icon = document.createElement('span');
    icon.className = 'entry-icon';
    icon.textContent = item.isDir ? '📁' : '🖼';

    const main = document.createElement('button');
    main.className = 'entry-main';
    main.innerHTML = '';
    const nm = document.createElement('span');
    nm.className = 'entry-name';
    nm.textContent = item.name;
    const sub = document.createElement('span');
    sub.className = 'entry-sub';
    sub.textContent = item.sub || '';
    main.appendChild(nm);
    main.appendChild(sub);
    if (item.isDir) {
      main.addEventListener('click', function () { loadFolder(item.path); });
    } else {
      main.disabled = true;
    }

    const ren = document.createElement('button');
    ren.className = 'btn icon';
    ren.textContent = '✎';
    ren.title = '이름 바꾸기';
    ren.addEventListener('click', async function () {
      const next = window.prompt('새 이름', item.name);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === item.name) return;
      try {
        const parent = Folders.parentOf(item.path);
        await Folders.rename(folderDest(), item.path, Folders.join(parent, trimmed));
        loadFolder(folderPath);
      } catch (e) {
        say($('folders-msg'), (e && e.message ? e.message : String(e)), 'err');
      }
    });

    const del = document.createElement('button');
    del.className = 'btn icon danger-text';
    del.textContent = '🗑';
    del.title = '지우기';
    del.addEventListener('click', async function () {
      if (!window.confirm('"' + item.name + '" 을(를) 지울까요?')) return;
      try {
        let r = await Folders.remove(folderDest(), item.path, item.isDir, false);
        if (r && r.needsConfirm) {
          // ★비어 있지 않은 폴더는 한 번 더 묻는다. 수백 장이 한 번에 날아가는 일을 막는다.
          const msg = '이 폴더 안에 파일이 ' + r.count + '개 있습니다.\n전부 지울까요? 되돌릴 수 없습니다.';
          if (!window.confirm(msg)) return;
          r = await Folders.remove(folderDest(), item.path, item.isDir, true);
        }
        loadFolder(folderPath);
      } catch (e) {
        say($('folders-msg'), (e && e.message ? e.message : String(e)), 'err');
      }
    });

    row.appendChild(icon);
    row.appendChild(main);
    row.appendChild(ren);
    row.appendChild(del);
    return row;
  }

  // ── 프리셋 ───────────────────────────────────────────────────────────────
  // ★참조 이미지는 담지 않는다. 프리셋 하나가 몇 MB 가 되면 저장소가 버티지 못한다.
  function renderPresetSelect() {
    const sel = $('preset-select');
    const cur = sel.value;
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = presets.length ? '프리셋 불러오기…' : '저장된 프리셋 없음';
    sel.appendChild(none);
    presets.forEach(function (p) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    if (cur && presets.some(function (p) { return p.id === cur; })) sel.value = cur;
    $('preset-del').disabled = !sel.value;
  }

  function snapshot() {
    return {
      options: Object.assign({}, options),
      persona: $('persona').value,
      basePrompt: $('base-prompt').value,
      characters: JSON.parse(JSON.stringify(characters)),
      slots: JSON.parse(JSON.stringify(slots)),
      slotTarget: slotTarget,
      namingTemplate: namingTemplate
    };
  }

  async function savePreset() {
    const name = window.prompt('프리셋 이름', persona || '내 설정');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    // 같은 이름이면 덮어쓴다 (물어본 뒤에).
    const existing = presets.find(function (p) { return p.name === trimmed; });
    if (existing && !window.confirm('"' + trimmed + '" 이(가) 이미 있습니다. 덮어쓸까요?')) return;

    const entry = {
      id: existing ? existing.id : ('p' + Date.now().toString(36)),
      name: trimmed,
      savedAt: new Date().toISOString(),
      data: snapshot()
    };
    presets = existing
      ? presets.map(function (p) { return p.id === existing.id ? entry : p; })
      : presets.concat([entry]);
    await Store.setPresets(presets);
    renderPresetSelect();
    $('preset-select').value = entry.id;
    $('preset-del').disabled = false;
  }

  async function loadPreset(id) {
    const p = presets.find(function (x) { return x.id === id; });
    if (!p || !p.data) return;
    const d = p.data;

    options = Object.assign({}, Store.DEFAULT_OPTIONS, d.options || {});
    persona = d.persona || '';
    characters = Array.isArray(d.characters) ? d.characters : [];
    slots = Array.isArray(d.slots) ? d.slots : [];
    slotTarget = (d.slotTarget === 'base') ? 'base' : 'char';
    namingTemplate = d.namingTemplate || Store.DEFAULT_TEMPLATE;

    await Promise.all([
      Store.setOptions(options), Store.setPersona(persona),
      Store.setCharacters(characters), Store.setSlots(slots),
      Store.setSlotTarget(slotTarget), Store.setNamingTemplate(namingTemplate),
      Store.setBasePrompt(d.basePrompt || '')
    ]);

    $('persona').value = persona;
    $('base-prompt').value = d.basePrompt || '';
    $('slot-target').value = slotTarget;
    fillOptionUI();
    renderChars();
    renderRefs();
    renderSlots();
    renderNamingUI();
    renderSlotTargetHint();
    renderAnlas();
  }

  async function deletePreset(id) {
    const p = presets.find(function (x) { return x.id === id; });
    if (!p) return;
    if (!window.confirm('"' + p.name + '" 프리셋을 지울까요?')) return;
    presets = presets.filter(function (x) { return x.id !== id; });
    await Store.setPresets(presets);
    renderPresetSelect();
  }

  // ── 인핸스 · 업스케일 ────────────────────────────────────────────────────
  // ★인핸스는 NAI 의 img2img 다 (해상도를 키워 다시 그린다).
  //   업스케일은 완전히 다른 API(/ai/upscale)로, 창작적 변형 없이 해상도만 4배 올린다.
  let enhTarget = null;      // { item } 또는 { batch: true }

  function align64(v) {
    const lo = Math.floor(v / 64) * 64;
    const hi = Math.ceil(v / 64) * 64;
    const r = (v - lo < hi - v) ? lo : hi;
    return r <= 0 ? 64 : r;
  }

  function enhScaleOptions(w, h) {
    // 원본 대비 배율. 너무 키우면 Anlas 가 급격히 오르므로 1.5~2.5 만 둔다.
    return [1.25, 1.5, 2.0, 2.5].map(function (k) {
      return { value: String(k), w: align64(w * k), h: align64(h * k), k: k };
    });
  }

  async function openEnhance(item, batch) {
    enhTarget = batch ? { batch: true } : { item: item };
    say($('enh-msg'), '');

    const targets = batch ? visibleItems() : [item];
    if (!targets.length) { window.alert('인핸스할 그림이 없습니다.'); return; }

    const first = targets[0];
    $('enh-title').textContent = batch ? ('일괄 인핸스 (' + targets.length + '장)') : '인핸스';
    $('enh-help').textContent = batch
      ? '결과에 있는 그림 전부를 해상도를 키워 다시 그립니다. 원본은 덮어쓰지 않고 새 장으로 추가됩니다.'
      : '이 그림을 해상도를 키워 다시 그립니다.';
    $('enh-preview').src = first.url;

    // ★투명 배경 그림은 인핸스해도 투명을 지킨다는 것을 알려 준다. 예전에는 배경이
    //   하얗게 붙어 나와서, 투명하게 뽑아 놓고도 인핸스를 못 쓰는 상태였다.
    ImageUtil.toImageData(first.bytes, 'image/png').then(function (d) {
      if (enhTarget && Compose.detectAlpha(d.data) !== 'none') {
        $('enh-help').textContent += ' 투명 배경은 그대로 지킵니다.';
      }
    }).catch(function () { /* 못 읽어도 안내만 빠질 뿐이다 */ });

    // 원본 크기는 저장해 둔 정보에서 읽는다 (없으면 현재 설정값).
    const info = first.saveInfo || {};
    const w = info.width || options.width;
    const h = info.height || options.height;

    const sel = $('enh-scale');
    sel.innerHTML = '';
    enhScaleOptions(w, h).forEach(function (o, i) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = '×' + o.k + '  (' + o.w + '×' + o.h + ')';
      sel.appendChild(opt);
      if (i === 1) sel.value = o.value;   // 기본 ×1.5
    });

    updateEnhCost();
    show('enhance');
  }

  function enhCurrentSize() {
    const t = enhTarget && enhTarget.batch ? visibleItems()[0] : (enhTarget ? enhTarget.item : null);
    const info = (t && t.saveInfo) || {};
    const w = info.width || options.width;
    const h = info.height || options.height;
    const k = parseFloat($('enh-scale').value) || 1.5;
    return { w: align64(w * k), h: align64(h * k) };
  }

  function updateEnhCost() {
    const size = enhCurrentSize();
    const n = enhTarget && enhTarget.batch ? visibleItems().length : 1;
    const strength = parseFloat($('enh-strength').value);
    $('enh-strength-val').textContent = strength.toFixed(2);
    $('enh-noise-val').textContent = parseFloat($('enh-noise').value).toFixed(2);
    $('enh-scale-val').textContent = size.w + '×' + size.h;

    const est = Anlas.estimate({
      width: size.w, height: size.h, steps: options.steps, model: options.nai_model,
      isOpus: subscription ? subscription.isOpus : false,
      opusExhausted: subscription ? subscription.opusExhausted : false,
      strength: strength, count: n
    });
    $('enh-cost').textContent = est.free
      ? (n + '장 · 무료')
      : ('예상 ' + est.total + ' Anlas (' + n + '장 · 장당 ' + est.perImage + ')');
    $('enh-cost').className = 'msg' + (est.free ? ' ok' : '');
  }

  /** 결과 하나를 새 항목으로 추가한다 (인핸스·업스케일 결과). */
  async function addDerived(bytes, srcItem, suffix, extraInfo, kind) {
    const name = (srcItem.name || 'image') + suffix;
    // ★원본이 어느 인물의 것이었는지 저장 정보에 남아 있다. 파생본도 그 폴더로 보낸다 —
    //   인핸스한 것만 인물 폴더 밖에 떨어지면 나중에 짝을 못 찾는다.
    const srcChar = (srcItem.saveInfo && srcItem.saveInfo.char) || '';
    const relPath = Naming.dedupe(Naming.render(
      srcChar ? Naming.withChar(namingTemplate) : namingTemplate, {
      persona: persona,
      char: srcChar || undefined,
      label: name,
      seq: results.length + 1,
      seed: (srcItem.saveInfo && srcItem.saveInfo.seed) || 0,
      model: options.nai_model
    }), usedPaths);

    // ★슬롯·부모를 물려받아야 결과 화면에서 "어느 원본의 인핸스인지" 가 보인다.
    const item = ResultsModel.make({
      slotLabel: srcItem.slotLabel,
      cycle: srcItem.cycle,
      kind: kind || 'enhanced',
      parentId: srcItem.id,
      name: name,
      filename: relPath,
      bytes: bytes,
      url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })),
      saveInfo: Object.assign({}, srcItem.saveInfo || {}, extraInfo || {})
    });

    if (options.auto_save) {
      try {
        const prepared = await prepareForSave(bytes, relPath, item.saveInfo);
        item.filename = prepared.path;
        item.savedTo = await saveOne(prepared.bytes, prepared.path);
      } catch (e) {
        item.error = '저장 실패: ' + (e && e.message ? e.message : e);
      }
    }
    results.push(item);
    renderResults();
    return item;
  }

  async function runEnhance() {
    if (running) return;
    const token = await Store.getToken();
    if (!token) { show('setup'); return; }

    const targets = enhTarget && enhTarget.batch ? visibleItems() : [enhTarget.item];
    if (!targets.length) return;

    const size = enhCurrentSize();
    const strength = parseFloat($('enh-strength').value);
    const noise = parseFloat($('enh-noise').value);

    running = true;
    cancelRequested = false;
    $('enh-run').disabled = true;
    let done = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (cancelRequested) break;
      const src = targets[i];
      say($('enh-msg'), '인핸스 중 ' + (i + 1) + '/' + targets.length + ' — ' + src.name);
      try {
        // ★베이스 이미지는 요청 해상도로 미리 맞춰 보낸다. 서버 리사이즈에 맡기면
        //   필터가 달라 초기 latent 가 바뀌고 데스크톱판과 결과가 갈린다.
        const processed = await ImageUtil.preprocessBaseImage(src.bytes, size.w, size.h);
        const info = src.saveInfo || {};
        const req = Object.assign({}, options, {
          width: size.w,
          height: size.h,
          prompt: info.prompt || $('base-prompt').value,
          negative_prompt: info.negative || options.negative_prompt,
          character_prompts_with_coords: info.characters || [],
          seed: (info.seed === undefined || info.seed === null) ? -1 : info.seed,
          base_image_processed: processed,
          base_strength: strength,
          base_noise: noise,
          // ★투명 배경으로 뽑은 그림은 인핸스도 투명으로 요청한다. 지금 화면의 체크박스를
          //   그대로 쓰면, 그 사이에 체크를 껐거나 모델을 바꿨을 때 배경이 붙어 나온다.
          transparent_bg: (info.transparent_bg === undefined)
            ? options.transparent_bg : info.transparent_bg,
          straight_alpha: (info.straight_alpha === undefined)
            ? options.straight_alpha : info.straight_alpha,
          enhance_prompt_add: true
        });
        const built = buildNaiPayload(req);
        const res = await NaiClient.generate(token, built, function (n, wait, err) {
          say($('enh-msg'), src.name + ' — ' + NaiClient.networkMessage(err)
            + ' · ' + Math.round(wait / 1000) + '초 뒤 다시 시도 (' + n + '/3)');
        });
        // ★베이스를 흰 배경에 평탄화해 보내므로 그림이 불투명하게 돌아온다.
        //   원본이 투명했다면 원본 알파를 다시 씌우고 섞인 흰색을 걷어낸다.
        const bytes = await keepTransparency(res.bytes, src.bytes);
        const made = await addDerived(bytes, src, '_enh',
          { width: size.w, height: size.h, seed: res.seed, enhanced_from: src.name }, 'enhanced');
        // ★인핸스가 성공했으면 원본을 정리한다 (설정에 따라). 최종본만 남기고 싶을 때.
        if (made && options.enhance_replace_original) {
          await deleteOne(src);
          renderResults();
        }
      } catch (e) {
        failed++;
        say($('enh-msg'), src.name + ' 실패: ' + NaiClient.networkMessage(e), 'err');
      }
      done++;
    }

    running = false;
    $('enh-run').disabled = false;
    const msg = done + '/' + targets.length + ' 완료' + (failed ? ', 실패 ' + failed + '건' : '');
    say($('enh-msg'), msg, failed ? 'err' : 'ok');
    refreshAnlas();
    if (!failed) setTimeout(function () { show('results'); }, 800);
  }

  /** NAI 업스케일 (×4). 창작적 변형이 없어 설정할 게 없다 — 바로 실행한다. */
  async function runUpscale(items) {
    if (running) return;
    const token = await Store.getToken();
    if (!token) { show('setup'); return; }
    const targets = items.filter(function (r) { return r && r.bytes; });
    if (!targets.length) return;

    running = true;
    const box = $('batch-msg');
    box.hidden = false;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const src = targets[i];
      say(box, '업스케일 중 ' + (i + 1) + '/' + targets.length + ' — ' + src.name);
      try {
        const info = src.saveInfo || {};
        const w = info.width || options.width;
        const h = info.height || options.height;
        const built = buildUpscalePayload(ImageUtil.toBase64(src.bytes), w, h, 4);
        const res = await NaiClient.upscale(token, built, function (n, wait, err) {
          say(box, src.name + ' — ' + NaiClient.networkMessage(err)
            + ' · ' + Math.round(wait / 1000) + '초 뒤 다시 시도 (' + n + '/3)');
        });
        const bytes = await keepTransparency(res.bytes, src.bytes);
        await addDerived(bytes, src, '_x4',
          { width: w * 4, height: h * 4, upscaled_from: src.name }, 'upscaled');
      } catch (e) {
        failed++;
        say(box, src.name + ' 실패: ' + NaiClient.networkMessage(e), 'err');
      }
    }

    running = false;
    say(box, targets.length + '장 처리 완료' + (failed ? ', 실패 ' + failed + '건' : ''),
      failed ? 'err' : 'ok');
    refreshAnlas();
  }

  // ── 배경 합성 ────────────────────────────────────────────────────────────
  // ★통신이 없다. Anlas 도 들지 않고 인터넷도 필요 없다 — 전부 폰 안에서 끝난다.
  // ★자리는 **알파 경계**로 잡는다. 슬롯마다 인물이 잡힌 크기·여백이 달라서,
  //   같은 배율로 얹으면 어떤 장은 배경 밖으로 나가고 어떤 장은 한가운데 뜬다.
  //   경계를 찾아 「높이의 92% · 바닥에서 2%」 로 맞추면 수십 장이 같은 자리에 선다.
  let cmpTarget = null;      // { item } 또는 { batch: true }
  let cmpBg = null;          // { name, w, h, data, canvas }
  let cmpFg = null;          // 미리보기 기준 { name, w, h, straight, bounds, detected, canvas }
  let cmpBgCache = null;     // 결과 크기로 줄여 둔 배경 — 같은 배경으로 여러 장 돌릴 때 재사용
  // 무작위 배치의 씨앗. ★Math.random 을 그냥 쓰면 미리보기를 다시 그릴 때마다 인물이 튄다.
  //   씨앗을 들고 있다가 「다시 굴려 보기」 를 눌렀을 때만 바꾼다. 장마다는 씨앗 + 번호를 쓴다.
  let cmpSeed = 1;

  const CMP_PREVIEW_MAX = 560;

  function cmpTargets() {
    if (!cmpTarget) return [];
    return cmpTarget.batch ? visibleItems() : (cmpTarget.item ? [cmpTarget.item] : []);
  }

  /** 화면의 값들을 Compose 가 읽는 모양으로 모은다. */
  function cmpSettings() {
    // ★최소·최대를 사용자가 뒤집어 놓을 수 있다. 뒤집힌 채로 넘기면 범위가 0 이 된다.
    const rMin = parseInt($('cmp-rand-min').value, 10) / 100;
    const rMax = parseInt($('cmp-rand-max').value, 10) / 100;
    return {
      out: $('cmp-out').value,
      fit: $('cmp-fit').value,
      mode: $('cmp-mode').value,
      alpha: $('cmp-alpha').value,
      fill: parseInt($('cmp-fill').value, 10) / 100,
      bottom: parseInt($('cmp-bottom').value, 10) / 100,
      scale: parseInt($('cmp-scale').value, 10) / 100,
      x: parseInt($('cmp-x').value, 10) / 100,
      y: parseInt($('cmp-y').value, 10) / 100,
      randMin: Math.min(rMin, rMax),
      randMax: Math.max(rMin, rMax),
      randomY: $('cmp-rand-y').checked
    };
  }

  /** PNG·JPEG 바이트를 픽셀과 캔버스로 풀어 둔다 (미리보기에 쓴다). */
  async function cmpDecode(bytes, mime) {
    const img = await ImageUtil.toImageData(bytes, mime);
    return { data: img.data, w: img.width, h: img.height };
  }

  function cmpCanvasOf(data, w, h) {
    return ImageUtil.fromImageData(new ImageData(
      data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data), w, h));
  }

  /** 뷰어·결과에서 넘어온 그림 한 장을 미리보기 기준으로 삼는다. */
  async function cmpLoadFg(item) {
    const d = await cmpDecode(item.bytes, 'image/png');
    const detected = Compose.detectAlpha(d.data);
    const s = $('cmp-alpha').value;
    const mode = (s === 'auto') ? detected : s;
    const straight = Compose.toStraight(d.data, mode);
    cmpFg = {
      name: item.name,
      w: d.w, h: d.h,
      straight: straight,
      bounds: Compose.alphaBounds(straight, d.w, d.h),
      detected: detected,
      canvas: cmpCanvasOf(straight, d.w, d.h)
    };
  }

  function renderCmpAlphaHint() {
    if (!cmpFg) { $('cmp-alpha-hint').textContent = ''; return; }
    const map = {
      premultiplied: '이 그림은 **미리 곱해진 알파**로 보입니다 (되돌려서 합칩니다).',
      straight: '이 그림은 Straight Alpha 로 보입니다.',
      none: '⚠ 이 그림에는 투명한 곳이 없습니다 — 배경이 통째로 가려집니다.'
    };
    $('cmp-alpha-hint').textContent = (map[cmpFg.detected] || '').replace(/\*\*/g, '');
  }

  function renderCmpRows() {
    const mode = $('cmp-mode').value;
    const s = cmpSettings();
    $('cmp-auto-rows').hidden = (mode !== 'auto');
    $('cmp-rand-rows').hidden = (mode !== 'random');
    $('cmp-manual-rows').hidden = (mode !== 'manual');
    // 바닥 여백은 바닥에 세우는 두 경우에만 뜻이 있다.
    $('cmp-bottom-row').hidden = !(mode === 'auto' || (mode === 'random' && !s.randomY));

    $('cmp-fill-val').textContent = $('cmp-fill').value + '%';
    $('cmp-bottom-val').textContent = $('cmp-bottom').value + '%';
    $('cmp-scale-val').textContent = $('cmp-scale').value + '%';
    $('cmp-x-val').textContent = $('cmp-x').value + '%';
    $('cmp-y-val').textContent = $('cmp-y').value + '%';
    $('cmp-rand-val').textContent =
      Math.round(s.randMin * 100) + '% ~ ' + Math.round(s.randMax * 100) + '%';

    const hint = {
      auto: '인물이 그려진 사각형을 찾아 크기와 자리를 맞춥니다. 장마다 인물이 잡힌 크기가 달라도 같은 자리에 섭니다.',
      random: '장마다 크기와 자리를 다르게 뽑습니다. 인물이 화면 밖으로 잘리지 않는 범위 안에서만 뽑습니다.',
      'as-is': '원본 크기 그대로 얹습니다. 인물과 배경 크기가 같을 때 제일 정확합니다.',
      manual: '값을 직접 정합니다. 고른 값이 모든 장에 똑같이 걸립니다.'
    };
    $('cmp-mode-hint').textContent = hint[mode] || '';
  }

  /**
   * 미리보기. ★여기서는 캔버스 drawImage 로 빠르게 그린다 (슬라이더가 따라와야 한다).
   *   실제 합성은 lanczos3 로 다시 한다 — 자리는 같은 placement() 로 잡으므로 어긋나지 않는다.
   */
  function renderCmpPreview() {
    const cv = $('cmp-preview');
    if (!cmpFg) { cv.hidden = true; $('cmp-preview-hint').textContent = ''; return; }

    const s = cmpSettings();
    const place = Compose.placement(Object.assign({
      fgW: cmpFg.w, fgH: cmpFg.h,
      bgW: cmpBg ? cmpBg.w : cmpFg.w,
      bgH: cmpBg ? cmpBg.h : cmpFg.h,
      bounds: cmpFg.bounds,
      rng: Compose.rngFrom(cmpSeed)
    }, s));

    const k = Math.min(1, CMP_PREVIEW_MAX / Math.max(place.width, place.height));
    cv.hidden = false;
    cv.width = Math.max(1, Math.round(place.width * k));
    cv.height = Math.max(1, Math.round(place.height * k));
    const cx = cv.getContext('2d');
    cx.clearRect(0, 0, cv.width, cv.height);
    if (cmpBg) {
      cx.drawImage(cmpBg.canvas,
        place.bg.x * k, place.bg.y * k, place.bg.w * k, place.bg.h * k);
    }
    cx.drawImage(cmpFg.canvas,
      place.fg.x * k, place.fg.y * k, place.fg.w * k, place.fg.h * k);

    const n = cmpTargets().length;
    const many = (s.mode === 'random')
      ? ' (미리보기는 한 번 뽑아 본 것 — 실제로는 ' + n + '장이 저마다 다른 자리에 섭니다)'
      : ' (미리보기는 첫 장, 실제로는 ' + n + '장에 같은 설정이 걸립니다)';
    $('cmp-preview-hint').textContent =
      place.width + '×' + place.height + ' · ' + cmpFg.name + (n > 1 ? many : '');
  }

  async function openCompose(item, batch) {
    cmpTarget = batch ? { batch: true } : { item: item };
    say($('cmp-msg'), '');

    const targets = cmpTargets();
    if (!targets.length) { window.alert('합성할 그림이 없습니다.'); return; }

    $('cmp-title').textContent = batch ? ('일괄 배경 합성 (' + targets.length + '장)') : '배경 합성';
    $('cmp-help').textContent = batch
      ? '보이는 그림 전부를 같은 배경 위에 얹습니다. 원본은 그대로 두고 새 장으로 추가됩니다. Anlas 는 들지 않습니다.'
      : '이 그림을 배경 위에 얹습니다. 원본은 그대로 두고 새 장으로 추가됩니다. Anlas 는 들지 않습니다.';

    show('compose');
    try {
      await cmpLoadFg(targets[0]);
    } catch (e) {
      say($('cmp-msg'), '그림을 읽지 못했습니다: ' + (e && e.message ? e.message : e), 'err');
      return;
    }
    renderCmpRows();
    renderCmpAlphaHint();
    renderCmpPreview();
  }

  async function pickBackground(file) {
    if (!file) return;
    try {
      say($('cmp-msg'), '배경을 읽는 중…');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const d = await cmpDecode(bytes, file.type || 'image/png');
      cmpBg = {
        name: file.name || '배경',
        w: d.w, h: d.h,
        data: d.data,
        canvas: cmpCanvasOf(d.data, d.w, d.h)
      };
      cmpBgCache = null;
      $('cmp-bg-name').textContent = cmpBg.name + ' · ' + d.w + '×' + d.h;
      say($('cmp-msg'), '');
      renderCmpPreview();
    } catch (e) {
      say($('cmp-msg'), '배경을 읽지 못했습니다: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  /** 합성 결과를 PNG 바이트로. ★NAI 가 붙여 둔 tEXt 는 원본에서 그대로 옮겨 온다. */
  async function cmpEncode(result, srcBytes) {
    const cv = cmpCanvasOf(result.data, result.width, result.height);
    return copyNaiTexts(await ImageUtil.canvasToBytes(cv, 'image/png'), srcBytes);
  }

  async function runCompose() {
    if (running) return;
    if (!cmpBg) { say($('cmp-msg'), '먼저 배경 그림을 고르세요.', 'err'); return; }
    const targets = cmpTargets();
    if (!targets.length) return;

    const s = cmpSettings();
    running = true;
    $('cmp-run').disabled = true;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const src = targets[i];
      say($('cmp-msg'), '합치는 중 ' + (i + 1) + '/' + targets.length + ' — ' + src.name);
      // ★한 장씩 화면에 숨 돌릴 틈을 준다. 안 그러면 진행 문구가 끝날 때 한 번에 뜬다.
      await new Promise(function (r) { setTimeout(r, 0); });
      try {
        const fg = await cmpDecode(src.bytes, 'image/png');
        const res = Compose.composite(Object.assign({
          fg: { data: fg.data, width: fg.w, height: fg.h },
          bg: { data: cmpBg.data, width: cmpBg.w, height: cmpBg.h },
          bgScaled: cmpBgCache,
          // ★장마다 다른 씨앗을 준다. 하나만 쓰면 무작위인데도 전부 같은 자리에 선다.
          rng: Compose.rngFrom(cmpSeed + i * 7919)
        }, s));
        cmpBgCache = res.bgScaled;
        const bytes = await cmpEncode(res, src.bytes);
        await addDerived(bytes, src, '_bg', {
          width: res.width, height: res.height,
          background: cmpBg.name,
          compose: {
            mode: s.mode, fit: s.fit, out: s.out, alpha: res.alphaMode,
            scale: Number(res.place.scale.toFixed(4)),
            x: res.place.fg.x, y: res.place.fg.y,
            seed: (s.mode === 'random') ? (cmpSeed + i * 7919) : undefined
          }
        }, 'composed');
      } catch (e) {
        failed++;
        say($('cmp-msg'), src.name + ' 실패: ' + (e && e.message ? e.message : e), 'err');
      }
    }

    running = false;
    $('cmp-run').disabled = false;
    const okCount = targets.length - failed;
    say($('cmp-msg'), okCount + '/' + targets.length + ' 완료'
      + (failed ? ', 실패 ' + failed + '건' : ''), failed ? 'err' : 'ok');
    if (!failed) setTimeout(function () { show('results'); }, 800);
  }

  // ── 원격 작업 ────────────────────────────────────────────────────────────
  // ★PC·VPS 수신함에 누군가(예: Claude Code)가 올려 둔 「이거 뽑으세요」 를 받아 온다.
  //   ★키도 Anlas 도 이 폰 것이다 — 그래서 실행 여부는 언제나 여기서 정한다.
  //     「받으면 바로 실행」 을 켜야만 묻지 않고 돈다.
  //   ★결과는 그 수신함으로 저장된다. 올린 쪽이 결과를 봐야 왕복이 완성되기 때문이다.
  let jobsSource = 'dest';    // 'dest' 수신함 | 'github' 저장소 지시함
  let ghCfg = { repo: '', branch: 'main', token: '' };
  let ghDone = [];            // 이미 실행한 작업 id (폰이 기억한다)
  let jobsDestId = null;      // 어느 수신함에서 받을지
  let jobsAuto = false;       // 받으면 바로 실행
  let jobsList = [];
  let jobTimer = null;
  let activeJob = null;       // { id, dest, total } — 지금 돌고 있는 원격 작업
  let jobReportAt = 0;

  const JOB_POLL_MS = 8000;

  /**
   * GitHub 에 GET 한 번. ★안드로이드에서는 CapacitorHttp 로 부른다 (WebView 의 CORS 회피).
   * 토큰이 있으면 붙인다 — 비공개 저장소를 읽으려면 필요하고, API 한도도 넉넉해진다.
   */
  async function ghGet(url, accept) {
    const headers = { 'Cache-Control': 'no-cache' };
    const token = (ghCfg.token || '').trim();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (accept) headers.Accept = accept;

    const explain = function (status) {
      if (status === 404) return '찾지 못했습니다 (저장소·브랜치·경로를 확인하세요).';
      if (status === 401 || status === 403) {
        return '읽을 권한이 없습니다 (비공개면 읽기 전용 토큰이 필요합니다. '
          + '토큰 없이 자주 부르면 GitHub 이 잠깐 막기도 합니다).';
      }
      return 'GitHub 이 ' + status + ' 로 답했습니다.';
    };

    const C = window.Capacitor;
    const P = (C && C.Plugins) ? C.Plugins : null;
    if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && P && P.CapacitorHttp) {
      const r = await P.CapacitorHttp.request({
        method: 'GET', url: url, headers: headers, connectTimeout: 20000, readTimeout: 30000
      });
      if (r.status >= 400) throw new Error(explain(r.status));
      return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    }

    const r = await fetch(url, { headers: headers, cache: 'no-store' });
    if (!r.ok) throw new Error(explain(r.status));
    return await r.text();
  }

  /** 저장소 전체 목록 (한 번에). */
  async function ghFetchTree() {
    const url = Github.treeUrl(ghCfg);
    if (!url) throw new Error('저장소를 읽지 못했습니다 (owner/repo 로 적어 주세요).');
    return Github.parseTree(await ghGet(url, 'application/vnd.github+json'));
  }

  /** 파일 하나. ★공개 저장소는 raw(CDN)로 — API 한도를 쓰지 않는다. */
  async function ghFetchFile(path) {
    const token = (ghCfg.token || '').trim();
    const url = token ? Github.apiFileUrl(ghCfg, path) : Github.rawUrl(ghCfg, path, Date.now());
    const text = await ghGet(url, token ? 'application/vnd.github.raw' : null);
    const parsed = Github.parseJson(text);
    if (!parsed.ok) throw new Error(path + ' — ' + parsed.error);
    return parsed.data;
  }

  function renderGhRows() {
    $('jobs-source').value = jobsSource;
    $('jobs-dest-row').hidden = (jobsSource !== 'dest');
    $('jobs-gh-rows').hidden = (jobsSource !== 'github');
    $('gh-repo').value = ghCfg.repo || '';
    $('gh-branch').value = ghCfg.branch || '';
    $('gh-token').value = ghCfg.token || '';

    const web = Github.webUrl(ghCfg);
    $('gh-hint').textContent = web
      ? (web + ' · 이미 한 작업 ' + ghDone.length + '건을 기억하고 있습니다.')
      : '저장소를 적으면 여기에 주소가 보입니다. 없으면 아래에서 만들 수 있습니다.';
    // 저장소가 없으면 만들기 안내를 펼쳐 둔다.
    $('gh-setup').open = !Github.parseRepo(ghCfg.repo);
  }

  function readGhForm() {
    ghCfg = {
      repo: $('gh-repo').value.trim(),
      branch: $('gh-branch').value.trim() || 'main',
      token: $('gh-token').value.trim()
    };
    return Store.setGithub(ghCfg);
  }

  /** AI 에게 그대로 붙여넣을 세팅 지시. ★규약 파일은 AI 가 만든다 — 앱은 저장소에 못 쓴다. */
  function ghSetupPrompt() {
    const repo = Github.parseRepo(ghCfg.repo);
    const where = repo ? (repo.owner + '/' + repo.repo) : '<내 저장소 owner/repo>';
    return [
      '저장소 ' + where + ' 를 PeroPix 모바일의 「지시함」 으로 세팅해 줘.',
      '',
      '1. AGENTS.md 와 CLAUDE.md 를 만들어, 아래 규약을 그대로 적어 둘 것',
      '   (두 파일 내용은 같아도 된다 — Codex 는 AGENTS.md, Claude Code 는 CLAUDE.md 를 읽는다).',
      '2. 폴더 구조',
      '     <작품 이름>/characters/*.json   인물 (그 작품 안에서 공용)',
      '     <작품 이름>/slots/*.json        슬롯 묶음. 파일 하나가 작업 하나',
      '3. 슬롯 파일 모양',
      '     { "name": "미아 · 일상", "prefix": "공통 태그",',
      '       "slots": [ { "name": "1-1", "content": "슬롯 태그" } ],',
      '       "options": { "count_per_slot": 1 } }',
      '   인물 파일 모양',
      '     { "name": "미아", "content": "1girl, silver hair" }',
      '4. 규칙',
      '   - 슬롯 파일이 새로 생기거나 내용이 바뀌면 폰 앱이 그것을 새 작업으로 뽑는다.',
      '     그러니 파일을 고치는 것은 곧 생성 요청이다. 시험 삼아 고치지 말 것.',
      '   - 인물 파일을 고치는 것은 작업을 만들지 않는다 (다음 실행 때 최신 인물이 쓰인다).',
      '   - 저장 폴더는 작품 폴더 이름을 쓴다. 슬롯 파일에 folder 를 적으면 그것이 이긴다.',
      '   - options 는 아는 값만: nai_model, width, height, steps, cfg, sampler, uc_preset,',
      '     quality_preset, negative_prompt, count_per_slot, one_char_mode, transparent_bg,',
      '     straight_alpha, save_format, variety_plus, seed',
      '   - 한 번에 수십 장이 나가는 지시는 돈이 든다. 새 작업은 작게 시작할 것.',
      '5. 예시로 작품 하나(폴더 + 인물 1명 + 슬롯 2개)를 만들어 커밋해 줘.',
      '',
      '규약 전문(그대로 써도 된다):',
      'https://raw.githubusercontent.com/lulus-cat/peropix-mobile/main/docs/inbox/AGENTS.md'
    ].join('\n');
  }

  async function copyText(text) {
    const C = window.Capacitor;
    if (C && C.Plugins && C.Plugins.Clipboard) {
      try { await C.Plugins.Clipboard.write({ string: text }); return true; } catch (e) { /* 아래로 */ }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 아래로 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // ── 작가 태그 ─────────────────────────────────────────────────────────────
  // 찾기(실시간 조회) → 서랍(엄선·갈래·섞기) → 깎기(범인 찾기) 가 한 화면에 있다.
  // ★실제 계산은 danbooru.js / artists.js / bisect.js 가 한다. 여기는 화면과 통신만.
  let artDrawer = [];          // 엄선해 둔 작가들
  let artMix = [];             // 지금 섞고 있는 것
  let artCur = null;           // 지금 펼쳐 본 작가
  let artTab = 'find';
  let artTotal = 0;            // Danbooru 전체 장수 (특징 태그의 분모)
  let drwF = { q: '', cat: '', fav: false };
  let acTimer = null;
  let lastBaked = '';          // 작가 태그 칸에 넣어 둔 조합 (다시 넣을 때 갈아 끼우려고)
  let bis = null;              // 깎기 상태
  let bisSaved = null;         // 깎기 전 슬롯·프롬프트·시드 (그만두면 되돌린다)
  let bisScan = null;          // 세기 훑기 중인가

  /**
   * Danbooru 에 묻는다. ★토큰이 없다 — 이쪽은 비로그인으로 열려 있고 CORS 도 열려 있다.
   *   안드로이드에서는 그래도 CapacitorHttp 를 쓴다 (웹뷰가 막는 경우를 피하려고).
   */
  async function dbGet(url) {
    if (!url) return '';
    const C = window.Capacitor;
    const P = (C && C.Plugins) ? C.Plugins : null;
    if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && P && P.CapacitorHttp) {
      const r = await P.CapacitorHttp.request({
        method: 'GET', url: url, connectTimeout: 15000, readTimeout: 25000
      });
      if (r.status >= 400) throw new Error('Danbooru 가 ' + r.status + ' 로 답했습니다.');
      return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    }
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      throw new Error(r.status === 429
        ? '너무 자주 물었습니다. 잠깐 뒤에 다시 해 주세요.'
        : 'Danbooru 가 ' + r.status + ' 로 답했습니다.');
    }
    return r.text();
  }

  function artMsg(text, bad) {
    const el = $('art-msg');
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
  }

  async function openArtists() {
    show('artists');
    setArtTab(artTab);
    renderDrawer();
    renderMix();
    renderBisSetup();
    // ★깎기는 뽑으러 메인으로 갔다가 돌아온다. 다시 그리지 않으면 「답하기」 가 안 뜬다.
    renderBis();
    // 전체 장수는 한 번만 물어 둔다 (특징 태그의 분모).
    if (!artTotal) {
      try { artTotal = Danbooru.parseTotal(await dbGet(Danbooru.totalUrl())); } catch (e) { /* 없어도 된다 */ }
    }
  }

  function setArtTab(name) {
    artTab = name;
    ['find', 'drawer', 'bisect'].forEach(function (n) {
      $('tab-' + n).classList.toggle('on', n === name);
      $('pane-' + n).hidden = (n !== name);
    });
    window.scrollTo(0, 0);
  }

  // ── 찾기 ──────────────────────────────────────────────────────────────────
  function renderAutocomplete(rows) {
    const box = $('art-ac');
    box.innerHTML = '';
    box.hidden = !rows.length;
    rows.forEach(function (r) {
      const b = document.createElement('button');
      const left = document.createElement('span');
      left.textContent = r.name.replace(/_/g, ' ');
      if (r.via) {
        const via = document.createElement('span');
        via.className = 'via';
        via.textContent = ' ← ' + r.via.replace(/_/g, ' ');
        left.appendChild(via);
      }
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = r.count.toLocaleString() + '장';
      b.appendChild(left);
      b.appendChild(n);
      b.addEventListener('click', function () {
        $('art-q').value = r.name.replace(/_/g, ' ');
        box.hidden = true;
        artLoad(r.name);
      });
      box.appendChild(b);
    });
  }

  function onArtInput() {
    const q = $('art-q').value.trim();
    if (acTimer) clearTimeout(acTimer);
    if (q.length < 2) { $('art-ac').hidden = true; return; }
    // ★글자마다 부르면 한도를 친다. 손이 멈춘 뒤에 한 번만 묻는다.
    acTimer = setTimeout(async function () {
      try {
        renderAutocomplete(Danbooru.parseAutocomplete(await dbGet(Danbooru.autocompleteUrl(q))));
      } catch (e) {
        $('art-ac').hidden = true;
      }
    }, 300);
  }

  /** 한 작가를 펼쳐 본다 — 반영율·통계·그림까지 한 번에. */
  async function artLoad(name) {
    const tag = Danbooru.normalize(name);
    if (!tag) return;
    artMsg('찾는 중…');
    $('art-detail').hidden = true;
    try {
      const rating = $('art-rating').value;
      const [tagBody, artistBody, postBody] = await Promise.all([
        dbGet(Danbooru.tagUrl(tag)),
        dbGet(Danbooru.artistUrl(tag)).catch(function () { return '[]'; }),
        dbGet(Danbooru.postsUrl({ name: tag, rating: rating, limit: 100 }))
      ]);

      const found = Danbooru.parseTags(tagBody)[0];
      const posts = JSON.parse(postBody || '[]');
      if (!found && !posts.length) {
        artMsg('그런 작가 태그가 없습니다. 철자나 별명을 확인해 보세요.', true);
        return;
      }
      const st = Danbooru.stats(posts);
      // 특징 태그를 재려면 「남들은 얼마나 그리는가」 가 필요하다 — 한 번에 묻는다.
      let dist = [];
      if (st && artTotal) {
        try {
          const names = st.topTags.map(function (t) { return t.name; });
          const g = Danbooru.countMap(Danbooru.parseTags(await dbGet(Danbooru.tagCountsUrl(names))));
          dist = Danbooru.distinctive(st.topTags, g, artTotal);
        } catch (e) { /* 없으면 잦은 태그만 보여 준다 */ }
      }

      artCur = {
        tag: tag,
        count: found ? found.count : 0,
        deprecated: found ? found.deprecated : false,
        artist: Danbooru.parseArtist(artistBody),
        stats: st,
        dist: dist,
        before: Danbooru.beforeShare(posts, 2024),
        images: Danbooru.images(posts, { max: 24 })
      };
      artMsg('');
      renderArtDetail();
    } catch (e) {
      artMsg(e.message || String(e), true);
    }
  }

  function renderArtDetail() {
    const a = artCur;
    if (!a) return;
    $('art-detail').hidden = false;
    $('art-name').textContent = a.tag.replace(/_/g, ' ');
    const alias = (a.artist && a.artist.others.length)
      ? ('별명: ' + a.artist.others.slice(0, 6).map(function (n) { return n.replace(/_/g, ' '); }).join(', '))
      : '';
    $('art-alias').textContent = (a.artist && a.artist.banned) ? '★Danbooru 에서 차단된 작가입니다.' : alias;

    const r = Danbooru.reach(a.count, { deprecated: a.deprecated });
    const fill = $('art-reach-fill');
    fill.style.width = (r.level * 20) + '%';
    fill.className = 'lv' + r.level;
    $('art-reach-label').textContent = '반영율 ' + r.label;
    $('art-reach-note').textContent = r.note;

    // 통계 알갱이들
    const box = $('art-stats');
    box.innerHTML = '';
    const add = function (label, value) {
      if (value === '' || value === null || value === undefined) return;
      const d = document.createElement('span');
      d.className = 'art-stat';
      d.innerHTML = label + ' <b></b>';
      d.querySelector('b').textContent = value;
      box.appendChild(d);
    };
    const st = a.stats;
    if (st) {
      add('표본', st.sampled + '장');
      if (st.era) add('평균', st.era + '년');
      if (a.before) add(a.before.year + '년 이전', a.before.share + '%');
      add('등급', st.rating.map(function (x) { return x.label + ' ' + x.pct + '%'; }).join(' · '));
      if (st.copyright.length) add('주로', st.copyright[0].name.replace(/_/g, ' ')
        + ' ' + st.copyright[0].pct + '%');
      add('혼자', st.solo + '%');
      if (st.mono >= 10) add('흑백', st.mono + '%');
      if (st.comic >= 10) add('만화', st.comic + '%');
      if (st.landscape >= 25) add('가로', st.landscape + '%');
    }

    // 태그 알갱이 — 특징(×N)을 먼저, 그다음 잦은 것
    const chips = $('art-tags');
    chips.innerHTML = '';
    a.dist.slice(0, 8).forEach(function (t) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = t.name.replace(/_/g, ' ') + ' ×' + t.times;
      c.title = '남들보다 ' + t.times + '배 자주 그립니다';
      chips.appendChild(c);
    });
    (st ? st.topTags : []).slice(0, 8).forEach(function (t) {
      if (a.dist.some(function (d) { return d.name === t.name; })) return;
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = t.name.replace(/_/g, ' ') + ' ' + t.pct + '%';
      chips.appendChild(c);
    });

    // 그림
    const grid = $('art-grid');
    grid.innerHTML = '';
    a.images.forEach(function (im) {
      const link = document.createElement('a');
      link.href = im.web;
      link.target = '_blank';
      link.rel = 'noreferrer';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = im.thumb;
      img.alt = '';
      link.appendChild(img);
      grid.appendChild(link);
    });
    if (!a.images.length) {
      grid.innerHTML = '<p class="hint">이 수위에서는 보여 줄 그림이 없습니다.</p>';
    }

    $('art-keep').textContent = Artists.has(artDrawer, a.tag) ? '서랍에 있음' : '서랍에 담기';
  }

  // ── 서랍 ──────────────────────────────────────────────────────────────────
  function renderDrawer() {
    $('tab-drawer-n').textContent = artDrawer.length ? String(artDrawer.length) : '';

    const cats = $('drw-cats');
    cats.innerHTML = '';
    const chip = function (label, on, fn) {
      const c = document.createElement('button');
      c.className = 'chip' + (on ? ' on' : '');
      c.textContent = label;
      c.addEventListener('click', fn);
      cats.appendChild(c);
    };
    chip('전체', !drwF.cat, function () { drwF.cat = ''; renderDrawer(); });
    Artists.categories(artDrawer).forEach(function (c) {
      chip(c.name + ' ' + c.count, drwF.cat === c.name, function () {
        drwF.cat = (drwF.cat === c.name) ? '' : c.name;
        renderDrawer();
      });
    });
    chip('갈래 없음', drwF.cat === '__none__', function () {
      drwF.cat = (drwF.cat === '__none__') ? '' : '__none__';
      renderDrawer();
    });
    $('drw-fav').classList.toggle('on', drwF.fav);

    const list = $('drw-list');
    list.innerHTML = '';
    const rows = Artists.filter(artDrawer, drwF);
    if (!rows.length) {
      list.innerHTML = '<p class="hint">'
        + (artDrawer.length ? '이 조건에 맞는 작가가 없습니다.'
          : '「찾기」에서 마음에 드는 작가를 담아 두세요.') + '</p>';
      return;
    }
    rows.forEach(function (e) {
      const row = document.createElement('div');
      row.className = 'drw-row' + (artMix.some(function (m) { return m.tag === e.tag; }) ? ' picked' : '');

      const fav = document.createElement('button');
      fav.className = 'btn small';
      fav.textContent = e.fav ? '★' : '☆';
      fav.addEventListener('click', async function () {
        artDrawer = Artists.toggleFav(artDrawer, e.tag);
        await Store.setArtists(artDrawer);
        renderDrawer();
      });

      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = e.tag.replace(/_/g, ' ');
      if (e.cats.length) {
        const c = document.createElement('div');
        c.className = 'drw-cats';
        c.textContent = e.cats.join(' · ');
        nm.appendChild(c);
      }
      nm.addEventListener('click', function () { addToMix(e.tag); });

      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = Danbooru.reach(e.count, { deprecated: false }).label;

      const cat = document.createElement('button');
      cat.className = 'btn small';
      cat.textContent = '갈래';
      cat.addEventListener('click', async function () {
        const name = window.prompt('갈래 이름 (이미 있는 것을 다시 적으면 뗍니다)', '');
        if (name === null) return;
        artDrawer = Artists.toggleCat(artDrawer, e.tag, name.trim());
        await Store.setArtists(artDrawer);
        renderDrawer();
      });

      const del = document.createElement('button');
      del.className = 'btn small';
      del.textContent = '빼기';
      del.addEventListener('click', async function () {
        artDrawer = Artists.remove(artDrawer, e.tag);
        await Store.setArtists(artDrawer);
        renderDrawer();
      });

      row.appendChild(fav);
      row.appendChild(nm);
      row.appendChild(n);
      row.appendChild(cat);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  async function addToMix(tag) {
    if (artMix.some(function (m) { return m.tag === tag; })) {
      artMix = artMix.filter(function (m) { return m.tag !== tag; });
    } else {
      artMix = Artists.mix(artMix.concat([{ tag: tag }]));
    }
    await Store.setArtistMix(artMix);
    renderMix();
    renderDrawer();
  }

  function mixBaked() {
    return Artists.bake(artMix, { normalize: $('mix-norm').checked });
  }

  function renderMix() {
    const box = $('mix-list');
    box.innerHTML = '';
    $('mix-empty').hidden = artMix.length > 0;

    const shown = $('mix-norm').checked ? Artists.normalize(artMix) : artMix;
    artMix.forEach(function (m, i) {
      const row = document.createElement('div');
      row.className = 'mix-row' + (m.on ? '' : ' off');

      const top = document.createElement('div');
      top.className = 'mix-top';

      const on = document.createElement('button');
      on.className = 'btn small';
      on.textContent = m.on ? '켬' : '끔';
      on.addEventListener('click', async function () {
        artMix = Artists.toggleOn(artMix, m.tag);
        await Store.setArtistMix(artMix);
        renderMix();
      });

      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = m.tag.replace(/_/g, ' ');

      const w = document.createElement('span');
      w.className = 'mix-w';
      // ★합 고정을 켜면 실제로 나가는 값은 다르다. 슬라이더가 가리키는 값이 아니라
      //   **나가는 값**을 보여 준다 — 안 그러면 프롬프트와 화면이 어긋난다.
      w.textContent = shown[i].weight.toFixed(2);

      const del = document.createElement('button');
      del.className = 'btn small';
      del.textContent = '×';
      del.addEventListener('click', async function () {
        artMix = artMix.filter(function (x) { return x.tag !== m.tag; });
        await Store.setArtistMix(artMix);
        renderMix();
        renderDrawer();
      });

      top.appendChild(on);
      top.appendChild(nm);
      top.appendChild(w);
      top.appendChild(del);

      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(Artists.W_MIN);
      range.max = String(Artists.W_MAX);
      range.step = String(Artists.W_STEP);
      range.value = String(m.weight);
      range.addEventListener('input', function () {
        artMix = Artists.setWeight(artMix, m.tag, parseFloat(range.value));
        renderMix();
      });
      range.addEventListener('change', function () { Store.setArtistMix(artMix); });

      row.appendChild(top);
      row.appendChild(range);
      box.appendChild(row);
    });

    $('mix-out').value = mixBaked();
  }

  /**
   * 작가 태그 칸에 넣는다.
   * ★앞서 넣어 둔 조합이 그대로 남아 있으면 **갈아 끼운다.** 그냥 앞에 덧붙이면
   *   누를 때마다 같은 작가가 쌓여 세기가 몇 배가 된다.
   */
  async function applyMix() {
    const baked = mixBaked();
    if (!baked) { toast('섞은 작가가 없습니다.', 2000); return; }
    const el = $('base-prompt');
    let rest = el.value;
    if (lastBaked && rest.indexOf(lastBaked) === 0) {
      rest = rest.slice(lastBaked.length).replace(/^\s*,\s*/, '');
    }
    el.value = rest.trim() ? (baked + ', ' + rest.trim()) : baked;
    lastBaked = baked;
    await Store.setBasePrompt(el.value);
    toast('작가 태그 칸에 넣었습니다.', 2000);
  }

  // ── 깎기 ──────────────────────────────────────────────────────────────────
  function bisTags() {
    return $('bis-tags').value.split(/[,\n]/).map(function (t) {
      return Danbooru.normalize(t.replace(/^[\d.]+::/, '').replace(/::$/, ''));
    }).filter(Boolean);
  }

  function renderBisSetup() {
    const tags = bisTags();
    const seeds = [1];
    const st = Bisect.start({
      tags: tags, seeds: seeds, cross: $('bis-cross').checked
    });
    const e = Bisect.estimate(st);
    $('bis-est').textContent = tags.length < 2
      ? '후보를 두 명 이상 적어 주세요.'
      : ('후보 ' + tags.length + '명 · ' + e.rounds + '라운드 · 모두 ' + e.total + '장'
        + (bisCost(e.total) ? (' · 약 ' + bisCost(e.total) + ' Anlas') : ''));
    $('bis-start').disabled = tags.length < 2;
  }

  /** 이만큼 뽑으면 Anlas 가 얼마나 드는지. 기존 계산기를 그대로 쓴다. */
  function bisCost(count) {
    try {
      const cap = NAI_TABLES.MODEL_CAPS[baseModelOf(options.nai_model)] || NAI_TABLES.CAPS_FALLBACK;
      const est = Anlas.estimate({
        width: options.width, height: options.height, steps: options.steps,
        model: options.nai_model,
        isOpus: subscription ? subscription.isOpus : false,
        opusExhausted: subscription ? subscription.opusExhausted : false,
        refCount: cap.char_ref ? references.length : 0,
        count: Math.max(1, count)
      });
      return est ? (est.total || 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  function renderBis() {
    const on = !!bis;
    $('bis-setup').hidden = on;
    $('bis-run').hidden = !on;
    if (!on) return;

    $('bis-sum').textContent = Bisect.summary(bis);
    const step = Bisect.plan(bis);
    const box = $('bis-step');
    box.innerHTML = '';

    if (step) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = step.note;
      box.appendChild(note);
      step.shots.forEach(function (s) {
        const d = document.createElement('div');
        d.className = 'bis-shot';
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = s.name + ' — 작가 ' + s.tags.length + '명'
          + (s.removed.length ? (' (뺀 사람 ' + s.removed.length + ')') : '');
        const tg = document.createElement('div');
        tg.className = 'tags';
        tg.textContent = s.removed.length
          ? ('뺌: ' + s.removed.map(function (t) { return t.replace(/_/g, ' '); }).join(', '))
          : '아무도 빼지 않음';
        d.appendChild(nm);
        d.appendChild(tg);
        box.appendChild(d);
      });
    }

    $('bis-shoot').hidden = !step;
    $('bis-done').hidden = !(bis.culprit && bis.done);
    renderBisAsk(step);
  }

  function renderBisAsk(step) {
    const ask = $('bis-ask');
    const btns = $('bis-ask-btns');
    btns.innerHTML = '';
    // 뽑기 전에는 물을 것이 없다. 뽑고 온 뒤에만 답을 받는다.
    if (!step || !bis.shot) { ask.hidden = true; return; }
    ask.hidden = false;

    if (step.kind === 'reference') {
      $('bis-ask-q').textContent = '기준 그림을 보셨나요? 이 그림에 있는 요소를 앞으로 찾습니다.';
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.textContent = '봤습니다 · 다음';
      b.addEventListener('click', function () { bisAnswer({}); });
      btns.appendChild(b);
      return;
    }

    const word = bis.goal === 'drop' ? '거슬리는 요소' : '그 요소';
    $('bis-ask-q').textContent = '뽑은 그림에서 ' + word + '가 아직 보이나요?';
    const rows = bis.cross ? ['L', 'R'] : ['L'];
    const answers = {};
    rows.forEach(function (side) {
      const label = side === 'L' ? '빼기L' : '빼기R';
      ['남아 있다', '사라졌다'].forEach(function (text, i) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = label + ' — ' + text;
        b.addEventListener('click', function () {
          answers[side] = (i === 0);
          b.classList.add('primary');
          Array.from(btns.children).forEach(function (x) {
            if (x !== b && x.textContent.indexOf(label) === 0) x.disabled = true;
          });
          if (rows.every(function (s) { return answers[s] !== undefined; })) bisAnswer(answers);
        });
        btns.appendChild(b);
      });
    });
  }

  async function bisAnswer(answers) {
    bis = Bisect.answer(bis, answers);
    bis.shot = false;
    renderBis();
  }

  /** 이번 라운드를 실제로 뽑는다 — 슬롯으로 구워 기존 생성 경로를 그대로 탄다. */
  async function bisShoot() {
    if (running) { toast('지금 뽑는 중입니다.', 2000); return; }
    const step = Bisect.plan(bis);
    if (!step) return;

    const n = step.shots.length;
    if (!window.confirm('이번 라운드 ' + n + '장을 뽑을까요?\n\n'
      + '★지금 슬롯이 깎기용으로 바뀝니다 (그만두면 되돌립니다).\n'
      + '시드는 ' + bis.seeds[0] + ' 로 고정됩니다.')) return;

    slots = step.shots.map(function (s) {
      return { label: s.name, prompt: Artists.bake(Artists.mix(s.tags), {}), enabled: true };
    });
    options.seed = bis.seeds[0];
    options.count_per_slot = 1;
    await Store.setSlots(slots);
    await Store.setOptions(options);
    fillOptionUI();
    renderSlots();

    bis.shot = true;
    show('main');
    toast('깎기 ' + n + '장을 뽑습니다. 끝나면 결과를 보고 돌아와 답해 주세요.', 3500);
    await runGeneration();
  }

  /** 범인의 세기를 훑는다 — 1차원이라 가짓수가 곱해지지 않는다. */
  async function bisScanRun() {
    if (!bis || !bis.culprit) return;
    const base = Artists.mix(bis.base);
    const steps = Artists.scan(base, bis.culprit);
    if (!window.confirm('세기 ' + steps.length + '칸을 뽑을까요? ('
      + steps.map(function (s) { return s.weight; }).join(' / ') + ')')) return;

    slots = steps.map(function (s) {
      return { label: '세기-' + s.weight, prompt: s.prompt, enabled: true };
    });
    options.seed = bis.seeds[0];
    options.count_per_slot = 1;
    await Store.setSlots(slots);
    await Store.setOptions(options);
    fillOptionUI();
    renderSlots();
    bisScan = true;
    show('main');
    await runGeneration();
  }

  async function bisStart() {
    const tags = bisTags();
    if (tags.length < 2) return;
    const seedRaw = parseInt($('bis-seed').value, 10);
    const seed = (isFinite(seedRaw) && seedRaw >= 0) ? seedRaw : Math.floor(Math.random() * 1e9);
    $('bis-seed').value = String(seed);

    // ★깎기 전 상태를 챙겨 둔다. 그만두면 그대로 되돌린다 —
    //   남의 슬롯을 말없이 갈아 치우고 끝내면 하던 작업이 날아간다.
    bisSaved = {
      slots: JSON.parse(JSON.stringify(slots)),
      base: $('base-prompt').value,
      seed: options.seed,
      per: options.count_per_slot
    };
    bis = Bisect.start({
      tags: tags, seed: seed, cross: $('bis-cross').checked, goal: $('bis-goal').value
    });
    bis.shot = false;
    bisScan = null;

    // 작가 태그 칸에서 후보를 빼 둔다 — 슬롯으로 들어가므로 두 번 실리면 안 된다.
    const el = $('base-prompt');
    let text = el.value;
    tags.forEach(function (t) {
      const plain = t.replace(/_/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('(^|,)\\s*[\\d.]*:?:?\\s*' + plain + '\\s*:?:?\\s*(?=,|$)', 'gi'), '$1');
    });
    el.value = text.replace(/,\s*,/g, ',').replace(/^\s*,\s*|\s*,\s*$/g, '').trim();
    await Store.setBasePrompt(el.value);

    renderBis();
  }

  async function bisStop() {
    if (bisSaved && window.confirm('깎기를 그만두고 원래 슬롯으로 되돌릴까요?')) {
      slots = bisSaved.slots;
      $('base-prompt').value = bisSaved.base;
      options.seed = bisSaved.seed;
      options.count_per_slot = bisSaved.per;
      await Store.setSlots(slots);
      await Store.setBasePrompt(bisSaved.base);
      await Store.setOptions(options);
      fillOptionUI();
      renderSlots();
    }
    bis = null;
    bisSaved = null;
    renderBis();
    renderBisSetup();
  }

  function jobsDest() {
    return destinations.find(function (d) { return d.id === jobsDestId; }) || null;
  }

  function renderJobsDestSelect() {
    const sel = $('jobs-dest');
    sel.innerHTML = '';
    destinations.forEach(function (d) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name || d.url;
      sel.appendChild(o);
    });
    if (!destinations.some(function (d) { return d.id === jobsDestId; })) {
      jobsDestId = destinations.length ? destinations[0].id : null;
    }
    if (jobsDestId) sel.value = jobsDestId;

    const d = jobsDest();
    $('jobs-dest-hint').textContent = d
      ? ('받아 오는 곳: ' + RemoteStore.baseUrl(d) + ' · 결과도 여기로 저장됩니다.')
      : '등록된 PC·VPS 수신함이 없습니다. 설정에서 먼저 추가하세요.';
  }

  /** 이 작업이 몇 장짜리인지 (예상). 실행 전에 사람이 판단할 근거다. */
  function jobShots(spec) {
    const slots = (spec && spec.slots) ? spec.slots.length : 0;
    const chars = (spec && spec.characters) ? spec.characters.filter(function (c) {
      return c.enabled !== false;
    }).length : 0;
    const opts = (spec && spec.options) || {};
    const per = Math.max(1, parseInt(opts.count_per_slot, 10) || 1);
    const one = !!opts.one_char_mode && chars > 0;
    return slots * per * (one ? chars : 1);
  }

  function renderJobsBadge() {
    const n = jobsList.filter(function (j) { return j.status === 'pending'; }).length;
    const b = $('jobs-badge');
    b.textContent = n > 9 ? '9+' : String(n);
    b.hidden = n === 0;
  }

  function renderJobs() {
    renderJobsBadge();
    const box = $('jobs-list');
    box.innerHTML = '';
    if (!jobsList.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = (jobsSource === 'github')
        ? (Github.parseRepo(ghCfg.repo) ? '새 작업이 없습니다.' : '저장소를 적어 주세요.')
        : (jobsDest() ? '기다리는 작업이 없습니다.' : '');
      box.appendChild(e);
      return;
    }

    jobsList.forEach(function (j) {
      const row = document.createElement('div');
      row.className = 'job-row ' + (j.status || '');

      const nm = document.createElement('div');
      nm.className = 'job-name';
      nm.textContent = j.name || '작업';
      row.appendChild(nm);

      const meta = document.createElement('div');
      meta.className = 'job-meta';
      const spec = j.spec || {};
      const bits = [];
      const STATUS = { pending: '기다리는 중', running: '도는 중', done: '끝남',
        failed: '실패', cancelled: '취소됨' };
      bits.push(STATUS[j.status] || j.status);
      bits.push('슬롯 ' + ((spec.slots || []).length) + '개');
      if ((spec.characters || []).length) bits.push('인물 ' + spec.characters.length + '명');
      bits.push('약 ' + jobShots(spec) + '장');
      if (spec.folder) bits.push('폴더 ' + spec.folder);
      if (j.progress && j.progress.total) bits.push(j.progress.done + '/' + j.progress.total);
      if (j.error) bits.push('⚠ ' + j.error);
      meta.textContent = bits.join(' · ') + '\n' + (j.createdAt || '');
      meta.style.whiteSpace = 'pre-line';
      row.appendChild(meta);

      const tools = document.createElement('div');
      tools.className = 'toolrow';
      if (j.status === 'more') {
        box.appendChild(row);
        return;   // 「그 밖에 N건」 은 안내일 뿐이다
      }
      if (j.status === 'pending' || j.status === 'failed') {
        const run = document.createElement('button');
        run.className = 'btn small primary';
        run.textContent = '실행';
        run.disabled = running;
        run.addEventListener('click', function () { startJob(j, false); });
        tools.appendChild(run);
      }
      const del = document.createElement('button');
      del.className = 'btn small danger';
      // ★GitHub 지시는 저장소를 건드리지 않는다 — 대신 「한 것」 으로 표시해 넘긴다.
      del.textContent = (j.source === 'github') ? '건너뛰기' : '지우기';
      del.addEventListener('click', async function () {
        try {
          if (j.source === 'github') {
            ghDone = Github.rememberDone(ghDone, j.id);
            await Store.setGithubDone(ghDone);
          } else {
            const d = jobsDest();
            if (!d) return;
            await RemoteStore.deleteJob(d, j.id);
          }
          await loadJobs();
        } catch (e) {
          say($('jobs-msg'), e.message || String(e), 'err');
        }
      });
      tools.appendChild(del);
      row.appendChild(tools);
      box.appendChild(row);
    });
  }

  async function loadJobs(quiet) {
    if (jobsSource === 'github') {
      if (!Github.parseRepo(ghCfg.repo)) {
        jobsList = [];
        renderJobs();
        if (!quiet) say($('jobs-msg'), '저장소를 먼저 적어 주세요.', 'err');
        return;
      }
      try {
        const files = await ghFetchTree();
        const planned = Github.plan(files, ghDone);
        // ★이미 한 것(같은 내용)은 뺀다. 파일을 고치면 SHA 가 바뀌어 다시 뜬다.
        const fresh = Github.pending(planned.jobs, ghDone);

        // 몇 장짜리인지 미리 보여 주려면 슬롯 파일을 읽어야 한다. 한 번에 너무 많이 읽지 않는다.
        const LOOK = 12;
        jobsList = [];
        for (let i = 0; i < fresh.length && i < LOOK; i++) {
          const j = fresh[i];
          let spec = null;
          try {
            spec = Github.mergeSpec(await ghFetchFile(j.slotPath), [], j.work);
          } catch (e) {
            // 읽지 못한 파일은 목록에 이유와 함께 남긴다 (조용히 사라지면 왜 안 도는지 모른다).
            jobsList.push({ id: j.id, name: j.name, status: 'failed', source: 'github',
              gh: j, spec: { slots: [] }, error: (e.message || String(e)) });
            continue;
          }
          jobsList.push({ id: j.id, name: j.name, status: 'pending', source: 'github',
            gh: j, spec: spec });
        }
        if (fresh.length > LOOK) {
          jobsList.push({ id: '__more__', name: '… 그 밖에 ' + (fresh.length - LOOK) + '건',
            status: 'more', source: 'github', spec: { slots: [] } });
        }
        const skipped = planned.jobs.length - fresh.length;
        if (!quiet) {
          say($('jobs-msg'), jobsList.length
            ? ('새 작업 ' + jobsList.length + '건' + (skipped ? (' · 이미 한 것 ' + skipped + '건은 건너뜀') : ''))
            : (skipped ? ('새 작업이 없습니다 (이미 한 것 ' + skipped + '건).') : '지시 파일이 비어 있습니다.'),
            'ok');
        }
        renderJobs();
        renderGhRows();
      } catch (e) {
        jobsList = [];
        renderJobs();
        if (!quiet) say($('jobs-msg'), (e.message || String(e)), 'err');
      }
      return;
    }

    const d = jobsDest();
    if (!d) { jobsList = []; renderJobs(); return; }
    try {
      jobsList = (await RemoteStore.listJobs(d)).map(function (j) {
        return Object.assign({ source: 'dest' }, j);
      });
      if (!quiet) say($('jobs-msg'), '');
      renderJobs();
    } catch (e) {
      jobsList = [];
      renderJobs();
      if (!quiet) say($('jobs-msg'), '받아 오지 못했습니다: ' + (e.message || e), 'err');
    }
  }

  /** 작업 JSON 을 화면 상태로 옮긴다. ★가져오기와 같은 길을 쓴다. */
  async function applyJobSpec(spec, dest) {
    const parsed = PerofixImport.parse(JSON.stringify(spec));
    if (!parsed.ok) throw new Error('작업 JSON 을 읽지 못했습니다: ' + parsed.error);

    // ★parse() 는 이미 앱이 쓰는 모양으로 돌려준다 (가져오기 화면과 같은 값).
    //   여기서 한 번 더 옮겨 담으면 라벨이 사라져 파일 이름이 slot1, slot2 가 된다.
    slots = parsed.slots;
    if (parsed.prefix) $('base-prompt').value = parsed.prefix;

    const chars = PerofixImport.parseCharacters(JSON.stringify(spec));
    if (chars.ok && chars.characters.length) characters = chars.characters;

    persona = String(spec.folder || spec.persona || persona || '').trim();
    $('persona').value = persona;

    // 옵션 덮어쓰기 — 아는 것만 받는다 (모르는 값이 들어와 페이로드가 뒤틀리지 않게).
    const OK_OPTS = ['nai_model', 'width', 'height', 'steps', 'cfg', 'sampler', 'uc_preset',
      'quality_preset', 'negative_prompt', 'count_per_slot', 'one_char_mode',
      'transparent_bg', 'straight_alpha', 'save_format', 'variety_plus', 'seed'];
    const given = spec.options || {};
    OK_OPTS.forEach(function (k) {
      if (given[k] !== undefined) options[k] = given[k];
    });
    // ★저장은 켠다 — 지시를 받아 돌린 것이니 결과가 남아야 한다.
    options.auto_save = true;
    // 수신함에서 온 지시면 결과도 그리로 보낸다 (올린 쪽이 결과를 봐야 왕복이 완성된다).
    // GitHub 지시는 되돌려 줄 곳이 없으므로 **지금 저장 위치를 그대로 쓴다** (폰이든 수신함이든).
    if (dest) activeDestId = dest.id;

    await Store.setSlots(slots);
    await Store.setCharacters(characters);
    await Store.setBasePrompt($('base-prompt').value);
    await Store.setPersona(persona);
    await Store.setActiveDest(activeDestId);
    await Store.setOptions(options);

    fillOptionUI();
    renderSlots();
    renderCharDrawer();
    renderDestSelect();
    renderNamingUI();
    renderAnlas();
  }

  /** 진행을 수신함에 알린다. ★너무 자주 부르면 배치가 느려진다 — 2초에 한 번으로 묶는다. */
  function reportJobProgress(done, total) {
    if (!activeJob) return;
    activeJob.total = total;
    const now = Date.now();
    if (now - jobReportAt < 2000 && done < total) return;
    jobReportAt = now;
    RemoteStore.updateJob(activeJob.dest, {
      id: activeJob.id, status: 'running', progress: { done: done, total: total }
    }).catch(function () { /* 알리기에 실패해도 뽑는 것은 계속한다 */ });
  }

  async function startJob(job, auto) {
    if (running) return;
    const fromGithub = (job.source === 'github');
    const d = fromGithub ? null : jobsDest();
    if (!fromGithub && !d) return;

    const shots = jobShots(job.spec || {});
    if (!auto) {
      const ok = window.confirm(
        '「' + (job.name || '작업') + '」 을 실행할까요?\n\n'
        + '약 ' + shots + '장을 뽑고 Anlas 를 씁니다.\n'
        + '지금 슬롯·인물·폴더 이름이 이 작업 것으로 바뀝니다.');
      if (!ok) return;
    }

    // ★수신함 지시는 집어 온다 — 서버가 running 으로 바꿔 다른 폰이 또 뽑지 못하게 한다.
    //   GitHub 은 저장소에 쓰지 않으므로, 대신 폰이 한 것을 기억해 두 번 돌지 않게 한다.
    let claimed = job;
    try {
      if (fromGithub && job.gh) {
        // ★인물은 **뽑기 직전에** 읽는다. 목록을 그릴 때마다 읽으면 요청만 늘고,
        //   그 사이에 인물이 고쳐졌다면 최신 것으로 뽑는 편이 맞다.
        const chars = [];
        for (let i = 0; i < job.gh.charPaths.length; i++) {
          chars.push(await ghFetchFile(job.gh.charPaths[i]));
        }
        claimed = {
          id: job.id,
          name: job.name,
          spec: Github.mergeSpec(await ghFetchFile(job.gh.slotPath), chars, job.gh.work)
        };
      }
      if (!fromGithub && job.status === 'pending') {
        claimed = await RemoteStore.claimJob(d);
        if (!claimed || claimed.id !== job.id) {
          say($('jobs-msg'), '다른 쪽이 먼저 집어 갔습니다. 목록을 새로 고칩니다.', 'err');
          await loadJobs();
          return;
        }
      }
      await applyJobSpec(claimed.spec || {}, d);
    } catch (e) {
      say($('jobs-msg'), (e.message || String(e)), 'err');
      if (!fromGithub) {
        try { await RemoteStore.updateJob(d, { id: job.id, status: 'failed', error: String(e.message || e) }); } catch (e2) { /* 알리기 실패는 넘어간다 */ }
      }
      await loadJobs(true);
      return;
    }

    // 진행 알림은 수신함에만 보낸다 (GitHub 은 되돌려 줄 곳이 없다).
    activeJob = d ? { id: claimed.id, dest: d, total: shots } : null;
    jobReportAt = 0;
    say($('jobs-msg'), '「' + (claimed.name || '작업') + '」 을 뽑는 중입니다…');
    show('main');

    const total = shots;
    try {
      await runGeneration();
      const saved = ResultsModel.live(results).filter(function (r) { return r.savedTo && r.filename; });
      const failed = ResultsModel.live(results).filter(function (r) { return r.error && !r.bytes; });

      if (fromGithub) {
        // ★한 것을 기억한다. 지시 파일을 지우지 않아도 다시 돌지 않는다.
        ghDone = Github.rememberDone(ghDone, claimed.id);
        await Store.setGithubDone(ghDone);
        say($('jobs-msg'), '「' + (claimed.name || '작업') + '」 ' + saved.length + '장 완료'
          + (failed.length ? (' · 실패 ' + failed.length + '장') : ''), failed.length ? 'err' : 'ok');
      } else {
        await RemoteStore.updateJob(d, {
          id: claimed.id,
          status: failed.length && !saved.length ? 'failed' : 'done',
          progress: { done: saved.length, total: total },
          files: saved.map(function (r) { return r.filename; }),
          error: failed.length ? (failed.length + '장 실패') : ''
        });
      }
    } catch (e) {
      if (!fromGithub) {
        try {
          await RemoteStore.updateJob(d, { id: claimed.id, status: 'failed', error: String(e.message || e) });
        } catch (e2) { /* 알리기 실패는 넘어간다 */ }
      } else {
        say($('jobs-msg'), (e.message || String(e)), 'err');
      }
    } finally {
      activeJob = null;
      await loadJobs(true);
    }
  }

  /** 자동 모드 — 기다리는 것이 있으면 하나 집어 돌린다. */
  async function pollJobs() {
    if (running) return;
    await loadJobs(true);
    if (!jobsAuto) return;
    const next = jobsList.find(function (j) { return j.status === 'pending' && j.id !== '__more__'; });
    if (next) startJob(next, true);
  }

  function setJobTimer(on) {
    clearInterval(jobTimer);
    jobTimer = null;
    if (on) jobTimer = setInterval(pollJobs, JOB_POLL_MS);
  }

  // ── 즐겨찾기 폴더 ────────────────────────────────────────────────────────
  // ★VPS·PC 는 폴더가 금세 수백 개가 된다. 자주 가는 곳은 한 번에 가야 한다.
  // ★구분자가 없으면 destId 와 path 의 경계가 사라져 서로 다른 대상의 항목이 같은 키가 된다
  //   (예: d1 + "2/x" 와 d12 + "/x"). 파이프는 경로에도 대상 id 에도 들어갈 수 없어 안전하다.
  function favKey(destId, path) { return destId + '|' + path; }

  function isFav(destId, path) {
    return favorites.some(function (f) { return favKey(f.destId, f.path) === favKey(destId, path); });
  }

  function destLabel(id) {
    if (id === Store.DEVICE_ID) return '이 폰';
    const d = destinations.find(function (x) { return x.id === id; });
    return d ? (d.name || '(이름 없음)') : '(없어진 대상)';
  }

  function renderFavs() {
    const box = $('favs');
    box.innerHTML = '';
    // 지금 보고 있는 대상의 즐겨찾기만 보여 준다 — 다른 서버 경로가 섞이면 헷갈린다.
    const mine = favorites.filter(function (f) { return f.destId === folderDestId; });
    $('favs-wrap').hidden = mine.length === 0;

    mine.forEach(function (f) {
      const chip = document.createElement('button');
      chip.className = 'fav';
      chip.type = 'button';

      const label = document.createElement('span');
      label.className = 'fav-label';
      label.textContent = f.label || ('/' + f.path);
      chip.appendChild(label);

      const x = document.createElement('span');
      x.className = 'fav-x';
      x.textContent = '✕';
      x.addEventListener('click', function (ev) {
        ev.stopPropagation();      // 칩 자체의 이동 동작과 겹치지 않게
        favorites = favorites.filter(function (g) {
          return favKey(g.destId, g.path) !== favKey(f.destId, f.path);
        });
        Store.setFavorites(favorites);
        renderFavs();
        renderStar();
      });
      chip.appendChild(x);

      chip.addEventListener('click', function () { loadFolder(f.path); });
      box.appendChild(chip);
    });
  }

  function renderStar() {
    const on = isFav(folderDestId, folderPath);
    const btn = $('folders-star');
    btn.textContent = on ? '★' : '☆';
    btn.className = 'btn icon' + (on ? ' on' : '');
    btn.title = on ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기';
    // 루트는 어차피 첫 화면이라 즐겨찾기가 의미 없다.
    btn.disabled = !folderPath;
  }

  function toggleFav() {
    if (!folderPath) return;
    if (isFav(folderDestId, folderPath)) {
      favorites = favorites.filter(function (f) {
        return favKey(f.destId, f.path) !== favKey(folderDestId, folderPath);
      });
    } else {
      favorites.push({
        destId: folderDestId,
        path: folderPath,
        label: folderPath.split('/').slice(-2).join('/')
      });
    }
    Store.setFavorites(favorites);
    renderFavs();
    renderStar();
  }

  // ── JSON 가져오기 (슬롯 · 캐릭터 겸용) ───────────────────────────────────
  let importMode = 'slots';   // 'slots' | 'characters'

  function openImport(mode) {
    importMode = mode;
    say($('import-msg'), '');
    $('import-text').value = '';
    if (mode === 'characters') {
      $('import-title').textContent = '캐릭터 JSON 가져오기';
      $('import-help').innerHTML =
        '캐릭터 프리셋 JSON 을 붙여넣으세요. <code>characters[]</code> 의 '
        + '<code>content</code>·<code>uc</code>·<code>coord</code> 를 읽습니다.';
      $('import-text').placeholder = '{ "characters": [ { "content": "...", "uc": "...", "coord": "a1" } ] }';
    } else {
      $('import-title').textContent = '슬롯 JSON 가져오기';
      $('import-help').innerHTML =
        'Claude Code · Codex · Gemini 가 만든 PeroFix 프롬프트 JSON 을 붙여넣으세요. '
        + '<code>prefix</code> 는 작가·퀄리티 태그로, 각 <code>slots</code> 는 생성 슬롯으로 들어갑니다.';
      $('import-text').placeholder = '{ "prefix": "...", "slots": [ ... ] }';
    }
    $('import-file').value = '';       // 같은 파일을 다시 골라도 change 가 뜨게
    $('import-file-name').textContent = '';
    show('import');
  }

  /**
   * 폰에 있는 JSON 파일을 읽어 입력칸에 넣는다.
   * ★클립보드보다 이 길이 낫다 — 긴 JSON 은 복사 도중 잘리는 일이 잦고,
   *   안드로이드는 앱을 오갈 때 클립보드를 비우기도 한다.
   */
  async function loadImportFile(file) {
    if (!file) return;
    $('import-file-name').textContent = file.name + ' 읽는 중…';
    try {
      const text = await readTextFile(file);
      $('import-text').value = text;
      $('import-file-name').textContent = file.name + ' (' + text.length.toLocaleString() + '자)';
      say($('import-msg'), '');
    } catch (e) {
      $('import-file-name').textContent = '';
      say($('import-msg'), '파일을 읽지 못했습니다: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  /** File.text() 가 없는 구형 WebView 를 위해 FileReader 로 물러선다. */
  function readTextFile(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(fr.error || new Error('읽기 실패')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  // ── 작가 · 퀄리티 태그 모음 ──────────────────────────────────────────────
  // ★프리셋(설정 전체)과 다른 축이다. 그림체만 갈아 끼우고 나머지는 그대로 두고 싶을 때 쓴다.
  let tagsets = [];

  function renderTagsetSelect() {
    const sel = $('tagset-select');
    const keep = sel.value;
    sel.innerHTML = '';

    const first = document.createElement('option');
    first.value = '';
    first.textContent = tagsets.length ? '저장된 작가태그 선택' : '저장된 작가태그 없음';
    sel.appendChild(first);

    tagsets.forEach(function (t) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.appendChild(o);
    });
    if (keep && tagsets.some(function (t) { return t.id === keep; })) sel.value = keep;

    const none = !tagsets.length;
    $('tagset-load').disabled = none;
    $('tagset-del').disabled = none;
  }

  async function saveTagset() {
    const text = ($('base-prompt').value || '').trim();
    if (!text) { toast('먼저 작가·퀄리티 태그를 적어주세요.'); return; }

    const cur = $('tagset-select').value;
    const existing = tagsets.find(function (t) { return t.id === cur; });
    const name = (window.prompt('태그 모음 이름', existing ? existing.name : '') || '').trim();
    if (!name) return;

    // 같은 이름이면 덮어쓴다 — 이름을 다시 고르게 하면 목록만 지저분해진다.
    const same = tagsets.find(function (t) { return t.name === name; });
    if (same) {
      same.text = text;
    } else {
      tagsets.push({ id: 't' + Date.now().toString(36), name: name, text: text });
    }
    await Store.setTagsets(tagsets);
    renderTagsetSelect();
    $('tagset-select').value = (same || tagsets[tagsets.length - 1]).id;
    toast('"' + name + '" 저장했습니다.');
  }

  function loadTagset() {
    const t = tagsets.find(function (x) { return x.id === $('tagset-select').value; });
    if (!t) { toast('불러올 태그 모음을 먼저 고르세요.'); return; }
    $('base-prompt').value = t.text || '';
    Store.setBasePrompt($('base-prompt').value);
    renderAnlas();
    toast('"' + t.name + '" 을(를) 넣었습니다.');
  }

  async function deleteTagset() {
    const t = tagsets.find(function (x) { return x.id === $('tagset-select').value; });
    if (!t) { toast('지울 태그 모음을 먼저 고르세요.'); return; }
    if (!window.confirm('"' + t.name + '" 을(를) 지울까요?')) return;
    tagsets = tagsets.filter(function (x) { return x.id !== t.id; });
    await Store.setTagsets(tagsets);
    renderTagsetSelect();
    toast('지웠습니다.');
  }

  async function runImportCharacters(append) {
    const r = PerofixImport.parseCharacters($('import-text').value);
    if (!r.ok) { say($('import-msg'), r.error, 'err'); return; }

    characters = append ? characters.concat(r.characters) : r.characters;
    await Store.setCharacters(characters);
    renderChars();
    renderSlotTargetHint();

    const lim = charLimit();
    const over = activeChars().length > lim;
    say($('import-msg'),
      '캐릭터 ' + r.characters.length + '명을 ' + (append ? '추가했습니다.' : '가져왔습니다.')
      + (over ? ' 켠 인물이 모델 상한(' + lim + '명)을 넘습니다 — 안 쓸 인물을 꺼 주세요.' : ''),
      over ? 'err' : 'ok');
    setTimeout(function () { show('main'); }, over ? 1600 : 700);
  }

  async function runImport(append) {
    if (importMode === 'characters') return runImportCharacters(append);
    return runImportSlots(append);
  }

  async function runImportSlots(append) {
    const r = PerofixImport.parse($('import-text').value);
    if (!r.ok) { say($('import-msg'), r.error, 'err'); return; }

    slots = append ? slots.concat(r.slots) : r.slots;
    await Store.setSlots(slots);

    // ★prefix 는 공통 프롬프트다. 비어 있으면 기존 것을 지우지 않는다 —
    //   슬롯만 갈아 끼우려는 경우가 많다.
    if (r.prefix) {
      $('base-prompt').value = r.prefix;
      await Store.setBasePrompt(r.prefix);
    }

    renderSlots();
    renderNamingPreview();
    say($('import-msg'),
      '슬롯 ' + r.slots.length + '개를 ' + (append ? '추가했습니다.' : '가져왔습니다.') +
      (r.name ? ' (' + r.name + ')' : ''), 'ok');
    setTimeout(function () { show('main'); }, 700);
  }

  // ── Anlas ────────────────────────────────────────────────────────────────
  function activeSlotCount() {
    const base = $('base-prompt').value;
    return slots.filter(function (s) {
      return s.enabled !== false && ((s.prompt || '').trim() || (base || '').trim());
    }).length;
  }

  function renderAnlas() {
    if (!options) return;

    const cap = NAI_TABLES.MODEL_CAPS[baseModelOf(options.nai_model)] || NAI_TABLES.CAPS_FALLBACK;
    const est = Anlas.estimate({
      width: options.width, height: options.height, steps: options.steps,
      model: options.nai_model,
      isOpus: subscription ? subscription.isOpus : false,
      opusExhausted: subscription ? subscription.opusExhausted : false,
      refCount: cap.char_ref ? references.length : 0,
      // ★실제로 뽑을 장수로 센다 — 배수와 한 명 모드의 바퀴까지 포함이다.
      //   슬롯 수만 세면 「배수 3」 을 켠 사람에게 1/3 로 적힌 값을 보여 주게 된다.
      count: Math.max(1, plannedJobs().length)
    });

    const el = $('cost-est');
    let cls = 'cost-est';
    let text;
    if (!subscription) {
      // 잔량을 아직 못 읽었으면 무료 판정을 할 수 없다 — 유료 기준으로 보수적으로 적는다.
      text = '예상 ' + est.total + ' Anlas (' + est.count + '장, 구독 확인 전)';
    } else if (est.free) {
      text = est.count + '장 · 무료';
      cls += ' free';
    } else {
      text = '예상 ' + est.total + ' Anlas (' + est.count + '장 · 장당 ' + est.perImage + ')';
    }
    if (est.overLimit) { text += ' · 1장 상한(140) 초과'; cls += ' warn'; }
    el.className = cls;
    el.textContent = text;

    renderOneChar();

    const bal = $('anlas-bal');
    if (subscription) {
      bal.textContent = '잔량 ' + subscription.anlas.toLocaleString()
        + (subscription.isOpus ? ' · Opus' : '')
        + (subscription.usagePercent !== null
          ? (' · 무료 ' + Math.max(0, Math.round(subscription.usagePercent)) + '%') : '');
    } else {
      bal.textContent = '';
    }
  }

  async function refreshAnlas() {
    const token = await Store.getToken();
    if (!token) return;
    const r = await NaiClient.checkSubscription(token);
    if (r.ok && r.raw) subscription = Anlas.parseSubscription(r.raw);
    renderAnlas();
  }

  // ── 와일드카드 ───────────────────────────────────────────────────────────
  function renderWildcardInfo() {
    wildcardPools = Wildcards.parse(wildcardDoc);
    const names = Object.keys(wildcardPools);
    $('wc-info').textContent = names.length
      ? ('풀 ' + names.length + '개: ' + names.map(function (n) {
        return '#' + n + '(' + wildcardPools[n].length + ')';
      }).join(', '))
      : '아직 정의가 없습니다. 「예시 넣기」 를 눌러 보세요.';
  }

  // ── Precise Reference ────────────────────────────────────────────────────
  // ★모델이 지원할 때만(char_ref) 보낸다. 참조는 개당 5 Anlas 라, 지원하지 않는 모델에
  //   보내면 무시되는 게 아니라 돈만 나간다.
  const REF_MODES = [
    { value: 'character&style', text: '인물 + 화풍' },
    { value: 'character', text: '인물만' },
    { value: 'style', text: '화풍만' }
  ];
  const REF_MAX_PX = 1024;

  function refsSupported() {
    const base = baseModelOf(options ? options.nai_model : '');
    const cap = NAI_TABLES.MODEL_CAPS[base] || NAI_TABLES.CAPS_FALLBACK;
    return !!cap.char_ref;
  }

  function renderRefHint() {
    $('ref-hint').innerHTML = refsSupported()
      ? '<b>참조 1장당 약 5 Anlas</b> 가 더 듭니다.'
      : '<b>이 모델은 Precise Reference 를 지원하지 않습니다</b> (V4.5 계열에서만 됩니다). 등록해 두어도 전송하지 않습니다.';
    $('ref-hint').className = refsSupported() ? 'hint' : 'hint warn';
  }

  function renderRefs() {
    renderRefHint();
    const box = $('refs');
    box.innerHTML = '';

    if (!references.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '참조할 그림이 있으면 추가하세요. 없으면 비워 둡니다.';
      box.appendChild(e);
      return;
    }

    references.forEach(function (r, i) {
      const el = document.createElement('div');
      el.className = 'slot' + (refsSupported() ? '' : ' off');

      const head = document.createElement('div');
      head.className = 'ref-head';

      const img = document.createElement('img');
      img.className = 'ref-thumb';
      img.src = 'data:image/png;base64,' + r.image;
      img.alt = r.name || '';

      const meta = document.createElement('div');
      meta.className = 'ref-meta';

      const nm = document.createElement('div');
      nm.className = 'ref-name';
      nm.textContent = (r.name || '참조 ' + (i + 1)) + (r.w ? ('  ' + r.w + '×' + r.h) : '');

      const mode = document.createElement('select');
      REF_MODES.forEach(function (m) {
        const o = document.createElement('option');
        o.value = m.value;
        o.textContent = m.text;
        mode.appendChild(o);
      });
      mode.value = r.mode || 'character&style';
      mode.addEventListener('change', function () {
        references[i].mode = mode.value;
        Store.setReferences(references);
      });

      meta.appendChild(nm);
      meta.appendChild(mode);

      const del = document.createElement('button');
      del.className = 'btn icon';
      del.textContent = '✕';
      del.addEventListener('click', function () {
        references.splice(i, 1);
        Store.setReferences(references);
        renderRefs();
        renderAnlas();
      });

      head.appendChild(img);
      head.appendChild(meta);
      head.appendChild(del);
      el.appendChild(head);

      const slider = function (labelText, key, min, max, step, fallback) {
        const f = document.createElement('label');
        f.className = 'field';
        const sp = document.createElement('span');
        sp.className = 'label';
        sp.textContent = labelText;
        const row = document.createElement('div');
        row.className = 'range-row';
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = min; inp.max = max; inp.step = step;
        inp.value = (r[key] === undefined ? fallback : r[key]);
        const val = document.createElement('span');
        val.className = 'range-val';
        val.textContent = Number(inp.value).toFixed(2);
        inp.addEventListener('input', function () {
          val.textContent = Number(inp.value).toFixed(2);
        });
        inp.addEventListener('change', function () {
          references[i][key] = parseFloat(inp.value);
          Store.setReferences(references);
        });
        row.appendChild(inp);
        row.appendChild(val);
        f.appendChild(sp);
        f.appendChild(row);
        return f;
      };

      el.appendChild(slider('strength', 'strength', 0, 1, 0.05, 1.0));
      el.appendChild(slider('fidelity', 'fidelity', 0, 1, 0.05, 1.0));
      box.appendChild(el);
    });
  }

  async function addReferenceFile(file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // ★저장소에 넣기 전에 줄인다. 원본 그대로면 설정이 몇 MB 로 불어난다.
      const small = await ImageUtil.shrinkToBase64(bytes, REF_MAX_PX);
      references.push({
        name: file.name || '',
        image: small.base64,
        w: small.width, h: small.height,
        mode: 'character&style',
        strength: 1.0,
        fidelity: 1.0
      });
      await Store.setReferences(references);
      renderRefs();
      renderAnlas();
    } catch (e) {
      window.alert('그림을 읽지 못했습니다: ' + (e && e.message ? e.message : e));
    }
  }

  // ── 캐릭터 프롬프트 ──────────────────────────────────────────────────────
  // ★생성 슬롯과 다른 축이다. 공통 프롬프트에도 섞이지 않는다.
  const COORDS = (function () {
    const out = [{ value: '', text: '위치 지정 안 함' }];
    ['a', 'b', 'c', 'd', 'e'].forEach(function (col) {
      ['1', '2', '3', '4', '5'].forEach(function (row) {
        out.push({ value: col + row, text: col.toUpperCase() + row });
      });
    });
    return out;
  })();

  function charLimit() {
    const base = baseModelOf(options ? options.nai_model : '');
    const cap = NAI_TABLES.MODEL_CAPS[base] || NAI_TABLES.CAPS_FALLBACK;
    return cap.max_characters;
  }

  /** 켜 둔 인물만 전송한다. 꺼 둔 인물은 목록에 남아 있어도 이번 생성에 안 들어간다. */
  function activeChars(list) {
    return (list || characters).filter(function (c) { return c.enabled !== false; });
  }

  /**
   * 인원 경고.
   * ★목록 길이는 제한하지 않는다 — 인물을 쌓아 두고 골라 쓰는 것이 이 화면의 쓸모다.
   *   막아야 하는 것은 "한 번에 켜 둔 인물이 모델 상한을 넘는" 경우뿐이다.
   *   그때 조용히 잘라 보내면 돈만 쓰고 다른 그림이 나오므로 반드시 보여 준다.
   */
  function renderCharLimitHint() {
    const lim = charLimit();
    const on = activeChars().length;
    const el = $('char-limit-hint');
    // ★한 명 모드에서는 한 장에 한 명만 실리므로 모델 상한과 무관하다.
    if (oneCharOn()) {
      el.textContent = '';
      el.hidden = true;
    } else if (on > lim) {
      el.textContent = '켜 둔 인물이 ' + on + '명입니다. 현재 모델은 ' + lim
        + '명까지라 뒤 ' + (on - lim) + '명은 전송되지 않습니다 — 안 쓸 인물은 꺼 주세요.';
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  // ── 인물 · 슬롯 목록 (옆 서랍) ───────────────────────────────────────────
  // ★수십 개가 되면 본문에 늘어놓을 수 없다. 목록은 서랍에서 보고, 편집은 수정창에서.
  //   서랍에서는 켜고 끄기만 한다 — 한 손으로 훑으며 고르는 것이 목적이다.

  /** 인물의 표시 이름. 가져온 JSON 의 name 을 우선 쓰고, 없으면 번호로 부른다. */
  function charName(c, i) {
    return (c && c.name ? String(c.name).trim() : '') || ('인물 ' + (i + 1));
  }

  /**
   * 켠 인물 중 이 번째가 모델 상한을 넘어 전송되지 않는지.
   * ★꺼 둔 인물은 세지 않는다 — 상한 자리를 차지하지 않기 때문이다.
   */
  // ── 한 명 모드 ───────────────────────────────────────────────────────────
  // ★켠 인물을 **한 명씩** 보내고 인물 수만큼 바퀴를 더 돈다 (인물 × 슬롯 × 배수).
  //   인물이 많고 슬롯이 적을 때, 인물을 켰다 껐다 하며 여러 번 돌리던 왕복을 없앤다.
  function oneCharOn() {
    return !!(options && options.one_char_mode);
  }

  /** 지금 설정으로 몇 장이 나오는지. Anlas 어림과 화면 문구가 같은 값을 쓴다. */
  function plannedJobs() {
    return Jobs.build({
      slots: slots, chars: characters, base: $('base-prompt').value,
      perSlot: options ? options.count_per_slot : 1, oneChar: oneCharOn()
    });
  }

  function renderOneChar() {
    const on = oneCharOn();
    $('opt-one-char').checked = on;
    $('drawer-one-char').checked = on;

    const chars = activeChars().length;
    const jobs = plannedJobs();
    const slotCount = Jobs.activeSlots(slots, $('base-prompt').value).length;
    const perSlot = Math.max(1, (options && options.count_per_slot) || 1);

    let text;
    if (on && chars) {
      text = '켠 인물 ' + chars + '명을 **한 명씩** 돌립니다 — 인물 ' + chars
        + ' × 슬롯 ' + slotCount + (perSlot > 1 ? ' × 배수 ' + perSlot : '')
        + ' = ' + jobs.length + '장. 저장 경로에 인물 폴더가 한 겹 끼어듭니다.';
    } else if (on) {
      text = '켠 인물이 없습니다. 인물을 켜면 그 수만큼 바퀴를 돕니다.';
    } else {
      text = chars > 1
        ? ('켠 인물 ' + chars + '명이 한 장에 함께 나갑니다. 한 명씩 따로 뽑으려면 켜세요.')
        : '켠 인물을 한 명씩 따로 뽑고 싶을 때 켭니다 (인물 수만큼 바퀴를 돕니다).';
    }
    $('one-char-hint').textContent = text.replace(/\*\*/g, '');
    $('drawer-one-char-hint').textContent = text.replace(/\*\*/g, '');
  }

  function charOverLimit(i) {
    // ★한 명 모드에서는 한 장에 한 명만 나가므로 상한을 넘을 수가 없다.
    if (oneCharOn()) return false;
    if (!characters[i] || characters[i].enabled === false) return false;
    const lim = charLimit();
    let seen = 0;
    for (let k = 0; k <= i; k++) {
      if (characters[k].enabled !== false) seen++;
    }
    return seen > lim;
  }

  function renderCharsSummary() {
    const on = activeChars().length;
    $('chars-summary').textContent = characters.length
      ? ('인물 ' + characters.length + '명 · ' + on + '명 켜짐')
      : '인물 없음 — 눌러서 추가';
  }

  function renderCharDrawer() {
    renderCharLimitHint();
    renderCharsSummary();

    const on = activeChars().length;
    $('drawer-chars-count').textContent = characters.length
      ? (on + ' / ' + characters.length + ' 켜짐')
      : '';

    renderOneChar();

    // 상한 경고는 서랍 안에도 둔다 — 켜고 끄는 곳이 여기이므로.
    const lim = charLimit();
    const w = $('drawer-chars-warn');
    if (oneCharOn()) {
      w.hidden = true;
    } else if (on > lim) {
      w.textContent = '켠 인물이 ' + on + '명입니다. 현재 모델은 ' + lim
        + '명까지라 「초과」 표시된 인물은 전송되지 않습니다.';
      w.hidden = false;
    } else {
      w.hidden = true;
    }

    const box = $('drawer-chars-list');
    box.innerHTML = '';

    if (!characters.length) {
      const e = document.createElement('div');
      e.className = 'drawer-empty';
      e.textContent = '인물이 없습니다. 아래 「+ 인물 추가」 를 누르거나 캐릭터 JSON 을 가져오세요.';
      box.appendChild(e);
      return;
    }

    characters.forEach(function (c, i) {
      const over = charOverLimit(i);
      const row = document.createElement('div');
      row.className = 'drow' + (c.enabled === false ? ' off' : '') + (over ? ' over' : '');
      row.dataset.kind = 'chars';
      row.dataset.index = i;

      const toggle = document.createElement('button');
      toggle.className = 'btn icon';
      toggle.textContent = c.enabled === false ? '○' : '●';
      toggle.title = '누르면 켜고 끄기 · 누른 채 쓸면 여러 줄';
      toggle.setAttribute('aria-label', charName(c, i) + ' 켜기/끄기');
      // 누르는 순간 칠하기가 시작된다. 그냥 떼면 한 줄만 바뀐다.
      toggle.addEventListener('touchstart', function (e) { startPaint('chars', i, e); }, { passive: true });
      toggle.addEventListener('mousedown', function (e) { startPaint('chars', i, e); });
      // 키보드로도 쓸 수 있게 (마우스를 안 쓰는 경우)
      toggle.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        characters[i].enabled = (characters[i].enabled === false);
        Store.setCharacters(characters);
        renderCharDrawer();
        renderSlotTargetHint();
      });

      const main = document.createElement('div');
      main.className = 'drow-main';

      const nm = document.createElement('div');
      nm.className = 'drow-name' + (c.name ? '' : ' unnamed');
      nm.textContent = charName(c, i);

      const sub = document.createElement('div');
      sub.className = 'drow-sub';
      const bits = [];
      if (c.coord) bits.push(String(c.coord).toUpperCase());
      bits.push((c.prompt || '').trim() || '(프롬프트 없음)');
      sub.textContent = bits.join(' · ');

      main.appendChild(nm);
      main.appendChild(sub);
      // 이름을 눌러도 열린다 — 「수정」 을 정확히 겨냥하지 않아도 되게.
      main.addEventListener('click', function () { openItemEdit('char', i); });

      const edit = document.createElement('button');
      edit.className = 'btn small';
      edit.textContent = '수정';
      edit.addEventListener('click', function () { openItemEdit('char', i); });

      row.appendChild(toggle);
      row.appendChild(main);
      if (over) {
        const tag = document.createElement('span');
        tag.className = 'drow-over-tag';
        tag.textContent = '초과';
        row.appendChild(tag);
      }
      row.appendChild(edit);
      box.appendChild(row);
    });
  }

  // 예전 이름을 그대로 남긴다 — 부르는 곳이 여러 군데다.
  function renderChars() { renderCharDrawer(); }

  function renderSlotTargetHint() {
    const t = $('slot-target').value;
    $('slot-target-hint').textContent = (t === 'char')
      ? (activeChars().length
        ? '슬롯 프롬프트가 각 인물 뒤에 붙습니다. 공통 프롬프트는 그대로입니다.'
        : '켠 인물이 없으면 공통 프롬프트에 붙습니다.')
      : '슬롯 프롬프트가 공통 프롬프트 뒤에 붙습니다.';
  }

  /**
   * 슬롯 프롬프트를 어디에 붙일지 정해 최종 프롬프트 구성을 만든다.
   * ★데스크톱판(backend.py 의 promptTarget 분기)과 같은 규칙이어야 한다.
   */
  function composePrompts(base, slotContent, target, charsIn) {
    // 켠 인물만 추린 뒤 모델 상한까지 자른다. 순서를 뒤집으면 꺼 둔 인물이
    // 상한 자리를 차지해 정작 쓰려던 인물이 밀려난다.
    const chars = activeChars(charsIn || characters).slice(0, charLimit());
    const hasChars = chars.length > 0;
    const strip = function (s) { return s.replace(/^[, ]+|[, ]+$/g, ''); };

    if (target === 'char' && slotContent && hasChars) {
      return {
        basePrompt: base,
        characters: chars.map(function (c) {
          // 가져온 JSON 이 "이 인물에는 붙이지 말라" 고 표시해 둔 경우
          if (c.skipSlotPrompt) return c;
          return {
            prompt: c.prompt ? strip(c.prompt + ', ' + slotContent) : slotContent,
            uc: c.uc || '',
            coord: c.coord || null
          };
        })
      };
    }
    return {
      basePrompt: slotContent ? strip(base + ', ' + slotContent) : base,
      characters: chars
    };
  }

  // ── 슬롯 ────────────────────────────────────────────────────────────────
  function slotName(sl, i) {
    return (sl && sl.label ? String(sl.label).trim() : '') || ('slot' + (i + 1));
  }

  function renderSlotsSummary() {
    const on = slots.filter(function (x) { return x.enabled !== false; }).length;
    $('slots-summary').textContent = slots.length
      ? ('슬롯 ' + slots.length + '개 · ' + on + '개 켜짐')
      : '슬롯 없음 — 눌러서 추가';
  }

  function renderSlotDrawer() {
    renderSlotsSummary();

    const on = slots.filter(function (x) { return x.enabled !== false; }).length;
    $('drawer-slots-count').textContent = slots.length ? (on + ' / ' + slots.length + ' 켜짐') : '';

    const box = $('drawer-slots-list');
    box.innerHTML = '';

    if (!slots.length) {
      const e = document.createElement('div');
      e.className = 'drawer-empty';
      e.textContent = '슬롯을 추가하면 각각 다른 프롬프트로 한 번에 생성합니다.';
      box.appendChild(e);
      return;
    }

    slots.forEach(function (sl, i) {
      const row = document.createElement('div');
      row.className = 'drow' + (sl.enabled === false ? ' off' : '');
      row.dataset.kind = 'slots';
      row.dataset.index = i;

      const toggle = document.createElement('button');
      toggle.className = 'btn icon';
      toggle.textContent = sl.enabled === false ? '○' : '●';
      toggle.title = '누르면 켜고 끄기 · 누른 채 쓸면 여러 줄';
      toggle.setAttribute('aria-label', slotName(sl, i) + ' 켜기/끄기');
      toggle.addEventListener('touchstart', function (e) { startPaint('slots', i, e); }, { passive: true });
      toggle.addEventListener('mousedown', function (e) { startPaint('slots', i, e); });
      toggle.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        slots[i].enabled = (slots[i].enabled === false);
        Store.setSlots(slots);
        renderSlotDrawer();
        renderAnlas();
      });

      const main = document.createElement('div');
      main.className = 'drow-main';

      const nm = document.createElement('div');
      nm.className = 'drow-name' + (sl.label ? '' : ' unnamed');
      nm.textContent = slotName(sl, i);

      const sub = document.createElement('div');
      sub.className = 'drow-sub';
      sub.textContent = (sl.prompt || '').trim() || '(프롬프트 없음)';

      main.appendChild(nm);
      main.appendChild(sub);
      main.addEventListener('click', function () { openItemEdit('slot', i); });

      const edit = document.createElement('button');
      edit.className = 'btn small';
      edit.textContent = '수정';
      edit.addEventListener('click', function () { openItemEdit('slot', i); });

      row.appendChild(toggle);
      row.appendChild(main);
      row.appendChild(edit);
      box.appendChild(row);
    });
  }

  function renderSlots() { renderSlotDrawer(); }

  // ── 생성 ────────────────────────────────────────────────────────────────
  // ── 결과 목록 ────────────────────────────────────────────────────────────
  // 항목 구조와 분류 규칙은 results-model.js 에 있다 (화면과 분리해 검사한다).
  let results = [];
  let resultFilter = 'all';
  // ★중지 등으로 **손도 못 댄** 작업들. 실패한 장과 함께 「못 만든 것 다시 생성」 이 집는다.
  let pendingJobs = [];
  // 「다시 생성」 이 도는 중인지. running 만으로는 생성 중과 구별되지 않아 버튼 글자가 엉킨다.
  let retrying = false;
  // 이번 실행의 조건 (공통 프롬프트 · 이름 규칙 · 한 명 모드). 다시 뽑을 때 그대로 쓴다.
  let lastRun = null;

  function clearResults() {
    // ★objectURL 을 반드시 풀어 준다. 안 그러면 배치를 돌릴수록 메모리가 쌓인다.
    results.forEach(function (r) { if (r.url) URL.revokeObjectURL(r.url); });
    results = [];
    pendingJobs = [];
    $('results').innerHTML = '';
    $('results-summary').textContent = '';
    renderResultsBadge();
    renderFilters();
  }

  function captionOf(r) {
    if (r.error && !r.bytes) return r.name + ' · 실패: ' + r.error;
    const bits = [r.name];
    bits.push(r.savedTo ? '저장됨' : '저장 안 함');
    if (r.verdict === 'reject') bits.push('버릴 것');
    else if (r.verdict === 'keep') bits.push('남길 것');
    if (r.error) bits.push(r.error);
    return bits.join(' · ');
  }

  const KIND_TAG = { enhanced: '인핸스', upscaled: '×4', composed: '배경' };

  function renderResultsBadge() {
    const n = ResultsModel.live(results).length;
    const b = $('results-badge');
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = n === 0;
  }

  function renderFilters() {
    const box = $('result-filters');
    box.innerHTML = '';
    renderBatchHint();
    if (!results.length) return;

    ResultsModel.FILTERS.forEach(function (f) {
      const groups = ResultsModel.applyFilter(results, f.id);
      const n = groups.reduce(function (a, g) { return a + g.items.length; }, 0);

      const chip = document.createElement('button');
      chip.className = 'chip' + (resultFilter === f.id ? ' on' : '');
      chip.type = 'button';
      chip.appendChild(document.createTextNode(f.name));
      const cnt = document.createElement('span');
      cnt.className = 'chip-n';
      cnt.textContent = n;
      chip.appendChild(cnt);
      chip.addEventListener('click', function () {
        resultFilter = f.id;
        renderResults();
      });
      box.appendChild(chip);
    });
  }

  /** 일괄 버튼이 지금 몇 장에 걸리는지. "보이는 것" 이 무엇인지 짐작하지 않게 한다. */
  function renderBatchHint() {
    const n = visibleItems().length;
    const name = (ResultsModel.FILTERS.find(function (f) { return f.id === resultFilter; }) || {}).name || '전체';
    $('batch-hint').textContent = n
      ? ('아래 두 버튼은 지금 고른 ‘' + name + '’ ' + n + '장에 한꺼번에 걸립니다.')
      : '';
  }

  function renderResults() {
    const box = $('results');
    box.innerHTML = '';
    renderResultsBadge();
    renderFilters();
    renderRetryRow();

    const s = ResultsModel.stats(results);
    $('results-summary').textContent = s.total
      ? (s.total + '장 · 저장됨 ' + s.saved + ' · 안 본 것 ' + s.pending
        + (s.reject ? ' · 버릴 것 ' + s.reject : '')
        + (s.failed ? ' · 실패 ' + s.failed : ''))
      : '';

    const groups = ResultsModel.applyFilter(results, resultFilter);
    if (!groups.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = results.length ? '이 조건에 맞는 그림이 없습니다.' : '아직 생성한 그림이 없습니다.';
      box.appendChild(e);
      return;
    }

    // ★슬롯별로 나눠 그린다. 한 슬롯을 여러 장 뽑으면 섞여서 고를 수가 없다.
    groups.forEach(function (g) {
      const wrap = document.createElement('div');
      wrap.className = 'slot-group';

      const head = document.createElement('div');
      head.className = 'slot-group-head';
      const nm = document.createElement('span');
      nm.className = 'slot-group-name';
      nm.textContent = g.label;
      const cnt = document.createElement('span');
      cnt.className = 'slot-group-n';
      cnt.textContent = g.items.length + '장';
      head.appendChild(nm);
      head.appendChild(cnt);
      wrap.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'results';
      g.items.forEach(function (r) { grid.appendChild(resultCard(r)); });
      wrap.appendChild(grid);
      box.appendChild(wrap);
    });
  }

  function resultCard(r) {
    const card = document.createElement('div');
    card.className = 'card'
      + (r.error && !r.bytes ? ' failed' : '')
      + (r.verdict === 'keep' ? ' keep' : '')
      + (r.verdict === 'reject' ? ' reject' : '');

    if (r.url) {
      const img = document.createElement('img');
      img.src = r.url;
      img.loading = 'lazy';
      img.alt = r.name;
      card.appendChild(img);
      card.addEventListener('click', function () { openViewerAt(r); });
    }
    if (KIND_TAG[r.kind]) {
      const tag = document.createElement('span');
      tag.className = 'kind-tag';
      tag.textContent = KIND_TAG[r.kind];
      card.appendChild(tag);
    }

    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = captionOf(r);
    card.appendChild(cap);
    return card;
  }

  // ── 못 만든 것 다시 생성 ─────────────────────────────────────────────────
  // ★인터넷이 끊기면 남은 장이 줄줄이 깨진다. 그때 처음부터 다시 돌리면 이미 나온 장을
  //   또 뽑느라 Anlas 를 두 번 쓴다. 실패한 장(과 중지로 손도 못 댄 장)만 집어 이어 뽑는다.
  function failedItems() {
    return ResultsModel.live(results).filter(function (r) {
      return !!r.error && !r.bytes && !!r.job;
    });
  }

  /** 다시 뽑을 수 있는 장수 = 실패한 장 + 아직 손도 못 댄 장. */
  function unfinishedCount() {
    return failedItems().length + pendingJobs.length;
  }

  function renderRetryRow() {
    const n = unfinishedCount();
    const row = $('retry-row');
    const btn = $('retry-failed');
    row.hidden = (n === 0);
    if (retrying) {
      btn.textContent = '중지';
      btn.className = 'btn danger small block';
      btn.disabled = false;
      return;
    }
    btn.textContent = '못 만든 ' + n + '장 다시 생성';
    btn.className = 'btn primary small block';
    // 생성이 도는 중에는 누르지 못하게 한다 (같은 장을 두 번 뽑게 된다).
    btn.disabled = running;
    // ★그림이 없는 장만 다시 뽑는다. 「저장 실패」 는 그림이 이미 있으니 뷰어에서 저장하면 된다.
    $('retry-hint').textContent = pendingJobs.length
      ? ('실패 ' + failedItems().length + '장 + 중지로 안 만든 ' + pendingJobs.length
        + '장입니다. 이미 나온 장은 건드리지 않습니다.')
      : '이미 나온 장은 그대로 두고, 실패한 장만 같은 설정으로 다시 뽑습니다.';
  }

  async function retryUnfinished() {
    // 도는 중에 누르면 멈춤 신호로 쓴다 (다시 생성은 결과 화면에 중지 버튼이 따로 없다).
    if (running) {
      cancelRequested = true;
      if (retrying) $('retry-failed').textContent = '멈추는 중…';
      return;
    }

    const token = await Store.getToken();
    if (!token) { show('setup'); return; }
    if (!lastRun) { say($('batch-msg'), '이번 실행 정보가 없습니다. 생성 화면에서 다시 돌려주세요.', 'err'); return; }

    const retryItems = failedItems();
    const pend = pendingJobs.slice();
    const total = retryItems.length + pend.length;
    if (!total) return;

    running = true;
    retrying = true;
    cancelRequested = false;
    pendingJobs = [];
    renderRetryRow();
    const box = $('batch-msg');
    box.hidden = false;

    let done = 0;
    let failed = 0;

    // 1) 실패한 장 — 원래 자리에 그대로 갈아 끼운다 (순서와 묶음이 흐트러지지 않게).
    for (let i = 0; i < retryItems.length; i++) {
      if (cancelRequested) break;
      const prev = retryItems[i];
      say(box, '다시 생성 중 ' + (done + 1) + '/' + total + ' — ' + prev.name);
      const item = await runOneJob(token, prev.job, {
        base: lastRun.base, tpl: lastRun.tpl, oneChar: lastRun.oneChar,
        seq: results.length + 1,
        onWait: function (msg) { say(box, prev.name + ' — ' + msg); }
      });
      const at = results.indexOf(prev);
      if (at !== -1) results[at] = item; else results.push(item);
      if (!item.bytes) failed++;
      done++;
      renderResults();
    }

    // 2) 중지로 손도 못 댄 장 — 뒤에 이어 붙인다.
    for (let i = 0; i < pend.length; i++) {
      if (cancelRequested) {
        pendingJobs = pend.slice(i);   // 또 멈추면 남은 것을 다시 들고 있는다
        break;
      }
      const job = pend[i];
      say(box, '이어서 생성 중 ' + (done + 1) + '/' + total + ' — ' + job.name);
      const item = await runOneJob(token, job, {
        base: lastRun.base, tpl: lastRun.tpl, oneChar: lastRun.oneChar,
        seq: results.length + 1,
        onWait: function (msg) { say(box, job.name + ' — ' + msg); }
      });
      results.push(item);
      if (!item.bytes) failed++;
      done++;
      renderResults();
    }

    running = false;
    retrying = false;
    const left = unfinishedCount();
    say(box, done + '/' + total + ' 다시 생성'
      + (failed ? ', 또 실패 ' + failed + '건' : '')
      + (cancelRequested ? ' (중지됨)' : '')
      + (left ? ' · 아직 ' + left + '장 남음' : ''),
      (failed || left) ? 'err' : 'ok');
    renderResults();
    refreshAnlas();
  }

  // ── 저장 · 버리기 ────────────────────────────────────────────────────────
  /**
   * 이미 저장된 파일을 실제로 지운다.
   * ★자동 저장이 켜져 있으면 버리는 순간 파일이 이미 디스크에 있다.
   *   목록에서만 빼면 쓰레기가 그대로 쌓인다.
   */
  async function removeSavedFile(r) {
    if (!r.savedTo || !r.filename) return;
    try {
      await Folders.remove(activeDest(), r.filename, false, false);
    } catch (e) {
      // 사람이 이미 지웠을 수도 있다 — 목록 정리를 막지는 않는다.
    }
    r.savedTo = null;
  }

  async function saveItem(r) {
    if (!r || !r.bytes || r.savedTo) return;
    const prepared = await prepareForSave(r.bytes, r.filename, r.saveInfo || {});
    r.filename = prepared.path;
    r.savedTo = await saveOne(prepared.bytes, prepared.path);
  }

  /**
   * 딱 그 한 장만 버린다. 파생본은 건드리지 않는다.
   * ★「인핸스 성공하면 원본 지우기」 가 이걸 쓴다 — deleteItem 을 쓰면 방금 만든
   *   인핸스본까지 딸려 지워져 결과가 통째로 사라진다 (실제로 그렇게 났다).
   */
  async function deleteOne(r) {
    if (!r || r.deleted) return;
    await removeSavedFile(r);
    if (r.url) { URL.revokeObjectURL(r.url); r.url = null; }
    r.bytes = null;
    r.deleted = true;
  }

  /** 한 장과 그 파생본을 함께 버린다 (뷰어에서 위로 밀 때). */
  async function deleteItem(r) {
    const ids = ResultsModel.withDescendants(results, r.id);
    for (const id of ids) {
      const it = ResultsModel.byId(results, id);
      if (!it) continue;
      await removeSavedFile(it);
      if (it.url) { URL.revokeObjectURL(it.url); it.url = null; }
      it.bytes = null;
      it.deleted = true;
    }
  }

  // ── 전체화면 텍스트 편집기 ───────────────────────────────────────────────
  // ★폰에서 2~3줄 칸에 긴 프롬프트를 넣으면 앞뒤가 안 보여 고칠 수가 없다.
  //   프롬프트 칸을 누르면 여기가 열려 전체를 펼쳐 놓고 고친다.
  // ★고치는 즉시 원래 칸에 반영하고 저장까지 한다 — 「완료」 를 안 눌러 잃는 일이 없게.
  let editorTarget = null;
  let editorOriginal = '';

  function editorSync() {
    if (!editorTarget) return;
    editorTarget.value = $('editor-text').value;
    // 원래 칸의 input 처리기가 저장을 맡고 있다 — 그대로 태운다.
    editorTarget.dispatchEvent(new Event('input', { bubbles: true }));
    updateEditorCount();
  }

  function updateEditorCount() {
    const v = $('editor-text').value;
    const lines = v ? v.split('\n').length : 0;
    $('editor-count').textContent = v.length + '자 · ' + lines + '줄';
  }

  function editorSay(text, ok) {
    const el = $('editor-msg');
    el.textContent = text || '';
    el.style.color = ok === false ? 'var(--danger)' : 'var(--ok)';
    if (text) setTimeout(function () { if (el.textContent === text) el.textContent = ''; }, 2200);
  }

  function openEditor(target, title) {
    editorTarget = target;
    editorOriginal = target.value;
    $('editor-title').textContent = title || '편집';
    $('editor-text').value = target.value;
    $('editor-text').placeholder = target.placeholder || '';
    $('editor-msg').textContent = '';
    $('editor').hidden = false;
    document.body.style.overflow = 'hidden';
    updateEditorCount();
    // 키보드를 바로 올려 준다 — 누른 이유가 고치려는 것이므로.
    setTimeout(function () {
      const t = $('editor-text');
      t.focus();
      // 커서를 끝에 둔다 (덧붙이는 경우가 대부분이다).
      t.setSelectionRange(t.value.length, t.value.length);
    }, 60);
  }

  function closeEditor() {
    $('editor').hidden = true;
    document.body.style.overflow = '';
    editorTarget = null;
  }

  /**
   * 클립보드 복사.
   * ★navigator.clipboard 는 "사용자 조작 직후" 가 아니면 조용히 거절당한다.
   *   그래서 **화면에 실제로 있는 편집기 칸을 선택해서** 복사하는 길을 먼저 쓴다 —
   *   포커스가 살아 있어 성공률이 훨씬 높다.
   */
  async function copyFromEditor() {
    const t = $('editor-text');
    if (!t.value) return false;

    // 0) 앱에서는 네이티브 클립보드를 쓴다 — 브라우저의 "사용자 조작" 제약이 없어 확실하다.
    const C = window.Capacitor;
    if (C && C.Plugins && C.Plugins.Clipboard) {
      try {
        await C.Plugins.Clipboard.write({ string: t.value });
        return true;
      } catch (e) { /* 아래 방법으로 */ }
    }

    // 1) 보이는 칸을 직접 선택해 복사 (포커스가 유지된다)
    try {
      const wasReadonly = t.readOnly;
      t.readOnly = false;
      t.focus();
      t.setSelectionRange(0, t.value.length);
      const ok = document.execCommand('copy');
      t.readOnly = wasReadonly;
      // 선택을 풀고 커서를 끝으로 (선택된 채 두면 다음 입력이 통째로 덮인다)
      t.setSelectionRange(t.value.length, t.value.length);
      if (ok) return true;
    } catch (e) { /* 아래로 */ }

    // 2) 최신 API
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t.value);
        return true;
      }
    } catch (e) { /* 실패 */ }
    return false;
  }

  /**
   * 이 칸을 누르면 전체화면 편집기가 열리게 만든다.
   * ★readonly 를 걸어 인라인 키보드가 먼저 뜨는 것을 막는다 — 두 곳에서 고치면 헷갈린다.
   * @param {HTMLTextAreaElement} el
   * @param {function|string} title 제목 (함수면 열 때 계산)
   */
  function makeExpandable(el, title) {
    if (!el || el.dataset.expandable === '1') return;
    el.dataset.expandable = '1';
    el.readOnly = true;
    el.classList.add('expandable');
    el.addEventListener('click', function () {
      openEditor(el, typeof title === 'function' ? title() : title);
    });
  }

  function bindEditor() {
    $('editor-text').addEventListener('input', editorSync);
    $('editor-close').addEventListener('click', closeEditor);
    $('editor-done').addEventListener('click', closeEditor);

    $('editor-copy').addEventListener('click', async function () {
      if (!$('editor-text').value) { editorSay('복사할 내용이 없습니다.', false); return; }
      const ok = await copyFromEditor();
      editorSay(ok ? '복사했습니다.' : '복사하지 못했습니다. 글자를 길게 눌러 복사하세요.', ok);
    });

    $('editor-undo').addEventListener('click', function () {
      $('editor-text').value = editorOriginal;
      editorSync();
      editorSay('열었을 때 상태로 되돌렸습니다.');
    });

    $('editor-clear').addEventListener('click', function () {
      // ★확인을 묻지 않는다 — 「되돌리기」 가 있어서 되살릴 수 있다.
      $('editor-text').value = '';
      editorSync();
      editorSay('전부 지웠습니다. 되돌리려면 「되돌리기」.');
    });

    document.addEventListener('keydown', function (e) {
      if ($('editor').hidden) return;
      if (e.key === 'Escape') closeEditor();
    });
  }

  // ── 전체화면 뷰어 ────────────────────────────────────────────────────────
  // ★슬롯 안에서 좌우로 넘기고, 슬롯 이동은 버튼으로 한다.
  //   위로 밀면 버리고, 아래로 밀면 저장한다.
  let viewGroups = [];
  let viewSlot = 0;
  let viewIndex = 0;
  let dragX = 0;
  let dragY = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  // 확대·이동. ★확대해 둔 동안에는 스와이프(버리기·저장·넘기기)를 끄고 끌기를 이동으로 쓴다 —
  //   확대한 채로 밀다가 그림이 버려지면 되돌릴 수 없다.
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const ZOOM_MAX = 6;
  const ZOOM_STEP = 1.6;      // 단추 한 번 · 두 번 누르기의 배율

  /** 지금 필터로 화면에 보이는 그림들. 일괄 작업은 이걸 대상으로 한다 —
   *  필터로 골라 놓고 「보이는 것 인핸스」 를 누르는 흐름이 자연스럽다. */
  function visibleItems() {
    return ResultsModel.applyFilter(results, resultFilter)
      .reduce(function (acc, g) { return acc.concat(g.items); }, [])
      .filter(function (r) { return !!r.bytes; });
  }

  function rebuildViewGroups() {
    viewGroups = ResultsModel.applyFilter(results, resultFilter)
      .map(function (g) {
        return { label: g.label, items: g.items.filter(function (r) { return !!r.bytes; }) };
      })
      .filter(function (g) { return g.items.length > 0; });
  }

  function openViewerAt(item) {
    rebuildViewGroups();
    for (let gi = 0; gi < viewGroups.length; gi++) {
      const ii = viewGroups[gi].items.indexOf(item);
      if (ii !== -1) {
        viewSlot = gi;
        viewIndex = ii;
        $('viewer').hidden = false;
        document.body.style.overflow = 'hidden';
        paintViewer();
        return;
      }
    }
  }

  function applyZoom(anim) {
    const img = $('viewer-img');
    img.style.transition = anim ? 'transform 0.18s ease' : 'none';
    img.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    $('zoom-reset').textContent = zoom.toFixed(1) + '×';
    $('zoom-out').disabled = (zoom <= 1.001);
    $('zoom-in').disabled = (zoom >= ZOOM_MAX - 0.001);
  }

  /** 그림이 화면 밖으로 도망가지 않게 이동 범위를 자른다. */
  function clampPan() {
    const img = $('viewer-img');
    const stage = $('viewer-stage');
    const maxX = Math.max(0, (img.clientWidth * zoom - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * zoom - stage.clientHeight) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function resetZoom() {
    zoom = 1; panX = 0; panY = 0;
    applyZoom(false);
  }

  /**
   * 확대한다. cx·cy 를 주면 **그 점이 제자리에 남도록** 이동을 함께 맞춘다
   * (두 손가락 가운데나 두 번 누른 자리). 안 주면 화면 가운데를 기준으로 한다.
   */
  function setZoom(next, cx, cy, anim) {
    const stage = $('viewer-stage').getBoundingClientRect();
    const prev = zoom;
    const z = Math.max(1, Math.min(ZOOM_MAX, next));
    if (z === prev) { applyZoom(!!anim); return; }

    const dx = (cx === undefined ? stage.left + stage.width / 2 : cx) - (stage.left + stage.width / 2);
    const dy = (cy === undefined ? stage.top + stage.height / 2 : cy) - (stage.top + stage.height / 2);
    const k = z / prev;
    // 손가락 밑의 점이 그대로 있으려면: pan' = d - (d - pan) × 배율
    panX = dx - (dx - panX) * k;
    panY = dy - (dy - panY) * k;
    zoom = z;
    if (zoom <= 1.001) { zoom = 1; panX = 0; panY = 0; }
    clampPan();
    applyZoom(anim !== false);
  }

  function closeViewer() {
    $('viewer').hidden = true;
    document.body.style.overflow = '';
    renderResults();
  }

  function currentItem() {
    const g = viewGroups[viewSlot];
    return g ? g.items[viewIndex] : null;
  }

  function paintViewer() {
    const g = viewGroups[viewSlot];
    if (!g || !g.items.length) {
      // 이 슬롯이 비었으면 인접 슬롯으로, 그것도 없으면 닫는다.
      if (!nextSlot(1) && !nextSlot(-1)) closeViewer();
      return;
    }
    if (viewIndex >= g.items.length) viewIndex = g.items.length - 1;
    const r = g.items[viewIndex];

    const img = $('viewer-img');
    img.style.transition = 'none';
    img.style.opacity = '1';
    img.src = r.url;
    // ★장을 넘기면 확대는 풀린다. 확대한 채로 넘어가면 다음 장의 엉뚱한 구석이 보인다.
    resetZoom();
    setFlash('');

    $('viewer-count').textContent =
      g.label + '  ' + (viewIndex + 1) + '/' + g.items.length
      + '   (슬롯 ' + (viewSlot + 1) + '/' + viewGroups.length + ')';
    $('viewer-cap').textContent = captionOf(r);
    $('viewer-prev').disabled = (viewIndex === 0);
    $('viewer-next').disabled = (viewIndex === g.items.length - 1);
    $('viewer-prev-slot').disabled = (viewSlot === 0);
    $('viewer-next-slot').disabled = (viewSlot === viewGroups.length - 1);

    const saveBtn = $('viewer-save');
    saveBtn.textContent = r.savedTo ? '저장됨' : '저장';
    saveBtn.className = 'btn small' + (r.savedTo ? ' saved' : '');
    saveBtn.disabled = !!r.savedTo;

    setViewerHint('');
  }

  /**
   * 화면 한가운데의 큰 글씨. p 는 0~1 로 문턱에 얼마나 다가갔는지 —
   * 1 이 되면 「놓으면 실행」 이라는 뜻이라 한 번 커진다.
   */
  function setFlash(text, kind, p) {
    const el = $('viewer-flash');
    if (!text) { el.hidden = true; return; }
    const ratio = Math.max(0, Math.min(1, p === undefined ? 1 : p));
    el.hidden = false;
    el.textContent = text;
    el.className = 'viewer-flash' + (kind ? ' act-' + kind : '') + (ratio >= 1 ? ' ready' : '');
    el.style.opacity = String(0.4 + ratio * 0.6);
  }

  function setViewerHint(text, kind) {
    const el = $('viewer-hint');
    el.textContent = text
      || '↑ 버리기   ↓ 저장   ←→ 넘기기   ·   두 번 누르거나 손가락 두 개로 확대';
    el.className = 'viewer-hint' + (kind ? ' act-' + kind : '');
  }

  function step(delta) {
    const g = viewGroups[viewSlot];
    if (!g) return;
    const next = viewIndex + delta;
    if (next < 0 || next >= g.items.length) { bounce(-delta * 24, 0); return; }
    viewIndex = next;
    paintViewer();
  }

  function nextSlot(delta) {
    const next = viewSlot + delta;
    if (next < 0 || next >= viewGroups.length) return false;
    viewSlot = next;
    viewIndex = 0;
    paintViewer();
    return true;
  }

  function bounce(dx, dy) {
    // ★확대 배율을 함께 써야 한다. 빼먹으면 튕기는 순간 확대가 풀려 보인다.
    const img = $('viewer-img');
    img.style.transition = 'transform 0.18s ease';
    img.style.transform = 'translate(' + (panX + dx) + 'px,' + (panY + dy) + 'px) scale(' + zoom + ')';
    setTimeout(function () { applyZoom(true); }, 120);
  }

  /**
   * 위로 밀어 버리기. 저장돼 있었으면 파일도 지운다.
   *
   * ★버린 뒤에는 **그 슬롯의 다음 장**을 보여 준다 (자리를 그대로 두면 지운 자리에
   *   다음 장이 들어온다). 그 슬롯이 비면 **다음 슬롯**의 첫 장으로 넘어간다.
   *   훑으면서 버리는 흐름이라, 버릴 때마다 손으로 다시 찾아 들어가면 안 된다.
   */
  async function swipeDelete() {
    const r = currentItem();
    if (!r) return;
    const g = viewGroups[viewSlot];
    const label = g ? g.label : null;

    const img = $('viewer-img');
    img.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    img.style.transform = 'translate(0, -60%) scale(' + zoom + ')';
    img.style.opacity = '0';

    await deleteItem(r);
    rebuildViewGroups();
    if (!viewGroups.length) { closeViewer(); return; }

    const at = viewGroups.findIndex(function (x) { return x.label === label; });
    if (at === -1) {
      // 이 슬롯의 마지막 장이었다 — 사라진 자리에 다음 슬롯이 들어와 있다.
      // 뒤에 아무것도 없으면 마지막 슬롯으로 물러난다.
      viewSlot = Math.min(viewSlot, viewGroups.length - 1);
      viewIndex = 0;
    } else {
      viewSlot = at;
      // 자리를 그대로 두면 지운 자리에 다음 장이 들어온다. 끝이었으면 한 칸 앞으로.
      if (viewIndex >= viewGroups[at].items.length) viewIndex = viewGroups[at].items.length - 1;
    }
    setTimeout(paintViewer, 200);
  }

  /** 아래로 밀어 저장. 이미 저장돼 있으면 「남길 것」 표시만 남긴다. */
  async function swipeSave() {
    const r = currentItem();
    if (!r) return;
    r.verdict = 'keep';
    try {
      await saveItem(r);
    } catch (e) {
      setViewerHint('저장 실패: ' + (e && e.message ? e.message : e), 'delete');
      return;
    }
    bounce(0, 24);
    setTimeout(paintViewer, 200);
  }

  function bindViewer() {
    const stage = $('viewer-stage');
    const img = $('viewer-img');
    const THRESHOLD = 60;
    // ★세로 문턱은 더 크게 잡는다 — 실수로 버리면 되돌릴 수 없다.
    const V_THRESHOLD = 90;

    let pinching = false;
    let panning = false;
    let pinchDist = 0;
    let pinchZoom = 1;
    let pinchX = 0;
    let pinchY = 0;
    let panFromX = 0;
    let panFromY = 0;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    function dist(t) {
      return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    }

    /** 두 번 누르면 확대·원래대로를 오간다 (누른 자리를 기준으로). */
    function doubleTap(x, y) {
      if (zoom > 1.001) resetZoom();
      else setZoom(ZOOM_STEP * 1.5, x, y, true);
    }

    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        // 손가락 두 개 — 벌려서 확대. 밀기는 취소한다.
        pinching = true;
        dragging = false;
        panning = false;
        setFlash('');
        pinchDist = dist(e.touches);
        pinchZoom = zoom;
        pinchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        return;
      }
      if (e.touches.length !== 1) return;

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragX = 0; dragY = 0;
      if (zoom > 1.001) {
        // ★확대해 둔 동안에는 끌기가 **이동**이다. 스와이프는 끈다 —
        //   확대한 채로 밀다가 버려지면 되돌릴 수 없다.
        panning = true;
        dragging = false;
        panFromX = panX;
        panFromY = panY;
      } else {
        dragging = true;
        img.style.transition = 'none';
      }
    }, { passive: true });

    stage.addEventListener('touchmove', function (e) {
      if (pinching && e.touches.length === 2) {
        const d = dist(e.touches);
        if (pinchDist > 0) setZoom(pinchZoom * (d / pinchDist), pinchX, pinchY, false);
        return;
      }
      if (panning && e.touches.length === 1) {
        panX = panFromX + (e.touches[0].clientX - startX);
        panY = panFromY + (e.touches[0].clientY - startY);
        clampPan();
        applyZoom(false);
        return;
      }
      if (!dragging || e.touches.length !== 1) return;

      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (Math.abs(dy) > Math.abs(dx)) {
        dragY = dy; dragX = 0;
        img.style.transform = 'translate(0,' + dy + 'px)';
        // 문턱을 넘으면 무엇이 일어날지 미리 알려 준다 — 화면 한가운데에 크게.
        const p = Math.abs(dy) / V_THRESHOLD;
        if (dy < 0) {
          setFlash('버리기', 'delete', p);
          setViewerHint(p >= 1 ? '놓으면 버립니다' : '', 'delete');
        } else {
          setFlash('저장', 'save', p);
          setViewerHint(p >= 1 ? '놓으면 저장합니다' : '', 'save');
        }
      } else {
        dragX = dx; dragY = 0;
        img.style.transform = 'translate(' + dx + 'px, 0)';
        const p = Math.abs(dx) / THRESHOLD;
        // 왼쪽으로 밀면 다음 장, 오른쪽으로 밀면 이전 장.
        setFlash(dx < 0 ? '다음 ›' : '‹ 이전', '', p);
        setViewerHint('');
      }
    }, { passive: true });

    stage.addEventListener('touchend', function (e) {
      if (pinching) {
        if (e.touches.length === 0) {
          pinching = false;
          // 거의 원래 크기면 딱 맞춰 놓는다 (1.02 배로 남아 스와이프가 막히지 않게).
          if (zoom <= 1.02) resetZoom();
        }
        return;
      }
      if (panning) {
        if (e.touches.length === 0) panning = false;
        return;
      }
      if (!dragging) return;
      dragging = false;
      img.style.transition = 'transform 0.18s ease';
      setFlash('');

      // 거의 안 움직였으면 「두 번 누르기」 인지 본다.
      if (Math.abs(dragX) < 10 && Math.abs(dragY) < 10) {
        const now = Date.now();
        const x = startX;
        const y = startY;
        if (now - lastTapAt < 300 && Math.hypot(x - lastTapX, y - lastTapY) < 40) {
          lastTapAt = 0;
          doubleTap(x, y);
        } else {
          lastTapAt = now; lastTapX = x; lastTapY = y;
        }
        img.style.transform = 'translate(0, 0) scale(' + zoom + ')';
        setViewerHint('');
        return;
      }

      if (dragY <= -V_THRESHOLD) { swipeDelete(); return; }
      if (dragY >= V_THRESHOLD) { swipeSave(); return; }
      if (dragX <= -THRESHOLD) { step(1); return; }
      if (dragX >= THRESHOLD) { step(-1); return; }
      img.style.transform = 'translate(0, 0) scale(' + zoom + ')';
      setViewerHint('');
    });

    // PC 미리보기 — 휠로 확대, 두 번 누르기는 dblclick 으로.
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY, false);
    }, { passive: false });
    stage.addEventListener('dblclick', function (e) { doubleTap(e.clientX, e.clientY); });

    $('zoom-in').addEventListener('click', function () { setZoom(zoom * ZOOM_STEP); });
    $('zoom-out').addEventListener('click', function () { setZoom(zoom / ZOOM_STEP); });
    $('zoom-reset').addEventListener('click', resetZoom);

    $('viewer-prev').addEventListener('click', function () { step(-1); });
    $('viewer-next').addEventListener('click', function () { step(1); });
    $('viewer-prev-slot').addEventListener('click', function () { nextSlot(-1); });
    $('viewer-next-slot').addEventListener('click', function () { nextSlot(1); });
    $('viewer-close').addEventListener('click', closeViewer);
    $('viewer-save').addEventListener('click', swipeSave);

    document.addEventListener('keydown', function (e) {
      if ($('viewer').hidden) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowUp') swipeDelete();
      else if (e.key === 'ArrowDown') swipeSave();
      else if (e.key === '+' || e.key === '=') setZoom(zoom * ZOOM_STEP);
      else if (e.key === '-') setZoom(zoom / ZOOM_STEP);
      else if (e.key === '0') resetZoom();
      else if (e.key === 'Escape') closeViewer();
    });
  }

  function setProgress(done, total, text) {
    $('progress').hidden = false;
    $('progress-fill').style.width = total ? (done / total * 100) + '%' : '0';
    $('progress-text').textContent = text;
  }

  /**
   * 한 장을 뽑아 결과 항목 하나를 만든다. 성공하든 실패하든 **항목을 돌려준다**
   * (실패 항목에는 그림 대신 error 와 job 이 들어 있어 나중에 다시 뽑을 수 있다).
   *
   * ★생성과 「다시 생성」 이 같은 길을 쓰게 하려고 떼어 놓았다. 두 벌로 두면 한쪽만
   *   고쳐져서, 다시 뽑은 장만 프롬프트가 다르거나 엉뚱한 폴더로 가는 일이 생긴다.
   * @param {object} ctx { base, tpl, oneChar, seq, onWait(문구) }
   */
  async function runOneJob(token, job, ctx) {
    const slot = job.slot;
    const name = job.slotName;
    const oneChar = ctx.oneChar;

    // ★와일드카드는 **장마다 따로** 뽑는다. 다시 뽑을 때도 새로 뽑는다 —
    //   실패한 장을 원래 조합 그대로 되살릴 이유가 없다 (시드도 어차피 새로 나온다).
    const wcBase = Wildcards.resolve(ctx.base, wildcardPools);
    const wcSlot = Wildcards.resolve((slot.prompt || '').trim(), wildcardPools);
    // ★한 명 모드면 이번 인물 하나만 보낸다. 켜 둔 다른 인물은 이 장에 실리지 않는다.
    const sending = oneChar ? [job.char] : characters;
    const wcChars = sending.map(function (c) {
      return Object.assign({}, c, {
        enabled: true,
        prompt: Wildcards.resolve(c.prompt || '', wildcardPools),
        uc: Wildcards.resolve(c.uc || '', wildcardPools)
      });
    });

    // ★공통 / 캐릭터 / 슬롯은 서로 다른 축이다. 어디에 붙일지는 slotTarget 이 정한다.
    const composed = composePrompts(wcBase, wcSlot, slotTarget, wcChars);
    const req = Object.assign({}, options, {
      negative_prompt: Wildcards.resolve(options.negative_prompt || '', wildcardPools),
      prompt: composed.basePrompt,
      character_prompts_with_coords: composed.characters,
      precise_references: references.map(function (r) {
        return { image: r.image, mode: r.mode, strength: r.strength, fidelity: r.fidelity };
      })
    });

    try {
      const built = buildNaiPayload(req);
      // ★재시도 중이라는 걸 알려 준다. 아무 표시 없이 멈춰 있으면 멈춘 줄 안다.
      const res = await NaiClient.generate(token, built, function (n, wait, err) {
        if (ctx.onWait) {
          ctx.onWait(NaiClient.networkMessage(err)
            + ' · ' + Math.round(wait / 1000) + '초 뒤 다시 시도 (' + n + '/3)');
        }
      });

      // ★이름을 먼저 정하고 겹침을 비켜 둔다. 같은 슬롯을 여러 장 뽑으면 반드시 겹친다.
      const relPath = Naming.dedupe(Naming.render(ctx.tpl, {
        persona: persona,
        char: oneChar ? job.charName : undefined,
        label: name,
        seq: ctx.seq,
        seed: res.seed,
        model: options.nai_model
      }), usedPaths);

      const item = ResultsModel.make({
        // ★한 명 모드면 「인물 · 슬롯」 으로 묶는다. 슬롯으로만 묶으면 인물 8명이
        //   한 묶음에 섞여 뷰어에서 누구를 보고 있는지 알 수 없다.
        slotLabel: job.group,
        cycle: job.cycle,
        kind: 'base',
        name: job.name,
        filename: relPath,
        bytes: res.bytes,
        url: URL.createObjectURL(new Blob([res.bytes], { type: 'image/png' })),
        saveInfo: {
          prompt: composed.basePrompt,
          negative: options.negative_prompt,
          characters: composed.characters.map(function (c) {
            return { prompt: c.prompt, uc: c.uc, coord: c.coord };
          }),
          model: options.nai_model, steps: options.steps, cfg: options.cfg,
          sampler: options.sampler, scheduler: options.scheduler,
          width: options.width, height: options.height, seed: res.seed,
          uc_preset: options.uc_preset, quality_preset: options.quality_preset,
          // ★인핸스·업스케일이 이 값을 보고 투명도를 지킨다. 지금 화면의 체크박스가
          //   아니라 **이 그림을 뽑을 때의 설정**이어야 한다 (그 사이에 모델을 바꿨을 수 있다).
          transparent_bg: !!options.transparent_bg,
          straight_alpha: !!options.straight_alpha,
          slot: name, cycle: job.cycle, persona: persona,
          // ★파생본(인핸스·배경 합성)도 같은 인물 폴더로 가야 한다.
          char: oneChar ? job.charName : undefined
        }
      });

      // ★자동 저장이 꺼져 있으면 아무 데도 쓰지 않는다. 뷰어에서 골라 저장한다.
      if (options.auto_save) {
        try {
          const prepared = await prepareForSave(res.bytes, relPath, item.saveInfo);
          item.filename = prepared.path;
          item.savedTo = await saveOne(prepared.bytes, prepared.path);
        } catch (e) {
          item.savedTo = null;
          item.error = '저장 실패: ' + (e && e.message ? e.message : e);
        }
      }
      return item;
    } catch (e) {
      // ★job 을 함께 들고 있는다. 이게 있어야 나중에 **이 장만** 다시 뽑을 수 있다 —
      //   인터넷이 끊겨 스무 장이 한꺼번에 깨져도 처음부터 다시 돌릴 필요가 없다.
      return ResultsModel.make({
        slotLabel: job.group,
        cycle: job.cycle,
        name: job.name,
        error: NaiClient.networkMessage(e),
        job: job,
        saveInfo: { char: oneChar ? job.charName : undefined }
      });
    }
  }

  async function runGeneration() {
    if (running) return;

    await readOptionUI();
    const base = $('base-prompt').value;
    await Store.setBasePrompt(base);
    persona = $('persona').value.trim();
    await Store.setPersona(persona);
    usedPaths = new Set();

    // ★뽑을 목록은 jobs.js 가 만든다 (인물 · 슬롯 · 배수의 순서를 거기서 검사한다).
    //   한 명 모드면 켠 인물마다 한 바퀴씩 더 돈다.
    const oneChar = oneCharOn();
    const jobs = Jobs.build({
      slots: slots, chars: characters, base: base,
      perSlot: options.count_per_slot, oneChar: oneChar
    });

    if (!jobs.length) {
      setProgress(0, 0, '생성할 슬롯이 없습니다. 슬롯을 추가하고 프롬프트를 넣어주세요.');
      return;
    }

    const token = await Store.getToken();
    if (!token) { show('setup'); return; }

    const tpl = namingTemplateNow();
    const totalJobs = jobs.length;
    // 「못 만든 것 다시 생성」 이 같은 조건으로 이어 뽑도록 들고 있는다.
    lastRun = { base: base, tpl: tpl, oneChar: oneChar };

    running = true;
    cancelRequested = false;
    $('generate').hidden = true;
    $('cancel').hidden = false;
    $('progress-open').hidden = true;
    clearResults();

    let done = 0;
    let failed = 0;

    for (let ji = 0; ji < jobs.length; ji++) {
      if (cancelRequested) {
        // ★아직 손도 못 댄 것들을 들고 있는다. 결과 화면의 「못 만든 것 다시 생성」 이
        //   실패한 장과 함께 이어서 뽑는다 — 처음부터 다시 돌리지 않게.
        pendingJobs = jobs.slice(ji);
        break;
      }
      const job = jobs[ji];
      const tag = (oneChar ? (job.charName + ' · ') : '')
        + (job.perSlot > 1 ? (job.slotName + ' (' + job.cycle + '/' + job.perSlot + ')') : job.slotName);
      setProgress(done, totalJobs, '생성 중 ' + (done + 1) + '/' + totalJobs + ' — ' + tag);

      const item = await runOneJob(token, job, {
        base: base, tpl: tpl, oneChar: oneChar, seq: done + 1,
        onWait: function (msg) { setProgress(done, totalJobs, tag + ' — ' + msg); }
      });
      if (!item.bytes) failed++;
      results.push(item);

      renderResults();
      done++;
      setProgress(done, totalJobs, done + '/' + totalJobs + ' 완료');
      // 원격 작업으로 도는 중이면 올린 쪽에도 진행을 알린다.
      reportJobProgress(done, totalJobs);
    }

    running = false;
    $('generate').hidden = false;
    $('cancel').hidden = true;

    const stopped = cancelRequested ? ' (중지됨)' : '';
    const summary = done + '/' + totalJobs + ' 완료'
      + (failed ? ', 실패 ' + failed + '건' : '') + stopped;
    setProgress(done, totalJobs, summary);
    // ★끝난 뒤에 한 번 더 그린다. 도는 동안에는 「못 만든 것 다시 생성」 이 잠겨 있고,
    //   중지로 남은 장은 루프를 빠져나온 뒤에야 정해진다 — 다시 안 그리면 줄이 안 뜬다.
    renderResults();
    $('progress-open').hidden = ResultsModel.live(results).length === 0;

    // ★알림은 실패해도 조용히 넘어간다 — 결과를 못 보게 만들면 안 된다.
    if (options.notify_on_complete && !cancelRequested) {
      Notify.done('생성이 끝났습니다', (persona ? persona + ' · ' : '') + summary);
    }
  }

  // ── 권한 ─────────────────────────────────────────────────────────────────
  // ★첫 실행 때 한 번 물어 둔다. 배치를 다 돌린 뒤에야 "알림 권한이 없어 못 알렸다" 를
  //   알게 되면 이미 늦다.
  async function renderPermStates() {
    const nEl = $('perm-notify-state');
    const st = await Notify.status();
    const NAMES = {
      granted: ['허용됨', 'ok'],
      denied: ['거부됨', 'no'],
      prompt: ['아직 안 물음', ''],
      unavailable: ['이 기기에서 지원 안 함', '']
    };
    const n = NAMES[st] || NAMES.prompt;
    nEl.textContent = n[0];
    nEl.className = 'perm-state' + (n[1] ? ' ' + n[1] : '');
    $('perm-notify').disabled = (st === 'granted' || st === 'unavailable');
    if (st === 'denied') {
      $('perm-notify').textContent = '설정에서 직접 켜야 합니다';
      $('perm-notify').disabled = true;
    }

    // 파일 저장은 실제로 써 봐야 안다 — 권한 API 로는 알 수 없는 경우가 많다.
    const fEl = $('perm-files-state');
    fEl.textContent = permFilesChecked === null ? '확인 전'
      : (permFilesChecked ? '쓸 수 있음' : '쓸 수 없음');
    fEl.className = 'perm-state' + (permFilesChecked === null ? '' : (permFilesChecked ? ' ok' : ' no'));
  }

  let permFilesChecked = null;

  /**
   * 저장 폴더에 실제로 써 보고 지운다.
   * ★권한 API 를 묻는 것보다 확실하다 — 안드로이드는 버전마다 필요한 권한이 달라서
   *   "권한은 있는데 못 쓰는" 경우가 있다.
   */
  async function checkFileAccess() {
    const probe = '.peropix-write-test.png';
    // 1x1 투명 PNG (가장 작은 유효 PNG)
    const tiny = ImageUtil.fromBase64(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
    try {
      await NaiClient.saveImage(tiny, probe);
      permFilesChecked = true;
      // 흔적을 남기지 않는다.
      try { await Folders.remove(null, probe, false, false); } catch (e) { /* 못 지워도 결과는 유효 */ }
      say($('perm-msg'), '저장 폴더에 쓸 수 있습니다.', 'ok');
    } catch (e) {
      permFilesChecked = false;
      say($('perm-msg'),
        '저장 폴더에 쓰지 못했습니다: ' + (e && e.message ? e.message : e)
        + '  ·  VPS·PC 로만 보낼 거면 그대로 두셔도 됩니다.', 'err');
    }
    renderPermStates();
  }

  async function openPerms(fromSettings) {
    permFilesChecked = null;
    say($('perm-msg'), '');
    $('perm-done').textContent = fromSettings ? '닫기' : '시작하기';
    permsFromSettings = !!fromSettings;
    show('perms');
    renderPermStates();
  }

  let permsFromSettings = false;

  // ── 키 저장 흐름 ─────────────────────────────────────────────────────────
  async function saveToken(inputEl, msgEl, onDone) {
    const token = inputEl.value.trim();
    const problem = Store.validateTokenFormat(token);
    if (problem) { say(msgEl, problem, 'err'); return; }

    say(msgEl, 'NAI 서버에 키를 확인하는 중…');
    const r = await NaiClient.checkSubscription(token);

    if (!r.ok) {
      // ★확인에 실패해도 저장은 해 준다 — 네트워크 문제일 수 있고,
      //   저장 자체를 막으면 비행기모드 등에서 아무것도 못 하게 된다.
      await Store.setToken(token);
      say(msgEl, r.message + ' 키는 저장했습니다. 생성이 잘 되면 문제없습니다.', 'err');
      return;
    }

    await Store.setToken(token);
    say(msgEl, '키가 확인되었습니다.', 'ok');
    if (onDone) setTimeout(onDone, 400);
  }

  // ── 시작 ────────────────────────────────────────────────────────────────
  async function boot() {
    options = await Store.getOptions();
    slots = await Store.getSlots();
    if (!slots.length) {
      slots = [{ label: 'happy', prompt: 'smile, happy', enabled: true }];
      await Store.setSlots(slots);
    }

    wildcardDoc = await Store.getWildcardDoc();
    presets = await Store.getPresets();
    references = await Store.getReferences();
    favorites = await Store.getFavorites();
    characters = await Store.getCharacters();
    slotTarget = await Store.getSlotTarget();
    destinations = await Store.getDestinations();
    activeDestId = await Store.getActiveDest();
    namingTemplate = await Store.getNamingTemplate();
    persona = await Store.getPersona();

    fillOptionUI();
    renderSlots();
    renderChars();
    renderRefs();
    renderResultsBadge();
    renderPresetSelect();
    $('wc-doc').value = wildcardDoc;
    renderWildcardInfo();
    $('slot-target').value = slotTarget;
    renderSlotTargetHint();
    renderDestSelect();
    renderDestList();
    renderNamingUI();
    $('base-prompt').value = await Store.getBasePrompt();
    tagsets = await Store.getTagsets();
    renderTagsetSelect();
    setupBackButton();
    $('persona').value = persona;

    jobsDestId = await Store.getJobsDest();
    jobsAuto = await Store.getJobsAuto();
    jobsSource = await Store.getJobsSource();
    ghCfg = await Store.getGithub();
    ghDone = await Store.getGithubDone();
    artDrawer = await Store.getArtists();
    artMix = await Store.getArtistMix();
    renderGhRows();
    $('jobs-auto').checked = jobsAuto;
    renderJobsDestSelect();
    // ★자동 모드는 앱을 켜 두는 동안만 돈다 (안드로이드가 백그라운드를 재운다).
    if (jobsAuto) setJobTimer(true);

    renderAnlas();
    renderOneChar();
    show((await Store.hasToken()) ? 'main' : 'setup');
    // 잔량은 통신이 필요하므로 화면을 먼저 띄우고 뒤따라 채운다.
    refreshAnlas();

    // ★설정을 다 읽은 뒤에 인트로를 걷는다. 먼저 걷으면 빈 화면이 잠깐 보인다.
    const intro = $('intro');
    if (intro) {
      $('intro-msg').textContent = '준비 완료';
      intro.classList.add('gone');
      setTimeout(function () { intro.remove(); }, 400);
    }
  }

  // ── 이벤트 ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    $('setup-save').addEventListener('click', function () {
      // ★첫 실행이면 키 다음에 권한을 묻는다. 나중에 물으면 이미 늦다.
      saveToken($('setup-token'), $('setup-msg'), function () { openPerms(false); });
    });

    // ── 프리셋 ──────────────────────────────────────────────────────
    $('preset-save').addEventListener('click', savePreset);
    $('preset-del').addEventListener('click', function () {
      const id = $('preset-select').value;
      if (id) deletePreset(id);
    });
    $('preset-select').addEventListener('change', function () {
      const id = $('preset-select').value;
      $('preset-del').disabled = !id;
      if (id) loadPreset(id);
    });

    // ── 와일드카드 ──────────────────────────────────────────────────
    $('go-wildcards').addEventListener('click', function () {
      $('wc-doc').value = wildcardDoc;
      renderWildcardInfo();
      $('wc-result').hidden = true;
      show('wildcards');
    });
    $('wc-back').addEventListener('click', function () { show('main'); });
    makeExpandable($('wc-doc'), '와일드카드 정의');
    $('wc-doc').addEventListener('input', function () {
      wildcardDoc = $('wc-doc').value;
      Store.setWildcardDoc(wildcardDoc);
      renderWildcardInfo();
    });
    $('wc-sample').addEventListener('click', function () {
      if (wildcardDoc.trim() && !window.confirm('지금 정의를 예시로 덮어쓸까요?')) return;
      wildcardDoc = Wildcards.SAMPLE;
      $('wc-doc').value = wildcardDoc;
      Store.setWildcardDoc(wildcardDoc);
      renderWildcardInfo();
    });
    $('wc-roll').addEventListener('click', function () {
      const src = $('wc-try').value;
      if (!src.trim()) { say($('wc-result'), '시험할 문장을 넣어주세요.', 'err'); return; }
      say($('wc-result'), Wildcards.resolve(src, wildcardPools), 'ok');
    });

    // ── 인핸스 · 업스케일 ───────────────────────────────────────────
    $('enh-back').addEventListener('click', function () { show('results'); });
    $('enh-run').addEventListener('click', runEnhance);
    ['enh-scale', 'enh-strength', 'enh-noise'].forEach(function (id) {
      $(id).addEventListener('input', updateEnhCost);
      $(id).addEventListener('change', updateEnhCost);
    });

    // ── 배경 합성 ───────────────────────────────────────────────────
    $('cmp-back').addEventListener('click', function () { show('results'); });
    $('cmp-pick').addEventListener('click', function () { $('cmp-file').click(); });
    $('cmp-file').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';        // 같은 파일을 다시 골라도 change 가 뜨게
      pickBackground(f);
    });
    $('cmp-run').addEventListener('click', runCompose);
    $('cmp-reroll').addEventListener('click', function () {
      cmpSeed = (cmpSeed + 1 + Math.floor(Math.random() * 9973)) >>> 0;
      renderCmpPreview();
    });
    ['cmp-mode', 'cmp-out', 'cmp-fit', 'cmp-rand-y'].forEach(function (id) {
      $(id).addEventListener('change', function () { renderCmpRows(); renderCmpPreview(); });
    });
    ['cmp-fill', 'cmp-bottom', 'cmp-scale', 'cmp-x', 'cmp-y',
     'cmp-rand-min', 'cmp-rand-max'].forEach(function (id) {
      $(id).addEventListener('input', function () { renderCmpRows(); renderCmpPreview(); });
    });
    // ★알파 처리를 바꾸면 인물 픽셀을 다시 풀어야 한다 (되돌릴지 말지가 달라진다).
    $('cmp-alpha').addEventListener('change', async function () {
      const targets = cmpTargets();
      if (!targets.length) return;
      try {
        await cmpLoadFg(targets[0]);
        renderCmpAlphaHint();
        renderCmpPreview();
      } catch (e) {
        say($('cmp-msg'), '그림을 다시 읽지 못했습니다: ' + (e && e.message ? e.message : e), 'err');
      }
    });

    $('retry-failed').addEventListener('click', retryUnfinished);

    $('batch-compose').addEventListener('click', function () { openCompose(null, true); });
    $('viewer-compose').addEventListener('click', function () {
      const r = currentItem();
      if (!r) return;
      closeViewer();
      openCompose(r, false);
    });

    $('batch-enhance').addEventListener('click', function () { openEnhance(null, true); });
    $('batch-upscale').addEventListener('click', function () {
      const list = visibleItems();
      if (!list.length) return;
      if (!window.confirm(list.length + '장을 ×4 로 업스케일할까요? Anlas 가 듭니다.')) return;
      runUpscale(list);
    });

    $('viewer-enhance').addEventListener('click', function () {
      const r = currentItem();
      if (!r) return;
      closeViewer();
      openEnhance(r, false);
    });
    $('viewer-upscale').addEventListener('click', function () {
      const r = currentItem();
      if (!r) return;
      if (!window.confirm('이 그림을 ×4 로 업스케일할까요? Anlas 가 듭니다.')) return;
      closeViewer();
      show('results');
      runUpscale([r]);
    });

    $('add-ref').addEventListener('click', function () { $('ref-file').click(); });
    $('ref-file').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';        // 같은 파일을 다시 골라도 change 가 뜨게
      addReferenceFile(f);
    });

    $('perm-notify').addEventListener('click', async function () {
      await Notify.request();
      renderPermStates();
    });
    $('perm-files').addEventListener('click', checkFileAccess);
    $('perm-done').addEventListener('click', function () {
      show(permsFromSettings ? 'settings' : 'main');
    });
    $('settings-perms').addEventListener('click', function () { openPerms(true); });

    $('go-results').addEventListener('click', function () { renderResults(); show('results'); });
    $('results-back').addEventListener('click', function () { show('main'); });
    $('progress-open').addEventListener('click', function () { renderResults(); show('results'); });
    $('results-clear').addEventListener('click', function () {
      if (!results.length) return;
      if (!window.confirm('결과 목록을 비울까요? 저장하지 않은 그림은 사라집니다.')) return;
      clearResults();
    });

    // ── 작가 태그 ───────────────────────────────────────────────────
    $('go-artists').addEventListener('click', openArtists);
    $('artists-back').addEventListener('click', function () { show('main'); });
    ['find', 'drawer', 'bisect'].forEach(function (n) {
      $('tab-' + n).addEventListener('click', function () { setArtTab(n); });
    });

    $('art-q').addEventListener('input', onArtInput);
    $('art-q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        $('art-ac').hidden = true;
        artLoad($('art-q').value);
      }
    });
    $('art-rating').addEventListener('change', function () {
      if (artCur) artLoad(artCur.tag);       // 수위를 바꾸면 그림을 다시 받는다
    });
    $('art-open').addEventListener('click', function () {
      const tag = artCur ? artCur.tag : Danbooru.normalize($('art-q').value);
      if (tag) window.open(Danbooru.webUrl(tag), '_blank');
    });
    $('art-keep').addEventListener('click', async function () {
      if (!artCur) return;
      artDrawer = Artists.add(artDrawer, { tag: artCur.tag, count: artCur.count }, Date.now());
      await Store.setArtists(artDrawer);
      renderDrawer();
      renderArtDetail();
      toast('서랍에 담았습니다.', 1800);
    });

    $('drw-q').addEventListener('input', function () {
      drwF.q = $('drw-q').value;
      renderDrawer();
    });
    $('drw-fav').addEventListener('click', function () {
      drwF.fav = !drwF.fav;
      renderDrawer();
    });
    $('mix-norm').addEventListener('change', renderMix);
    $('mix-apply').addEventListener('click', applyMix);
    $('mix-copy').addEventListener('click', async function () {
      const ok = await copyText(mixBaked());
      toast(ok ? '복사했습니다.' : '복사하지 못했습니다.', 1800);
    });
    $('mix-clear').addEventListener('click', async function () {
      artMix = [];
      await Store.setArtistMix(artMix);
      renderMix();
      renderDrawer();
    });

    $('bis-tags').addEventListener('input', renderBisSetup);
    $('bis-cross').addEventListener('change', renderBisSetup);
    $('bis-from-mix').addEventListener('click', function () {
      $('bis-tags').value = artMix.map(function (m) { return m.tag.replace(/_/g, ' '); }).join(', ');
      renderBisSetup();
    });
    $('bis-from-prompt').addEventListener('click', function () {
      // 작가 태그 칸의 첫 줄에서 쉼표로 갈라 온다. 세기 문법은 벗겨서 담는다.
      $('bis-tags').value = $('base-prompt').value;
      renderBisSetup();
      toast('작가가 아닌 태그는 지워 주세요.', 2600);
    });
    $('bis-start').addEventListener('click', bisStart);
    $('bis-shoot').addEventListener('click', bisShoot);
    $('bis-undo').addEventListener('click', function () {
      bis = Bisect.undo(bis);
      bis.shot = false;
      renderBis();
    });
    $('bis-stop').addEventListener('click', bisStop);
    $('bis-scan').addEventListener('click', bisScanRun);

    // ── 원격 작업 ───────────────────────────────────────────────────
    $('go-jobs').addEventListener('click', async function () {
      renderJobsDestSelect();
      renderGhRows();
      $('jobs-auto').checked = jobsAuto;
      show('jobs');
      await loadJobs();
      setJobTimer(true);          // 화면을 보는 동안에는 자주 확인한다
    });
    $('jobs-back').addEventListener('click', function () {
      // ★자동 모드가 아니면 나갈 때 확인을 멈춘다. 켜 뒀다면 계속 지켜본다.
      setJobTimer(jobsAuto);
      show('main');
    });
    $('jobs-reload').addEventListener('click', function () { loadJobs(); });

    $('jobs-source').addEventListener('change', async function () {
      jobsSource = $('jobs-source').value === 'github' ? 'github' : 'dest';
      await Store.setJobsSource(jobsSource);
      renderGhRows();
      say($('jobs-msg'), '');
      loadJobs();
    });
    $('gh-save').addEventListener('click', async function () {
      await readGhForm();
      renderGhRows();
      await loadJobs();
    });
    $('gh-open').addEventListener('click', function () {
      const url = Github.webUrl(ghCfg);
      if (url) window.open(url, '_blank');
    });
    $('gh-new').addEventListener('click', function () {
      // ★앱은 저장소를 만들지 못한다 (그 권한을 폰에 주지 않는다). 만드는 화면만 열어 준다.
      window.open('https://github.com/new', '_blank');
      toast('Private 로 만드시길 권합니다 — 프롬프트가 그대로 남는 곳입니다.', 3200);
    });
    $('gh-copy-setup').addEventListener('click', async function () {
      const ok = await copyText(ghSetupPrompt());
      toast(ok ? 'AI 에게 붙여넣으세요.' : '복사하지 못했습니다.', 2200);
    });
    $('gh-forget').addEventListener('click', async function () {
      if (!window.confirm('이미 한 작업 기억을 지울까요?\n지시 파일에 남아 있는 작업이 다시 뜹니다.')) return;
      ghDone = [];
      await Store.setGithubDone(ghDone);
      renderGhRows();
      await loadJobs();
    });
    $('jobs-dest').addEventListener('change', function () {
      jobsDestId = $('jobs-dest').value;
      Store.setJobsDest(jobsDestId);
      renderJobsDestSelect();
      loadJobs();
    });
    $('jobs-auto').addEventListener('change', function () {
      jobsAuto = $('jobs-auto').checked;
      Store.setJobsAuto(jobsAuto);
      setJobTimer(true);
      if (jobsAuto) toast('기다리는 작업이 있으면 바로 뽑습니다.', 2200);
    });

    $('folders-star').addEventListener('click', toggleFav);

    $('add-char').addEventListener('click', addCharacter);

    $('slot-target').addEventListener('change', function () {
      slotTarget = $('slot-target').value;
      Store.setSlotTarget(slotTarget);
      renderSlotTargetHint();
    });

    $('add-slot').addEventListener('click', addSlot);

    $('opt-model').addEventListener('change', function () {
      options.nai_model = $('opt-model').value;
      refreshModelDependent();
      readOptionUI();
      renderCharLimitHint();
      renderRefs();
    });

    ['opt-count', 'opt-enh-replace',
      'opt-uc', 'opt-quality', 'opt-sampler', 'opt-width', 'opt-height',
      'opt-steps', 'opt-cfg', 'opt-negative', 'opt-variety', 'opt-autosave',
      'opt-cfg-rescale', 'opt-transparent', 'opt-straight-alpha', 'opt-format',
      'opt-jpg-quality', 'opt-strip-meta', 'opt-notify'].forEach(function (id) {
      $(id).addEventListener('change', readOptionUI);
    });
    // ── 한 명 모드 ──────────────────────────────────────────────────
    // 본문과 서랍 두 곳에 같은 스위치가 있다 — 어느 쪽을 눌러도 같이 움직인다.
    ['opt-one-char', 'drawer-one-char'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        options.one_char_mode = $(id).checked;
        Store.setOptions(options);
        renderOneChar();
        renderCharLimitHint();
        renderCharDrawer();     // 「초과」 표시가 달라진다
        renderNamingUI();       // 경로에 인물 폴더가 생기거나 사라진다
        renderAnlas();
      });
    });

    $('opt-transparent').addEventListener('change', refreshTransparentRow);
    $('opt-format').addEventListener('change', refreshQualityRow);
    $('opt-jpg-quality').addEventListener('input', refreshQualityRow);

    bindViewer();
    bindEditor();
    makeExpandable($('base-prompt'), '작가 태그 · 퀄리티 태그');
    makeExpandable($('opt-negative'), '네거티브 프롬프트');

    $('base-prompt').addEventListener('input', function () {
      Store.setBasePrompt($('base-prompt').value);
      renderAnlas();
    });

    $('persona').addEventListener('input', function () {
      persona = $('persona').value.trim();
      Store.setPersona(persona);
      renderNamingPreview();
    });

    // ── 저장 위치 · 이름 규칙 ──────────────────────────────────────────
    $('dest-select').addEventListener('change', function () {
      activeDestId = $('dest-select').value;
      Store.setActiveDest(activeDestId);
      renderDestSelect();
      renderNamingPreview();
    });

    $('naming-preset').addEventListener('change', function () {
      const v = $('naming-preset').value;
      if (v === '__custom__') { $('naming-template').focus(); return; }
      namingTemplate = v;
      Store.setNamingTemplate(namingTemplate);
      $('naming-template').value = namingTemplate;
      renderNamingPreview();
    });

    $('naming-template').addEventListener('input', function () {
      namingTemplate = $('naming-template').value.trim() || Store.DEFAULT_TEMPLATE;
      Store.setNamingTemplate(namingTemplate);
      const known = Naming.PRESETS.some(function (p) { return p.template === namingTemplate; });
      $('naming-preset').value = known ? namingTemplate : '__custom__';
      renderNamingPreview();
    });

    // ★붙여넣는 순간 바로 등록한다 (버튼을 또 누르게 하지 않는다).
    $('dest-paste').addEventListener('input', function () {
      const v = $('dest-paste').value.trim();
      if (v.indexOf('peropix') === 0 && v.indexOf('#') !== -1) applyPairString();
    });

    $('dest-add').addEventListener('click', function () {
      destinations.push({
        id: 'd' + Date.now().toString(36),
        name: '', url: '', token: ''
      });
      Store.setDestinations(destinations);
      renderDestList();
      renderDestSelect();
    });

    // ── JSON 가져오기 ──────────────────────────────────────────────────
    $('import-json').addEventListener('click', function () { openImport('slots'); });
    $('import-chars').addEventListener('click', function () { openImport('characters'); });
    $('import-back').addEventListener('click', function () { show('main'); });
    // ── 서랍 ────────────────────────────────────────────────────────────
    $('open-chars').addEventListener('click', function () {
      if (!characters.length) { addCharacter(); return; }
      openDrawer('chars');
    });
    $('open-slots').addEventListener('click', function () {
      if (!slots.length) { addSlot(); return; }
      openDrawer('slots');
    });
    $('drawer-scrim').addEventListener('click', closeDrawer);
    Array.prototype.forEach.call(document.querySelectorAll('.drawer-close'), function (b) {
      b.addEventListener('click', closeDrawer);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bulk]'), function (b) {
      const parts = b.getAttribute('data-bulk').split('-');
      b.addEventListener('click', function () { bulkSet(parts[0], parts[1]); });
    });
    $('drawer-add-char').addEventListener('click', addCharacter);
    $('drawer-add-slot').addEventListener('click', addSlot);
    $('item-edit-close').addEventListener('click', closeItemEdit);
    $('item-edit-done').addEventListener('click', closeItemEdit);
    $('item-edit-del').addEventListener('click', deleteEditedItem);
    setupDrawerSwipe();
    setupPaint('drawer-chars-list', 'chars');
    setupPaint('drawer-slots-list', 'slots');

    $('import-file-btn').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      loadImportFile($('import-file').files && $('import-file').files[0]);
    });

    $('tagset-load').addEventListener('click', loadTagset);
    $('tagset-save').addEventListener('click', saveTagset);
    $('tagset-del').addEventListener('click', deleteTagset);
    $('import-run').addEventListener('click', function () { runImport(false); });
    $('import-append').addEventListener('click', function () { runImport(true); });

    $('generate').addEventListener('click', runGeneration);
    $('cancel').addEventListener('click', function () {
      cancelRequested = true;
      $('progress-text').textContent = '현재 장이 끝나면 중지합니다…';
    });

    $('go-folders').addEventListener('click', function () {
      // 생성 화면에서 고른 저장 위치를 그대로 이어 연다 — 방금 저장한 곳을 바로 보게.
      folderDestId = activeDestId;
      folderPath = '';
      renderFolderDestSelect();
      renderFavs();
      show('folders');
      loadFolder('');
    });
    $('folders-back').addEventListener('click', function () { show('main'); });
    $('folders-reload').addEventListener('click', function () { loadFolder(folderPath); });
    $('folders-up').addEventListener('click', function () {
      loadFolder(Folders.parentOf(folderPath));
    });
    $('folders-dest').addEventListener('change', function () {
      folderDestId = $('folders-dest').value;
      folderPath = '';
      renderFavs();
      loadFolder('');
    });
    $('folders-new').addEventListener('click', async function () {
      const name = window.prompt('새 폴더 이름');
      if (name === null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await Folders.mkdir(folderDest(), Folders.join(folderPath, trimmed));
        loadFolder(folderPath);
      } catch (e) {
        say($('folders-msg'), (e && e.message ? e.message : String(e)), 'err');
      }
    });

    $('go-settings').addEventListener('click', async function () {
      $('settings-token').value = await Store.getToken();
      say($('settings-msg'), '');
      show('settings');
    });
    $('back-main').addEventListener('click', function () { show('main'); });

    $('settings-save').addEventListener('click', function () {
      saveToken($('settings-token'), $('settings-msg'), null);
    });

    $('settings-test').addEventListener('click', async function () {
      const token = await Store.getToken();
      if (!token) { say($('settings-msg'), '저장된 키가 없습니다.', 'err'); return; }
      say($('settings-msg'), '확인하는 중…');
      const r = await NaiClient.checkSubscription(token);
      say($('settings-msg'), r.message, r.ok ? 'ok' : 'err');
    });

    $('settings-clear').addEventListener('click', async function () {
      await Store.clearToken();
      $('settings-token').value = '';
      say($('settings-msg'), '키를 삭제했습니다.', 'ok');
    });

    boot();
  });
})();
