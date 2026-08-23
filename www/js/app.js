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

  // ── 홈 ───────────────────────────────────────────────────────────────────
  function renderHome() {
    const live = ResultsModel.live(results).length;
    badge('home-results-badge', live);
    badge('home-jobs-badge',
      jobsList.filter(function (j) { return j.status === 'pending'; }).length);
    badge('home-bulk-badge', running ? 1 : 0, running ? '…' : '');
    $('home-sub').textContent = persona ? ('폴더: ' + persona) : 'Lkit mobile ver.';

    const bal = $('home-anlas');
    const src = $('anlas-bal');
    bal.hidden = !src || src.hidden;
    if (!bal.hidden) bal.textContent = src.textContent;

    // 홈에도 팁을 한 줄. 인트로를 눌러 넘긴 사람도 볼 수 있게 한다.
    $('home-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  function badge(id, n, text) {
    const el = $(id);
    if (!el) return;
    el.hidden = !n;
    if (n) el.textContent = text !== undefined ? text : String(n);
  }

  // ── 인트로 ───────────────────────────────────────────────────────────────
  // ★쓰는 법을 여기서 한 줄씩 알려 준다. 기능이 늘면서 어디에 뭐가 있는지 찾기 어려워졌는데,
  //   설명서를 따로 만들어 봐야 아무도 안 읽는다. 어차피 뜨는 화면이니 여기에 얹는다.
  const TIPS = [
    '작가 태그 → 찾기 에서 이름을 넣으면 그 작가 이미지가 몇 장인지, NAI 가 알아볼 만한지 바로 보입니다.',
    '작가 태그 → 테스트 → 조합 은 가중치를 아무렇게나 매긴 조합을 여러 개 뽑아 줍니다. 마음에 드는 걸 고르세요.',
    '조합에서 딱 맞는 게 없으면 별점을 매기고 "점수 반영해서 다시 뽑기". 높은 점수 쪽으로 가중치가 당겨집니다.',
    '작가 20명을 넣었는데 어떤 부분이 누구 때문인지 모르겠다면, 테스트 → 깎기 가 5번 만에 범인을 찾아 줍니다.',
    '뷰어에서 위로 밀면 버리기, 아래로 밀면 저장. 손가락 두 개로 벌리면 확대됩니다.',
    '조합·깎기에서 생성한 이미지을 누르면 크게 뜹니다. 좌우로 밀어 그 세트 안을 오가고, 아래 별점으로 점수를 줍니다.',
    '인터넷이 끊겨 몇 장이 깨졌으면, 결과 화면 맨 위의 "못 만든 N장 다시 생성" 이 그것만 다시 뽑습니다.',
    '인물이 많고 슬롯이 적으면 "한 명 모드" 를 켜세요. 인물 수만큼 자동으로 돌립니다.',
    '투명 배경으로 생성한 이미지은 "배경 합성" 으로 배경 그림 위에 얹을 수 있습니다. 통신도 Anlas 도 안 듭니다.',
    'API 키는 이 폰에만 저장됩니다. APK 를 남에게 줘도 키는 따라가지 않습니다.'
  ];

  const INTRO_MS = 5000;

  /** 인트로를 띄우고 5초 뒤에 걷는다. 아무 데나 누르면 바로 넘어간다. */
  function startIntro() {
    const intro = $('intro');
    if (!intro) return;

    let tip = Math.floor(Math.random() * TIPS.length);   // 켤 때마다 다른 것부터
    const showTip = function () {
      const el = $('intro-tip-text');
      el.textContent = TIPS[tip % TIPS.length];
      // 애니메이션을 다시 태우려면 한 번 떼었다 붙여야 한다.
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      tip++;
    };
    showTip();
    $('intro-msg').textContent = '준비 완료';

    const started = Date.now();
    const rotate = setInterval(showTip, 2200);
    const tick = setInterval(function () {
      const p = Math.min(1, (Date.now() - started) / INTRO_MS);
      $('intro-fill').style.width = (p * 100) + '%';
      if (p >= 1) close();
    }, 100);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(rotate);
      clearInterval(tick);
      intro.classList.add('gone');
      setTimeout(function () { intro.remove(); }, 400);
    }
    intro.addEventListener('click', close);
  }

  // ── 화면 전환 ────────────────────────────────────────────────────────────
  // ★뒤로가기가 "어디서 눌렸는지" 알아야 해서 지금 화면을 들고 있는다.
  let currentScreen = 'main';

  // ★어디서 들어왔는지 기억한다. 홈에서 연 화면의 "뒤로" 가 대량생성으로 가면
  //   가 본 적 없는 곳에 떨어진다.
  let hubScreen = 'home';

  function show(which) {
    if (currentScreen === 'home' || currentScreen === 'main') hubScreen = currentScreen;
    currentScreen = which;
    ['setup', 'perms', 'home', 'main', 'settings', 'import', 'folders', 'results',
     'wildcards', 'enhance', 'compose', 'jobs', 'artists', 'guide',
     'connect'].forEach(function (n) {
      $('screen-' + n).hidden = (n !== which);
    });
    // ★들어오는 화면만 짧게 떠오르게. 클래스를 뗐다 붙이지 않으면 같은 화면을
    //   다시 열었을 때 애니메이션이 안 돈다 (브라우저가 "그대로" 로 본다).
    const el = $('screen-' + which);
    el.classList.remove('sc-in');
    void el.offsetWidth;
    el.classList.add('sc-in');
    window.scrollTo(0, 0);
  }

  // ── 업데이트 알림 ──────────────────────────────────────────────────────────
  // ★조용히 알아서 깔리게는 **못 만든다.** 안드로이드는 옆에서 받아 까는 앱을 설치할 때
  //   반드시 사람이 확인 화면을 눌러야 한다. 그러니 앱이 할 수 있는 것은 여기까지다 —
  //   새 버전이 나온 것을 알아채고, 받는 곳까지 한 번에 데려다주는 것.
  // ★스토어를 안 거치므로 아무도 안 알려 준다. 그래서 앱이 직접 본다.
  let updRepo = Store.DEFAULT_UPDATE_REPO;
  let appVersion = '';        // 지금 깔려 있는 버전 (네이티브에서만 알 수 있다)
  let updLatest = null;

  /** 지금 깔린 버전. ★브라우저 미리보기에서는 알 길이 없어 빈 값이다. */
  async function loadAppVersion() {
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (!P || !P.App || !P.App.getInfo) return '';
    try {
      const info = await P.App.getInfo();
      return String(info && info.version || '');
    } catch (e) {
      return '';
    }
  }

  /**
   * GitHub 릴리스를 본다.
   * ★인박스 토큰을 붙이지 않는다. 공개 저장소라 필요도 없고, 남의 토큰 한도를 쓸 일도
   *   아니다 (ghGet 은 토큰을 붙이므로 여기서 안 쓴다).
   */
  /**
   * GitHub 이 준 코드를 사람 말로.
   * ★404 는 「저장소가 비공개」 인 경우가 대부분이다. 앱은 열쇠 없이 보기 때문에
   *   비공개 저장소의 릴리스는 영영 못 본다. 숫자만 띄우면 뭘 고쳐야 할지 모른다.
   */
  function githubWhy(status) {
    if (status === 404) {
      return '그 저장소의 릴리스를 못 찾았습니다. 비공개 저장소이거나 이름이 틀렸습니다 '
        + '(앱은 열쇠 없이 보므로 비공개는 확인할 수 없습니다).';
    }
    if (status === 403) return 'GitHub 한도에 걸렸습니다. 한 시간 뒤에 다시 보세요.';
    return 'GitHub 이 ' + status + ' 로 답했습니다.';
  }

  async function fetchLatest() {
    const url = Updater.latestUrl(updRepo);
    if (!url) throw new Error('저장소를 owner/repo 로 적어 주세요 (지금: ' + updRepo + ')');
    const headers = { Accept: 'application/vnd.github+json' };
    const C = window.Capacitor;
    const P = (C && C.Plugins) ? C.Plugins : null;
    if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && P && P.CapacitorHttp) {
      const r = await P.CapacitorHttp.request({
        method: 'GET', url: url, headers: headers, connectTimeout: 15000, readTimeout: 25000
      });
      if (r.status >= 400) throw new Error(githubWhy(r.status));
      return Updater.parseLatest(typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
    }
    const r = await fetch(url, { headers: headers, cache: 'no-store' });
    if (!r.ok) throw new Error(githubWhy(r.status));
    return Updater.parseLatest(await r.text());
  }

  /** 시작 화면의 알림 줄. */
  // ★같은 알림을 시작 화면과 설정 두 곳에 띄운다. 업데이트하려고 설정에서 확인을
  //   눌렀는데 「시작 화면에서 받으세요」 만 나오면, 받으러 다시 나가야 했다.
  const UPD_SPOTS = [
    { box: 'home-upd', title: 'upd-title', ver: 'upd-ver', list: 'upd-list', get: 'upd-get' },
    { box: 'ver-upd', title: 'ver-upd-title', ver: 'ver-upd-ver', list: 'ver-upd-list',
      get: 'ver-upd-get' }
  ];

  function renderUpdate(d) {
    const show = !!(d && d.show && updLatest);
    UPD_SPOTS.forEach(function (spot) {
      const box = $(spot.box);
      if (!box) return;
      box.hidden = !show;
      if (!show) return;
      $(spot.title).textContent = '업데이트가 있습니다';
      $(spot.ver).textContent = Updater.summary(appVersion, updLatest);
      const list = $(spot.list);
      list.innerHTML = '';
      Updater.highlights(updLatest.notes, 4).forEach(function (line) {
        const li = document.createElement('li');
        li.textContent = line;
        list.appendChild(li);
      });
      // 크기를 적어 준다 — 데이터를 아끼는 사람에게는 이게 판단 근거다.
      $(spot.get).textContent = updLatest.apkSize
        ? ('받아서 설치 (' + Math.round(updLatest.apkSize / 1048576) + 'MB)')
        : '받아서 설치';
    });
  }

  /**
   * 업데이트가 있는지 본다.
   * @param {boolean} manual 사람이 눌러서 부른 것인가 (그러면 간격을 안 따지고 결과도 적는다)
   */
  async function checkUpdate(manual) {
    const msg = $('ver-msg');
    if (!manual) {
      if (!(await Store.getUpdateAuto())) return;
      if (!Updater.due(await Store.getUpdateCheckedAt(), Date.now())) return;
    }
    if (manual) msg.textContent = '보는 중…';
    // 깔린 버전을 그때그때 다시 읽는다. 켤 때 한 번만 읽어 두면, 읽기 전에 확인이 돌면
    // "현재 버전을 모른다" 로 새어 나간다.
    appVersion = await loadAppVersion();
    try {
      updLatest = await fetchLatest();
      await Store.setUpdateCheckedAt(Date.now());
      const d = Updater.decide({
        current: appVersion,
        latest: updLatest,
        skipped: await Store.getUpdateSkipped()
      });
      renderUpdate(d);
      if (!manual) return;
      // ★눌러서 본 것은 결과를 반드시 적어 준다. 아무 일도 안 일어나면 고장으로 보인다.
      if (d.show) msg.textContent = '새 버전 ' + d.version + ' 이 있습니다. 아래에서 바로 받으세요.';
      else if (d.reason === 'current') msg.textContent = '최신입니다 (' + d.version + ').';
      else if (d.reason === 'skipped') msg.textContent = d.version + ' 은 건너뛰기로 해 두셨습니다.';
      else if (d.reason === 'unknown') {
        msg.textContent = '최신 버전은 ' + d.version + ' 입니다. '
          + '(브라우저 미리보기에서는 현재 버전을 알 수 없어 견주지 못합니다.)';
      } else msg.textContent = '릴리스를 찾지 못했습니다.';
    } catch (e) {
      updLatest = null;
      if (manual) msg.textContent = '보지 못했습니다: ' + (e.message || e);
    }
  }

  /** 저장소 고르는 줄. 목록에 없는 것이면 「직접 적기」 로 펴 준다. */
  function renderUpdateRepo() {
    const sel = $('ver-repo');
    const known = Array.from(sel.options).some(function (o) { return o.value === updRepo; });
    sel.value = known ? updRepo : '__custom__';
    $('ver-repo-row').hidden = known;
    $('ver-repo-text').value = updRepo;
  }

  async function readUpdateRepo() {
    const pick = $('ver-repo').value;
    if (pick === '__custom__') {
      $('ver-repo-row').hidden = false;
      updRepo = $('ver-repo-text').value.trim() || Store.DEFAULT_UPDATE_REPO;
    } else {
      updRepo = pick;
      $('ver-repo-row').hidden = true;
    }
    await Store.setUpdateRepo(updRepo);
    // ★저장소를 바꾸면 「언제 마지막으로 봤는지」 를 지운다. 안 그러면 여섯 시간 동안
    //   옛 저장소의 결과를 그대로 들고 있는다.
    await Store.setUpdateCheckedAt(0);
    updLatest = null;
    $('home-upd').hidden = true;
  }

  /**
   * 새 버전 APK 를 받아서 설치 화면까지 띄운다.
   *
   * ★조용히 알아서 깔지는 못한다. 안드로이드는 스토어를 안 거친 APK 를 설치할 때 반드시
   *   사람이 확인 화면을 눌러야 한다. 앱이 하는 일은 받아 두고 그 화면까지 데려다주는 것이다.
   * ★네이티브 플러그인이 없으면(PC 미리보기 등) 그냥 링크를 연다. 브라우저에서도
   *   똑같이 굴러가야 검사를 할 수 있다.
   */
  async function downloadAndInstall(btnId) {
    if (!updLatest) return;
    // ★어느 자리에서 눌렀는지에 따라 그 단추에 진행을 적는다. 한 곳에 박아 두면
    //   설정에서 눌렀을 때 시작 화면의 단추만 바뀌어 아무 반응이 없어 보인다.
    const btn = $(btnId || 'upd-get');
    const P = window.Capacitor && window.Capacitor.Plugins;
    // ponytail: Filesystem.downloadFile 은 7.1 부터 deprecated 다 (아직 돌아간다).
    //   빠지면 @capacitor/file-transfer 로 옮긴다. 그때까지 의존성을 하나 더 들이지 않는다.
    const native = !!(P && P.Installer && P.Filesystem
      && typeof P.Filesystem.downloadFile === 'function' && updLatest.apkUrl);
    if (!native) {
      window.open(updLatest.apkUrl || updLatest.pageUrl, '_blank');
      return;
    }

    const label = btn.textContent;
    btn.disabled = true;
    try {
      // 권한이 없으면 먼저 설정으로 보낸다. 없는 채로 띄우면 아무 일도 안 일어난다.
      const can = await P.Installer.canInstall();
      if (!can || !can.granted) {
        btn.textContent = '권한을 켜 주세요';
        await P.Installer.openSettings();
        toast('"이 출처 허용" 을 켠 뒤 다시 눌러 주세요.', 4000);
        return;
      }

      btn.textContent = '받는 중…';
      const name = 'peropix-' + updLatest.version + '.apk';
      // ★캐시 폴더에 받는다. FileProvider 가 내주는 곳이 거기다 (res/xml/file_paths.xml).
      await P.Filesystem.downloadFile({
        url: updLatest.apkUrl, path: name, directory: 'CACHE'
      });

      btn.textContent = '설치 화면 여는 중…';
      await P.Installer.install({ name: name });
      btn.textContent = label;
    } catch (e) {
      // 받다가 안 되면 링크라도 열어 준다. 여기서 막히면 업데이트할 길이 없어진다.
      toast('앱에서 받지 못했습니다. 브라우저로 엽니다: ' + (e.message || e), 4000);
      window.open(updLatest.apkUrl || updLatest.pageUrl, '_blank');
      btn.textContent = label;
    } finally {
      btn.disabled = false;
    }
  }

  function bindUpdate() {
    // 시작 화면과 설정, 어느 쪽 단추를 눌러도 같게 돈다.
    $('upd-get').addEventListener('click', function () { downloadAndInstall('upd-get'); });
    $('ver-upd-get').addEventListener('click', function () { downloadAndInstall('ver-upd-get'); });

    const skip = async function () {
      if (!updLatest) return;
      await Store.setUpdateSkipped(updLatest.version);
      UPD_SPOTS.forEach(function (spot) { $(spot.box).hidden = true; });
      toast(updLatest.version + ' 은 다시 안 알립니다. 그 다음 버전부터 알려 드립니다.', 3000);
    };
    $('upd-skip').addEventListener('click', skip);
    $('ver-upd-skip').addEventListener('click', skip);

    // "나중에" 는 이번에만 접는다 (다음에 켜면 또 알려 준다). 설정 쪽은 안 접는다 —
    // 거기는 일부러 찾아 들어온 자리라 접어 버리면 다시 확인을 눌러야 한다.
    $('upd-later').addEventListener('click', function () { $('home-upd').hidden = true; });

    $('ver-check').addEventListener('click', function () { checkUpdate(true); });
    $('ver-repo').addEventListener('change', readUpdateRepo);
    $('ver-repo-text').addEventListener('change', readUpdateRepo);
    $('ver-auto').addEventListener('change', async function () {
      await Store.setUpdateAuto($('ver-auto').checked);
    });

    $('cons-mode').addEventListener('change', readConsistency);
    $('cons-get').addEventListener('click', consDownload);
    $('cons-score-copy').addEventListener('click', function () {
      copyPy('score.py', 'cons-server-msg');
    });
    $('cons-score-save').addEventListener('click', function () {
      savePy('score.py', 'cons-server-msg');
    });
  }

  /**
   * 가이드.
   * ★인트로 팁은 한 번에 하나만 보여 준다. "그거 뭐였더라" 를 찾아볼 곳이 따로 있어야 한다.
   * ★팁 목록은 인트로와 **같은 배열**을 쓴다. 두 벌로 두면 한쪽만 고쳐진다.
   */
  function openGuide() {
    show('guide');

    const tips = $('guide-tips');
    if (!tips.children.length) {
      TIPS.forEach(function (t) {
        const li = document.createElement('li');
        li.textContent = t;
        tips.appendChild(li);
      });
    }

    const nav = $('guide-nav');
    if (!nav.children.length) {
      Array.from(document.querySelectorAll('#screen-guide details')).forEach(function (d) {
        const c = document.createElement('button');
        c.className = 'chip';
        c.textContent = d.querySelector('summary').textContent;
        // 눌러서 그 항목만 펴고 그리로 옮겨 준다 — 긴 글을 스크롤로 찾게 하지 않는다.
        c.addEventListener('click', function () {
          Array.from(document.querySelectorAll('#screen-guide details')).forEach(function (x) {
            x.open = (x === d);
          });
          d.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        nav.appendChild(c);
      });
    }
  }

  /** 온 곳으로 돌아간다. */
  function goBack() {
    show(hubScreen);
    if (hubScreen === 'home') renderHome();
  }

  // ── 안드로이드 뒤로가기 ──────────────────────────────────────────────────
  // ★기본 동작은 "앱 종료" 다. 갤럭시 네비게이션 바로 뒤로 가면 작업 중이던 것이
  //   통째로 날아간다. 그래서 직접 가로채, 열린 것부터 차례로 닫는다.
  //     오버레이(편집기·뷰어) → 하위 화면 → 메인 → (한 번 더 누르면) 종료
  let backExitArmed = false;
  let backExitTimer = null;

  function handleBack() {
    // 1) 오버레이가 떠 있으면 그것부터 닫는다. 겹쳐 있으면 위에 있는 것부터.
    if (!$('editor').hidden) { closeEditor(); return; }
    if (!$('item-edit').hidden) { closeItemEdit(); return; }
    if (openDrawerName) { closeDrawer(); return; }
    if (!$('viewer').hidden) { closeViewer(); return; }

    // 2) 하위 화면이면 메인으로.
    if (currentScreen !== 'home' && currentScreen !== 'setup' && currentScreen !== 'perms') {
      goBack();
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
  // ★"전체 켜기/끄기" 는 전부 아니면 전무다. 실제로는 "이 구간만" 이 잦다.
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
      box.appendChild(mkText('이름', 'name', '예: 미아, 비워 두면 "인물 ' + (i + 1) + '"',
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
    if (!window.confirm('"' + nm + '" 을(를) 지울까요?')) return;

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
   *   살아 있어야 나중에 그 그림을 NAI 산출물로 다시 읽을 수 있다.
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
   * ★다시 인코딩하면 사라지는데, 사라지면 그 그림을 NAI 산출물로 다시 읽지 못한다.
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
   *   같은 절차). 그래서 투명 배경으로 생성한 이미지을 인핸스하면 배경이 하얗게 붙어 돌아온다.
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

  /**
   * 앱 안에 든 receiver.py 를 꺼낸다.
   * ★저장소를 뒤져 내려받게 하지 않는다. 앱 안의 것이 **지금 이 앱과 짝이 맞는 버전**이라,
   *   여기서 꺼내 쓰는 것이 제일 확실하다 (저장소 기본 가지에는 예전 버전이 있을 수 있다).
   */
  async function receiverSource(name) {
    const file = name || 'receiver.py';
    const r = await fetch(file + '.txt', { cache: 'no-store' });
    if (!r.ok) throw new Error('앱 안에서 파일을 못 찾았습니다 (' + r.status + ')');
    const text = await r.text();
    if (text.indexOf('PeroPix') === -1) throw new Error('파일이 온전하지 않습니다.');
    return text;
  }

  /** 앱에 든 파이썬 파일을 클립보드로. SSH 에 그대로 붙여넣으라고 만든 길이다. */
  async function copyPy(name, boxId) {
    const box = $(boxId);
    box.textContent = '꺼내는 중…';
    try {
      const text = await receiverSource(name);
      const t = $('editor-text');
      const keep = t.value;
      t.value = text;
      const ok = await copyFromEditor();
      t.value = keep;
      box.textContent = ok
        ? (name + ' 를 복사했습니다. SSH 에서 "cat > ' + name + '" 하고 붙여넣은 뒤 Ctrl+D.')
        : '복사하지 못했습니다. "파일로 저장" 을 쓰세요.';
    } catch (e) {
      box.textContent = '꺼내지 못했습니다: ' + (e.message || e);
    }
  }

  async function savePy(name, boxId) {
    const box = $(boxId);
    box.textContent = '저장하는 중…';
    try {
      const bytes = new TextEncoder().encode(await receiverSource(name));
      const where = await NaiClient.saveImage(bytes, name, 'text/x-python');
      box.textContent = where + ' 에 저장했습니다.';
    } catch (e) {
      box.textContent = '저장하지 못했습니다: ' + (e.message || e);
    }
  }

  // ★한 줄 설치. 파일 올리기·실행·방화벽·상시 실행을 이 한 줄이 대신한다.
  //   저장소가 공개라 토큰이 필요 없다.
  function installCmd() {
    const open = $('rx-cmd-open').checked ? ' -s -- --open' : '';
    return 'curl -fsSL https://raw.githubusercontent.com/' + Store.DEFAULT_UPDATE_REPO
      + '/main/tools/deploy/install.sh | sudo bash' + open;
  }

  function renderInstallCmd() {
    $('rx-cmd').textContent = installCmd();
  }

  async function copyInstallCmd() {
    const box = $('rx-cmd-msg');
    const t = $('editor-text');
    const keep = t.value;
    t.value = installCmd();
    const ok = await copyFromEditor();
    t.value = keep;
    box.textContent = ok
      ? '복사했습니다. SSH 창에 붙여넣고 Enter 를 누르세요.'
      : '복사하지 못했습니다. 위 글을 길게 눌러 직접 복사하세요.';
  }

  // ── 연결 따라 하기 ──────────────────────────────────────────────────────
  // ★명령 한 줄로 줄여도 「터미널을 어떻게 여는가」 를 모르면 못 한다. 업체별로 어디를
  //   눌러야 웹 터미널이 나오는지까지 짚어 준다 — SSH 프로그램을 따로 깔지 않아도 된다.
  const CW_KINDS = [
    { key: 'vps', label: 'VPS (인터넷 서버)',
      hint: '어디서든 닿습니다. 폰 데이터로도 씁니다. 업체 방화벽을 한 번 열어야 할 수 있습니다.' },
    { key: 'pc', label: '집 안 PC (리눅스 · 맥)',
      hint: '같은 Wi-Fi 안에서만 닿습니다. 방화벽을 건드릴 일이 거의 없습니다.' },
    { key: 'win', label: '집 안 PC (윈도우)',
      hint: '★이 설치 명령은 윈도우에서 안 돕니다. 아래 3번 대신 다른 방법을 알려 드립니다.' }
  ];

  // 업체마다 웹 터미널이 어디 있는지. ★여기가 이 화면의 알맹이다.
  const CW_HOSTS = [
    { key: 'contabo', label: 'Contabo',
      how: '고객 패널 로그인 → 왼쪽 <b>Your Services</b> → 서버 줄의 <b>Manage</b> → '
        + '위쪽 <b>VNC</b> 를 누르면 브라우저 안에 검은 창이 열립니다. '
        + 'root 로 로그인한 뒤 3번으로 가세요.' },
    { key: 'vultr', label: 'Vultr',
      how: 'Products → 서버 이름 클릭 → 오른쪽 위 <b>View Console</b>.' },
    { key: 'do', label: 'DigitalOcean',
      how: 'Droplets → 서버 클릭 → 오른쪽 위 <b>Console</b>.' },
    { key: 'lightsail', label: 'AWS Lightsail',
      how: '인스턴스 카드의 <b>Connect using SSH</b> 단추. 바로 검은 창이 열립니다.' },
    { key: 'oracle', label: 'Oracle Cloud',
      how: '인스턴스 화면의 <b>Cloud Shell</b> 을 열고 '
        + '<code>ssh ubuntu@서버IP</code> 를 칩니다.' },
    { key: 'ssh', label: '그 밖 · SSH 로 직접',
      how: '이미 쓰시는 SSH 프로그램(Termius · PuTTY · 맥 터미널)으로 서버에 붙으세요. '
        + '폰만 있다면 <b>Termius</b> 앱이 무료로 됩니다.' }
  ];

  let cwKind = 'vps';

  function renderWizard() {
    const chips = $('cw-kind');
    if (!chips.children.length) {
      CW_KINDS.forEach(function (k) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = k.label;
        b.addEventListener('click', function () { cwKind = k.key; renderWizard(); });
        chips.appendChild(b);
      });
    }
    Array.from(chips.children).forEach(function (b, i) {
      b.classList.toggle('on', CW_KINDS[i].key === cwKind);
    });
    const kind = CW_KINDS.find(function (k) { return k.key === cwKind; }) || CW_KINDS[0];
    $('cw-kind-hint').innerHTML = kind.hint;

    const sel = $('cw-host');
    if (!sel.children.length) {
      CW_HOSTS.forEach(function (h) {
        const o = document.createElement('option');
        o.value = h.key;
        o.textContent = h.label;
        sel.appendChild(o);
      });
      sel.addEventListener('change', renderWizard);
    }

    // 윈도우는 이 스크립트가 안 돈다. 얼버무리지 말고 다른 길을 준다.
    const win = cwKind === 'win';
    $('cw-step-term').hidden = win;
    if (win) {
      $('cw-cmd').textContent = 'python receiver.py --root ./images';
      $('cw-copy-msg').innerHTML = '윈도우에서는 이 설치 명령이 안 돕니다 (리눅스 전용). '
        + '대신 <b>파이썬</b>을 깔고(python.org), 위 <b>한 줄로 설치</b> 아래의 '
        + '<b>receiver.py 파일로 저장</b> 으로 파일을 받은 뒤, 그 폴더에서 '
        + '<code>python receiver.py --root ./images</code> 를 실행하세요. '
        + '창을 닫으면 멈추니 켜 두셔야 합니다.';
    } else {
      const h = CW_HOSTS.find(function (x) { return x.key === sel.value; }) || CW_HOSTS[0];
      $('cw-host-how').innerHTML = h.how;
      // 집 안 PC 면 바깥에 열 이유가 없다.
      $('cw-cmd').textContent = cwInstallCmd();
      $('cw-copy-msg').textContent = '복사한 뒤 터미널에 붙여넣고 Enter 를 누르세요. '
        + '1~2분쯤 글자가 주르륵 올라갑니다.';
    }
  }

  function cwInstallCmd() {
    const open = cwKind === 'vps' ? ' -s -- --open' : '';
    return 'curl -fsSL https://raw.githubusercontent.com/' + Store.DEFAULT_UPDATE_REPO
      + '/main/tools/deploy/install.sh | sudo bash' + open;
  }

  /**
   * 앱이 직접 SSH 로 붙어 수신함을 깐다.
   * ★사람이 터미널을 아예 안 보게 하려는 것이다. 파일 올리기·명령 치기·방화벽 열기가
   *   전부 여기서 끝난다.
   */
  async function cwSshRun() {
    const box = $('cw-ssh-msg');
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (!P || !P.Ssh) {
      say(box, '이 기능은 앱(APK)에서만 됩니다. 브라우저 미리보기에서는 아래 「직접 터미널로 하기」 를 쓰세요.', 'err');
      return;
    }
    const at = Ssh.split($('cw-ssh-host').value);
    const user = $('cw-ssh-user').value.trim();
    const pw = $('cw-ssh-pw').value;
    if (!at.host) { say(box, '서버 주소를 넣어 주세요.', 'err'); return; }
    if (!user) { say(box, '아이디를 넣어 주세요.', 'err'); return; }

    const btn = $('cw-ssh-run');
    btn.disabled = true;
    say(box, '붙는 중… (설치까지 1~3분 걸립니다. 화면을 켜 두세요)');
    try {
      const cmd = Ssh.installCommand({
        repo: Store.DEFAULT_UPDATE_REPO,
        open: cwKind === 'vps',
        root: user === 'root'
      });
      const r = await P.Ssh.exec({
        host: at.host, port: at.port, user: user, password: pw,
        command: cmd, timeoutMs: 240000
      });

      // ★서버 열쇠가 예전과 다르면 알린다. 서버를 다시 깔았거나 남이 끼어든 것이다.
      const saved = await Store.getSshKey(at.host);
      if (Ssh.keyChanged(saved, r.fingerprint)) {
        $('cw-ssh-fp').textContent = '⚠ 이 서버의 열쇠가 예전과 다릅니다 (' + r.fingerprint
          + '). 서버를 다시 깐 것이 아니라면 조심하세요.';
      } else {
        $('cw-ssh-fp').textContent = r.fingerprint ? ('서버 열쇠: ' + r.fingerprint) : '';
        if (r.fingerprint) await Store.setSshKey(at.host, r.fingerprint);
      }

      const v = Ssh.verdict(r);
      if (!v.ok) { say(box, v.why, 'err'); return; }

      say(box, '설치했습니다. 연결을 확인하는 중…');
      const dest = await addDestination(v.pair, box);
      if (dest) {
        $('cw-ssh-pw').value = '';        // 비밀번호는 안 들고 있는다
        $('cw-step-done').hidden = false;
        $('cw-step-done').scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch (e) {
      say(box, Ssh.explain(e), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function cwCopy() {
    const t = $('editor-text');
    const keep = t.value;
    t.value = $('cw-cmd').textContent;
    const ok = await copyFromEditor();
    t.value = keep;
    $('cw-copy-msg').textContent = ok
      ? '복사했습니다. 터미널에 붙여넣고 Enter 를 누르세요.'
      : '복사하지 못했습니다. 위 글을 길게 눌러 직접 복사하세요.';
  }

  async function cwConnect() {
    const box = $('cw-msg');
    const r = await addDestination($('cw-paste').value, box);
    if (!r) return;
    $('cw-paste').value = '';
    $('cw-step-done').hidden = false;
    $('cw-step-done').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function openWizard() {
    show('connect');
    $('cw-msg').hidden = true;
    $('cw-step-done').hidden = true;
    renderWizard();
  }

  async function copyReceiver() {
    const box = $('rx-msg');
    box.textContent = '꺼내는 중…';
    try {
      const text = await receiverSource();
      // 편집기 칸을 빌려 복사한다 — 보이는 칸을 선택해서 복사하는 길이 성공률이 높다.
      const t = $('editor-text');
      const keep = t.value;
      t.value = text;
      const ok = await copyFromEditor();
      t.value = keep;
      box.textContent = ok
        ? 'receiver.py 를 복사했습니다. SSH 에서 "cat > receiver.py" 하고 붙여넣은 뒤 Ctrl+D.'
        : '복사하지 못했습니다. "파일로 저장" 을 쓰세요.';
    } catch (e) {
      box.textContent = '꺼내지 못했습니다: ' + (e.message || e);
    }
  }

  async function saveReceiver() {
    const box = $('rx-msg');
    box.textContent = '저장하는 중…';
    try {
      const bytes = new TextEncoder().encode(await receiverSource());
      const where = await NaiClient.saveImage(bytes, 'receiver.py', 'text/x-python');
      box.textContent = where + ' 에 저장했습니다.';
    } catch (e) {
      box.textContent = '저장하지 못했습니다: ' + (e.message || e);
    }
  }

  /**
   * peropix:// 한 줄로 수신함을 등록하고 연결까지 확인한다.
   * ★설정 칸과 따라 하기 화면이 **같은 코드**를 쓴다. 두 벌로 두면 한쪽만 고쳐진다.
   * @returns {Promise<object|null>} 붙은 대상, 실패하면 null
   */
  async function addDestination(pasted, box) {
    const r = parsePairString(pasted);
    if (!r.ok) { say(box, r.error, 'err'); return null; }

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
    // ★검사를 맡길지는 지금 묻는다. 설정 깊은 곳에 숨겨 두면 아무도 못 찾는다.
    await askDestScore(dest, ping);

    renderDestList();
    renderDestSelect();
    renderNamingPreview();
    // ★닿지 않으면 성공으로 치지 않는다. 따라 하기 화면이 「끝났습니다」 를 띄우면
    //   안 되는 것을 됐다고 믿고 넘어간다.
    return ping.ok ? dest : null;
  }

  async function applyPairString() {
    if (await addDestination($('dest-paste').value, $('dest-paste-msg'))) {
      $('dest-paste').value = '';
    }
  }

  // ── 오래 걸리는 일 붙잡아 두기 ───────────────────────────────────────────
  // ★안드로이드는 화면에 안 보이는 앱을 재운다. 그러면 WebView 의 자바스크립트가 멈추고
  //   DNS 도 막혀, 다른 앱을 잠깐 보고 돌아오면 「인터넷 연결이 끊겼습니다」 가 뜬다.
  //   몇 분씩 걸리는 일을 하면서 화면을 계속 켜 두라고 할 수는 없다.
  // ★실패해도 하던 일은 그대로 간다. 붙잡아 두지 못할 뿐이지, 이것 때문에 못 뽑으면
  //   본말이 뒤집힌다.
  let keepDepth = 0;

  /**
   * 오래 걸리는 일의 시작·끝을 한 곳에서 잡는다.
   * ★running 을 직접 대입하면 붙잡기(keepAwake)와 놓기(releaseAwake)의 짝이 언젠가
   *   어긋난다. 놓기를 한 번 빠뜨리면 알림이 안 사라지고 배터리를 계속 먹는다.
   *   드나드는 문을 하나로 두면 그 실수가 안 생긴다.
   */
  async function setRunning(on, text) {
    running = !!on;
    if (on) await keepAwake(text);
    else await releaseAwake();
  }


  async function keepAwake(text) {
    keepDepth++;
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (!P || !P.KeepAwake) return;
    try { await P.KeepAwake.start({ text: text || '작업 중입니다' }); } catch (e) { /* 무시 */ }
  }

  async function releaseAwake() {
    // ★겹쳐 부를 수 있다 (뽑는 중에 또 뽑기). 마지막 하나가 끝날 때만 놓는다.
    keepDepth = Math.max(0, keepDepth - 1);
    if (keepDepth > 0) return;
    const P = window.Capacitor && window.Capacitor.Plugins;
    if (!P || !P.KeepAwake) return;
    try { await P.KeepAwake.stop(); } catch (e) { /* 무시 */ }
  }

  // ── 일관성 검사 ──────────────────────────────────────────────────────────
  // ★재는 곳은 둘, 잣대는 하나다. 벡터를 어디서 뽑든 판정은 consistency.js 가 한다.
  //   양쪽에 따로 두면 서버를 껐다 켰다 할 때 같은 그림의 점수가 달라진다.
  let consMode = 'off';       // 'off' | 'device'(폰) | 'server'(수신함)
  let consReady = false;      // 폰에 모델을 받아 두었는가
  let consBusy = false;

  /**
   * 검사를 맡길 수신함.
   * ★지금 고른 저장 대상을 먼저 본다. 그것이 폰이거나 검사를 못 하면, 검사가 되는
   *   수신함을 하나 찾아 쓴다 — 저장은 폰에 하면서 검사만 서버에 맡기는 것도 흔하다.
   */
  function consDest() {
    const now = activeDest();
    if (now && now.canScore !== false && now.score !== false) return now;
    return destinations.find(function (d) {
      return d.canScore === true && d.score !== false;
    }) || null;
  }

  function consPick() {
    return Embed.pick({ mode: consMode, dest: consDest(), ready: consReady });
  }

  /** 지금 검사가 되는가. */
  function consOn() { return consPick().how !== 'off'; }

  /**
   * 검사 단추를 어떻게 보일지.
   *
   * ★못 재는 상태라고 단추를 **숨기면 안 된다.** 숨기면 기능이 있다는 것 자체를 알 길이
   *   없다. 설정 깊은 곳에 켜는 자리를 두고 화면에서는 아무 흔적도 안 남기면, 만들어 놓고
   *   아무도 안 쓰는 것과 같다. 그래서 단추는 늘 보이고, 대신 **무엇을 하면 되는지**를
   *   옆에 적는다.
   * @returns {{ready:boolean, why:string, fix:boolean}} fix 는 설정으로 보낼지
   */
  function consState(extra) {
    // ★막힌 것이 둘이면 **설정 쪽을 먼저** 말한다. 「장수를 늘리세요」 만 말해 두면,
    //   장수를 늘려 다시 뽑고 나서야 「아직 안 켰습니다」 를 보게 된다. 그림을 두 번
    //   뽑게 만드는 안내다.
    const how = consPick();
    if (how.how === 'off') {
      return { ready: false, why: how.why + ' 설정에서 켤 수 있습니다.', fix: true };
    }
    if (extra) return { ready: false, why: extra, fix: false };
    return { ready: true, why: '', fix: false };
  }

  /** 단추 한 벌(단추 + 안내 + 설정 바로가기)을 상태에 맞게 그린다. */
  function renderConsRow(rowId, btnId, msgId, visible, extra) {
    const row = $(rowId);
    row.hidden = !visible;
    if (!visible) return;
    const st = consState(extra);
    const btn = $(btnId);
    btn.disabled = !st.ready || consBusy;
    $(msgId).textContent = st.why;

    // 설정으로 가는 길을 그 자리에 둔다. "설정 어디에 있더라" 를 찾게 하지 않는다.
    let go = document.getElementById(rowId + '-go');
    if (st.fix) {
      if (!go) {
        go = document.createElement('button');
        go.id = rowId + '-go';
        go.className = 'btn small';
        go.textContent = '설정 열기';
        go.addEventListener('click', async function () {
          $('settings-token').value = await Store.getToken();
          say($('settings-msg'), '');
          show('settings');
          const sel = $('cons-mode');
          // ★설정이 접이식이라 그 칸이 든 서랍을 먼저 펴야 한다. 접힌 채로 스크롤만
          //   시키면 아무것도 안 보여, 데려다준 것이 아니라 버린 것이 된다.
          const panel = sel.closest('details');
          if (panel) panel.open = true;
          sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
          sel.focus();
        });
        btn.parentNode.insertBefore(go, btn.nextSibling);
      }
      go.hidden = false;
    } else if (go) {
      go.hidden = true;
    }
  }

  /**
   * 그림들의 특징 벡터를 받아 온다.
   * @param {string} kind 'style'(그림체) 또는 'identity'(인물)
   * @param {Array} items [{bytes} 또는 {path}] — 이미 수신함에 올린 것은 path 로
   */
  async function consVectors(kind, items, onStep) {
    const how = consPick();
    if (how.how === 'off') throw new Error(how.why);
    if (how.how === 'server') {
      // 이미 올려 둔 것은 경로만 보낸다. 올린 것을 또 올려보낼 이유가 없다.
      const sent = items.map(function (it) {
        return it.remotePath ? { path: it.remotePath }
          : { b64: NaiClient.toBase64(it.bytes) };
      });
      return await Embed.fromServer(RemoteStore, consDest(), kind, sent, onStep);
    }
    const sent = items.map(function (it) {
      return { b64: 'data:image/png;base64,' + NaiClient.toBase64(it.bytes) };
    });
    return await Embed.fromDevice(kind, sent, onStep);
  }

  /**
   * 폰에 모델을 받아 둔다. 처음 한 번만.
   * ★얼마나 받는지 먼저 말하고 묻는다. 이동통신으로 90MB 를 말없이 당기면 안 된다.
   */
  async function consDownload() {
    const box = $('cons-get-msg');
    if (!window.confirm(
      '검사에 쓸 모델을 받습니다 (' + Embed.sizeText(['style', 'identity']) + ').\n\n'
      + '한 번만 받으면 다음부터는 인터넷 없이도 됩니다.\n'
      + 'Wi-Fi 에서 받는 것을 권합니다. 받을까요?')) {
      return;
    }
    const bar = $('cons-get-bar');
    const fill = $('cons-get-fill');
    bar.hidden = false;
    box.textContent = '받는 중…';
    await keepAwake('일관성 검사 모델을 받는 중입니다');
    // ★파일마다 따로 오는 진행을 하나로 합친다. 그러지 않으면 퍼센트가 왔다 갔다 한다.
    const bag = {};
    let lastAt = 0;
    let lastLine = '';
    const onProgress = function (ev) {
      const t = Embed.tally(bag, ev);
      const line = t.percent < 0
        // 아직 총량을 모를 때 — 퍼센트를 지어내지 않고 받은 양만 적는다.
        ? (Embed.mb(t.loaded) + ' 받는 중…')
        : (t.percent + '% · ' + Embed.mb(t.loaded) + ' / ' + Embed.mb(t.total));
      if (t.percent >= 0) fill.style.width = t.percent + '%';
      box.textContent = '받는 중… ' + line;

      // ★상태바는 **시간으로** 막는다. 예전에는 퍼센트가 바뀔 때만 고쳐 쓰게 했는데,
      //   퍼센트가 한 값에 붙어 버리면 그 조건이 매번 참이 되어 알림이 조각마다 떴다.
      //   1.5초에 한 번, 글이 달라졌을 때만 고쳐 쓴다.
      const now = Date.now();
      if (now - lastAt < 1500 || line === lastLine) return;
      lastAt = now;
      lastLine = line;
      Notify.progress('일관성 검사 모델 받는 중', line, true);
    };

    try {
      // 1×1 짜리 그림으로 한 번 돌려 본다. 받아만 두고 안 돌려 보면, 정작 결과
      // 화면에서 처음 터진다 — 그때는 사람이 뽑기까지 다 마친 뒤라 늦다.
      const dot = 'data:image/png;base64,'
        + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      box.textContent = '그림체용 모델 받는 중…';
      await Embed.fromDevice('style', [{ b64: dot }], null, onProgress);
      box.textContent = '인물용 모델 받는 중…';
      await Embed.fromDevice('identity', [{ b64: dot }], null, onProgress);
      consReady = true;
      await Store.setConsistencyReady(true);
      fill.style.width = '100%';
      box.textContent = '다 받았습니다. 이제 인터넷 없이도 됩니다.';
      await Notify.clearProgress();
      Notify.done('일관성 검사 준비 끝', '모델을 다 받았습니다. 이제 인터넷 없이도 잽니다.');
      renderConsistency();
    } catch (e) {
      consReady = false;
      await Store.setConsistencyReady(false);
      await Notify.clearProgress();
      bar.hidden = true;
      box.textContent = '못 받았습니다: ' + (e.message || e)
        + ' — 대신 「수신함에서」 를 쓰실 수 있습니다.';
    } finally {
      await releaseAwake();
    }
  }

  function renderConsistency() {
    $('cons-mode').value = consMode;
    $('cons-device-row').hidden = consMode !== 'device';
    $('cons-server-row').hidden = consMode !== 'server';

    const how = consPick();
    $('cons-hint').textContent = consMode === 'off'
      ? '뽑고 나서 결과 화면에 「일관성 검사」 단추가 생깁니다.'
      : (how.how === 'off' ? ('지금은 못 잽니다 — ' + how.why) : '지금 잴 수 있습니다.');

    $('cons-get-msg').textContent = consReady
      ? '받아 두었습니다.' : (Embed.sizeText(['style', 'identity']) + ' 를 받습니다.');
    $('cons-get').textContent = consReady ? '다시 받기' : '모델 받기';

    const d = consDest();
    $('cons-server-msg').textContent = d
      ? ((d.canScore === true ? '「' + d.name + '」 이 맡습니다.'
        : '「' + d.name + '」 에 아직 검사 기능이 없습니다.'))
      : '검사를 맡을 수신함이 없습니다. 아래에서 먼저 등록하세요.';
  }

  async function readConsistency() {
    consMode = $('cons-mode').value;
    await Store.setConsistency(consMode);
    renderConsistency();
  }

  /**
   * 수신함을 등록하거나 확인했을 때, 검사를 맡길지 물어본다.
   * ★설정 화면 깊은 곳에 숨겨 두면 아무도 못 찾는다. 그 서버가 할 수 있다는 걸 안
   *   그 자리에서 묻는 것이 맞다.
   */
  async function askDestScore(dest, ping) {
    if (!dest || !ping || !ping.ok) return;
    const before = dest.canScore;
    dest.canScore = ping.canScore === true;
    if (!dest.canScore) {
      await Store.setDestinations(destinations);
      return;
    }
    // 이미 정해 둔 대상이면 다시 묻지 않는다.
    if (before === true && dest.score !== undefined) {
      await Store.setDestinations(destinations);
      return;
    }
    dest.score = window.confirm(
      '이 수신함은 일관성 검사를 할 수 있습니다.\n\n'
      + '맡기면 그림체·인물이 얼마나 고른지 이쪽에서 재 줍니다.\n'
      + '폰은 아무것도 받지 않아도 됩니다. 맡길까요?');
    await Store.setDestinations(destinations);
    if (dest.score && consMode === 'off') {
      consMode = 'server';
      await Store.setConsistency(consMode);
    }
    renderConsistency();
  }

  /**
   * 한 묶음을 재서 사람이 읽을 결과로.
   * @returns {Promise<{rep, text}>}
   */
  async function consRun(kind, items, onStep) {
    const vecs = await consVectors(kind, items, onStep);
    if (Embed.usable(vecs) < 2) {
      throw new Error('잰 그림이 두 장이 안 됩니다. 장수를 늘려 보세요.');
    }
    const rep = Consistency.report(vecs);
    return { rep: rep, vectors: vecs, text: Consistency.summary(rep) };
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

      // 이 수신함에 검사를 맡길지. ★VPS 를 세팅하는 그 자리에서 켜고 끈다 —
      //   수신함마다 사정이 다르므로(어디는 score.py 를 깔았고 어디는 아니고),
      //   앱 전체 설정 하나로 묶어 두면 맞출 수가 없다.
      const consLine = document.createElement('label');
      consLine.className = 'check';
      const consBox = document.createElement('input');
      consBox.type = 'checkbox';
      consBox.checked = d.score !== false;
      consBox.disabled = d.canScore === false;
      consLine.appendChild(consBox);
      consLine.appendChild(document.createTextNode(' 이 수신함에 일관성 검사 맡기기'));
      const consWhy = document.createElement('p');
      consWhy.className = 'hint';
      consWhy.textContent = d.canScore === false
        ? '이 수신함에는 검사 기능이 없습니다. score.py 를 옆에 두고 pip 로 셋만 깔면 됩니다.'
        : (d.canScore === true ? '「연결 확인」 에서 검사 가능으로 확인되었습니다.'
          : '「연결 확인」 을 누르면 이 수신함이 검사를 할 수 있는지 봅니다.');
      consBox.addEventListener('change', async function () {
        destinations[i].score = consBox.checked;
        await Store.setDestinations(destinations);
        renderConsistency();
      });
      el.appendChild(consLine);
      el.appendChild(consWhy);

      const test = document.createElement('button');
      test.className = 'btn block';
      test.textContent = '연결 확인';
      test.addEventListener('click', async function () {
        const problem = Store.validateDestination(destinations[i]);
        if (problem) { say(msg, problem, 'err'); return; }
        say(msg, '확인하는 중…');
        const r = await RemoteStore.ping(destinations[i]);
        say(msg, r.message
          + (r.ok ? (r.canScore ? ' · 일관성 검사 가능' : ' · 일관성 검사 없음') : ''),
          r.ok ? 'ok' : 'err');
        await askDestScore(destinations[i], r);
        // ★목록을 통째로 다시 그리면 방금 쓴 확인 메시지가 같이 지워진다. 그 줄만 고친다.
        consBox.checked = destinations[i].score !== false;
        consBox.disabled = destinations[i].canScore === false;
        consWhy.textContent = destinations[i].canScore === false
          ? '이 수신함에는 검사 기능이 없습니다. score.py 를 옆에 두고 pip 로 셋만 깔면 됩니다.'
          : '검사 가능으로 확인되었습니다.';
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

    await setRunning(true, '인핸스하는 중입니다');
    cancelRequested = false;
    $('enh-run').disabled = true;
    let done = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (cancelRequested) break;
      const src = targets[i];
      say($('enh-msg'), '인핸스 중 ' + (i + 1) + '/' + targets.length + ', ' + src.name);
      try {
        // ★베이스 이미지는 요청 해상도로 미리 맞춰 보낸다. 서버 리사이즈에 맡기면
        //   필터가 달라 초기 latent 가 바뀌고 데스크톱 버전과 결과가 갈린다.
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
          // ★투명 배경으로 생성한 이미지은 인핸스도 투명으로 요청한다. 지금 화면의 체크박스를
          //   그대로 쓰면, 그 사이에 체크를 껐거나 모델을 바꿨을 때 배경이 붙어 나온다.
          transparent_bg: (info.transparent_bg === undefined)
            ? options.transparent_bg : info.transparent_bg,
          straight_alpha: (info.straight_alpha === undefined)
            ? options.straight_alpha : info.straight_alpha,
          enhance_prompt_add: true
        });
        const built = buildNaiPayload(req);
        const res = await NaiClient.generate(token, built, function (n, wait, err) {
          say($('enh-msg'), src.name + ', ' + NaiClient.networkMessage(err)
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

    await setRunning(false);
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

    await setRunning(true, '업스케일하는 중입니다');
    const box = $('batch-msg');
    box.hidden = false;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const src = targets[i];
      say(box, '업스케일 중 ' + (i + 1) + '/' + targets.length + ', ' + src.name);
      try {
        const info = src.saveInfo || {};
        const w = info.width || options.width;
        const h = info.height || options.height;
        const built = buildUpscalePayload(ImageUtil.toBase64(src.bytes), w, h, 4);
        const res = await NaiClient.upscale(token, built, function (n, wait, err) {
          say(box, src.name + ', ' + NaiClient.networkMessage(err)
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

    await setRunning(false);
    say(box, targets.length + '장 처리 완료' + (failed ? ', 실패 ' + failed + '건' : ''),
      failed ? 'err' : 'ok');
    refreshAnlas();
  }

  // ── 배경 합성 ────────────────────────────────────────────────────────────
  // ★통신이 없다. Anlas 도 들지 않고 인터넷도 필요 없다 — 전부 폰 안에서 끝난다.
  // ★자리는 **알파 경계**로 잡는다. 슬롯마다 인물이 잡힌 크기·여백이 달라서,
  //   같은 배율로 얹으면 어떤 장은 배경 밖으로 나가고 어떤 장은 한가운데 뜬다.
  //   경계를 찾아 "높이의 92% · 바닥에서 2%" 로 맞추면 수십 장이 같은 자리에 선다.
  let cmpTarget = null;      // { item } 또는 { batch: true }
  let cmpBg = null;          // { name, w, h, data, canvas }
  let cmpFg = null;          // 미리보기 기준 { name, w, h, straight, bounds, detected, canvas }
  let cmpBgCache = null;     // 결과 크기로 줄여 둔 배경, 같은 배경으로 여러 장 돌릴 때 재사용
  // 무작위 배치의 씨앗. ★Math.random 을 그냥 쓰면 미리보기를 다시 그릴 때마다 인물이 튄다.
  //   씨앗을 들고 있다가 "다시 굴려 보기" 를 눌렀을 때만 바꾼다. 장마다는 씨앗 + 번호를 쓴다.
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
      none: '⚠ 이 그림에는 투명한 곳이 없습니다. 배경이 통째로 가려집니다.'
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
      ? ' (미리보기는 한 번 뽑아 본 것, 실제로는 ' + n + '장이 저마다 다른 자리에 섭니다)'
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
    await setRunning(true, '배경을 합성하는 중입니다');
    $('cmp-run').disabled = true;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const src = targets[i];
      say($('cmp-msg'), '합치는 중 ' + (i + 1) + '/' + targets.length + ', ' + src.name);
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

    await setRunning(false);
    $('cmp-run').disabled = false;
    const okCount = targets.length - failed;
    say($('cmp-msg'), okCount + '/' + targets.length + ' 완료'
      + (failed ? ', 실패 ' + failed + '건' : ''), failed ? 'err' : 'ok');
    if (!failed) setTimeout(function () { show('results'); }, 800);
  }

  // ── 원격 작업 ────────────────────────────────────────────────────────────
  // ★PC·VPS 수신함에 누군가(예: Claude Code)가 올려 둔 "이거 뽑으세요" 를 받아 온다.
  //   ★키도 Anlas 도 이 폰 것이다 — 그래서 실행 여부는 언제나 여기서 정한다.
  //     "받으면 바로 실행" 을 켜야만 묻지 않고 돈다.
  //   ★결과는 그 수신함으로 저장된다. 올린 쪽이 결과를 봐야 왕복이 완성되기 때문이다.
  let jobsSource = 'dest';    // 'dest' 수신함 | 'github' 저장소 지시함
  let ghCfg = { repo: '', branch: 'main', token: '' };
  let ghDone = [];            // 이미 실행한 작업 id (폰이 기억한다)
  let jobsDestId = null;      // 어느 수신함에서 받을지
  let jobsAuto = false;       // 받으면 바로 실행
  let jobsList = [];
  let jobTimer = null;
  let activeJob = null;       // { id, dest, total }, 지금 돌고 있는 원격 작업
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
    if (!parsed.ok) throw new Error(path + ', ' + parsed.error);
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
      '저장소 ' + where + ' 를 PeroPix 모바일의 "지시함" 으로 세팅해 줘.',
      '',
      '1. AGENTS.md 와 CLAUDE.md 를 만들어, 아래 규약을 그대로 적어 둘 것',
      '   (두 파일 내용은 같아도 된다. Codex 는 AGENTS.md, Claude Code 는 CLAUDE.md 를 읽는다).',
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
      '     그러니 파일을 고치는 것은 곧 생성 요청이다. 테스트 삼아 고치지 말 것.',
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
  let artTotal = 0;            // Danbooru 전체 이미지 수 (특징 태그의 분모)
  let drwF = { q: '', cat: '', fav: false, genre: '' };
  // 라벨 붙이기 모드. ★라벨은 **한 번 고르고 나서** 작가를 넣고 뺀다. 작가마다 이름을
  //   다시 적게 하면 스무 명한테 붙이려고 스무 번을 타이핑하게 된다.
  let drwLabelMode = false;
  let drwLabel = '';
  let acTimer = null;
  let lastBaked = '';          // 작가 태그 칸에 넣어 둔 조합 (다시 넣을 때 갈아 끼우려고)
  let wRange = null;           // 가중치 범위 (사람이 정한다. null 이면 기본값)
  let recoOff = false;         // "이런 작태는 어떠세요" 를 껐나
  let recoMin = 100;           // 추천할 작가의 최소 이미지 수
  let recoBusy = false;
  let stCfg = null;            // 그림체 테스트 설정 (구도·캐릭터·퀄리티·네거티브)
  let styleSaved = null;       // 테스트 전 상태, 끝나면 그대로 돌려놓는다
  let cmbPool = [];            // 조합에 쓸 작가 풀
  let cmbSel = [];             // 그중 고른 것
  let cmbLast = [];            // 방금 뽑은 조합들 (어느 그림이 어느 조합인지)
  let cmbShots = [];           // 그 조합으로 생성한 이미지
  let cmbPerUsed = 1;          // 뽑을 때 조합마다 몇 장씩 뽑았는지 (그림↔조합 짝을 세는 기준)
  let styleBusy = false;
  let styleView = null;        // 조합·깎기에서 연 뷰어일 때 {items, meta}
  let styleMode = 'combo';
  let bisPool = [];            // 깎기 후보 풀 (여기서 골라 담는다)
  let bisSel = [];             // 그중 고른 것 (최대 20)
  let bis = null;              // 깎기 상태
  let bisScan = null;          // 가중치 훑기 중인가

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
    renderWeightUI();
    renderStyleUI();
    renderCombo();
    renderComboResult();
    setStyleMode(styleMode);
    renderBisPick();
    // ★깎기는 뽑으러 메인으로 갔다가 돌아온다. 다시 그리지 않으면 "답하기" 가 안 뜬다.
    renderBis();
    // 전체 이미지 수는 한 번만 물어 둔다 (특징 태그의 분모).
    if (!artTotal) {
      try { artTotal = Danbooru.parseTotal(await dbGet(Danbooru.totalUrl())); } catch (e) { /* 없어도 된다 */ }
    }
  }

  function setArtTab(name) {
    artTab = name;
    ['find', 'drawer', 'reco', 'style'].forEach(function (n) {
      $('tab-' + n).classList.toggle('on', n === name);
      $('pane-' + n).hidden = (n !== name);
    });
    // 화면 갈아 끼울 때와 같은 방식 — 뗐다 붙여야 다시 돈다.
    const pane = $('pane-' + name);
    pane.classList.remove('sc-in');
    void pane.offsetWidth;
    pane.classList.add('sc-in');
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
      // 특징 태그를 재려면 "남들은 얼마나 그리는가" 가 필요하다 — 한 번에 묻는다.
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
        genres: Danbooru.genres(posts),
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
    $('art-alias').textContent = (a.artist && a.artist.banned) ? 'Danbooru 에서 차단된 작가입니다.' : alias;

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
    (a.genres || []).forEach(function (g) { add(g.label, g.pct + '%'); });
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
      c.title = '다른 작가보다 ' + t.times + '배 자주 그리는 태그';
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
      grid.innerHTML = '<p class="hint">이 등급에서는 보여 줄 그림이 없습니다.</p>';
    }

    $('art-keep').textContent = Artists.has(artDrawer, a.tag) ? '서랍에 있음' : '서랍에 담기';
  }

  // ── 서랍 ──────────────────────────────────────────────────────────────────
  function renderDrawer() {
    $('tab-drawer-n').textContent = artDrawer.length ? String(artDrawer.length) : '';

    // ★장르는 앱이 매긴 것, 갈래는 사람이 붙인 것 — 다른 축이라 줄을 나눈다.
    const gbox = $('drw-genres');
    gbox.innerHTML = '';
    const gcount = Object.create(null);
    artDrawer.forEach(function (e) {
      (e.genres || []).forEach(function (g) { gcount[g] = (gcount[g] || 0) + 1; });
    });
    Danbooru.GENRES.forEach(function (g) {
      if (!gcount[g.key]) return;
      const c = document.createElement('button');
      c.className = 'chip' + (drwF.genre === g.key ? ' on' : '');
      c.textContent = g.label + ' ' + gcount[g.key];
      c.addEventListener('click', function () {
        drwF.genre = (drwF.genre === g.key) ? '' : g.key;
        renderDrawer();
      });
      gbox.appendChild(c);
    });

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
    chip('라벨 없음', drwF.cat === '__none__', function () {
      drwF.cat = (drwF.cat === '__none__') ? '' : '__none__';
      renderDrawer();
    });
    $('drw-fav').classList.toggle('on', drwF.fav);
    renderDrawerImport();
    renderLabelBar();

    const list = $('drw-list');
    list.innerHTML = '';
    const rows = visibleDrawerRows();
    if (!rows.length) {
      list.innerHTML = '<p class="hint">'
        + (artDrawer.length ? '이 조건에 맞는 작가가 없습니다.'
          : '"찾기"에서 마음에 드는 작가를 담아 두세요.') + '</p>';
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
      // 라벨 모드에서는 줄을 누르는 것이 곧 라벨 붙이기/떼기다. 평소에는 섞기로 담는다.
      nm.addEventListener('click', function () {
        if (labeling()) toggleLabel(e.tag);
        else addToMix(e.tag);
      });

      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = Danbooru.reach(e.count, { deprecated: false }).label;

      // 라벨 모드일 때는 지금 고른 라벨이 붙어 있는지를 그대로 보여 주는 단추가 된다.
      const cat = document.createElement('button');
      cat.className = 'btn small';
      if (labeling()) {
        const on = e.cats.indexOf(drwLabel) !== -1;
        cat.textContent = on ? '✓' : '＋';
        cat.classList.toggle('primary', on);
        cat.title = drwLabel;
        cat.addEventListener('click', function () { toggleLabel(e.tag); });
      } else {
        cat.textContent = '라벨';
        cat.addEventListener('click', function () {
          drwLabelMode = true;
          renderDrawer();
          toast('라벨을 고른 다음 작가 줄을 누르세요.', 2600);
        });
      }

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

  /** 대량생성에서 저장해 둔 작가 태그 모음 목록. */
  function renderDrawerImport() {
    const sel = $('drw-import-pick');
    const keep = sel.value;
    sel.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = tagsets.length
      ? '대량생성에 저장된 작가 태그…' : '대량생성에 저장된 것 없음';
    sel.appendChild(first);
    tagsets.forEach(function (t) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.appendChild(o);
    });
    if (keep && tagsets.some(function (t) { return t.id === keep; })) sel.value = keep;
    $('drw-import').disabled = !tagsets.length;
  }

  /**
   * 고른 모음을 서랍에 담는다.
   *
   * ★모음에는 퀄리티 태그도 섞여 있다 ("artist:wlop, masterpiece, best quality").
   *   그래서 Danbooru 에 갈래를 물어 **작가인 것만** 담는다. 안 거르면 서랍이
   *   masterpiece 로 채워져 쓸 수가 없다.
   * ★한 번에 다 묻는다. 태그마다 부르면 스무 개짜리 모음 하나에 스무 번이 나간다.
   */
  async function importTagsetToDrawer() {
    const t = tagsets.find(function (x) { return x.id === $('drw-import-pick').value; });
    if (!t) { toast('가져올 모음을 먼저 고르세요.', 2200); return; }

    const names = tagsFromText(t.text);
    if (!names.length) { toast('그 모음에 태그가 없습니다.', 2200); return; }

    const msg = $('drw-import-msg');
    msg.textContent = '알아보는 중…';
    $('drw-import').disabled = true;
    try {
      const rows = Danbooru.parseTags(await dbGet(Danbooru.tagsByNameUrl(names)));
      const artists = rows.filter(function (r) { return !r.deprecated; });
      let added = 0;
      artists.forEach(function (r) {
        if (Artists.has(artDrawer, r.name)) return;
        artDrawer = Artists.add(artDrawer, { tag: r.name, count: r.count }, Date.now());
        added++;
      });
      if (added) await Store.setArtists(artDrawer);
      renderDrawer();
      // ★무엇이 빠졌는지 적어 준다. "스무 개 넣었는데 세 명만 담겼다" 를 말없이
      //   두면 고장으로 보인다.
      const skipped = names.length - artists.length;
      msg.textContent = added + '명을 담았습니다.'
        + (artists.length - added ? ' 이미 있던 ' + (artists.length - added) + '명은 건너뛰었습니다.' : '')
        + (skipped > 0 ? ' 작가가 아니거나 폐기된 태그 ' + skipped + '개는 뺐습니다.' : '');
      if (names.length > 40) {
        msg.textContent += ' (한 번에 40개까지만 봅니다)';
      }
    } catch (e) {
      msg.textContent = '가져오지 못했습니다: ' + (e.message || e);
    }
    $('drw-import').disabled = false;
  }

  /** 지금 라벨을 붙이고 있는 중인가 (모드가 켜져 있고 라벨도 골라 뒀는가). */
  function labeling() { return drwLabelMode && !!drwLabel; }

  /** 한 사람에게 지금 고른 라벨을 붙이거나 뗀다. */
  async function toggleLabel(tag) {
    if (!labeling()) return;
    artDrawer = Artists.toggleCat(artDrawer, tag, drwLabel);
    await Store.setArtists(artDrawer);
    renderDrawer();
  }

  /** 라벨 고르는 줄. */
  function renderLabelBar() {
    $('drw-label-mode').classList.toggle('on', drwLabelMode);
    $('drw-label-mode').textContent = drwLabelMode ? '라벨 붙이기 끝내기' : '라벨 붙이기';
    $('drw-label-bar').hidden = !drwLabelMode;
    $('drw-label-now').textContent = labeling()
      ? ('"' + drwLabel + '" 붙이는 중')
      : (drwLabelMode ? '라벨을 고르세요' : '');

    // ★막 만든 라벨과, 마지막 한 명에게서 떨어진 라벨은 아직/이제 아무한테도 안 붙어 있어
    //   목록에 안 나온다. 그래도 고른 채로 남겨 둔다 — 만들자마자 사라지면 붙일 수가 없고,
    //   실수로 뗀 것을 바로 다시 붙이지도 못한다.
    const cats = Artists.categories(artDrawer);
    if (drwLabel && !cats.some(function (c) { return c.name === drwLabel; })) {
      cats.push({ name: drwLabel, count: 0 });
    }

    const box = $('drw-label-pick');
    box.innerHTML = '';
    cats.forEach(function (c) {
      const b = document.createElement('button');
      b.className = 'chip' + (drwLabel === c.name ? ' on' : '');
      b.textContent = c.name + ' ' + c.count;
      b.addEventListener('click', function () {
        drwLabel = (drwLabel === c.name) ? '' : c.name;
        renderDrawer();
      });
      box.appendChild(b);
    });
    if (!cats.length) box.innerHTML = '<p class="hint">아직 라벨이 없습니다. "＋ 새 라벨" 로 만드세요.</p>';

    ['drw-label-all', 'drw-label-rename', 'drw-label-del'].forEach(function (id) {
      $(id).disabled = !labeling();
    });
    $('drw-label-hint').textContent = labeling()
      ? '작가 줄을 누르면 "' + drwLabel + '" 이 붙었다 떨어집니다.'
      : '라벨을 고른 다음 작가 줄을 누르면 붙었다 떨어집니다.';
  }

  function bindLabelBar() {
    $('drw-label-mode').addEventListener('click', function () {
      drwLabelMode = !drwLabelMode;
      renderDrawer();
    });

    // ★새 라벨은 이름만 받는다. 만들자마자 그 라벨을 고른 상태가 되므로, 바로 작가 줄을
    //   눌러 담으면 된다. (아무한테도 안 붙은 라벨은 저장할 데가 없어 목록에 안 뜬다.)
    $('drw-label-new').addEventListener('click', function () {
      const name = String(window.prompt('새 라벨 이름', '') || '').trim();
      if (!name) return;
      drwLabelMode = true;
      drwLabel = name;
      renderDrawer();
      toast('"' + name + '" 을 붙일 작가를 누르세요.', 2800);
    });

    // 지금 걸러 보고 있는 사람 전부에게 한 번에. 검색·즐겨찾기·장르와 같이 쓰면
    // "19금 작가 전부에 '어두움' 붙이기" 가 한 번에 끝난다.
    $('drw-label-all').addEventListener('click', async function () {
      if (!labeling()) return;
      const rows = visibleDrawerRows();
      if (!rows.length) return;
      const tags = rows.map(function (e) { return e.tag; });
      const off = rows.filter(function (e) { return e.cats.indexOf(drwLabel) === -1; });
      // 다 붙어 있으면 "전부 떼기" 로 뒤집는다 — 같은 자리에서 되돌릴 수 있어야 한다.
      const on = off.length > 0;
      if (!window.confirm(rows.length + '명에게 "' + drwLabel + '" 을 '
        + (on ? '붙일까요?' : '전부 뗄까요?'))) return;
      artDrawer = Artists.setCat(artDrawer, tags, drwLabel, on);
      await Store.setArtists(artDrawer);
      renderDrawer();
    });

    $('drw-label-rename').addEventListener('click', async function () {
      if (!labeling()) return;
      const to = String(window.prompt('새 이름', drwLabel) || '').trim();
      if (!to || to === drwLabel) return;
      artDrawer = Artists.renameCat(artDrawer, drwLabel, to);
      await Store.setArtists(artDrawer);
      if (drwF.cat === drwLabel) drwF.cat = to;
      drwLabel = to;
      renderDrawer();
    });

    $('drw-label-del').addEventListener('click', async function () {
      if (!labeling()) return;
      if (!window.confirm('"' + drwLabel + '" 라벨을 없앨까요?\n작가는 서랍에 그대로 남습니다.')) return;
      artDrawer = Artists.removeCat(artDrawer, drwLabel);
      await Store.setArtists(artDrawer);
      if (drwF.cat === drwLabel) drwF.cat = '';
      drwLabel = '';
      renderDrawer();
    });
  }

  /** 지금 서랍에 실제로 보이고 있는 줄 (걸러 낸 뒤). */
  function visibleDrawerRows() {
    let rows = Artists.filter(artDrawer, drwF);
    if (drwF.genre) {
      rows = rows.filter(function (e) { return (e.genres || []).indexOf(drwF.genre) !== -1; });
    }
    return rows;
  }

  async function addToMix(tag) {
    if (artMix.some(function (m) { return m.tag === tag; })) {
      artMix = artMix.filter(function (m) { return m.tag !== tag; });
    } else {
      const before = artMix.length;
      artMix = Artists.mix(artMix.concat([{ tag: tag }]), wRange);
      if (artMix.length === before) {
        toast('한 조합에 ' + Artists.MAX_TAGS + '명까지 담을 수 있습니다.', 2400);
      }
    }
    await Store.setArtistMix(artMix);
    renderMix();
    renderDrawer();
  }

  function mixBaked() {
    return Artists.bake(artMix, { normalize: $('mix-norm').checked, cfg: wRange });
  }

  /**
   * 굽고 나서 화면에 적어 줄 말.
   * ★이름 끝이 숫자인 작가는 `숫자::` 뒤에 바로 붙일 수 없어 괄호로 나간다. 괄호는
   *   1.05 의 거듭제곱이라 정한 값에 딱 안 맞는데, 말없이 어긋나면 안 된다.
   */
  function renderMixNote() {
    const off = Artists.approximated(artMix, {
      normalize: $('mix-norm').checked, cfg: wRange
    });
    const note = $('mix-note');
    note.hidden = !off.length;
    if (!off.length) return;
    note.textContent = off.map(function (x) {
      return x.tag + ' ' + x.want + '→' + x.got;
    }).join(', ') + ' — 이름이 숫자로 끝나는 작가는 괄호로 나갑니다. '
      + '숫자:: 바로 앞에 숫자가 오면 그 숫자가 새 가중치로 읽혀 그림이 깨집니다. '
      + '괄호는 한 겹에 1.05배라 값이 조금 어긋납니다. 같은 가중치인 다른 작가를 '
      + '같이 켜면 정확한 값으로 나갑니다.';
  }

  /** 지금 정해진 가중치 범위 (성한 값으로 다듬은 것). */
  function wr() {
    return Artists.range(wRange);
  }

  // ★자주 쓰는 폭을 단추로. 폰에서 숫자 칸을 톡톡 치는 것은 성가시다.
  const W_PRESETS = [
    { label: '좁게', min: 0.85, max: 1.15 },
    { label: '보통', min: 0.6, max: 1.4 },
    { label: '넓게', min: 0.4, max: 1.7 },
    { label: '아주 넓게', min: 0.3, max: 2 }
  ];
  const W_STEPS = [0.05, 0.1, 0.25];

  /**
   * 폭·간격 단추를 그린다.
   * ★서랍과 조합 두 군데에 똑같이 나온다. 조합을 하다가 폭을 바꾸려고 서랍으로 갔다
   *   오게 만들면 흐름이 끊긴다. 값은 한 세트이라 어느 쪽에서 바꿔도 같이 움직인다.
   */
  function renderWeightChips(presetsId, stepsId) {
    const r = wr();
    const pbox = $(presetsId);
    if (pbox) {
      pbox.innerHTML = '';
      W_PRESETS.forEach(function (w) {
        const c = document.createElement('button');
        c.className = 'chip' + ((r.min === w.min && r.max === w.max) ? ' on' : '');
        c.textContent = w.label + ' ' + w.min + '~' + w.max;
        c.addEventListener('click', function () {
          $('w-min').value = String(w.min);
          $('w-max').value = String(w.max);
          readWeightUI();
        });
        pbox.appendChild(c);
      });
    }
    const sbox = $(stepsId);
    if (sbox) {
      sbox.innerHTML = '';
      W_STEPS.forEach(function (st) {
        const c = document.createElement('button');
        c.className = 'chip' + (r.step === st ? ' on' : '');
        c.textContent = String(st);
        c.addEventListener('click', function () {
          $('w-step').value = String(st);
          readWeightUI();
        });
        sbox.appendChild(c);
      });
    }
  }

  function renderWeightUI() {
    const r = wr();
    $('w-min').value = String(r.min);
    $('w-max').value = String(r.max);
    $('w-step').value = String(r.step);
    renderWeightChips('w-presets', 'w-steps');
    $('w-hint').textContent = '지금 ' + r.min + ' ~ ' + r.max + ', ' + r.step + ' 간격'
      + ' (가중치 훑기는 ' + Artists.scanSteps(wRange).join(' / ') + ')';
  }

  /** 어느 쪽 숫자 칸에서 읽을지. 서랍과 조합 두 군데에 같은 칸이 있다. */
  async function readWeightUI(prefix) {
    const q = prefix || 'w';
    wRange = Artists.range({
      min: parseFloat($(q + '-min').value),
      max: parseFloat($(q + '-max').value),
      step: parseFloat($(q + '-step').value)
    });
    // ★범위를 좁히면 지금 섞고 있는 값이 밖으로 나간다. 바로 끌어들인다 —
    //   안 그러면 화면에 보이는 값과 실제로 나가는 값이 어긋난다.
    artMix = artMix.map(function (m) {
      return { tag: m.tag, weight: Artists.clampWeight(m.weight, wRange), on: m.on };
    });
    await Store.setWeightRange(wRange);
    await Store.setArtistMix(artMix);
    renderWeightUI();
    renderMix();
    // ★조합 쪽에도 같은 단추가 있다. 안 그려 주면 한쪽만 바뀌어, 어느 폭이 쓰이는지
    //   화면마다 다르게 보인다.
    renderCombo();
  }

  function renderMix() {
    const box = $('mix-list');
    box.innerHTML = '';
    $('mix-empty').hidden = artMix.length > 0;

    const shown = $('mix-norm').checked ? Artists.normalize(artMix, wRange) : artMix;
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
      // ★손으로 정한 값을 크게 보여 준다. 여기에 "나가는 값"(합 고정을 거친 것)을 적으면,
      //   ＋ 를 눌러도 정규화가 도로 깎아 **숫자가 안 움직이는 것처럼 보인다** — 셋을 섞어
      //   놓고 한 명을 올리면 셋이 같이 조정되기 때문이다. 고장으로 보이는 자리다.
      //   대신 나가는 값이 다르면 옆에 작게 덧붙인다. 둘 다 알아야 하기 때문이다.
      w.appendChild(document.createTextNode(m.weight.toFixed(2)));
      if (Math.abs(shown[i].weight - m.weight) >= 0.005) {
        const out = document.createElement('span');
        out.className = 'mix-out-w';
        out.textContent = '→' + shown[i].weight.toFixed(2);
        out.title = '합 고정을 거쳐 실제로 나가는 값';
        w.appendChild(out);
      }

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

      // ★슬라이더만으로는 폰에서 0.05 를 맞추기 어렵다. 양쪽에 단추를 둔다.
      const rr = wr();
      const bar = document.createElement('div');
      bar.className = 'mix-bar';
      const nudge = function (text, delta) {
        const b = document.createElement('button');
        b.className = 'mix-nudge';
        b.textContent = text;
        b.addEventListener('click', async function () {
          artMix = Artists.setWeight(artMix, m.tag, m.weight + delta, wRange);
          await Store.setArtistMix(artMix);
          renderMix();
        });
        return b;
      };
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(rr.min);
      range.max = String(rr.max);
      range.step = String(rr.step);
      range.value = String(m.weight);
      // ★끄는 동안에는 숫자만 고친다. 여기서 renderMix() 를 부르면 지금 끌고 있는
      //   슬라이더를 통째로 새로 만들어 버려서, 손가락이 떨어진 것처럼 끊긴다.
      range.addEventListener('input', function () {
        artMix = Artists.setWeight(artMix, m.tag, parseFloat(range.value), wRange);
        const now = $('mix-norm').checked ? Artists.normalize(artMix, wRange) : artMix;
        w.firstChild.textContent = artMix[i].weight.toFixed(2);
        if (w.lastChild !== w.firstChild) {
          w.lastChild.textContent = '→' + now[i].weight.toFixed(2);
        }
        $('mix-out').value = mixBaked();
      });
      range.addEventListener('change', function () {
        Store.setArtistMix(artMix);
        renderMix();
      });

      bar.appendChild(nudge('−', -rr.step));
      bar.appendChild(range);
      bar.appendChild(nudge('＋', rr.step));

      row.appendChild(top);
      row.appendChild(bar);
      box.appendChild(row);
    });

    $('mix-out').value = mixBaked();
    renderMixNote();
  }

  /**
   * 작가 태그 칸에 넣는다.
   * ★앞서 넣어 둔 조합이 그대로 남아 있으면 **갈아 끼운다.** 그냥 앞에 덧붙이면
   *   누를 때마다 같은 작가가 쌓여 가중치가 몇 배가 된다.
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
  /** 글에서 작가 태그를 뽑아낸다. 가중치 문법(1.2::이름::)은 벗긴다. */
  function tagsFromText(text) {
    return String(text || '').split(/[,\n]/).map(function (t) {
      return Danbooru.normalize(t
        .replace(/^\s*[\d.]+\s*::/, '')      // 1.2::태그:: 의 가중치
        .replace(/::\s*$/, '')
        // ★artist: 는 Danbooru 의 **검색 문법**이지 태그 이름이 아니다. NAI 프롬프트에는
        //   artist:wlop 처럼 쓰는 사람이 많은데, 그대로 물어보면 그런 태그는 없다고 나온다.
        .replace(/^\s*artist:\s*/i, ''));
    }).filter(Boolean);
  }

  function bisTags() {
    return bisSel.slice(0, Artists.MAX_TAGS);
  }

  /** 후보 풀에 더한다 (겹치지 않게). pick 이면 고른 상태로. */
  function bisAdd(tags, pick) {
    (tags || []).forEach(function (t) {
      if (bisPool.indexOf(t) === -1) bisPool.push(t);
      if (pick && bisSel.indexOf(t) === -1 && bisSel.length < Artists.MAX_TAGS) bisSel.push(t);
    });
    renderBisPick();
  }

  /**
   * 고를 작가를 라벨별로 묶어 그린다. 조합과 깎기가 **같은 코드**를 쓴다 —
   * 두 벌로 두면 한쪽만 고쳐진다.
   *
   * @param {string} boxId 그릴 칸
   * @param {string[]} pool 고를 수 있는 태그
   * @param {string[]} sel  지금 고른 태그
   * @param {function} toggle (tag) 눌렀을 때
   * @param {string} empty 아무것도 없을 때 적을 말
   */
  function renderTagPicker(boxId, pool, sel, toggle, empty) {
    const box = $(boxId);
    box.innerHTML = '';
    if (!pool.length) {
      box.innerHTML = '<p class="hint">' + empty + '</p>';
      return;
    }
    const full = sel.length >= Artists.MAX_TAGS;
    Artists.groupByLabel(pool, artDrawer).forEach(function (g) {
      const head = document.createElement('div');
      head.className = 'pick-head';
      const picked = g.tags.filter(function (t) { return sel.indexOf(t) !== -1; }).length;
      head.textContent = g.label + ' ' + g.tags.length + (picked ? ' · 선택 ' + picked : '');
      box.appendChild(head);

      const row = document.createElement('div');
      row.className = 'pick-row';
      g.tags.forEach(function (t) {
        const on = sel.indexOf(t) !== -1;
        const b = document.createElement('button');
        b.className = on ? 'on' : '';
        b.textContent = t.replace(/_/g, ' ');
        // ★상한에 찼으면 더 못 고르게 막는다. 눌리기는 하는데 안 담기면 고장으로 보인다.
        b.disabled = !on && full;
        b.addEventListener('click', function () { toggle(t); });
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }

  function renderBisPick() {
    renderTagPicker('bis-pick', bisPool, bisSel, function (t) {
      if (bisSel.indexOf(t) !== -1) {
        bisSel = bisSel.filter(function (x) { return x !== t; });
      } else if (bisSel.length < Artists.MAX_TAGS) {
        bisSel.push(t);
      }
      renderBisPick();
    }, '위 버튼으로 후보를 불러오세요.');
    $('bis-count').textContent = bisSel.length + ' / ' + Artists.MAX_TAGS + '명';
    renderBisSetup();
  }

  function renderBisSetup() {
    const tags = bisTags();
    const seeds = [1];
    const st = Bisect.start({
      tags: tags, seeds: seeds, cross: $('bis-cross').checked
    });
    const e = Bisect.estimate(st);
    $('bis-est').textContent = tags.length < 2
      ? '후보를 두 명 이상 골라 주세요.'
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
        nm.textContent = s.name + ' · 작가 ' + s.tags.length + '명'
          + (s.removed.length ? (' (뺀 사람 ' + s.removed.length + ')') : '');
        const tg = document.createElement('div');
        tg.className = 'tags';
        tg.textContent = s.removed.length
          ? ('뺀 사람: ' + s.removed.map(function (t) { return t.replace(/_/g, ' '); }).join(', '))
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
      $('bis-ask-q').textContent = '기준 그림을 보셨나요? 이 그림에서 찾을 부분을 정하고 시작합니다.';
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.textContent = '봤습니다 · 다음';
      b.addEventListener('click', function () { bisAnswer({}); });
      btns.appendChild(b);
      return;
    }

    const word = bis.goal === 'drop' ? '거슬리는 부분' : '그 부분';
    $('bis-ask-q').textContent = '생성한 이미지에 ' + word + '이 아직 보이나요?';
    const rows = bis.cross ? ['L', 'R'] : ['L'];
    const answers = {};
    rows.forEach(function (side) {
      const label = side === 'L' ? '빼기L' : '빼기R';
      ['남아 있다', '사라졌다'].forEach(function (text, i) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = label + ', ' + text;
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
      + '작가 태그 화면에 그대로 머물고, 평소 슬롯·프롬프트는 건드리지 않습니다.\n'
      + '시드는 ' + bis.seeds[0] + ' 로 고정됩니다.')) return;

    bis.shot = true;
    await styleGenerate(step.shots.map(function (x) {
      return {
        label: x.name,
        prompt: Artists.bake(Artists.mix(x.tags, wRange), { cfg: wRange }),
        // 뷰어 아래에 무엇을 뺀 그림인지 적어 준다.
        note: x.removed.length
          ? ('뺀 사람: ' + x.removed.map(function (t) { return t.replace(/_/g, ' '); }).join(', '))
          : '아무도 빼지 않은 원래 조합'
      };
    }), bis.seeds[0], 'bis-shots');
    renderBis();
  }

  /** 범인의 가중치를 훑는다 — 1차원이라 가짓수가 곱해지지 않는다. */
  async function bisScanRun() {
    if (!bis || !bis.culprit) return;
    const base = Artists.mix(bis.base, wRange);
    const steps = Artists.scan(base, bis.culprit, null, { cfg: wRange });
    if (!window.confirm('가중치 ' + steps.length + '칸을 뽑을까요? ('
      + steps.map(function (s) { return s.weight; }).join(' / ') + ')')) return;

    bisScan = true;
    await styleGenerate(steps.map(function (x) {
      return {
        label: '가중치-' + x.weight,
        prompt: x.prompt,
        note: bis.culprit.replace(/_/g, ' ') + ' 가중치 ' + x.weight
      };
    }), bis.seeds[0], 'bis-shots');
  }

  async function bisStart() {
    const tags = bisTags();
    if (tags.length < 2) return;
    const seedRaw = parseInt($('bis-seed').value, 10);
    const seed = (isFinite(seedRaw) && seedRaw >= 0) ? seedRaw : Math.floor(Math.random() * 1e9);
    $('bis-seed').value = String(seed);

    bis = Bisect.start({
      tags: tags, seed: seed, cross: $('bis-cross').checked, goal: $('bis-goal').value
    });
    bis.shot = false;
    bisScan = null;

    // ★평소 베이스에서 후보를 빼낼 필요가 없다. 테스트은 자기 베이스를 쓰기 때문이다.
    renderBis();
  }

  async function bisStop() {
    // ★프롬프트는 뽑을 때마다 styleGenerate 가 되돌려 놓으므로 여기서 할 일이 없다.
    if (!window.confirm('깎기를 그만둘까요?')) return;
    bis = null;
    renderBis();
    renderBisPick();
  }

  // ── 그림체 테스트 설정 ───────────────────────────────────────────────────────
  // ★그림체를 견주려면 작가 말고는 아무것도 달라지면 안 된다. 평소 슬롯으로 돌리면
  //   베이스·네거티브·인물이 전부 딸려 들어와 무엇 때문에 달라졌는지 알 수 없다.
  //   그래서 테스트은 **자기 프롬프트 한 세트**을 쓰고, 끝나면 평소 것을 그대로 돌려놓는다.

  function renderStyleUI() {
    const sel = $('st-preset');
    if (!sel.options.length) {
      StyleTest.PRESETS.forEach(function (p) {
        const o = document.createElement('option');
        o.value = p.key;
        o.textContent = p.label;
        sel.appendChild(o);
      });
    }
    sel.value = stCfg.preset;
    $('st-comp-row').hidden = (stCfg.preset !== 'custom');
    $('st-comp').value = stCfg.comp;
    $('st-char').value = stCfg.char;
    $('st-base').value = stCfg.base;
    $('st-neg').value = stCfg.negative;

    renderStyleOpts();

    const b = StyleTest.build(stCfg);
    $('st-preview').textContent = '최종: ' + b.base
      + (b.character ? (' / 캐릭터: ' + b.character) : ' / 캐릭터 없음 (배경만 보는 구도)');
    // 배경만 보는 구도에서는 캐릭터 칸을 안 쓴다. 흐려 두어 알려 준다.
    $('st-char').parentElement.style.opacity = b.withChar ? '' : '.45';
  }

  // 테스트 쪽 숫자 칸과 대량생성 쪽 설정 열쇠의 짝. 한 곳에 두어 그리기와 읽기가 안 갈리게.
  const ST_NUMS = [['st-width', 'width'], ['st-height', 'height'], ['st-steps', 'steps'],
    ['st-cfg', 'cfg'], ['st-cfg-rescale', 'cfg_rescale']];
  const ST_BOOLS = [['st-variety', 'variety_plus'], ['st-transparent', 'transparent_bg'],
    ['st-straight-alpha', 'straight_alpha']];

  /** 테스트용 이미지 설정. 비어 있는 칸은 대량생성 값을 플레이스홀더로 보여 준다. */
  function renderStyleOpts() {
    const o = stCfg.opts || {};
    const same = { value: '', text: '대량생성 값 그대로' };
    // ★고르는 목록은 대량생성 쪽 select 를 그대로 베낀다. 두 벌로 두면 모델이 늘 때
    //   한쪽만 늘고, 모델마다 달라지는 UC·퀄리티 목록도 어긋난다.
    [['st-model', 'opt-model', o.nai_model], ['st-sampler', 'opt-sampler', o.sampler],
     ['st-uc', 'opt-uc', o.uc_preset], ['st-quality', 'opt-quality', o.quality_preset]]
      .forEach(function (p) {
        fillSelect($(p[0]), [same].concat(Array.from($(p[1]).options).map(function (x) {
          return { value: x.value, text: x.text };
        })), p[2] || '');
      });

    ST_NUMS.forEach(function (p) {
      $(p[0]).value = (o[p[1]] === undefined) ? '' : String(o[p[1]]);
      $(p[0]).placeholder = '대량생성 값 (' + options[p[1]] + ')';
    });
    ST_BOOLS.forEach(function (p) {
      $(p[0]).checked = (o[p[1]] === undefined) ? !!options[p[1]] : !!o[p[1]];
    });

    // ★모델이 못 하는 것은 여기서도 잠근다. 켜 봐야 무시되거나 돈만 나간다.
    //   기준은 대량생성 값이 아니라 **테스트에서 실제로 쓸 모델**이다.
    const use = StyleTest.withOpts(options, o);
    const cap = NAI_TABLES.MODEL_CAPS[baseModelOf(use.nai_model)] || NAI_TABLES.CAPS_FALLBACK;
    $('st-variety').disabled = !cap.cfg_delay;
    if (!cap.cfg_delay) $('st-variety').checked = false;
    $('st-transparent').disabled = !cap.transparency;
    if (!cap.transparency) $('st-transparent').checked = false;
    $('st-transparent-row').title = cap.transparency ? '' : '이 모델은 투명 배경을 지원하지 않습니다';
    // Straight Alpha 는 투명 배경을 켰을 때만 의미가 있다.
    $('st-straight-alpha-row').hidden = !($('st-transparent').checked && cap.transparency);

    // 실제로 나갈 값을 한 줄로 적어 준다 — 어느 쪽 값이 쓰이는지 헷갈리는 자리다.
    $('st-opt-echo').textContent = '테스트에 쓰일 값: ' + (MODEL_LABELS[use.nai_model] || use.nai_model)
      + ' · ' + use.width + '×' + use.height + ' · ' + use.steps + '스텝 · 가이던스 ' + use.cfg
      + (use.cfg_rescale ? ' (리스케일 ' + use.cfg_rescale + ')' : '')
      + ' · ' + use.sampler + ' · UC ' + use.uc_preset
      + (use.variety_plus ? ' · Variety+' : '')
      + (use.transparent_bg ? ' · 투명 배경' : '');
  }

  async function readStyleOpts() {
    const o = {};
    [['st-model', 'nai_model'], ['st-sampler', 'sampler'],
     ['st-uc', 'uc_preset'], ['st-quality', 'quality_preset']]
      .forEach(function (p) { if ($(p[0]).value) o[p[1]] = $(p[0]).value; });
    ST_NUMS.forEach(function (p) {
      if (String($(p[0]).value).trim() !== '') o[p[1]] = Number($(p[0]).value);
    });
    // ★켜고 끄는 것에는 "안 정했다" 가 없다. 대량생성 값과 같으면 안 담는다 —
    //   담아 두면 나중에 대량생성 쪽을 바꿔도 테스트은 옛 상태에 묶인다.
    ST_BOOLS.forEach(function (p) {
      if ($(p[0]).checked !== !!options[p[1]]) o[p[1]] = $(p[0]).checked;
    });
    stCfg = StyleTest.settings(Object.assign({}, stCfg, { opts: o }));
    await Store.setStyleTest(stCfg);
    renderStyleUI();
  }

  async function readStyleUI() {
    stCfg = StyleTest.settings({
      preset: $('st-preset').value,
      comp: $('st-comp').value,
      char: $('st-char').value,
      base: $('st-base').value,
      negative: $('st-neg').value
    });
    await Store.setStyleTest(stCfg);
    renderStyleUI();
  }

  /**
   * 테스트용 프롬프트로 잠깐 바꾼다.
   *
   * ★슬롯은 건드리지 않는다. 뽑을 목록을 직접 만들어 runOneJob 에 넘기기 때문이다.
   *   예전에는 슬롯을 갈아 끼우고 대량생성 화면으로 넘어갔는데, 그러면 작가 태그를
   *   보다가 매번 다른 화면으로 튕겨 나가고 결과도 대량생성 결과에 섞였다.
   */
  function styleApply(seed) {
    if (!styleSaved) {
      styleSaved = {
        chars: JSON.parse(JSON.stringify(characters)),
        neg: options.negative_prompt,
        seed: options.seed,
        persona: persona,
        target: slotTarget,
        one: options.one_char_mode,
        save: options.auto_save,
        // ★대량생성 쪽에 걸어 둔 레퍼런스 이미지를 테스트에 끌고 오면 안 된다.
        //   작가 태그만 보려고 뽑는 자리인데 참고 그림이 화풍을 덮어써 버리고,
        //   Anlas 도 더 나가며, 모델이 안 받는 조합이면 그대로 400 이 난다.
        refs: references,
        // ★테스트용 이미지 설정으로 바꾼 것만 담아 둔다. 안 정한 것까지 담으면 되돌릴 때
        //   그 사이에 대량생성 쪽에서 바꾼 값을 옛것으로 덮어쓴다.
        opts: {}
      };
      Object.keys(StyleTest.opts(stCfg.opts)).forEach(function (k) {
        styleSaved.opts[k] = options[k];
      });
    }
    Object.assign(options, StyleTest.opts(stCfg.opts));
    references = [];
    const b = StyleTest.build(stCfg);
    characters = b.character
      ? [{ prompt: b.character, uc: '', coord: null, name: '테스트', skipSlotPrompt: false, enabled: true }]
      : [];
    options.negative_prompt = b.negative;
    options.one_char_mode = false;
    // ★작가 태그는 공통(base)에 붙인다. 캐릭터 쪽에 붙이면 그림체가 캐릭터에만 걸린다.
    slotTarget = 'base';
    // ★테스트 그림을 폰에 자동 저장하지 않는다. 수십 장이 쌓이는데 대부분 버릴 것들이다.
    options.auto_save = false;
    if (seed !== undefined && seed !== null) options.seed = seed;
    persona = '그림체';
    return b;
  }

  function styleRestore() {
    if (!styleSaved) return;
    Object.keys(styleSaved.opts || {}).forEach(function (k) { options[k] = styleSaved.opts[k]; });
    characters = styleSaved.chars;
    options.negative_prompt = styleSaved.neg;
    options.seed = styleSaved.seed;
    options.one_char_mode = styleSaved.one;
    options.auto_save = styleSaved.save;
    slotTarget = styleSaved.target;
    persona = styleSaved.persona;
    references = styleSaved.refs || [];
    styleSaved = null;
    renderCharDrawer();
  }

  /**
   * 그림체 테스트를 한 번 돌린다. ★작가 태그 화면에 머문 채로 돈다.
   * @param {Array} shots [{label, prompt, note}]
   * @param {object} [hooks] {rate, scoreOf} — 주면 뷰어에서 별점을 매길 수 있다
   * @returns {Array} 뽑은 결과 (실패한 것도 들어 있다)
   */
  // ★NAI 는 바로 이어 붙여 부르면 429 로 되돌린다. 한 박자 쉬고 다음 장을 부른다.
  //   여기서 아끼는 1초가 실패 한 장의 재시도 14초보다 비쌀 일은 없다.
  const SHOT_GAP_MS = 900;

  // 마지막 테스트 실행. 실패한 장만 다시 뽑으려면 무엇을 뽑던 중이었는지 들고 있어야 한다.
  let stRun = null;
  // 재시도 중이라는 안내를 칸마다 따로 담는다 (index → 글).
  let stWait = {};

  /** 한 장 뽑기. 처음 뽑을 때와 다시 뽑을 때가 같은 길을 타게 한다. */
  async function styleShot(token, b, i) {
    const sh = stRun.shots[i];
    // ★컷마다 구도를 바꿔 끼울 수 있다 (최종 테스트가 쓴다). 안 주면 이번 판의 구도
    //   하나로 전부 뽑는다 — 조합·깎기는 구도를 고정해야 견줄 수 있으니 그쪽이 기본이다.
    let base = b.base;
    if (sh.preset) {
      const pb = StyleTest.build(Object.assign({}, stCfg, { preset: sh.preset }));
      base = pb.base;
      characters = pb.character
        ? [{ prompt: pb.character, uc: '', coord: null, name: '테스트', skipSlotPrompt: false,
            enabled: true }]
        : [];
    }
    // 컷마다 시드를 따로 줄 수 있다. 같은 조합을 여러 장 뽑을 때 쓴다.
    // 안 주면 styleApply 가 넣어 둔 시드를 그대로 쓴다.
    if (sh.seed !== undefined && sh.seed !== null) options.seed = sh.seed;
    return await runOneJob(token, {
      slot: { label: sh.label, prompt: sh.prompt },
      slotName: sh.label,
      group: '그림체',
      name: sh.label,
      cycle: 1
    }, {
      base: base, oneChar: false, tpl: '{label}.png', seq: i + 1,
      // ★다시 시도하는 중이라는 것을 그 칸에 적는다. 아무 표시 없이 20초를 기다리면
      //   멈춘 줄 알고 앱을 끄는데, 그러면 이미 나간 요청의 Anlas 만 날아간다.
      onWait: function (msg) {
        stWait[i] = msg;
        renderStyleShots(stRun.box, stRun.out, stRun.shots, i, stRun.hooks);
      }
    });
  }

  async function styleGenerate(shots, seed, box, hooks) {
    if (running || styleBusy) { toast('지금 뽑는 중입니다.', 2000); return null; }
    const token = await Store.getToken();
    if (!token) { toast('먼저 API 키를 넣어 주세요.', 2600); return null; }

    styleBusy = true;
    await keepAwake('그림체 테스트를 뽑는 중입니다');
    const b = styleApply(seed);
    usedPaths = new Set();
    const out = [];
    stWait = {};
    stRun = { shots: shots, out: out, box: box, hooks: hooks, seed: seed };
    try {
      for (let i = 0; i < shots.length; i++) {
        renderStyleShots(box, out, shots, i, hooks);
        if (i > 0) await new Promise(function (r) { setTimeout(r, SHOT_GAP_MS); });
        const item = await styleShot(token, b, i);
        delete stWait[i];
        out.push(item);
      }
    } finally {
      styleRestore();
      styleBusy = false;
      await releaseAwake();
    }
    renderStyleShots(box, out, shots, -1, hooks);
    return out;
  }

  /** 실패한 한 장만 다시. 나머지를 또 뽑아 Anlas 를 두 번 쓰지 않게 한다. */
  async function styleRetryOne(i) {
    if (!stRun || running || styleBusy) { toast('지금 뽑는 중입니다.', 2000); return; }
    const token = await Store.getToken();
    if (!token) { toast('먼저 API 키를 넣어 주세요.', 2600); return; }

    styleBusy = true;
    await keepAwake('한 장 다시 뽑는 중입니다');
    const b = styleApply(stRun.seed);
    delete stWait[i];
    // ★뽑는 중 표시가 그 칸에 서게 자리를 비워 둔다.
    stRun.out[i] = null;
    renderStyleShots(stRun.box, stRun.out, stRun.shots, i, stRun.hooks);
    try {
      stRun.out[i] = await styleShot(token, b, i);
      delete stWait[i];
    } finally {
      styleRestore();
      styleBusy = false;
      await releaseAwake();
    }
    renderStyleShots(stRun.box, stRun.out, stRun.shots, -1, stRun.hooks);
    if (stRun.hooks && stRun.hooks.after) stRun.hooks.after();
  }

  /** 실패한 것 전부 다시. */
  async function styleRetryFailed() {
    if (!stRun) return;
    const todo = [];
    stRun.out.forEach(function (it, i) { if (it && !it.bytes) todo.push(i); });
    for (let k = 0; k < todo.length; k++) {
      if (k > 0) await new Promise(function (r) { setTimeout(r, SHOT_GAP_MS); });
      await styleRetryOne(todo[k]);
    }
  }

  /**
   * 실패한 까닭을 칸에 적을 만큼 줄인다.
   * ★"실패" 세 글자만 띄우면 무엇이 잘못됐는지 아무도 모른다. 키가 거부된 것인지,
   *   Anlas 가 떨어진 것인지, 그냥 잠깐 끊긴 것인지에 따라 할 일이 완전히 다르다.
   */
  function shortError(msg) {
    const t = String(msg || '').trim();
    if (!t) return '실패';
    if (/\(401\)/.test(t)) return 'API 키 거부 (401)';
    if (/\(402\)/.test(t)) return 'Anlas 부족 (402)';
    if (/\(429\)/.test(t)) return '요청이 너무 잦음 (429)';
    if (/\(400\)/.test(t)) return '요청 거부 (400)';
    if (/시간이 초과/.test(t)) return '응답 없음 (시간 초과)';
    if (/연결이 끊겼|연결에 실패/.test(t)) return '인터넷 끊김';
    return t.length > 40 ? (t.slice(0, 40) + '…') : t;
  }

  /** 그 칸 안의 blob 주소를 놓아준다. 안 놓으면 다시 그릴 때마다 그림이 메모리에 쌓인다. */
  function freeBlobs(box) {
    Array.from(box.querySelectorAll('img[src^="blob:"]')).forEach(function (img) {
      URL.revokeObjectURL(img.src);
    });
  }

  /** 생성한 이미지을 그 자리에 늘어놓는다. doing 은 지금 뽑는 중인 칸. */
  function renderStyleShots(boxId, done, shots, doing, hooks) {
    const box = $(boxId);
    if (!box) return;
    freeBlobs(box);
    box.innerHTML = '';
    // ★방금 들어온 칸만 떠오르게 한다. 한 장 나올 때마다 통째로 다시 그리므로,
    //   전부에 걸면 있던 그림까지 매번 다시 튀어 오른다.
    const fresh = done.length - 1;
    shots.forEach(function (sh, i) {
      const cell = document.createElement('div');
      cell.className = 'shot';
      const item = done[i];
      if (item && item.bytes) {
        const img = document.createElement('img');
        if (i === fresh) img.className = 'pop';
        img.src = URL.createObjectURL(new Blob([item.bytes], { type: 'image/png' }));
        img.addEventListener('click', function () {
          openViewerFor(item, done.filter(Boolean), function (r) {
            const k = done.indexOf(r);
            return k === -1 ? '' : (shots[k].note || shots[k].label);
          }, hooks && hooks.rate, hooks && hooks.scoreOf);
        });
        cell.appendChild(img);
      } else {
        const failed = !!item;
        const ph = document.createElement('div');
        ph.className = 'shot-ph' + (i === doing ? ' doing' : '') + (failed ? ' bad' : '');
        if (failed) {
          // ★까닭을 적는다. "실패" 세 글자만으로는 키가 거부된 것인지 잠깐 끊긴 것인지
          //   알 수 없어, 사람이 할 수 있는 일이 "다시 다 뽑기" 밖에 없어진다.
          const why = document.createElement('div');
          why.className = 'shot-why';
          why.textContent = shortError(item.error);
          ph.appendChild(why);
          const again = document.createElement('div');
          again.className = 'shot-again';
          again.textContent = '눌러서 다시';
          ph.appendChild(again);
          ph.title = item.error || '';
          ph.addEventListener('click', function () { styleRetryOne(i); });
        } else if (i === doing) {
          ph.textContent = stWait[i] || '뽑는 중';
        }
        cell.appendChild(ph);
      }
      const cap = document.createElement('div');
      cap.className = 'shot-cap';
      cap.textContent = sh.label;
      cell.appendChild(cap);
      box.appendChild(cell);
    });

    renderShotNote(box, done, shots);
  }

  /**
   * 몇 장이 왜 안 됐는지 한 줄로 모아 적는다.
   * ★칸마다 따로 보면 "그냥 잘 안 되네" 로 끝난다. 여덟 장 중 여섯 장이 429 라면
   *   그것은 내 계정이 잠깐 막힌 것이지 조합이 잘못된 것이 아니다.
   */
  function renderShotNote(box, done, shots) {
    const note = document.getElementById(box.id + '-note');
    if (!note) return;
    const bad = done.filter(function (x) { return x && !x.bytes; });
    const btnOff = document.getElementById(box.id + '-retry');
    if (!bad.length) {
      note.hidden = true;
      note.textContent = '';
      if (btnOff) btnOff.hidden = true;
      return;
    }
    const count = {};
    bad.forEach(function (x) {
      const k = shortError(x.error);
      count[k] = (count[k] || 0) + 1;
    });
    const why = Object.keys(count)
      .sort(function (a, b) { return count[b] - count[a]; })
      .map(function (k) { return k + ' ' + count[k] + '장'; })
      .join(' · ');
    note.hidden = false;
    note.textContent = shots.length + '장 중 ' + bad.length + '장 실패 — ' + why;

    const btn = document.getElementById(box.id + '-retry');
    if (btn) btn.hidden = false;
  }

  /**
   * 조합·깎기에서 생성한 이미지을 크게 본다.
   *
   * ★한 번에 뽑은 것을 **통째로** 넣는다. 그래야 좌우로 밀어 그 세트 안을 오갈 수 있다.
   *   전부 같은 묶음 이름(그림체)이라 뷰어가 한 묶음으로 본다.
   * ★뷰어는 결과 목록 안의 항목만 열 수 있어서 목록에 없으면 넣어 준다. 자동 저장은
   *   꺼져 있으므로 마음에 든 그림은 여기서 저장하면 된다.
   *
   * @param {object} item 열 그림
   * @param {Array}  all  같은 번에 뽑은 것 전부
   * @param {function} meta (item) => 아래에 적을 글 (어떤 조합인지)
   * @param {function} [rate] (item, score) 별점을 매기면 부른다. 없으면 별점 줄이 안 뜬다
   * @param {function} [scoreOf] (item) => 지금 점수
   */
  function openViewerFor(item, all, meta, rate, scoreOf) {
    const list = (all || [item]).filter(function (x) { return x && x.bytes; });
    const fresh = list.filter(function (x) { return results.indexOf(x) === -1; });
    if (fresh.length) {
      results = results.concat(fresh);
      renderResults();
    }
    styleView = { items: list, meta: meta, rate: rate, scoreOf: scoreOf };

    // ★공용 묶음(결과 화면의 필터를 거친 것)을 쓰지 않는다. 필터에 걸려 몇 장만 남으면
    //   좌우로 밀어도 그 세트 안을 못 오간다. 이번 것만 담은 그룹을 그대로 쓴다.
    viewGroups = [{ label: '테스트', items: list }];
    viewSlot = 0;
    viewIndex = Math.max(0, list.indexOf(item));
    $('viewer').hidden = false;
    document.body.style.overflow = 'hidden';
    paintViewer();
  }

  /** 뷰어 아래를 조합·깎기용으로 바꾼다. */
  function paintStyleViewer(r) {
    const on = !!(styleView && styleView.items.indexOf(r) !== -1);
    $('viewer-actions').hidden = on;
    $('viewer-rate').hidden = !on;
    if (!on) return;

    $('viewer-combo').textContent = styleView.meta ? styleView.meta(r) : '';
    const box = $('viewer-stars');
    box.innerHTML = '';
    if (!styleView.rate) { box.hidden = true; return; }
    box.hidden = false;
    const now = styleView.scoreOf ? (styleView.scoreOf(r) || 0) : 0;
    for (let k = 1; k <= 5; k++) {
      const b = document.createElement('button');
      b.textContent = k <= now ? '★' : '☆';
      if (k <= now) b.className = 'on';
      b.title = k + '점';
      b.addEventListener('click', function () {
        styleView.rate(r, (now === k) ? 0 : k);
        paintStyleViewer(r);
      });
      box.appendChild(b);
    }
  }

  function setStyleMode(m) {
    styleMode = m;
    $('mode-combo').classList.toggle('on', m === 'combo');
    $('mode-bisect').classList.toggle('on', m === 'bisect');
    $('sub-combo').hidden = (m !== 'combo');
    $('sub-bisect').hidden = (m !== 'bisect');
    $('sub-final').hidden = (m !== 'final');
    // ★최종 테스트는 탭으로 못 간다 — 조합에서 「그림체 선택」 을 눌러야 들어오는 자리다.
    //   탭에 얹으면 아무 그림체도 안 고른 채로 들어와 빈 화면을 보게 된다.
  }

  // ── 조합 (무작위 가중치) ─────────────────────────────────────────────────
  function cmbAdd(tags, pick) {
    (tags || []).forEach(function (t) {
      if (cmbPool.indexOf(t) === -1) cmbPool.push(t);
      if (pick && cmbSel.indexOf(t) === -1 && cmbSel.length < Artists.MAX_TAGS) cmbSel.push(t);
    });
    renderCombo();
  }

  function renderCombo() {
    renderTagPicker('cmb-pick', cmbPool, cmbSel, function (t) {
      if (cmbSel.indexOf(t) !== -1) {
        cmbSel = cmbSel.filter(function (x) { return x !== t; });
      } else if (cmbSel.length < Artists.MAX_TAGS) {
        cmbSel.push(t);
      }
      renderCombo();
    }, '위 버튼으로 작가를 불러오세요.');
    $('cmb-count').textContent = cmbSel.length + ' / ' + Artists.MAX_TAGS + '명';

    renderWeightChips('cmb-presets', 'cmb-steps');
    const cr = wr();
    $('cw-min').value = String(cr.min);
    $('cw-max').value = String(cr.max);
    $('cw-step').value = String(cr.step);
    const n = parseInt($('cmb-n').value, 10) || 6;
    const per = cmbPerNow();
    $('cmb-n-val').textContent = n + '개';
    $('cmb-per-val').textContent = per + '장';
    const r = wr();
    $('cmb-range').textContent = r.min + '부터 ' + r.max + '까지 ' + r.step
      + '씩 끊어서 아무 값이나 뽑습니다. 서랍에서 바꿔도 같이 바뀝니다.';
    const shots = n * per;
    $('cmb-est').textContent = cmbSel.length
      ? (per > 1
        ? ('조합 ' + n + '개 × ' + per + '장 = ' + shots + '장'
          + (bisCost(shots) ? (' · 약 ' + bisCost(shots) + ' Anlas') : ''))
        : (shots + '장' + (bisCost(shots) ? (' · 약 ' + bisCost(shots) + ' Anlas') : '')))
      : '작가를 한 명 이상 골라 주세요.';
    $('cmb-run').disabled = !cmbSel.length;
  }

  function cmbPerNow() {
    return Math.min(4, Math.max(1, parseInt($('cmb-per').value, 10) || 1));
  }

  /**
   * 컷 번호로 어느 조합인지 찾는다.
   * ★뽑을 때 쓴 장수(cmbPerUsed)로 센다. 뽑고 난 뒤에 슬라이더를 움직여도 이미 나온
   *   그림의 짝이 어긋나지 않게 하려는 것이다.
   */
  function comboOfShot(r) {
    const i = cmbShots.indexOf(r);
    return i === -1 ? null : (cmbLast[Math.floor(i / cmbPerUsed)] || null);
  }

  async function cmbRun(sets) {
    if (!cmbSel.length) return;
    const n = parseInt($('cmb-n').value, 10) || 6;
    const per = cmbPerNow();
    const use = sets || Artists.combos(Artists.mix(cmbSel, wRange), n, wRange);
    if (!use.length) return;
    if (!sets && use.length < n) {
      toast('서로 다른 조합이 ' + use.length + '개밖에 안 나옵니다. 가중치 폭을 넓혀 보세요.', 3000);
    }
    const total = use.length * per;
    if (!window.confirm(
      (per > 1 ? ('조합 ' + use.length + '개 × ' + per + '장 = ' + total + '장') : (total + '장'))
      + ' 을 뽑을까요?\n\n'
      + '작가 태그 화면에 그대로 머물고, 평소 슬롯·프롬프트는 건드리지 않습니다.')) {
      return;
    }
    cmbLast = use.map(function (m, i) {
      return {
        name: '조합' + (i + 1), mix: m, score: 0,
        prompt: Artists.bake(m, { cfg: wRange })
      };
    });
    cmbPerUsed = per;
    cmbShots = [];
    renderComboResult();

    // ★시드를 고정해도 한 조합 안에서는 장마다 달라야 한다. 안 그러면 같은 그림이
    //   그대로 여러 장 나온다. 대신 **조합끼리는 같은 시드 묶음**을 써서 견줄 수 있게 한다.
    const fix = $('cmb-seed-fix').checked;
    const seeds = [];
    for (let k = 0; k < per; k++) seeds.push(Math.floor(Math.random() * 1e9));

    const comboNote = function (c, k) {
      return c.name + (per > 1 ? (' (' + (k + 1) + '/' + per + ')') : '') + ', '
        + c.mix.filter(function (x) { return x.on; })
          .map(function (x) { return x.tag.replace(/_/g, ' ') + ' ' + x.weight; }).join(' · ');
    };
    const jobs = [];
    cmbLast.forEach(function (c, i) {
      for (let k = 0; k < per; k++) {
        jobs.push({
          label: c.name + (per > 1 ? ('-' + (k + 1)) : ''),
          prompt: c.prompt,
          note: comboNote(c, k),
          seed: fix ? seeds[k] : undefined
        });
      }
    });

    cmbShots = (await styleGenerate(jobs, fix ? seeds[0] : undefined, 'cmb-shots', {
      // 실패한 장을 다시 뽑고 나면 아래 조합 줄도 같이 새로 그린다.
      after: renderComboResult,
      rate: function (r, score) {
        const c = comboOfShot(r);
        if (c) { c.score = score; renderComboResult(); }
      },
      scoreOf: function (r) {
        const c = comboOfShot(r);
        return c ? c.score : 0;
      }
    })) || [];
    renderComboResult();
  }

  function renderComboResult() {
    $('cmb-result').hidden = !cmbLast.length;
    $('cmb-refine').hidden = !cmbShots.length;
    const box = $('cmb-list');
    freeBlobs(box);
    box.innerHTML = '';
    cmbLast.forEach(function (c, i) {
      const row = document.createElement('div');
      row.className = 'cmb-row';

      // 그 조합으로 뽑은 것 전부. 조합마다 여러 장이면 나란히 붙는다.
      const mine = cmbShots.slice(i * cmbPerUsed, (i + 1) * cmbPerUsed);
      mine.forEach(function (shot) {
        if (!shot || !shot.bytes) return;
        const img = document.createElement('img');
        img.className = 'cmb-thumb';
        img.src = URL.createObjectURL(new Blob([shot.bytes], { type: 'image/png' }));
        img.addEventListener('click', function () {
          openViewerFor(shot, cmbShots,
            function (r) {
              const cc = comboOfShot(r);
              if (!cc) return '';
              const k = cmbShots.indexOf(r) % cmbPerUsed;
              return cc.name + (cmbPerUsed > 1 ? (' (' + (k + 1) + '/' + cmbPerUsed + ')') : '')
                + ', ' + cc.mix.filter(function (x) { return x.on; })
                  .map(function (x) { return x.tag.replace(/_/g, ' ') + ' ' + x.weight; })
                  .join(' · ');
            },
            function (r, score) {
              const cc = comboOfShot(r);
              if (cc) { cc.score = score; renderComboResult(); }
            },
            function (r) {
              const cc = comboOfShot(r);
              return cc ? cc.score : 0;
            });
        });
        row.appendChild(img);
      });

      const main = document.createElement('div');
      main.className = 'cmb-main';
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = c.name;
      const ws = document.createElement('div');
      ws.className = 'ws';
      ws.textContent = c.mix.filter(function (x) { return x.on; })
        .map(function (x) { return x.tag.replace(/_/g, ' ') + ' ' + x.weight; }).join(' · ');
      main.appendChild(nm);
      main.appendChild(ws);

      // 그림체가 얼마나 고른지 — 재고 나서만 붙는다.
      if (c.cons) {
        const cs = document.createElement('div');
        cs.className = 'cons' + (c.cons.rank === 1 ? ' best' : '');
        cs.textContent = (c.cons.rank === 1 ? '가장 고름 · ' : '') + c.cons.text;
        main.appendChild(cs);
      }

      // 별점 — 뽑고 나서만 뜬다. 뽑기 전에는 매길 것이 없다.
      if (cmbShots.length) {
        const stars = document.createElement('div');
        stars.className = 'stars';
        for (let k = 1; k <= 5; k++) {
          const b = document.createElement('button');
          b.textContent = k <= c.score ? '★' : '☆';
          if (k <= c.score) b.className = 'on';
          b.title = k + '점';
          b.addEventListener('click', function () {
            c.score = (c.score === k) ? 0 : k;
            renderComboResult();
          });
          stars.appendChild(b);
        }
        main.appendChild(stars);
      }
      row.appendChild(main);

      const use = document.createElement('button');
      use.className = 'btn small';
      use.textContent = '그림체 선택';
      // ★마음에 든 조합을 섞기로 옮기고 최종 테스트로 넘어간다. 숫자를 손으로 옮겨
      //   적게 하면 반드시 틀린다.
      use.addEventListener('click', async function () {
        artMix = c.mix.map(function (x) { return { tag: x.tag, weight: x.weight, on: x.on }; });
        await Store.setArtistMix(artMix);
        renderMix();
        renderDrawer();
        openFinal(c);
      });
      row.appendChild(use);
      box.appendChild(row);
    });

    // ★한 조합에 한 장뿐이면 그 조합이 고른지 잴 방법이 없다. 그래도 단추는 띄우고
    //   무엇을 하면 되는지 적는다 — 숨기면 이런 기능이 있다는 것을 알 길이 없다.
    renderConsRow('cmb-cons-row', 'cmb-cons', 'cmb-cons-msg', !!cmbShots.length,
      (cmbShots.length && cmbPerUsed < 2)
        ? '「조합마다 장수」 를 2장 이상으로 두고 뽑으면 잽니다.' : '');

    const rated = cmbLast.filter(function (c) { return c.score > 0; }).length;
    $('cmb-refine').textContent = rated
      ? ('점수 ' + rated + '개 반영해서 다시 뽑기')
      : '별점을 매기면 그 쪽으로 다시 뽑습니다';
    $('cmb-refine').disabled = !rated;
  }

  /**
   * 조합마다 뽑은 그림들이 서로 같은 화풍인지 잰다.
   * ★어느 조합이 「안정적인가」 를 보는 것이다. 별점이 마음에 든 정도라면, 이쪽은
   *   그 조합으로 계속 뽑아도 같은 그림이 나오겠는가에 대한 답이다. 둘은 다른 이야기라
   *   따로 보여 준다 — 예쁜데 들쭉날쭉한 조합이 흔하다.
   */
  async function cmbConsistency() {
    if (consBusy) return;
    const box = $('cmb-cons-msg');
    const how = consPick();
    if (how.how === 'off') { box.textContent = how.why; return; }

    consBusy = true;
    $('cmb-cons').disabled = true;
    try {
      // 조합마다 그 조합으로 뽑은 것만 모은다.
      const groups = cmbLast.map(function (c, i) {
        return {
          combo: c,
          shots: cmbShots.slice(i * cmbPerUsed, (i + 1) * cmbPerUsed)
            .filter(function (sh) { return sh && sh.bytes; })
        };
      }).filter(function (g) { return g.shots.length >= 2; });

      if (!groups.length) {
        box.textContent = '한 조합에 두 장 이상 있어야 잽니다. 「조합마다 장수」 를 늘려 보세요.';
        return;
      }

      // ★한 번에 전부 보내고 나서 나눈다. 조합마다 따로 부르면 요청이 수십 번이 된다.
      const flat = [];
      groups.forEach(function (g) {
        g.shots.forEach(function (sh) { flat.push({ bytes: sh.bytes }); });
      });
      box.textContent = '재는 중… (' + flat.length + '장)';
      const vecs = await consVectors('style', flat, function (done, all) {
        box.textContent = '재는 중… ' + done + '/' + all;
      });

      const parts = Consistency.split(vecs, groups.map(function (g) { return g.shots.length; }));
      const scored = groups.map(function (g, i) {
        return { name: g.combo.name, combo: g.combo, vectors: parts[i] };
      });
      const ranked = Consistency.compare(scored);

      cmbLast.forEach(function (c) { c.cons = null; });
      ranked.forEach(function (r, i) {
        const target = scored.find(function (x) { return x.name === r.name; });
        if (!target) return;
        target.combo.cons = { rank: i + 1, text: Consistency.summary(r.report), sd: r.sd };
      });
      renderComboResult();
      box.textContent = ranked.length
        ? ('가장 고른 조합: ' + ranked[0].name + ' (' + ranked[0].label + ')')
        : '';
    } catch (e) {
      box.textContent = '못 쟀습니다: ' + (e.message || e);
    } finally {
      consBusy = false;
      $('cmb-cons').disabled = false;
    }
  }

  // ── 최종 테스트 ──────────────────────────────────────────────────────────
  // ★조합 화면은 구도 하나로만 견준다. 상반신에서 멀쩡하던 그림체가 전신이나 복잡한
  //   배경에서 무너지는 일이 잦아서, 서랍에 넣기 전에 구도를 훑는 자리를 둔다.
  let finCombo = null;

  /** 최종 테스트에서 뽑을 구도들. 「직접 적기」 는 뺀다 (사람이 채워야 하는 칸이다). */
  function finalShots() {
    return StyleTest.PRESETS.filter(function (p) { return p.key !== 'custom'; });
  }

  function openFinal(combo) {
    finCombo = combo;
    setStyleMode('final');
    $('fin-after').hidden = true;
    $('fin-shots').innerHTML = '';
    $('fin-shots-note').hidden = true;
    $('fin-shots-retry').hidden = true;
    renderFinalMix();
    window.scrollTo(0, 0);
  }

  function renderFinalMix() {
    if (!finCombo) return;
    $('fin-mix').textContent = '고른 그림체: '
      + finCombo.mix.filter(function (x) { return x.on; })
        .map(function (x) { return x.tag.replace(/_/g, ' ') + ' ' + x.weight; }).join(' · ');
  }

  async function finRun() {
    if (!finCombo) { toast('먼저 조합에서 그림체를 고르세요.', 2400); return; }
    const shots = finalShots();
    if (!window.confirm('구도 ' + shots.length + '가지를 한 장씩 뽑을까요?\n\n'
      + shots.map(function (p) { return '· ' + p.label; }).join('\n'))) return;

    // ★시드를 하나로 묶는다. 구도 말고 다른 것이 달라지면 무엇 때문에 무너졌는지 모른다.
    const seed = Math.floor(Math.random() * 1e9);
    const prompt = Artists.bake(finCombo.mix, { cfg: wRange });
    const jobs = shots.map(function (p) {
      return { label: p.label, prompt: prompt, note: p.label, preset: p.key, seed: seed };
    });
    await styleGenerate(jobs, seed, 'fin-shots', { after: function () { $('fin-after').hidden = false; } });
    $('fin-after').hidden = false;
  }

  /** 고른 그림체를 저장된 작가태그로. 대량생성에서 그대로 불러 쓴다. */
  async function finSave() {
    if (!finCombo) return;
    const text = Artists.bake(finCombo.mix, { cfg: wRange });
    const name = (window.prompt('이 그림체를 무슨 이름으로 저장할까요?', finCombo.name) || '').trim();
    if (!name) return;
    // 같은 이름이면 덮어쓴다 — 이름을 다시 고르게 하면 목록만 지저분해진다.
    const same = tagsets.find(function (t) { return t.name === name; });
    if (same) same.text = text;
    else tagsets.push({ id: 't' + Date.now().toString(36), name: name, text: text });
    await Store.setTagsets(tagsets);
    renderTagsetSelect();
    toast('"' + name + '" 을 저장된 작가태그에 넣었습니다.', 2800);
  }

  /** 깎기로 넘긴다 — 고른 그림체의 작가들을 그대로 후보로 올린다. */
  function finToBisect() {
    if (!finCombo) return;
    const tags = finCombo.mix.filter(function (x) { return x.on; })
      .map(function (x) { return x.tag; });
    bisAdd(tags, true);
    setStyleMode('bisect');
    window.scrollTo(0, 0);
    toast('깎기에 ' + tags.length + '명을 올렸습니다. 라운드를 시작하세요.', 2800);
  }

  /** 매긴 점수를 반영해 한 번 더. */
  async function cmbRefine() {
    const n = parseInt($('cmb-n').value, 10) || 6;
    const next = Artists.refine(cmbLast, n, wRange);
    if (!next.length) { toast('별점을 먼저 매겨 주세요.', 2400); return; }
    await cmbRun(next);
  }


  // ── "이런 작태는 어떠세요" ──────────────────────────────────────────────
  // ★**앱을 켤 때** 한 번 띄운다. 뽑고 난 뒤가 아니다 — 다 뽑고 나면 이미 그 세션은 끝났고,
  //   새 작가는 다음 세트를 짜기 **전에** 알아야 쓸모가 있다.
  // ★근거는 **이미지 수 100 이상**이다. 그 아래는 NAI 가 배울 거리가 없어 태그를 넣어도
  //   그림에 안 나온다 — 권해 봐야 헛걸음을 시키는 셈이다.
  // ★100장 이상인 작가가 약 2만 4천 명이라 한 번에 다 받을 수 없다. 무작위 쪽(페이지)을
  //   받아 그중에서 다시 고른다. 그래서 켤 때마다 다른 얼굴이 나온다.

  const RECO_PAGE_MAX = 246;   // 100장 이상 · 한 쪽 100명 기준 (2026-08 실측 24,602명)

  /** 한 쪽을 받아 온다. ★빈 쪽이면 절반으로 줄여 다시 본다 (기준을 올리면 쪽수가 준다). */
  async function recoPage(min) {
    let page = 1 + Math.floor(Math.random() * RECO_PAGE_MAX);
    for (let i = 0; i < 4; i++) {
      const rows = Danbooru.parseTags(
        await dbGet(Danbooru.artistTagsUrl({ min: min, limit: 100, page: page })));
      if (rows.length) return rows;
      if (page === 1) return [];
      page = Danbooru.backoffPage(page);
    }
    return [];
  }

  /**
   * 권할 작가를 받아 그린다.
   *
   * ★켤 때 뜨는 시트와 "작가 태그 → 추천" 탭이 **같은 코드**를 쓴다. 두 벌로 두면
   *   한쪽만 고쳐져 팝업과 메뉴가 다른 것을 보여 주게 된다.
   *
   * @param {object} o {box, min, count} box 를 안 주면 시트에 그리고 시트를 연다
   */
  async function loadReco(o) {
    const opt = o || {};
    const sheet = !opt.box;
    const box = sheet ? $('reco-list') : $(opt.box);
    const min = opt.min || recoMin;
    if (recoBusy) return;
    recoBusy = true;
    if (sheet) {
      $('reco-why').textContent = '그림 ' + min.toLocaleString() + '장 이상인 작가 중에서 골랐습니다.';
      $('reco-off').checked = recoOff;
      $('reco-min').value = String(min);
      $('reco').hidden = false;
    }
    box.innerHTML = '<p class="hint">찾는 중…</p>';
    try {
      const rows = (await recoPage(min))
        // 이미 서랍에 있는 사람은 권할 것이 없다.
        .filter(function (r) { return !r.deprecated && !Artists.has(artDrawer, r.name); });
      await renderReco(Danbooru.sample(rows, opt.count || 5), box);
    } catch (e) {
      box.innerHTML = '<p class="hint">찾지 못했습니다: ' + (e.message || e) + '</p>';
    }
    recoBusy = false;
  }

  /**
   * 그 작가를 "찾기" 에서 펼친다. 추천 목록의 이름을 눌렀을 때 온다.
   * ★시트가 떠 있으면 먼저 닫는다. 뒤에서 화면이 바뀌어 봐야 가려서 안 보인다.
   */
  function showArtist(name) {
    $('reco').hidden = true;
    if (currentScreen !== 'artists') show('artists');
    setArtTab('find');
    $('art-ac').hidden = true;
    $('art-q').value = String(name || '').replace(/_/g, ' ');
    artLoad(name);
  }

  /** 켤 때 뜨는 시트. */
  async function openReco(force) {
    if (recoOff && !force) return;
    await loadReco({});
  }

  /** "작가 태그 → 추천" 탭. ★자리가 넓으니 열 명을 보여 준다. */
  async function loadRecoTab() {
    await loadReco({
      box: 'reco-tab-list',
      min: parseInt($('reco-tab-min').value, 10) || 100,
      count: 10
    });
  }

  async function renderReco(rows, target) {
    const box = target || $('reco-list');
    box.innerHTML = '';
    if (!rows.length) {
      box.innerHTML = '<p class="hint">권할 만한 작가를 못 찾았습니다.</p>';
      return;
    }
    rows.forEach(function (r) {
      const row = document.createElement('div');
      row.className = 'reco-row';

      const th = document.createElement('div');
      th.className = 'reco-thumbs';
      row.appendChild(th);

      const main = document.createElement('div');
      main.className = 'reco-main';
      // ★이름을 누르면 찾기로 넘어가 바로 펼친다. 권해 놓고 "더 볼 방법은 알아서
      //   찾으세요" 는 불친절하다 — 담을지 말지는 그림을 봐야 정해진다.
      const nm = document.createElement('button');
      nm.className = 'reco-name';
      nm.textContent = r.name.replace(/_/g, ' ');
      nm.title = '눌러서 이 작가 자세히 보기';
      nm.addEventListener('click', function () { showArtist(r.name); });
      const sub = document.createElement('div');
      sub.className = 'reco-sub';
      sub.textContent = Danbooru.reach(r.count).label + ' · ' + r.count.toLocaleString() + '장';
      main.appendChild(nm);
      main.appendChild(sub);
      row.appendChild(main);

      const keep = document.createElement('button');
      keep.className = 'btn small';
      keep.textContent = '담기';
      row.appendChild(keep);
      box.appendChild(row);

      // ★그림과 장르는 뒤따라 채운다. 다섯 명을 다 기다리면 시트가 한참 비어 있다.
      //   같은 응답에서 장르까지 재므로 부르는 횟수가 늘지 않는다.
      dbGet(Danbooru.postsUrl({ name: r.name, rating: $('art-rating').value, limit: 12 }))
        .then(function (body) {
          const posts = JSON.parse(body || '[]');
          Danbooru.images(posts, { max: 2 }).forEach(function (im) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = im.thumb;
            img.alt = '';
            th.appendChild(img);
          });
          const gs = Danbooru.genres(posts);
          r.genres = gs.map(function (g) { return g.key; });
          if (gs.length) {
            sub.textContent += ' · ' + gs.map(function (g) { return g.label; }).join(' ');
          }
        })
        .catch(function () { /* 그림이 없어도 이름과 이미지 수는 쓸모가 있다 */ });

      keep.addEventListener('click', async function () {
        artDrawer = Artists.add(artDrawer,
          { tag: r.name, count: r.count, genres: r.genres || [] }, Date.now());
        await Store.setArtists(artDrawer);
        keep.textContent = '담았음';
        keep.disabled = true;
        row.classList.add('kept');
        renderDrawer();
      });
    });
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
        return;   // "그 밖에 N건" 은 안내일 뿐이다
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
      // ★GitHub 지시는 저장소를 건드리지 않는다 — 대신 "한 것" 으로 표시해 넘긴다.
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
        '"' + (job.name || '작업') + '" 을 실행할까요?\n\n'
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
    say($('jobs-msg'), '"' + (claimed.name || '작업') + '" 을 뽑는 중입니다…');
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
        say($('jobs-msg'), '"' + (claimed.name || '작업') + '" ' + saved.length + '장 완료'
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
      + (over ? ' 켠 인물이 모델 상한(' + lim + '명)을 넘습니다. 안 쓸 인물을 꺼 주세요.' : ''),
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
  function renderAnlas() {
    if (!options) return;

    const cap = NAI_TABLES.MODEL_CAPS[baseModelOf(options.nai_model)] || NAI_TABLES.CAPS_FALLBACK;
    const est = Anlas.estimate({
      width: options.width, height: options.height, steps: options.steps,
      model: options.nai_model,
      isOpus: subscription ? subscription.isOpus : false,
      opusExhausted: subscription ? subscription.opusExhausted : false,
      refCount: cap.char_ref ? references.length : 0,
      // ★실제로 뽑을 이미지 수로 센다 — 배수와 한 명 모드의 바퀴까지 포함이다.
      //   슬롯 수만 세면 "배수 3" 을 켠 사람에게 1/3 로 적힌 값을 보여 주게 된다.
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
      : '아직 정의가 없습니다. "예시 넣기" 를 눌러 보세요.';
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
        + '명까지라 뒤 ' + (on - lim) + '명은 전송되지 않습니다. 안 쓸 인물은 꺼 주세요.';
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
      text = '켠 인물 ' + chars + '명을 **한 명씩** 돌립니다. 인물 ' + chars
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
      : '인물 없음. 눌러서 추가';
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
        + '명까지라 "초과" 표시된 인물은 전송되지 않습니다.';
      w.hidden = false;
    } else {
      w.hidden = true;
    }

    const box = $('drawer-chars-list');
    box.innerHTML = '';

    if (!characters.length) {
      const e = document.createElement('div');
      e.className = 'drawer-empty';
      e.textContent = '인물이 없습니다. 아래 "+ 인물 추가" 를 누르거나 캐릭터 JSON 을 가져오세요.';
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
      // 이름을 눌러도 열린다 — "수정" 을 정확히 겨냥하지 않아도 되게.
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
   * ★데스크톱 버전(backend.py 의 promptTarget 분기)과 같은 규칙이어야 한다.
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
      : '슬롯 없음. 눌러서 추가';
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
  // ★중지 등으로 **손도 못 댄** 작업들. 실패한 장과 함께 "못 만든 것 다시 생성" 이 집는다.
  let pendingJobs = [];
  // "다시 생성" 이 도는 중인지. running 만으로는 생성 중과 구별되지 않아 버튼 글자가 엉킨다.
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

    const shots = ResultsModel.viewable(results).length;
    renderConsRow('res-cons-row', 'res-cons', 'res-cons-msg', shots >= 2, '');

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

    // 인물 일관성 검사에서 튄 장. ★지우지도 고르지도 않는다 — 「여기를 보세요」 일 뿐이다.
    if (r.consOut) {
      const w = document.createElement('span');
      w.className = 'cons-out';
      w.textContent = '인물 다름?';
      w.title = '이 묶음의 다른 장들과 덜 닮았습니다. 눈으로 확인해 보세요.';
      card.appendChild(w);
    }
    return card;
  }

  /** 이 그림이 누구인가 — 묶는 열쇠. 한 명씩 모드면 인물 이름, 아니면 페르소나. */
  function whoOf(r) {
    const info = r.saveInfo || {};
    return info.char || info.persona || '전체';
  }

  /**
   * 대량으로 뽑은 것들이 계속 같은 사람인지 잰다.
   * ★스무 장 중 두 장만 얼굴이 다른 것은 눈으로 훑어서는 잘 안 보인다. 저장까지 하고
   *   폴더에서 나란히 보고서야 알아챈다. 그 전에 짚어 주자는 것이다.
   * ★튄 장을 지우지도 「버릴 것」 으로 찍지도 않는다. 닮은 정도는 사람 눈이 최종이고,
   *   모델이 틀리는 경우가 얼마든지 있다. 표시만 붙이고 판단은 사람에게 남긴다.
   */
  async function resConsistency() {
    if (consBusy) return;
    const box = $('res-cons-msg');
    const how = consPick();
    if (how.how === 'off') { box.textContent = how.why; return; }

    const shots = ResultsModel.viewable(results);
    if (shots.length < 2) { box.textContent = '견줄 그림이 두 장이 안 됩니다.'; return; }

    consBusy = true;
    $('res-cons').disabled = true;
    try {
      // 인물별로 묶는다. 서로 다른 사람을 한 묶음에 넣고 재면 전부 「들쭉날쭉」 이 된다.
      const byWho = {};
      shots.forEach(function (r) {
        const k = whoOf(r);
        (byWho[k] = byWho[k] || []).push(r);
      });
      const names = Object.keys(byWho).filter(function (k) { return byWho[k].length >= 2; });
      if (!names.length) {
        box.textContent = '한 사람당 두 장 이상 있어야 잽니다.';
        return;
      }

      // ★한 번에 다 보내고 나서 나눈다. 사람마다 따로 부르면 요청이 사람 수만큼 늘어난다.
      const flat = [];
      names.forEach(function (k) {
        byWho[k].forEach(function (r) {
          // 수신함에 이미 올려 둔 것은 경로만 보낸다 (다시 올려보내지 않는다).
          flat.push({ bytes: r.bytes, remotePath: remotePathOf(r) });
        });
      });
      box.textContent = '재는 중… (' + flat.length + '장)';
      const vecs = await consVectors('identity', flat, function (done, all) {
        box.textContent = '재는 중… ' + done + '/' + all;
      });

      shots.forEach(function (r) { r.consOut = false; });
      const parts = Consistency.split(vecs, names.map(function (k) { return byWho[k].length; }));
      const lines = [];
      names.forEach(function (k, gi) {
        const mine = byWho[k];
        const rep = Consistency.report(parts[gi]);
        rep.items.forEach(function (it) {
          if (it.out && mine[it.index]) mine[it.index].consOut = true;
        });
        lines.push(k + ' — ' + Consistency.summary(rep));
      });
      renderResults();
      const flagged = shots.filter(function (r) { return r.consOut; }).length;
      box.textContent = lines.join(' | ')
        + (flagged ? '' : ' · 튄 장은 없습니다.');
    } catch (e) {
      box.textContent = '못 쟀습니다: ' + (e.message || e);
    } finally {
      consBusy = false;
      $('res-cons').disabled = false;
    }
  }

  /**
   * 수신함에 저장된 경로. 없으면 null (그러면 본문째로 보낸다).
   * ★savedTo 는 "대상이름 · 상대경로" 꼴이다. 폰에 저장한 것은 그 꼴이 아니므로 걸러진다.
   */
  function remotePathOf(r) {
    const d = consDest();
    if (!d || !r.savedTo) return null;
    const head = d.name + ' · ';
    return r.savedTo.indexOf(head) === 0 ? r.savedTo.slice(head.length) : null;
  }

  // ── 못 만든 것 다시 생성 ─────────────────────────────────────────────────
  // ★인터넷이 끊기면 남은 장이 줄줄이 깨진다. 그때 처음부터 다시 돌리면 이미 나온 장을
  //   또 뽑느라 Anlas 를 두 번 쓴다. 실패한 장(과 중지로 손도 못 댄 장)만 집어 이어 뽑는다.
  function failedItems() {
    return ResultsModel.live(results).filter(function (r) {
      return !!r.error && !r.bytes && !!r.job;
    });
  }

  /** 다시 뽑을 수 있는 이미지 수 = 실패한 장 + 아직 손도 못 댄 장. */
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
    // ★그림이 없는 장만 다시 뽑는다. "저장 실패" 는 그림이 이미 있으니 뷰어에서 저장하면 된다.
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

    await setRunning(true, '못 만든 것을 다시 뽑는 중입니다');
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
      say(box, '다시 생성 중 ' + (done + 1) + '/' + total + ', ' + prev.name);
      const item = await runOneJob(token, prev.job, {
        base: lastRun.base, tpl: lastRun.tpl, oneChar: lastRun.oneChar,
        seq: results.length + 1,
        onWait: function (msg) { say(box, prev.name + ', ' + msg); }
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
      say(box, '이어서 생성 중 ' + (done + 1) + '/' + total + ', ' + job.name);
      const item = await runOneJob(token, job, {
        base: lastRun.base, tpl: lastRun.tpl, oneChar: lastRun.oneChar,
        seq: results.length + 1,
        onWait: function (msg) { say(box, job.name + ', ' + msg); }
      });
      results.push(item);
      if (!item.bytes) failed++;
      done++;
      renderResults();
    }

    await setRunning(false);
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
   * ★"인핸스 성공하면 원본 지우기" 가 이걸 쓴다 — deleteItem 을 쓰면 방금 만든
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
  // ★고치는 즉시 원래 칸에 반영하고 저장까지 한다 — "완료" 를 안 눌러 잃는 일이 없게.
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
      // ★확인을 묻지 않는다 — "되돌리기" 가 있어서 되살릴 수 있다.
      $('editor-text').value = '';
      editorSync();
      editorSay('전부 지웠습니다. 되돌리려면 "되돌리기".');
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
   *  필터로 골라 놓고 "보이는 것 인핸스" 를 누르는 흐름이 자연스럽다. */
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
    styleView = null;
    $('viewer-actions').hidden = false;
    $('viewer-rate').hidden = true;
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

    const styling = !!(styleView && styleView.items.indexOf(r) !== -1);
    $('viewer-count').textContent = styling
      ? (r.name + '  ' + (viewIndex + 1) + '/' + g.items.length)
      : (g.label + '  ' + (viewIndex + 1) + '/' + g.items.length
        + '   (슬롯 ' + (viewSlot + 1) + '/' + viewGroups.length + ')');
    $('viewer-cap').textContent = captionOf(r);
    $('viewer-prev').disabled = (viewIndex === 0);
    $('viewer-next').disabled = (viewIndex === g.items.length - 1);
    $('viewer-prev-slot').disabled = (viewSlot === 0);
    $('viewer-next-slot').disabled = (viewSlot === viewGroups.length - 1);

    const saveBtn = $('viewer-save');
    saveBtn.textContent = r.savedTo ? '저장됨' : '저장';
    saveBtn.className = 'btn small' + (r.savedTo ? ' saved' : '');
    saveBtn.disabled = !!r.savedTo;

    paintStyleViewer(r);
    setViewerHint('');
  }

  /**
   * 화면 한가운데의 큰 글씨. p 는 0~1 로 기준에 얼마나 다가갔는지 —
   * 1 이 되면 "놓으면 실행" 이라는 뜻이라 한 번 커진다.
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
      || ($('viewer-rate').hidden
        ? '↑ 버리기   ↓ 저장   ←→ 넘기기   ·   두 번 누르거나 손가락 두 개로 확대'
        : '←→ 밀어서 넘기기   ↓ 저장   ·   두 번 누르거나 손가락 두 개로 확대');
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

  /** 아래로 밀어 저장. 이미 저장돼 있으면 "남길 것" 표시만 남긴다. */
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
    // ★세로 기준은 더 크게 잡는다 — 실수로 버리면 되돌릴 수 없다.
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
        // 기준을 넘으면 무엇이 일어날지 미리 알려 준다 — 화면 한가운데에 크게.
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

      // 거의 안 움직였으면 "두 번 누르기" 인지 본다.
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
   * ★생성과 "다시 생성" 이 같은 길을 쓰게 하려고 떼어 놓았다. 두 벌로 두면 한쪽만
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
    // ★한 명 모드면 이번 인물 하나만, 아니면 **켜 둔 인물만** 보낸다.
    // ★여기서 enabled 를 참으로 덮어쓰면 안 된다. 뒤의 composePrompts 가 그 값으로
    //   꺼 둔 인물을 걸러 내는데, 전부 참으로 만들어 버리면 꺼 놓은 인물이 그대로
    //   실려 나간다. (한 명 모드에서만 필요했던 것이 반대편까지 망가뜨리고 있었다.)
    const sending = oneChar ? [job.char] : activeChars(characters);
    const wcChars = sending.map(function (c) {
      return Object.assign({}, c, {
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
        // ★한 명 모드면 "인물 · 슬롯" 으로 묶는다. 슬롯으로만 묶으면 인물 8명이
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
    // "못 만든 것 다시 생성" 이 같은 조건으로 이어 뽑도록 들고 있는다.
    lastRun = { base: base, tpl: tpl, oneChar: oneChar };

    await setRunning(true, '그림을 뽑는 중입니다');
    cancelRequested = false;
    $('generate').hidden = true;
    $('cancel').hidden = false;
    $('progress-open').hidden = true;
    clearResults();

    let done = 0;
    let failed = 0;

    for (let ji = 0; ji < jobs.length; ji++) {
      if (cancelRequested) {
        // ★아직 손도 못 댄 것들을 들고 있는다. 결과 화면의 "못 만든 것 다시 생성" 이
        //   실패한 장과 함께 이어서 뽑는다 — 처음부터 다시 돌리지 않게.
        pendingJobs = jobs.slice(ji);
        break;
      }
      const job = jobs[ji];
      const tag = (oneChar ? (job.charName + ' · ') : '')
        + (job.perSlot > 1 ? (job.slotName + ' (' + job.cycle + '/' + job.perSlot + ')') : job.slotName);
      setProgress(done, totalJobs, '생성 중 ' + (done + 1) + '/' + totalJobs + ', ' + tag);

      const item = await runOneJob(token, job, {
        base: base, tpl: tpl, oneChar: oneChar, seq: done + 1,
        onWait: function (msg) { setProgress(done, totalJobs, tag + ', ' + msg); }
      });
      if (!item.bytes) failed++;
      results.push(item);

      renderResults();
      done++;
      setProgress(done, totalJobs, done + '/' + totalJobs + ' 완료');
      // 원격 작업으로 도는 중이면 올린 쪽에도 진행을 알린다.
      reportJobProgress(done, totalJobs);
    }

    await setRunning(false);
    $('generate').hidden = false;
    $('cancel').hidden = true;

    const stopped = cancelRequested ? ' (중지됨)' : '';
    const summary = done + '/' + totalJobs + ' 완료'
      + (failed ? ', 실패 ' + failed + '건' : '') + stopped;
    setProgress(done, totalJobs, summary);
    // ★끝난 뒤에 한 번 더 그린다. 도는 동안에는 "못 만든 것 다시 생성" 이 잠겨 있고,
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

    // ★안드로이드 14의 「알람 및 리마인더」. 알림을 허용해도 이게 막혀 있으면 정작
    //   알림이 나갈 때 한 번 더 물어본다. 필요한 기기에서만 이 줄을 띄운다.
    const ex = await Notify.exactStatus();
    $('perm-exact-row').hidden = (ex === 'unavailable');
    if (ex !== 'unavailable') {
      const e = ex === 'granted' ? ['허용됨', 'ok'] : ['아직 안 켬', ''];
      $('perm-exact-state').textContent = e[0];
      $('perm-exact-state').className = 'perm-state' + (e[1] ? ' ' + e[1] : '');
      $('perm-exact').disabled = (ex === 'granted');
    }
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
    wRange = await Store.getWeightRange();
    recoOff = await Store.getRecoOff();
    recoMin = await Store.getRecoMin();
    stCfg = StyleTest.settings(await Store.getStyleTest());
    $('reco-tab-min').value = String(recoMin);
    renderWeightUI();
    renderGhRows();
    $('jobs-auto').checked = jobsAuto;
    renderJobsDestSelect();
    // ★자동 모드는 앱을 켜 두는 동안만 돈다 (안드로이드가 백그라운드를 재운다).
    if (jobsAuto) setJobTimer(true);

    renderAnlas();
    renderOneChar();
    if (await Store.hasToken()) { renderHome(); show('home'); } else { show('setup'); }
    // 잔량은 통신이 필요하므로 화면을 먼저 띄우고 뒤따라 채운다.
    refreshAnlas();

    // ★앱을 켤 때 한 번 권한다 — 새 작가는 세트를 짜기 **전에** 알아야 쓸모가 있다.
    //   키를 아직 안 넣은 첫 실행에는 띄우지 않는다 (그때 할 일은 키 넣기다).
    // ★인트로가 걷힌 뒤에 띄운다. 인트로 밑에서 먼저 열리면 걷히는 순간 이미 떠 있어,
    //   사람이 무엇을 눌러 띄운 것인지 알 수 없다.
    if (await Store.hasToken()) {
      setTimeout(function () { openReco(false); }, INTRO_MS + 700);
    }

    // ★업데이트는 조용히 본다. 스토어를 안 거치므로 아무도 안 알려 주는데, 그렇다고 켤 때마다
    //   물어보면 GitHub 한도(토큰 없이 시간당 60번)를 헛되이 쓴다. 여섯 시간에 한 번이다.
    appVersion = await loadAppVersion();
    updRepo = await Store.getUpdateRepo();
    renderUpdateRepo();
    $('ver-now').textContent = appVersion ? ('현재 ' + appVersion) : '버전을 알 수 없습니다 (미리보기)';
    $('ver-auto').checked = await Store.getUpdateAuto();
    checkUpdate(false);

    consMode = await Store.getConsistency();
    consReady = await Store.getConsistencyReady();
    renderConsistency();

    // ★설정을 다 읽은 뒤에 인트로를 걷는다. 먼저 걷으면 빈 화면이 잠깐 보인다.
    startIntro();
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
      if (!src.trim()) { say($('wc-result'), '테스트할 문장을 넣어주세요.', 'err'); return; }
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

        $('perm-exact').addEventListener('click', async function () {
      // 앱 안에서는 못 켠다. 시스템 설정 화면으로 보내고, 돌아오면 다시 본다.
      await Notify.requestExact();
      setTimeout(renderPermStates, 800);
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
    $('results-back').addEventListener('click', goBack);
    $('progress-open').addEventListener('click', function () { renderResults(); show('results'); });
    $('results-clear').addEventListener('click', function () {
      if (!results.length) return;
      if (!window.confirm('결과 목록을 비울까요? 저장하지 않은 그림은 사라집니다.')) return;
      clearResults();
    });

    // ── 작가 태그 ───────────────────────────────────────────────────
    // 홈
    const goHome = function () { show('home'); renderHome(); };
    $('main-home').addEventListener('click', goHome);
    $('home-bulk').addEventListener('click', function () { show('main'); });
    $('home-artists').addEventListener('click', openArtists);
    $('home-settings').addEventListener('click', function () { $('go-settings').click(); });
    $('home-folders').addEventListener('click', function () { $('go-folders').click(); });
    $('home-results').addEventListener('click', function () { renderResults(); show('results'); });
    $('home-jobs').addEventListener('click', function () { $('go-jobs').click(); });
    $('home-guide').addEventListener('click', openGuide);
    $('guide-back').addEventListener('click', goBack);
    $('artists-back').addEventListener('click', goHome);
    ['find', 'drawer', 'reco', 'style'].forEach(function (n) {
      $('tab-' + n).addEventListener('click', function () { setArtTab(n); });
    });
    $('mode-combo').addEventListener('click', function () { setStyleMode('combo'); });
    $('mode-bisect').addEventListener('click', function () { setStyleMode('bisect'); });

    $('art-q').addEventListener('input', onArtInput);
    $('art-q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        $('art-ac').hidden = true;
        artLoad($('art-q').value);
      }
    });
    $('art-rating').addEventListener('change', function () {
      if (artCur) artLoad(artCur.tag);       // 등급를 바꾸면 그림을 다시 받는다
    });
    $('art-open').addEventListener('click', function () {
      const tag = artCur ? artCur.tag : Danbooru.normalize($('art-q').value);
      if (tag) window.open(Danbooru.webUrl(tag), '_blank');
    });
    $('art-keep').addEventListener('click', async function () {
      if (!artCur) return;
      artDrawer = Artists.add(artDrawer, {
        tag: artCur.tag, count: artCur.count,
        genres: (artCur.genres || []).map(function (g) { return g.key; })
      }, Date.now());
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
    bindLabelBar();
    bindUpdate();
    $('drw-import').addEventListener('click', importTagsetToDrawer);
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

    $('bis-cross').addEventListener('change', renderBisSetup);
    $('bis-from-drawer').addEventListener('click', function () {
      bisAdd(artDrawer.map(function (e) { return e.tag; }), true);
    });
    $('bis-from-mix').addEventListener('click', function () {
      bisAdd(artMix.map(function (m) { return m.tag; }), true);
    });
    $('bis-from-prompt').addEventListener('click', function () {
      bisAdd(tagsFromText($('base-prompt').value), true);
      toast('작가가 아닌 태그는 눌러서 꺼 주세요.', 2800);
    });
    $('bis-none').addEventListener('click', function () {
      bisSel = [];
      renderBisPick();
    });
    $('bis-add-typed').addEventListener('click', function () {
      bisAdd(tagsFromText($('bis-tags').value), true);
      $('bis-tags').value = '';
    });

    // 가중치 범위
    ['w-min', 'w-max', 'w-step'].forEach(function (id) {
      // ★함수를 그대로 넘기면 Event 가 첫 인자로 들어가 접두사 자리를 차지한다.
      $(id).addEventListener('change', function () { readWeightUI('w'); });
    });
    $('mix-rand').addEventListener('click', async function () {
      if (!artMix.length) { toast('섞은 작가가 없습니다.', 2000); return; }
      artMix = Artists.randomize(artMix, wRange);
      await Store.setArtistMix(artMix);
      renderMix();
    });

    // 그림체 테스트 설정
    ['st-preset', 'st-comp', 'st-char', 'st-base', 'st-neg'].forEach(function (id) {
      $(id).addEventListener('change', readStyleUI);
    });
    // ★대량생성 쪽 슬롯 칸과 **같은 전체화면 편집기**를 쓴다. 두 줄짜리 칸에서 긴
    //   프롬프트를 고치는 것은 폰에서 사실상 불가능하다 (복사·되돌리기·글자수도 없다).
    //   편집기는 고칠 때 input 을 흘리므로 여기서도 input 을 받아야 저장된다.
    [['st-comp', '테스트 구도 태그'], ['st-char', '테스트용 캐릭터'],
     ['st-base', '테스트 퀄리티 프롬프트'], ['st-neg', '테스트 네거티브']]
      .forEach(function (p) {
        makeExpandable($(p[0]), p[1]);
        $(p[0]).addEventListener('input', readStyleUI);
      });
    ['st-model', 'st-sampler', 'st-uc', 'st-quality', 'st-width', 'st-height', 'st-steps',
     'st-cfg', 'st-cfg-rescale', 'st-variety', 'st-transparent', 'st-straight-alpha']
      .forEach(function (id) { $(id).addEventListener('change', readStyleOpts); });
    $('st-opt-same').addEventListener('click', async function () {
      stCfg = StyleTest.settings(Object.assign({}, stCfg, { opts: {} }));
      await Store.setStyleTest(stCfg);
      renderStyleUI();
      toast('대량생성 설정을 그대로 씁니다.', 2200);
    });

    $('st-reset').addEventListener('click', async function () {
      stCfg = StyleTest.settings(null);
      await Store.setStyleTest(stCfg);
      renderStyleUI();
    });

    // 조합
    $('cmb-from-drawer').addEventListener('click', function () {
      cmbAdd(artDrawer.map(function (e) { return e.tag; }), true);
    });
    $('cmb-from-mix').addEventListener('click', function () {
      cmbAdd(artMix.map(function (m) { return m.tag; }), true);
    });
    $('cmb-none').addEventListener('click', function () {
      cmbSel = [];
      renderCombo();
    });
    $('cmb-n').addEventListener('input', renderCombo);
    $('cmb-per').addEventListener('input', renderCombo);
    $('cmb-run').addEventListener('click', function () { cmbRun(); });
    $('cmb-refine').addEventListener('click', cmbRefine);
    $('cmb-cons').addEventListener('click', cmbConsistency);
    $('fin-run').addEventListener('click', finRun);
    $('fin-save').addEventListener('click', finSave);
    $('fin-bisect').addEventListener('click', finToBisect);
    $('fin-tweak').addEventListener('click', function () { setStyleMode('combo'); window.scrollTo(0, 0); });
    $('fin-back').addEventListener('click', function () { setStyleMode('combo'); window.scrollTo(0, 0); });
    ['cmb-shots-retry', 'bis-shots-retry', 'fin-shots-retry'].forEach(function (id) {
      $(id).addEventListener('click', styleRetryFailed);
    });
    $('res-cons').addEventListener('click', resConsistency);
    ['cw-min', 'cw-max', 'cw-step'].forEach(function (id) {
      $(id).addEventListener('change', function () { readWeightUI('cw'); });
    });

    $('w-reset').addEventListener('click', async function () {
      wRange = null;
      await Store.setWeightRange(null);
      renderWeightUI();
      renderMix();
    });

    // "이런 작태는 어떠세요"
    $('reco-close').addEventListener('click', function () { $('reco').hidden = true; });
    $('reco').addEventListener('click', function (e) {
      if (e.target === $('reco')) $('reco').hidden = true;    // 바깥을 눌러도 닫힌다
    });
    $('reco-off').addEventListener('change', async function () {
      recoOff = $('reco-off').checked;
      await Store.setRecoOff(recoOff);
      if (recoOff) toast('설정에서 다시 켤 수 있습니다.', 2400);
    });
    $('reco-more').addEventListener('click', function () { openReco(true); });
    $('tab-reco').addEventListener('click', function () {
      // ★탭을 처음 열 때만 부른다. 올 때마다 부르면 보고 있던 목록이 사라진다.
      if (!$('reco-tab-list').children.length) loadRecoTab();
    });
    $('reco-tab-go').addEventListener('click', loadRecoTab);
    $('reco-tab-min').addEventListener('change', async function () {
      recoMin = parseInt($('reco-tab-min').value, 10) || 100;
      await Store.setRecoMin(recoMin);
      // ★한 곳에서 정한 기준이다. 안 맞춰 두면 팝업과 메뉴가 서로 다른 것을 보여 준다.
      $('reco-min').value = String(recoMin);
      loadRecoTab();
    });
    $('reco-min').addEventListener('change', async function () {
      recoMin = parseInt($('reco-min').value, 10) || 100;
      await Store.setRecoMin(recoMin);
      $('reco-tab-min').value = String(recoMin);
      openReco(true);
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
      goBack();
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
      toast('Private 을 권합니다. 프롬프트가 그대로 남는 곳이니까요.', 3200);
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
        renderCharDrawer();     // "초과" 표시가 달라진다
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

    $('dest-wizard').addEventListener('click', openWizard);
    $('cw-back').addEventListener('click', function () { show('settings'); });
    $('cw-done').addEventListener('click', function () { show('settings'); });
    $('cw-ssh-run').addEventListener('click', cwSshRun);
    $('cw-copy').addEventListener('click', cwCopy);
    $('cw-connect').addEventListener('click', cwConnect);
    $('rx-cmd-copy').addEventListener('click', copyInstallCmd);
    $('rx-cmd-open').addEventListener('change', renderInstallCmd);
    renderInstallCmd();
    $('rx-copy').addEventListener('click', copyReceiver);
    $('rx-save').addEventListener('click', saveReceiver);

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
    $('folders-back').addEventListener('click', goBack);
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
    $('back-main').addEventListener('click', goBack);

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
