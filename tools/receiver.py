#!/usr/bin/env python3
"""PeroPix 이미지 수신함 — PC 와 VPS 에 똑같이 올려 쓴다.

앱이 생성한 이미지를 정해진 폴더 구조로 받아 저장한다.
표준 라이브러리만 쓴다 (설치할 것 없음, Python 3.8+).

    python receiver.py --root ./images --token 발급한비밀문자열

★토큰 없이는 시작하지 않는다. 인증 없는 업로드 창구는 아무나 쓰는 저장소가 된다.
★평문 HTTP 로 인터넷에 열면 토큰과 이미지가 그대로 노출된다.
  VPS 에서는 반드시 아래 중 하나를 쓸 것:
    - 리버스 프록시(Caddy/nginx)로 TLS 를 씌운다  ← 권장
    - --cert/--key 로 이 서버에 직접 인증서를 물린다
    - VPN(Tailscale/WireGuard) 안에서만 연다
  집 LAN 안의 PC 라면 평문도 무방하다.

엔드포인트
    GET  /ping             연결·인증 확인
    POST /upload           이미지 저장  (헤더 X-Path 에 상대 경로)
    GET  /list?prefix=...  저장된 파일 목록 (매트릭스 채움 확인용)
    GET  /browse?path=...  한 폴더의 바로 아래 (폴더 관리 화면용)
    POST /mkdir            폴더 만들기      {"path": "미아/H"}
    POST /rename           이름 바꾸기·이동  {"from": "...", "to": "..."}
    POST /delete           지우기           {"path": "...", "recursive": false}

  작업 큐 — 다른 사람(예: Claude Code)이 「이거 뽑으세요」 를 올려 두면 폰 앱이 받아 간다.
  ★키는 폰에만 있으므로, 여기 올라오는 것은 **무엇을 뽑을지에 대한 지시**뿐이다.
    NovelAI 를 부르는 것도, Anlas 를 쓰는 것도 폰이다. 이 서버는 쪽지함일 뿐이다.
    POST /jobs             작업 올리기       {"name": "...", "spec": {...}}
    GET  /jobs?status=...  작업 목록
    POST /jobs/claim       기다리는 것 하나를 집어 간다 (폰이 부른다)
    POST /jobs/update      진행·결과 알리기  {"id": "...", "status": "done", ...}
    POST /jobs/delete      작업 지우기       {"id": "..."}

★X-Path 는 **UTF-8 퍼센트 인코딩**으로 보낸다.
  HTTP 헤더는 latin-1 만 담을 수 있어서 "미아/happy.png" 를 날것으로 넣으면 전송 자체가 실패한다.
  페르소나 이름이 한글인 게 기본이므로 이 규약을 어기면 바로 막힌다.
  조각마다 encodeURIComponent 를 걸고 "/" 로 잇는다:
      %EB%AF%B8%EC%95%84/happy.png
"""

import argparse
import base64
import json
import os
import re
import secrets
import shutil
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

VERSION = "1.0.0"
MAX_BYTES = 32 * 1024 * 1024          # 한 장 상한. 이보다 큰 요청은 읽지 않고 끊는다.
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp"}

# 경로 조각으로 허용하지 않는 것들
_BAD_PART = re.compile(r'^$|^\.$|^\.\.$|[\\:*?"<>|]')

_lock = threading.Lock()


class Config:
    root = Path(".")
    token = ""


def safe_path(raw: str, require_image: bool = True, allow_root: bool = False):
    """앱이 보낸 상대 경로를 검사해 안전한 Path 로 바꾼다.

    ★여기가 이 서버의 유일한 위험 지점이다. `../../etc/passwd` 나 `C:\\Windows\\...`
      같은 값이 그대로 통과하면 서버의 아무 파일이나 덮어쓰거나 지울 수 있다.
      막는 방법은 둘을 **모두** 쓴다: 조각 검사 + 최종 경로가 root 안인지 확인.

    require_image=False 는 폴더 조작용이다 (확장자 검사를 건너뛴다).
    allow_root=True 는 목록 조회처럼 루트 자체를 가리켜도 되는 경우에만 쓴다.
    """
    raw = unquote(raw or "").replace("\\", "/").strip()

    # ★앞의 "/" 는 **거부**한다. 잘라내고 상대경로로 재해석하면 안 된다 —
    #   "/etc/passwd.png" 가 조용히 통과해 저장 폴더 안에 etc/passwd.png 로 떨어진다.
    #   root 밖으로 나가지는 않지만, 보낸 쪽 의도와 다르게 동작하는 것 자체가 결함이다.
    if raw.startswith("/"):
        return None, "절대 경로는 받지 않습니다"
    if re.match(r"^[A-Za-z]:", raw):
        return None, "절대 경로는 받지 않습니다"

    raw = raw.rstrip("/")   # 뒤의 "/" 만 떼어낸다 ("미아/" 같은 폴더 표기 허용)

    if not raw:
        if allow_root:
            return Config.root.resolve(), None
        return None, "경로가 비어 있습니다"

    parts = raw.split("/")
    if len(parts) > 8:
        return None, "폴더가 너무 깊습니다"
    for p in parts:
        if _BAD_PART.search(p):
            return None, f"쓸 수 없는 경로 조각: {p!r}"

    if require_image:
        ext = os.path.splitext(parts[-1])[1].lower()
        if ext not in ALLOWED_EXT:
            return None, f"허용하지 않는 확장자: {ext!r}"

    dest = (Config.root / Path(*parts)).resolve()
    root = Config.root.resolve()
    # ★조각 검사를 통과해도 심볼릭 링크로 빠져나갈 수 있다. 최종 확인이 필요하다.
    if root != dest and root not in dest.parents:
        return None, "저장 폴더 밖으로 나가는 경로입니다"
    return dest, None


def safe_relpath(raw: str):
    """업로드용 — 이미지 확장자만 허용한다."""
    return safe_path(raw, require_image=True)


def unique_path(dest: Path) -> Path:
    """이미 있으면 _2, _3 을 붙인다. 덮어쓰지 않는다."""
    if not dest.exists():
        return dest
    stem, ext = dest.stem, dest.suffix
    n = 2
    while True:
        cand = dest.with_name(f"{stem}_{n}{ext}")
        if not cand.exists():
            return cand
        n += 1


# ── 작업 큐 ──────────────────────────────────────────────────────────────
# ★이미지 폴더 안의 숨은 폴더(.jobs)에 둔다. 따로 경로를 받으면 설정이 하나 더 늘고,
#   두 곳을 옮길 때 짝이 어긋난다. 대신 **목록·폴더 화면에서는 숨긴다** (아래 _visible).
JOBS_DIR = ".jobs"
JOB_MAX_BYTES = 1024 * 1024          # 지시문은 작다. 이보다 크면 뭔가 잘못된 것이다.
JOB_STATUSES = ("pending", "running", "done", "failed", "cancelled")


def jobs_dir() -> Path:
    d = Config.root.resolve() / JOBS_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _visible(name: str) -> bool:
    """숨은 항목(.jobs 등)은 파일 목록에 내보내지 않는다."""
    return not name.startswith(".")


def job_path(job_id: str):
    """작업 id 는 우리가 만든 것만 받는다 (경로 조각으로 쓰이므로 엄격히)."""
    if not re.fullmatch(r"[0-9a-z\-]{8,64}", job_id or ""):
        return None
    return jobs_dir() / f"{job_id}.json"


def read_job(job_id: str):
    p = job_path(job_id)
    if not p or not p.exists():
        return None
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def write_job(job: dict):
    p = job_path(job["id"])
    if not p:
        return False
    # ★임시 파일에 쓰고 이름을 바꾼다. 폰이 읽는 중에 반쪽짜리 JSON 을 보면 안 된다.
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(job, ensure_ascii=False, indent=1), "utf-8")
    tmp.replace(p)
    return True


def all_jobs():
    out = []
    for p in sorted(jobs_dir().glob("*.json")):
        try:
            out.append(json.loads(p.read_text("utf-8")))
        except (OSError, ValueError):
            continue
    out.sort(key=lambda j: j.get("createdAt", ""))
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = f"PeroPixReceiver/{VERSION}"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ── 공통 ────────────────────────────────────────────────────────────
    def _send(self, code, payload):
        # ★204 는 본문을 가질 수 없다 (RFC 9110). 실어 보내면 프레이밍이 어긋나
        #   프리플라이트 뒤 요청이 이상하게 끊긴다.
        no_body = (code == 204)
        body = b"" if no_body else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if not no_body:
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
        # 앱(WebView)에서 직접 부를 수도 있으므로 CORS 를 열어 둔다.
        # ★토큰이 없으면 어차피 거부되므로 이것만으로 위험해지지는 않는다.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-Path, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        got = self.headers.get("Authorization", "")
        if not got.startswith("Bearer "):
            return False
        # ★타이밍 공격을 피해 상수시간 비교를 쓴다.
        return secrets.compare_digest(got[7:], Config.token)

    def do_OPTIONS(self):
        self._send(204, {})

    # ── GET ─────────────────────────────────────────────────────────────
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/ping":
            if not self._authed():
                self._send(401, {"ok": False, "error": "토큰이 맞지 않습니다"})
                return
            self._send(200, {"ok": True, "version": VERSION, "root": str(Config.root.resolve())})
            return

        if u.path == "/list":
            if not self._authed():
                self._send(401, {"ok": False, "error": "토큰이 맞지 않습니다"})
                return
            prefix = (parse_qs(u.query).get("prefix") or [""])[0]
            base, err = (Config.root.resolve(), None)
            files = []
            for p in sorted(base.rglob("*")):
                if not p.is_file():
                    continue
                rel = p.relative_to(base).as_posix()
                # ★.jobs 같은 숨은 폴더는 그림이 아니다 — 목록에 섞이면 매트릭스 셈이 틀어진다.
                if any(not _visible(part) for part in rel.split("/")):
                    continue
                if prefix and not rel.startswith(prefix):
                    continue
                files.append({"path": rel, "size": p.stat().st_size})
                if len(files) >= 5000:
                    break
            self._send(200, {"ok": True, "count": len(files), "files": files})
            return

        if u.path == "/jobs":
            if not self._authed():
                self._send(401, {"ok": False, "error": "토큰이 맞지 않습니다"})
                return
            want = (parse_qs(u.query).get("status") or [""])[0]
            jobs = all_jobs()
            if want:
                jobs = [j for j in jobs if j.get("status") == want]
            self._send(200, {"ok": True, "count": len(jobs), "jobs": jobs})
            return

        if u.path == "/browse":
            # 한 폴더의 바로 아래만 본다 (폴더 관리 화면용).
            if not self._authed():
                self._send(401, {"ok": False, "error": "토큰이 맞지 않습니다"})
                return
            rel = (parse_qs(u.query).get("path") or [""])[0]
            target, err = safe_path(rel, require_image=False, allow_root=True)
            if err:
                self._send(400, {"ok": False, "error": err})
                return
            if not target.is_dir():
                self._send(404, {"ok": False, "error": "폴더가 아닙니다"})
                return

            root = Config.root.resolve()
            dirs, files = [], []
            for p in sorted(target.iterdir(), key=lambda x: x.name.lower()):
                if not _visible(p.name):
                    continue
                try:
                    if p.is_dir():
                        # 안에 몇 장 들었는지 같이 알려 준다 (매트릭스 채움 확인용).
                        n = sum(1 for c in p.rglob("*") if c.is_file())
                        dirs.append({"name": p.name, "count": n})
                    elif p.is_file():
                        files.append({"name": p.name, "size": p.stat().st_size})
                except OSError:
                    continue
                if len(dirs) + len(files) >= 3000:
                    break
            self._send(200, {
                "ok": True,
                "path": "" if target == root else target.relative_to(root).as_posix(),
                "dirs": dirs,
                "files": files
            })
            return

        self._send(404, {"ok": False, "error": "없는 경로입니다"})

    # ── POST ────────────────────────────────────────────────────────────
    def _read_json(self, limit=64 * 1024):
        """폴더 조작용 작은 JSON 본문을 읽는다."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "Content-Length 가 이상합니다"
        if length <= 0 or length > limit:
            return None, "본문 크기가 이상합니다"
        try:
            return json.loads(self.rfile.read(length).decode("utf-8")), None
        except Exception as e:
            return None, f"JSON 본문이 이상합니다: {e}"

    def do_POST(self):
        path = urlparse(self.path).path

        if path.startswith("/jobs"):
            if not self._authed():
                self._send(401, {"ok": False, "error": "토큰이 맞지 않습니다"})
                return
            self._job_op(path)
            return

        if path in ("/mkdir", "/rename", "/delete"):
            if not self._authed():
                self._send(401, {"ok": False, "error": "토큰이 맞지 않습니다"})
                return
            self._folder_op(path)
            return

        if path != "/upload":
            self._send(404, {"ok": False, "error": "없는 경로입니다"})
            return
        if not self._authed():
            self._send(401, {"ok": False, "error": "토큰이 맞지 않습니다"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, {"ok": False, "error": "Content-Length 가 이상합니다"})
            return
        if length <= 0:
            self._send(400, {"ok": False, "error": "본문이 비어 있습니다"})
            return
        # base64 는 원본의 4/3 이므로 JSON 모드는 상한을 넉넉히 잡는다.
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        is_json = ctype == "application/json"
        cap = MAX_BYTES * 4 // 3 + 4096 if is_json else MAX_BYTES
        if length > cap:
            self._send(413, {"ok": False, "error": f"{MAX_BYTES // 1024 // 1024}MB 를 넘습니다"})
            return

        raw = self.rfile.read(length)
        if len(raw) != length:
            self._send(400, {"ok": False, "error": "본문이 끊겼습니다"})
            return

        if is_json:
            # ★앱(WebView)은 이 모드를 쓴다. 네이티브 HTTP 를 거쳐 바이너리를 그대로
            #   흘려보내는 것보다 JSON+base64 가 훨씬 안정적이다.
            #   경로도 본문에 담으므로 헤더 인코딩 문제를 겪지 않는다.
            try:
                body = json.loads(raw.decode("utf-8"))
                path_raw = body["path"]
                data = base64.b64decode(body["data"], validate=True)
            except Exception as e:
                self._send(400, {"ok": False, "error": f"JSON 본문이 이상합니다: {e}"})
                return
            if len(data) > MAX_BYTES:
                self._send(413, {"ok": False, "error": f"{MAX_BYTES // 1024 // 1024}MB 를 넘습니다"})
                return
        else:
            path_raw = self.headers.get("X-Path", "")
            data = raw

        dest, err = safe_relpath(path_raw)
        if err:
            self._send(400, {"ok": False, "error": err})
            return

        with _lock:
            dest = unique_path(dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(data)
            # ★임시 이름으로 다 쓴 뒤 옮긴다. 중간에 끊겨도 반쪽 파일이 남지 않는다.
            tmp.replace(dest)

        rel = dest.resolve().relative_to(Config.root.resolve()).as_posix()
        self._send(200, {"ok": True, "path": rel, "bytes": len(data)})

    # ── 폴더 관리 ───────────────────────────────────────────────────────
    # ── 작업 큐 ─────────────────────────────────────────────────────────
    def _job_op(self, path):
        """「이거 뽑으세요」 쪽지를 주고받는다. 그림은 여기서 만들지 않는다."""
        body, err = self._read_json(limit=JOB_MAX_BYTES)
        if err:
            self._send(400, {"ok": False, "error": err})
            return

        with _lock:
            if path == "/jobs":
                spec = body.get("spec")
                if not isinstance(spec, dict):
                    self._send(400, {"ok": False, "error": "spec 이 없습니다 (무엇을 뽑을지)"})
                    return
                now = time.strftime("%Y-%m-%dT%H:%M:%S")
                # ★id 앞에 시각을 둔다 — 파일 이름만 봐도 순서가 보이고, 정렬이 곧 시간순이다.
                job = {
                    "id": time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3),
                    "name": str(body.get("name") or spec.get("name") or "작업"),
                    "createdAt": now,
                    "updatedAt": now,
                    "status": "pending",
                    "spec": spec,
                    "progress": {"done": 0, "total": 0},
                    "files": [],
                    "error": ""
                }
                if not write_job(job):
                    self._send(500, {"ok": False, "error": "작업을 쓰지 못했습니다"})
                    return
                self._send(200, {"ok": True, "id": job["id"], "job": job})
                return

            if path == "/jobs/claim":
                # ★기다리는 것 중 **가장 오래된 하나**만 집어 준다. 집는 순간 running 으로
                #   바꿔 두어야 폰이 둘이어도 같은 작업을 두 번 뽑지 않는다 (돈이 두 배로 나간다).
                for job in all_jobs():
                    if job.get("status") != "pending":
                        continue
                    job["status"] = "running"
                    job["claimedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    job["updatedAt"] = job["claimedAt"]
                    write_job(job)
                    self._send(200, {"ok": True, "job": job})
                    return
                self._send(200, {"ok": True, "job": None})
                return

            if path == "/jobs/update":
                job = read_job(str(body.get("id") or ""))
                if not job:
                    self._send(404, {"ok": False, "error": "그런 작업이 없습니다"})
                    return
                status = body.get("status")
                if status is not None:
                    if status not in JOB_STATUSES:
                        self._send(400, {"ok": False, "error": f"모르는 상태: {status!r}"})
                        return
                    job["status"] = status
                if isinstance(body.get("progress"), dict):
                    job["progress"] = {
                        "done": int(body["progress"].get("done") or 0),
                        "total": int(body["progress"].get("total") or 0)
                    }
                if isinstance(body.get("files"), list):
                    # 저장된 경로만 담는다 (그림 자체는 /upload 로 따로 올라온다).
                    job["files"] = [str(f)[:400] for f in body["files"][:2000]]
                if body.get("error") is not None:
                    job["error"] = str(body.get("error"))[:2000]
                job["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                write_job(job)
                self._send(200, {"ok": True, "job": job})
                return

            if path == "/jobs/delete":
                p = job_path(str(body.get("id") or ""))
                if not p or not p.exists():
                    self._send(404, {"ok": False, "error": "그런 작업이 없습니다"})
                    return
                p.unlink()
                self._send(200, {"ok": True})
                return

        self._send(404, {"ok": False, "error": "없는 경로입니다"})

    def _folder_op(self, op):
        body, err = self._read_json()
        if err:
            self._send(400, {"ok": False, "error": err})
            return

        root = Config.root.resolve()

        if op == "/mkdir":
            target, err = safe_path(body.get("path", ""), require_image=False)
            if err:
                self._send(400, {"ok": False, "error": err})
                return
            if target.exists():
                self._send(409, {"ok": False, "error": "이미 있습니다"})
                return
            target.mkdir(parents=True, exist_ok=True)
            self._send(200, {"ok": True, "path": target.relative_to(root).as_posix()})
            return

        if op == "/rename":
            src, err = safe_path(body.get("from", ""), require_image=False)
            if err:
                self._send(400, {"ok": False, "error": "원본 " + err})
                return
            dst, err = safe_path(body.get("to", ""), require_image=False)
            if err:
                self._send(400, {"ok": False, "error": "새 이름 " + err})
                return
            if not src.exists():
                self._send(404, {"ok": False, "error": "원본이 없습니다"})
                return
            if dst.exists():
                self._send(409, {"ok": False, "error": "그 이름이 이미 있습니다"})
                return
            # ★폴더를 자기 하위로 옮기면 트리가 끊긴다. 미리 막는다.
            if src.is_dir() and src in dst.parents:
                self._send(400, {"ok": False, "error": "자기 하위 폴더로는 옮길 수 없습니다"})
                return
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
            self._send(200, {"ok": True, "path": dst.relative_to(root).as_posix()})
            return

        if op == "/delete":
            target, err = safe_path(body.get("path", ""), require_image=False)
            if err:
                self._send(400, {"ok": False, "error": err})
                return
            # ★루트 자체는 절대 지우지 않는다. safe_path 가 빈 경로를 막지만 한 번 더 본다.
            if target == root:
                self._send(400, {"ok": False, "error": "저장 폴더 자체는 지울 수 없습니다"})
                return
            if not target.exists():
                self._send(404, {"ok": False, "error": "없는 경로입니다"})
                return

            if target.is_dir():
                inner = [c for c in target.rglob("*") if c.is_file()]
                # ★비어 있지 않은 폴더는 명시적으로 확인받은 경우에만 지운다.
                #   실수로 수백 장을 날리는 사고를 막는다.
                if inner and not body.get("recursive"):
                    self._send(409, {
                        "ok": False,
                        "error": f"폴더 안에 파일이 {len(inner)}개 있습니다",
                        "count": len(inner),
                        "needs_confirm": True
                    })
                    return
                shutil.rmtree(target)
                self._send(200, {"ok": True, "deleted": len(inner) or 0, "kind": "dir"})
                return

            target.unlink()
            self._send(200, {"ok": True, "deleted": 1, "kind": "file"})
            return


def main():
    ap = argparse.ArgumentParser(description="PeroPix 이미지 수신함")
    ap.add_argument("--root", default="./images", help="이미지를 저장할 폴더")
    ap.add_argument("--host", default="0.0.0.0", help="바인드 주소")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--token", default=os.environ.get("PEROPIX_TOKEN", ""),
                    help="접속 토큰 (환경변수 PEROPIX_TOKEN 도 가능)")
    ap.add_argument("--cert", help="TLS 인증서 (.pem)")
    ap.add_argument("--key", help="TLS 개인키 (.pem)")
    ap.add_argument("--new-token", action="store_true", help="토큰을 하나 만들어 출력하고 끝낸다")
    args = ap.parse_args()

    if args.new_token:
        print(secrets.token_urlsafe(32))
        return

    if not args.token or len(args.token) < 16:
        print("토큰이 없거나 너무 짧습니다 (16자 이상).", file=sys.stderr)
        print("먼저 만들어 두세요:  python receiver.py --new-token", file=sys.stderr)
        sys.exit(2)

    Config.root = Path(args.root)
    Config.root.mkdir(parents=True, exist_ok=True)
    Config.token = args.token

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)

    scheme = "http"
    if args.cert and args.key:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(args.cert, args.key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"

    # ★주소·토큰을 따로 옮겨 적게 하면 반드시 오타가 난다. 한 줄로 만들어 준다 —
    #   앱의 「한 줄로 붙여넣기」 칸에 그대로 넣으면 세 칸이 알아서 채워진다.
    shown_host = args.host if args.host not in ("0.0.0.0", "::") else "이서버주소"
    pair = f"peropix://{shown_host}:{args.port}#{args.token}"

    print(f"PeroPix 수신함 {VERSION}")
    print(f"  저장 폴더 : {Config.root.resolve()}")
    print(f"  주소      : {scheme}://{args.host}:{args.port}")
    print()
    print("  앱에 붙여넣을 한 줄 (설정 → 원격 저장 대상 → 한 줄로 붙여넣기):")
    print(f"    {pair}")
    if shown_host == "이서버주소":
        print("    ↑ '이서버주소' 는 폰에서 닿는 실제 주소로 바꾸세요 (예: 192.168.0.5 또는 도메인).")
    print()
    if scheme == "http" and args.host not in ("127.0.0.1", "localhost"):
        print("  ⚠ 평문 HTTP 입니다. 인터넷에 노출된 서버라면 TLS 나 VPN 을 반드시 씌우세요.")
    print("  멈추려면 Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n멈춥니다.")


if __name__ == "__main__":
    main()
