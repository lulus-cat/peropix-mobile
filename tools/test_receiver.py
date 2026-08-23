"""수신함 검사 — 특히 경로 탈출 차단.

경로 검사가 뚫리면 서버의 아무 파일이나 덮어쓸 수 있다. 여기를 제일 세게 본다.

사용: python mobile/tools/test_receiver.py
"""

import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import base64
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import receiver  # noqa: E402

TOKEN = "test-token-abcdefghijklmnop"
PORT = 8791
ROOT = Path(tempfile.mkdtemp(prefix="peropix_rx_"))

fails = []
passed = 0


def check(why, cond):
    global passed
    if cond:
        passed += 1
    else:
        fails.append(why)


# ── 1. 경로 검사 (단위) ───────────────────────────────────────────────
receiver.Config.root = ROOT
receiver.Config.token = TOKEN

BLOCKED = [
    ("상위로 탈출", "../evil.png"),
    ("깊은 탈출", "a/../../evil.png"),
    ("절대 경로(유닉스)", "/etc/passwd.png"),
    ("절대 경로(윈도우)", "C:/Windows/evil.png"),
    ("백슬래시 탈출", "..\\..\\evil.png"),
    ("URL 인코딩 탈출", "%2e%2e/evil.png"),
    ("빈 경로", ""),
    ("실행 파일 확장자", "a/evil.exe"),
    ("확장자 없음", "a/evil"),
    ("콜론 포함", "a/ev:il.png"),
    ("너무 깊음", "/".join(["d"] * 9) + "/x.png"),
]
for why, raw in BLOCKED:
    dest, err = receiver.safe_relpath(raw)
    check(f"차단해야 함 — {why}: {raw!r} (결과 {dest})", dest is None and err)

ALLOWED = [
    ("기본", "미아/happy.png"),
    ("좌표 하이픈", "미아/1-3.png"),
    ("중첩 폴더", "작품/미아/happy.png"),
    ("webp", "미아/happy.webp"),
    ("점이 든 이름", "미아/happy.v2.png"),
]
for why, raw in ALLOWED:
    dest, err = receiver.safe_relpath(raw)
    ok = dest is not None and err is None and ROOT.resolve() in dest.parents
    check(f"허용해야 함 — {why}: {raw!r} (오류: {err})", ok)


# ── 2. 실제 서버 (통합) ───────────────────────────────────────────────
httpd = receiver.ThreadingHTTPServer(("127.0.0.1", PORT), receiver.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.3)

BASE = f"http://127.0.0.1:{PORT}"
PNG = bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 64  # PNG 시그니처 + 더미


def enc_path(raw):
    """X-Path 규약: 조각마다 퍼센트 인코딩 후 "/" 로 잇는다.
    ★HTTP 헤더는 latin-1 만 담는다 — 한글을 날것으로 넣으면 전송이 실패한다."""
    return "/".join(urllib.parse.quote(seg, safe="") for seg in raw.split("/"))


def req(method, path, data=None, token=TOKEN, xpath=None, raw_xpath=None):
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if token:
        r.add_header("Authorization", "Bearer " + token)
    if raw_xpath is not None:
        r.add_header("X-Path", raw_xpath)
    elif xpath:
        r.add_header("X-Path", enc_path(xpath))
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}


status, body = req("GET", "/ping")
check(f"인증되면 ping 성공 (받은 {status})", status == 200 and body.get("ok"))

status, _ = req("GET", "/ping", token="wrong-token-xxxxxxxxxxxx")
check(f"틀린 토큰은 401 (받은 {status})", status == 401)

status, _ = req("GET", "/ping", token=None)
check(f"토큰 없으면 401 (받은 {status})", status == 401)

status, body = req("POST", "/upload", data=PNG, xpath="미아/happy.png")
check(f"업로드 성공 (받은 {status} {body})", status == 200 and body.get("ok"))
check("파일이 실제로 생겼는지", (ROOT / "미아" / "happy.png").exists())

# 같은 이름을 또 보내면 덮어쓰지 않고 비켜야 한다
status, body = req("POST", "/upload", data=PNG, xpath="미아/happy.png")
check(f"겹치면 _2 로 비킴 (받은 {body.get('path')})", body.get("path") == "미아/happy_2.png")

status, body = req("POST", "/upload", data=PNG, raw_xpath="..%2Fevil.png")
check(f"탈출 경로 업로드는 400 (받은 {status})", status == 400)
check("서버 밖에 파일이 생기지 않았는지", not (ROOT.parent / "evil.png").exists())

status, _ = req("POST", "/upload", data=PNG, xpath="미아/x.png", token="wrong-token-xxxxxxxxxxxx")
check(f"틀린 토큰 업로드는 401 (받은 {status})", status == 401)

status, body = req("POST", "/upload", data=PNG, xpath="작품/미아/1-3.png")
check(f"한글+좌표 경로 왕복 (받은 {body.get('path')})", body.get("path") == "작품/미아/1-3.png")
check("중첩 폴더가 실제로 생겼는지", (ROOT / "작품" / "미아" / "1-3.png").exists())

# ── JSON+base64 모드 (앱이 쓰는 방식) ──────────────────────────────
def req_json(path_rel, blob=PNG, token=TOKEN):
    payload = json.dumps({"path": path_rel,
                          "data": base64.b64encode(blob).decode("ascii")}).encode("utf-8")
    r = urllib.request.Request(BASE + "/upload", data=payload, method="POST")
    r.add_header("Authorization", "Bearer " + token)
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


status, body = req_json("미아/json모드.png")
check(f"JSON 모드 업로드 (받은 {status} {body})", status == 200 and body.get("ok"))
check("JSON 모드로 한글 경로 저장", (ROOT / "미아" / "json모드.png").exists())

status, body = req_json("../evil.png")
check(f"JSON 모드도 탈출 차단 (받은 {status})", status == 400)

status, body = req_json("미아/x.png", token="wrong-token-xxxxxxxxxxxx")
check(f"JSON 모드도 토큰 검사 (받은 {status})", status == 401)

status, body = req("GET", "/list")
check(f"목록 조회 (받은 {body.get('count')}건)", status == 200 and body.get("count") == 4)


# ── 폴더 관리 ────────────────────────────────────────────────────────
def op(endpoint, payload, token=TOKEN):
    body = json.dumps(payload).encode("utf-8")
    r = urllib.request.Request(BASE + endpoint, data=body, method="POST")
    r.add_header("Authorization", "Bearer " + token)
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def browse(path=""):
    q = "/browse?path=" + urllib.parse.quote(path, safe="")
    r = urllib.request.Request(BASE + q)
    r.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(r, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


# 폴더 만들기
status, body = op("/mkdir", {"path": "새폴더/하위"})
check(f"폴더 만들기 (받은 {status} {body})", status == 200 and body.get("ok"))
check("실제로 생겼는지", (ROOT / "새폴더" / "하위").is_dir())

status, body = op("/mkdir", {"path": "새폴더/하위"})
check(f"이미 있으면 409 (받은 {status})", status == 409)

status, body = op("/mkdir", {"path": "../탈출폴더"})
check(f"탈출 경로 폴더 생성 차단 (받은 {status})", status == 400)
check("바깥에 폴더가 안 생겼는지", not (ROOT.parent / "탈출폴더").exists())

# 훑어보기
b = browse("")
check(f"루트 훑어보기 (폴더 {len(b['dirs'])}개)", b["ok"] and any(d["name"] == "미아" for d in b["dirs"]))
mia = [d for d in b["dirs"] if d["name"] == "미아"][0]
check(f"폴더 안 파일 수를 함께 알려주는지 (미아={mia['count']})", mia["count"] >= 2)

b = browse("미아")
check(f"하위 훑어보기 (파일 {len(b['files'])}개)", b["ok"] and len(b["files"]) >= 2)

# 이름 바꾸기
status, body = op("/rename", {"from": "새폴더", "to": "바뀐폴더"})
check(f"폴더 이름 바꾸기 (받은 {status})", status == 200)
check("바뀐 이름이 실제로", (ROOT / "바뀐폴더").is_dir() and not (ROOT / "새폴더").exists())

status, body = op("/rename", {"from": "바뀐폴더", "to": "../탈출"})
check(f"탈출 경로로 이름 바꾸기 차단 (받은 {status})", status == 400)

status, body = op("/rename", {"from": "바뀐폴더", "to": "바뀐폴더/자기하위"})
check(f"자기 하위로 옮기기 차단 (받은 {status})", status == 400)

status, body = op("/rename", {"from": "없는거", "to": "아무거나"})
check(f"없는 원본은 404 (받은 {status})", status == 404)

# 지우기
status, body = op("/delete", {"path": "미아"})
check(f"비어 있지 않은 폴더는 확인 요구 (받은 {status})",
      status == 409 and body.get("needs_confirm"))
check("확인 전에는 지워지지 않았는지", (ROOT / "미아").is_dir())

status, body = op("/delete", {"path": "바뀐폴더/하위"})
check(f"빈 폴더는 바로 지워짐 (받은 {status})", status == 200)

status, body = op("/delete", {"path": "미아", "recursive": True})
check(f"확인하면 지워짐 (받은 {status} {body})", status == 200 and body.get("ok"))
check("실제로 지워졌는지", not (ROOT / "미아").exists())

status, body = op("/delete", {"path": ""})
check(f"루트 자체는 못 지움 (받은 {status})", status == 400)
check("루트가 살아 있는지", ROOT.exists())

status, body = op("/mkdir", {"path": "x"}, token="wrong-token-xxxxxxxxxxxx")
check(f"폴더 조작도 토큰 검사 (받은 {status})", status == 401)

# ── 5. 작업 큐 ────────────────────────────────────────────────────────
def get(endpoint):
    return req("GET", endpoint)


# ★여기가 뚫리면 남이 「이거 뽑으세요」 를 밀어 넣어 폰의 Anlas 를 태울 수 있다.
status, body = op("/jobs", {"name": "미아 일상", "spec": {"prefix": "1girl", "slots": [{"name": "1-1"}]}},
                  token="wrong-token-xxxxxxxxxxxx")
check(f"작업 올리기도 토큰 검사 (받은 {status})", status == 401)

status, body = op("/jobs", {"name": "미아 일상", "spec": {"prefix": "1girl", "slots": [{"name": "1-1"}]}})
check(f"작업을 올릴 수 있다 (받은 {status})", status == 200 and body.get("ok"))
job_id = (body.get("job") or {}).get("id", "")
check(f"작업 id 를 돌려준다 ({job_id})", bool(job_id))
check("올린 작업은 pending", (body.get("job") or {}).get("status") == "pending")

status, body = op("/jobs", {"name": "spec 없음"})
check(f"spec 이 없으면 거절 (받은 {status})", status == 400)

status, body = get("/jobs")
check(f"목록을 볼 수 있다 (받은 {status})", status == 200 and body.get("count") == 1)
status, body = get("/jobs?status=done")
check("상태로 걸러 볼 수 있다", status == 200 and body.get("count") == 0)

# ★.jobs 는 그림 목록에 섞이면 안 된다 (매트릭스 채움 셈이 틀어진다).
status, body = get("/list")
check("작업 파일은 그림 목록에 안 섞인다",
      all(".jobs" not in f["path"] for f in body.get("files", [])))
status, body = get("/browse?path=")
check("작업 폴더는 폴더 화면에도 안 보인다",
      all(d["name"] != ".jobs" for d in body.get("dirs", [])))

# 집어 가기 — 두 번째로 부르면 없어야 한다 (같은 작업을 두 번 뽑으면 돈이 두 배로 나간다)
status, body = op("/jobs/claim", {})
claimed = body.get("job") or {}
check(f"기다리는 작업을 집어 준다 (받은 {status})", status == 200 and claimed.get("id") == job_id)
check("집는 순간 running 이 된다", claimed.get("status") == "running")
status, body = op("/jobs/claim", {})
check("★같은 작업을 두 번 집어 주지 않는다", status == 200 and body.get("job") is None)

# 진행·결과 알리기
status, body = op("/jobs/update", {"id": job_id, "progress": {"done": 1, "total": 4}})
check(f"진행을 알릴 수 있다 (받은 {status})", status == 200
      and (body.get("job") or {}).get("progress", {}).get("done") == 1)
status, body = op("/jobs/update", {"id": job_id, "status": "done", "files": ["미아/1-1.png"]})
check("끝났다고 알릴 수 있다", status == 200 and (body.get("job") or {}).get("status") == "done")
check("저장한 파일 목록이 남는다", (body.get("job") or {}).get("files") == ["미아/1-1.png"])

status, body = op("/jobs/update", {"id": job_id, "status": "이상한상태"})
check(f"모르는 상태는 거절 (받은 {status})", status == 400)
status, body = op("/jobs/update", {"id": "../../etc/passwd", "status": "done"})
check(f"★작업 id 로 경로 탈출을 못 한다 (받은 {status})", status == 404)
status, body = op("/jobs/update", {"id": "없는작업", "status": "done"})
check(f"없는 작업은 404 (받은 {status})", status == 404)

status, body = op("/jobs/delete", {"id": job_id})
check(f"작업을 지울 수 있다 (받은 {status})", status == 200)
status, body = get("/jobs")
check("지우면 목록에서 빠진다", body.get("count") == 0)

# ── 비밀번호 ────────────────────────────────────────────────────────────
# ★한글 비밀번호를 받아 주면 「받는 쪽은 잘 떴는데 폰에서만 안 되는」 상태가 된다.
#   HTTP 헤더(Authorization)에는 latin-1 밖에 안 실려서 앱이 보내기도 전에 막힌다.
check("영문·숫자 16자는 받는다", receiver.token_ok("abcdefghijklmnop"))
check("기호도 받는다", receiver.token_ok("my-vps-password-1"))
check("★한글 비밀번호는 막는다 (HTTP 헤더에 안 실려 폰에서만 안 되게 된다)",
      not receiver.token_ok("우리집고양이이름은나비입니다"))
check("★탭·줄바꿈도 막는다", not receiver.token_ok("tab\there-is-bad!!"))
check("15자는 짧다", not receiver.token_ok("abcdefghijklmno"))
check("빈 값은 안 된다", not receiver.token_ok(""))

# 「토큰 만들기」 단계를 없앤 부분 — 만들어 둔 비밀번호가 남에게 보이면 안 된다.
auto = ROOT / "자동비번시험"
auto.mkdir(parents=True, exist_ok=True)
made = auto / receiver.TOKEN_FILE
tok = "abcdefghijklmnopqrstuvwxyz012345"
made.write_text(tok, encoding="utf-8")
os.chmod(made, 0o600)
check("★만들어 둔 비밀번호는 파일 목록에 안 나온다 (점으로 시작한다)",
      not receiver._visible(receiver.TOKEN_FILE))
check("만들어 두는 비밀번호는 규칙을 통과한다", receiver.token_ok(tok))
check("★남이 못 읽게 둔다 (0600)", oct(made.stat().st_mode)[-3:] == "600")
check("다시 켜면 그대로 읽어 쓴다", made.read_text(encoding="utf-8").strip() == tok)
shutil.rmtree(auto, ignore_errors=True)

httpd.shutdown()
shutil.rmtree(ROOT, ignore_errors=True)

total = passed + len(fails)
print(f"수신함 검사 {total}건 — 통과 {passed}건, 실패 {len(fails)}건")
for f in fails:
    print("  ▸", f)
sys.exit(1 if fails else 0)
