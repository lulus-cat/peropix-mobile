#!/usr/bin/env python3
"""수신함에 「이거 뽑으세요」 를 올리고, 결과를 확인한다.

Claude Code 나 PC 에서 쓰는 쪽이다. **키도 Anlas 도 여기서는 쓰지 않는다** —
올라간 지시를 폰 앱이 받아 가서 뽑고, 결과를 같은 수신함에 올린다.

    python tools/job.py push  --url 192.168.0.5:8770 --token ... --file 작업.json
    python tools/job.py list  --url ... --token ...
    python tools/job.py watch --url ... --token ... --id 20260822-...
    python tools/job.py files --url ... --token ... --prefix 미아/

작업 JSON 은 PeroFix 가져오기와 같은 모양이다 (거기에 옵션만 얹는다):

    {
      "name": "미아 · 일상 4장",
      "folder": "미아",
      "prefix": "1girl, silver hair",
      "slots":  [{ "name": "1-1", "content": "smile, bedroom" }],
      "characters": [{ "name": "미아", "content": "1girl, silver hair" }],
      "options": { "count_per_slot": 1, "one_char_mode": false, "transparent_bg": true }
    }

★주소는 `192.168.0.5:8770` 처럼 적는다. https:// 를 붙이면 그대로 쓴다.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def base_url(raw: str) -> str:
    raw = (raw or "").strip().rstrip("/")
    if not raw:
        raise SystemExit("주소가 필요합니다 (예: 192.168.0.5:8770)")
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    return "http://" + raw


def call(url: str, token: str, path: str, payload=None):
    req = urllib.request.Request(url + path, method="POST" if payload is not None else "GET",
                                 data=json.dumps(payload).encode("utf-8") if payload is not None else None)
    req.add_header("Authorization", "Bearer " + token)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        raise SystemExit(f"수신함이 거절했습니다 ({e.code}): {body.get('error')}")
    except urllib.error.URLError as e:
        raise SystemExit(f"수신함에 닿지 못했습니다: {e.reason}")


def cmd_push(a):
    raw = sys.stdin.read() if a.file == "-" else open(a.file, encoding="utf-8").read()
    spec = json.loads(raw)
    name = a.name or spec.get("name") or "작업"
    out = call(base_url(a.url), a.token, "/jobs", {"name": name, "spec": spec})
    job = out.get("job", {})
    print(f"올렸습니다: {job.get('id')}  ({job.get('name')})")
    print("폰 앱에서 「원격 작업」 을 열면 받아 갑니다.")


def cmd_list(a):
    q = "/jobs" + (("?status=" + urllib.parse.quote(a.status)) if a.status else "")
    out = call(base_url(a.url), a.token, q)
    jobs = out.get("jobs", [])
    if not jobs:
        print("작업이 없습니다.")
        return
    for j in jobs:
        p = j.get("progress") or {}
        line = f"{j.get('id')}  {j.get('status'):9s}  {j.get('name')}"
        if p.get("total"):
            line += f"  [{p.get('done')}/{p.get('total')}]"
        if j.get("error"):
            line += f"  ⚠ {j['error']}"
        print(line)


def cmd_watch(a):
    url = base_url(a.url)
    last = None
    while True:
        out = call(url, a.token, "/jobs")
        job = next((j for j in out.get("jobs", []) if j.get("id") == a.id), None)
        if not job:
            raise SystemExit("그런 작업이 없습니다: " + a.id)
        p = job.get("progress") or {}
        now = f"{job.get('status')} {p.get('done', 0)}/{p.get('total', 0)}"
        if now != last:
            print(now + ("  ⚠ " + job["error"] if job.get("error") else ""))
            last = now
        if job.get("status") in ("done", "failed", "cancelled"):
            for f in job.get("files", []):
                print("  ·", f)
            return
        time.sleep(a.every)


def cmd_files(a):
    q = "/list" + (("?prefix=" + urllib.parse.quote(a.prefix)) if a.prefix else "")
    out = call(base_url(a.url), a.token, q)
    for f in out.get("files", []):
        print(f"{f['size']:>9}  {f['path']}")
    print(f"— {out.get('count', 0)}건")


def main():
    ap = argparse.ArgumentParser(description="수신함 작업 큐")
    ap.add_argument("--url", required=True, help="수신함 주소 (예: 192.168.0.5:8770)")
    ap.add_argument("--token", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("push", help="작업 올리기")
    p.add_argument("--file", required=True, help="작업 JSON 파일 (- 는 표준입력)")
    p.add_argument("--name")
    p.set_defaults(fn=cmd_push)

    p = sub.add_parser("list", help="작업 목록")
    p.add_argument("--status", help="pending / running / done / failed / cancelled")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("watch", help="한 작업이 끝날 때까지 지켜보기")
    p.add_argument("--id", required=True)
    p.add_argument("--every", type=float, default=5.0)
    p.set_defaults(fn=cmd_watch)

    p = sub.add_parser("files", help="수신함에 쌓인 그림 목록")
    p.add_argument("--prefix", default="")
    p.set_defaults(fn=cmd_files)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
