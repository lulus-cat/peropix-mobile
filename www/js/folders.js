// 폴더 관리 — 폰과 원격(PC·VPS)을 같은 인터페이스로 다룬다.
//
// 화면 코드가 "지금 대상이 폰인가 서버인가" 를 신경 쓰지 않게 여기서 갈라 준다.
// 폰은 Capacitor Filesystem, 원격은 RemoteStore(수신함) 를 쓴다.
'use strict';

const Folders = (function () {
  // 폰에서 이미지가 쌓이는 곳. nai-client.js 의 저장 경로와 같아야 한다.
  const DEVICE_ROOT = 'PeroPix';
  const DEVICE_DIR = 'DOCUMENTS';

  function fs() {
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.Filesystem) ? C.Plugins.Filesystem : null;
  }

  function isNative() {
    const C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  }

  function join(base, name) {
    return base ? (base + '/' + name) : name;
  }

  function parentOf(path) {
    if (!path) return '';
    const i = path.lastIndexOf('/');
    return i === -1 ? '' : path.slice(0, i);
  }

  function devicePath(rel) {
    return rel ? (DEVICE_ROOT + '/' + rel) : DEVICE_ROOT;
  }

  // ── 폰 ───────────────────────────────────────────────────────────────────
  async function deviceBrowse(rel) {
    const F = fs();
    if (!F) throw new Error('이 화면은 앱(APK)에서만 동작합니다. 브라우저 미리보기에서는 폰 폴더를 볼 수 없습니다.');
    let res;
    try {
      res = await F.readdir({ path: devicePath(rel), directory: DEVICE_DIR });
    } catch (e) {
      // 아직 한 장도 저장하지 않았으면 폴더 자체가 없다 — 오류가 아니라 빈 목록으로 본다.
      if (!rel) return { path: '', dirs: [], files: [] };
      throw new Error('폴더를 읽지 못했습니다: ' + (e && e.message ? e.message : e));
    }
    const dirs = [];
    const files = [];
    (res.files || []).forEach(function (f) {
      // Capacitor 버전에 따라 문자열 배열이거나 객체 배열이다.
      const name = (typeof f === 'string') ? f : f.name;
      const type = (typeof f === 'string') ? null : f.type;
      if (type === 'directory') dirs.push({ name: name, count: null });
      else if (type === 'file') files.push({ name: name, size: f.size || 0 });
      else files.push({ name: name, size: 0 });
    });
    return { path: rel || '', dirs: dirs, files: files };
  }

  async function deviceMkdir(rel) {
    const F = fs();
    if (!F) throw new Error('앱에서만 동작합니다.');
    await F.mkdir({ path: devicePath(rel), directory: DEVICE_DIR, recursive: true });
    return rel;
  }

  async function deviceRename(from, to) {
    const F = fs();
    if (!F) throw new Error('앱에서만 동작합니다.');
    await F.rename({
      from: devicePath(from), directory: DEVICE_DIR,
      to: devicePath(to), toDirectory: DEVICE_DIR
    });
    return to;
  }

  async function deviceRemove(rel, isDir, recursive) {
    const F = fs();
    if (!F) throw new Error('앱에서만 동작합니다.');
    if (!isDir) {
      await F.deleteFile({ path: devicePath(rel), directory: DEVICE_DIR });
      return { ok: true };
    }
    if (!recursive) {
      // 비어 있는지 먼저 본다 — 폰에서도 실수로 통째로 날리지 않게 서버와 같은 규칙을 쓴다.
      const inside = await deviceBrowse(rel);
      const n = inside.dirs.length + inside.files.length;
      if (n > 0) return { ok: false, needsConfirm: true, count: n };
    }
    await F.rmdir({ path: devicePath(rel), directory: DEVICE_DIR, recursive: true });
    return { ok: true };
  }

  // ── 공통 창구 ────────────────────────────────────────────────────────────
  // dest 가 null 이면 폰, 아니면 원격 대상.
  async function browse(dest, path) {
    return dest ? RemoteStore.browse(dest, path) : deviceBrowse(path);
  }

  async function mkdir(dest, path) {
    return dest ? RemoteStore.mkdir(dest, path) : deviceMkdir(path);
  }

  async function rename(dest, from, to) {
    return dest ? RemoteStore.rename(dest, from, to) : deviceRename(from, to);
  }

  async function remove(dest, path, isDir, recursive) {
    return dest ? RemoteStore.remove(dest, path, recursive) : deviceRemove(path, isDir, recursive);
  }

  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  return {
    browse: browse,
    mkdir: mkdir,
    rename: rename,
    remove: remove,
    join: join,
    parentOf: parentOf,
    humanSize: humanSize,
    isNative: isNative,
    DEVICE_ROOT: DEVICE_ROOT
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Folders;
