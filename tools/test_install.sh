#!/usr/bin/env bash
# 한 줄 설치 스크립트 검사.
#
# ★여기가 틀리면 사람이 자기 서버에 sudo 로 돌린다. 조용히 반쪽만 깔리거나,
#   받다 만 파일이 서비스로 등록되는 것이 제일 나쁘다.
# 사용: bash tools/test_install.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SH_FILE="$HERE/deploy/install.sh"
pass=0
fails=()

check() { if [ "$2" = 1 ]; then pass=$((pass+1)); else fails+=("$1${3:+  [$3]}"); fi; }
has()   { case "$1" in *"$2"*) echo 1 ;; *) echo 0 ;; esac; }

# ── 1. 문법 ────────────────────────────────────────────────────────────
bash -n "$SH_FILE" 2>/dev/null && check "문법이 맞는다" 1 || check "문법이 맞는다" 0

# ── 2. 옵션 ────────────────────────────────────────────────────────────
out="$(bash "$SH_FILE" --dry-run 2>&1)"
check "그냥 돌리면 서버 안에서만 연다" "$(has "$out" '127.0.0.1')" "$(echo "$out" | tail -3)"

out="$(bash "$SH_FILE" --dry-run --open --host 1.2.3.4 --port 9999 2>&1)"
check "★앱에 붙여넣을 한 줄을 찍어 준다" "$(has "$out" 'peropix://1.2.3.4:9999#')" \
  "$(echo "$out" | grep peropix:// || true)"
check "★평문이면 경고한다 (인터넷에 그냥 열면 비밀번호가 샌다)" "$(has "$out" '평문 HTTP')"
check "클라우드 방화벽은 못 연다고 말한다" "$(has "$out" '클라우드 업체')"
check "지우는 방법도 알려 준다" "$(has "$out" 'uninstall')"

# ★모르는 옵션을 조용히 넘기면 안 된다. --opne 오타로 열리지도 않은 채
#   "다 됐다" 는 화면만 보게 된다.
bash "$SH_FILE" --dry-run --opne >/dev/null 2>&1
check "★모르는 옵션은 거절한다" "$([ $? -ne 0 ] && echo 1 || echo 0)"

out="$(bash "$SH_FILE" --dry-run --uninstall 2>&1)"
check "지우기는 지우기만 한다" "$(has "$out" '지웠습니다')"
check "★지워도 이미지는 남긴다" "$(has "$out" '이미지는 그대로')"
check "★지워도 비밀번호는 남긴다 (다시 깔면 폰 설정이 그대로 산다)" \
  "$(has "$out" '비밀번호도 그대로')"

# ── 3. 안전장치 ────────────────────────────────────────────────────────
body="$(cat "$SH_FILE")"
check "★받은 파일이 진짜인지 본다 (404 쪽이 저장되면 서비스가 조용히 안 뜬다)" \
  "$(has "$body" 'grep -q PeroPix')"
check "★임시 이름으로 받아 옮긴다 (중간에 끊겨도 반쪽 파일이 안 남는다)" \
  "$(has "$body" '.part')"
check "★비밀번호가 있으면 덮어쓰지 않는다" "$(has "$body" '절대 덮어쓰지 않는다')"
check "★서비스 파일은 root 만 읽는다 (비밀번호가 들어 있다)" "$(has "$body" 'chmod 600 "$UNIT"')"
check "root 로 안 돌린다" "$(has "$body" 'User=$APP_USER')"
check "재부팅해도 뜬다" "$(has "$body" 'WantedBy=multi-user.target')"
check "죽으면 다시 뜬다" "$(has "$body" 'Restart=always')"
check "건드릴 수 있는 폴더를 좁힌다" "$(has "$body" 'ReadWritePaths=$DATA_DIR')"
check "★루트 권한 없이 실수로 돌리면 막는다" "$(has "$body" 'root 로 실행하세요')"

# ── 4. 실제로 받아지는가 ───────────────────────────────────────────────
# ★스크립트가 파일을 못 받으면 아무것도 안 된다. 주소가 살아 있는지 진짜로 본다.
RAW=https://raw.githubusercontent.com/lulus-cat/peropix-mobile/main/tools
if curl -fsS --max-time 10 "$RAW/receiver.py" -o /tmp/_rx.py 2>/dev/null; then
  check "★receiver.py 가 그 주소에 실제로 있다" "$(has "$(head -c 200 /tmp/_rx.py)" 'PeroPix')"
  curl -fsS --max-time 10 "$RAW/score.py" -o /tmp/_sc.py 2>/dev/null \
    && check "score.py 도 있다" "$(has "$(head -c 200 /tmp/_sc.py)" 'PeroPix')" \
    || check "score.py 도 있다" 0
  rm -f /tmp/_rx.py /tmp/_sc.py
else
  echo "  (인터넷이 안 되어 내려받기 검사는 건너뜁니다)"
fi

total=$((pass + ${#fails[@]}))
echo "설치 스크립트 검사 ${total}건 — 통과 ${pass}건, 실패 ${#fails[@]}건"
for f in "${fails[@]}"; do echo "  ▸ $f"; done
[ ${#fails[@]} -eq 0 ]
