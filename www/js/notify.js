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
   * 「알람 및 리마인더」 상태를 본다 (안드로이드 14부터 따로 묻는다).
   *
   * ★알림 권한을 허용해도 이것이 따로 막혀 있으면, 정작 알림이 나갈 때 시스템이
   *   한 번 더 물어본다. 그래서 첫 화면에서 같이 켤 수 있게 꺼내 둔다.
   * ★이 API 는 플러그인 버전에 따라 없을 수 있다. 없으면 「해당 없음」 으로 본다 —
   *   없는 것을 못 켰다고 빨갛게 띄우면 고칠 수도 없는 경고만 남는다.
   * @returns {'granted'|'denied'|'unavailable'}
   */
  async function exactStatus() {
    if (!isNative()) return 'unavailable';
    const P = plugin();
    if (!P || typeof P.checkExactNotificationSetting !== 'function') return 'unavailable';
    try {
      const r = await P.checkExactNotificationSetting();
      return r && r.exact_alarm === 'granted' ? 'granted' : 'denied';
    } catch (e) {
      return 'unavailable';
    }
  }

  /** 「알람 및 리마인더」 설정 화면으로 보낸다. 앱 안에서는 못 켜고 시스템 설정에서만 켠다. */
  async function requestExact() {
    const P = plugin();
    if (!P || typeof P.changeExactNotificationSetting !== 'function') return false;
    try {
      await P.changeExactNotificationSetting();
      return true;
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
    exactStatus: exactStatus, requestExact: requestExact
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Notify;
