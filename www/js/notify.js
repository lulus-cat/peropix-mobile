// 배치가 끝났을 때 알림.
//
// ★대량 생성은 몇 분씩 걸린다. 그동안 화면을 꺼 두거나 다른 앱을 보고 있어도
//   끝난 걸 알 수 있어야 한다.
// ★권한은 **처음 알림을 보낼 때** 묻는다. 앱을 켜자마자 물으면 맥락 없이 거절당한다.
'use strict';

const Notify = (function () {
  let asked = false;

  function plugin() {
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.LocalNotifications) ? C.Plugins.LocalNotifications : null;
  }

  function isNative() {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  }

  async function ensurePermission() {
    const P = plugin();
    if (!P) return false;
    try {
      let st = await P.checkPermissions();
      if (st.display === 'granted') return true;
      if (st.display === 'denied') return false;   // 이미 거절했으면 다시 묻지 않는다
      if (asked) return false;
      asked = true;
      st = await P.requestPermissions();
      return st.display === 'granted';
    } catch (e) {
      return false;
    }
  }

  /**
   * 알림 하나를 띄운다. 실패해도 조용히 넘어간다 —
   * 알림이 안 되는 것 때문에 생성 결과를 못 보게 하면 안 된다.
   */
  async function done(title, body) {
    if (!isNative()) {
      // PC 미리보기: 브라우저 알림이 허용돼 있으면 그걸 쓴다.
      try {
        if (window.Notification && Notification.permission === 'granted') {
          new Notification(title, { body: body });
        }
      } catch (e) { /* 무시 */ }
      return false;
    }
    const P = plugin();
    if (!P) return false;
    if (!(await ensurePermission())) return false;
    try {
      await P.schedule({
        notifications: [{
          id: Date.now() % 2147483647,
          title: title,
          body: body,
          smallIcon: 'ic_stat_icon_config_sample'
        }]
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // 진행 알림은 **같은 id 로 다시 띄워** 덮어쓴다. id 를 매번 새로 주면 알림 목록에
  // 「12% 13% 14%…」 가 줄줄이 쌓여 못 쓰게 된다.
  const PROGRESS_ID = 20260823;

  /**
   * 상태바에 진행을 띄운다 (같은 줄을 계속 고쳐 쓴다).
   * @param {string} title 제목
   * @param {string} body  몇 %인지 등
   * @param {boolean} [ongoing] 받는 동안 밀어서 못 지우게 할지
   */
  async function progress(title, body, ongoing) {
    if (!isNative()) return false;
    const P = plugin();
    if (!P) return false;
    if (!(await ensurePermission())) return false;
    try {
      await P.schedule({
        notifications: [{
          id: PROGRESS_ID,
          title: title,
          body: body,
          smallIcon: 'ic_stat_icon_config_sample',
          ongoing: !!ongoing,
          autoCancel: !ongoing
        }]
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 진행 알림을 치운다. 다 됐는데 남아 있으면 아직 받는 줄 안다. */
  async function clearProgress() {
    if (!isNative()) return;
    const P = plugin();
    if (!P) return;
    try { await P.cancel({ notifications: [{ id: PROGRESS_ID }] }); } catch (e) { /* 무시 */ }
  }

  /** 지금 권한 상태만 본다 (묻지 않는다). 'granted' | 'denied' | 'prompt' | 'unavailable' */
  async function status() {
    const P = plugin();
    if (!isNative() || !P) {
      if (window.Notification) return Notification.permission === 'granted' ? 'granted' : 'prompt';
      return 'unavailable';
    }
    try {
      const st = await P.checkPermissions();
      return st.display || 'prompt';
    } catch (e) {
      return 'unavailable';
    }
  }

  /** 대놓고 물어본다 (권한 화면의 버튼에서 쓴다). */
  async function request() {
    const P = plugin();
    if (!isNative() || !P) {
      if (window.Notification && Notification.requestPermission) {
        try { return (await Notification.requestPermission()) === 'granted'; } catch (e) { return false; }
      }
      return false;
    }
    try {
      asked = true;
      const st = await P.requestPermissions();
      return st.display === 'granted';
    } catch (e) {
      return false;
    }
  }

  return {
    done: done, isNative: isNative, status: status, request: request,
    progress: progress, clearProgress: clearProgress
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Notify;
