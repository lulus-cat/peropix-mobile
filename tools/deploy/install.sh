#!/usr/bin/env bash
#
# PeroPix 수신함 한 줄 설치.
#
#   VPS 에 SSH 로 붙어서 이 한 줄만 붙여넣으면 끝입니다:
#
#     curl -fsSL https://raw.githubusercontent.com/lulus-cat/peropix-mobile/main/tools/deploy/install.sh | sudo bash -s -- --open
#
# 하는 일
#   1. python3 확인 (없으면 설치)
#   2. receiver.py · score.py 를 내려받아 /opt/peropix 에 놓는다
#   3. 전용 사용자 peropix 를 만든다 (root 로 안 돌린다)
#   4. 비밀번호를 만들어 /etc/peropix/token 에 넣는다 (있으면 그대로 쓴다)
#   5. systemd 서비스로 등록 — 로그아웃해도, 재부팅해도 계속 돈다
#   6. 방화벽에 포트를 연다 (ufw · firewalld · nftables 중 있는 것)
#   7. 앱에 그대로 붙여넣을 peropix:// 한 줄을 찍어 준다
#
# ★파일을 올릴 필요가 없다. 스크립트가 알아서 받는다.
# ★--open 을 안 주면 127.0.0.1 에만 붙는다. 그 컴퓨터 안에서만 열리므로, VPN 을
#   쓰거나 같은 Wi-Fi 안의 집 PC 일 때 그렇게 한다.
#
# 옵션
#   --open           인터넷에서도 접속하게 연다 (0.0.0.0 + 방화벽 열기)
#   --port 8770      포트
#   --host 1.2.3.4   앱에 찍어 줄 주소 (기본: 자동 감지)
#   --ref main       어느 가지에서 받을지
#   --dry-run        아무것도 안 고치고 무엇을 할지만 찍는다
#   --uninstall      서비스·파일을 지운다 (이미지는 남긴다)

set -euo pipefail

APP_USER=peropix
APP_DIR=/opt/peropix
CONF_DIR=/etc/peropix
DATA_DIR=/var/lib/peropix/images
UNIT=/etc/systemd/system/peropix-receiver.service
REPO=lulus-cat/peropix-mobile

PORT=8770
BIND=127.0.0.1
OPEN=0
REF=main
SHOWN_HOST=""
DRY=0
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --open) OPEN=1; BIND=0.0.0.0 ;;
    --port) PORT="${2:?--port 뒤에 번호를 적으세요}"; shift ;;
    --host) SHOWN_HOST="${2:?--host 뒤에 주소를 적으세요}"; shift ;;
    --ref) REF="${2:?--ref 뒤에 가지 이름을 적으세요}"; shift ;;
    --repo) REPO="${2:?--repo 뒤에 owner/repo 를 적으세요}"; shift ;;
    --dry-run) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,30p' "$0" 2>/dev/null || true; exit 0 ;;
    *) printf '모르는 옵션: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

RAW="https://raw.githubusercontent.com/$REPO/$REF/tools"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '     %s\n' "$*"; }
die() { printf '\n오류: %s\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then printf '     [해볼 것] %s\n' "$*"; else "$@"; fi; }

[ "$(id -u)" -eq 0 ] || [ "$DRY" = 1 ] || die "root 로 실행하세요. 앞에 sudo 를 붙이면 됩니다."

# ── 지우기 ─────────────────────────────────────────────────────────────
if [ "$UNINSTALL" = 1 ]; then
  say "지우는 중"
  run systemctl disable --now peropix-receiver || true
  run rm -f "$UNIT"
  run systemctl daemon-reload || true
  run rm -rf "$APP_DIR"
  info "서비스와 프로그램을 지웠습니다."
  info "이미지는 그대로 둡니다: $DATA_DIR"
  info "비밀번호도 그대로 둡니다: $CONF_DIR/token (다시 깔면 그대로 씁니다)"
  exit 0
fi

# ── 1. python3 ─────────────────────────────────────────────────────────
say "1/6  파이썬 확인"
if [ -r /etc/os-release ]; then . /etc/os-release; info "배포판: ${PRETTY_NAME:-알 수 없음}"; fi

if ! command -v python3 >/dev/null 2>&1; then
  info "python3 이 없습니다. 설치합니다."
  if command -v apt-get >/dev/null 2>&1; then
    run apt-get update -qq && run apt-get install -y -qq python3 curl
  elif command -v dnf >/dev/null 2>&1; then run dnf install -y -q python3 curl
  elif command -v yum >/dev/null 2>&1; then run yum install -y -q python3 curl
  elif command -v apk >/dev/null 2>&1; then run apk add --no-progress python3 curl
  else die "python3 을 직접 설치한 뒤 다시 실행하세요."
  fi
fi
if command -v python3 >/dev/null 2>&1; then
  info "python3: $(python3 --version 2>&1)"
  PYV=$(python3 -c 'import sys; print("%d%02d" % sys.version_info[:2])')
  [ "$PYV" -ge 308 ] || die "Python 3.8 이상이 필요합니다 (지금 $(python3 --version 2>&1))"
fi

# ── 2. 파일 ────────────────────────────────────────────────────────────
say "2/6  프로그램 내려받기"
# ★스크립트 옆에 파일이 있으면 그것을 쓴다. 인터넷이 막힌 서버에서도 깔 수 있게.
HERE=""
case "${BASH_SOURCE[0]:-}" in
  /*|./*|../*) HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || HERE="" ;;
esac

fetch() {   # fetch <파일이름>
  local name="$1" dest="$APP_DIR/$1" src=""
  for cand in "$HERE/$name" "$HERE/../$name"; do
    [ -n "$HERE" ] && [ -f "$cand" ] && src="$cand" && break
  done
  if [ -n "$src" ]; then
    info "$name ← 옆에 있는 파일"
    run install -m 755 "$src" "$dest"
  else
    info "$name ← $RAW/$name"
    if [ "$DRY" = 1 ]; then
      printf '     [해볼 것] curl -fsSL %s -o %s\n' "$RAW/$name" "$dest"
    else
      curl -fsSL "$RAW/$name" -o "$dest.part" || die "$name 을 못 받았습니다. 인터넷이 되는지 보세요."
      # ★받은 것이 진짜인지 본다. 404 쪽이 그대로 저장되면 서비스가 조용히 안 뜬다.
      grep -q PeroPix "$dest.part" || die "$name 을 못 받았습니다 (받은 내용이 이상합니다)."
      mv "$dest.part" "$dest"
      chmod 755 "$dest"
    fi
  fi
}

run install -d -m 755 "$APP_DIR"
fetch receiver.py
fetch score.py || info "score.py 는 없어도 됩니다 (일관성 검사용)."

# ── 3. 사용자 ──────────────────────────────────────────────────────────
say "3/6  전용 사용자"
if id "$APP_USER" >/dev/null 2>&1; then
  info "이미 있음: $APP_USER"
else
  # 로그인 못 하는 시스템 계정. 이 서비스만 돌리는 용도다.
  run useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER" 2>/dev/null \
    || run useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$APP_USER" \
    || info "사용자를 못 만들었습니다 (이미 있을 수 있습니다)."
  info "만듦: $APP_USER"
fi
run install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR"
run install -d -m 750 "$CONF_DIR"

# ── 4. 비밀번호 ────────────────────────────────────────────────────────
say "4/6  비밀번호"
TOKEN_FILE="$CONF_DIR/token"
if [ "$DRY" = 1 ]; then
  TOKEN="(dry-run)"
  info "있으면 그대로, 없으면 새로 만듭니다: $TOKEN_FILE"
elif [ -s "$TOKEN_FILE" ]; then
  # ★있으면 절대 덮어쓰지 않는다. 새로 만들면 폰에 넣어 둔 값이 조용히 무효가 된다.
  info "이미 있음 — 그대로 씁니다 ($TOKEN_FILE)"
  TOKEN="$(cat "$TOKEN_FILE")"
else
  python3 "$APP_DIR/receiver.py" --new-token > "$TOKEN_FILE"
  info "새로 만들었습니다"
  TOKEN="$(cat "$TOKEN_FILE")"
fi
run chmod 640 "$TOKEN_FILE"
run chown root:"$APP_USER" "$TOKEN_FILE"

# ── 5. 서비스 ──────────────────────────────────────────────────────────
say "5/6  서비스 등록"
if [ "$DRY" = 1 ]; then
  info "[해볼 것] $UNIT 을 쓰고 systemctl enable --now peropix-receiver"
elif ! command -v systemctl >/dev/null 2>&1; then
  info "systemd 가 없습니다. 직접 띄우세요:"
  info "  python3 $APP_DIR/receiver.py --root $DATA_DIR --host $BIND --port $PORT"
else
  cat > "$UNIT" <<EOF
[Unit]
Description=PeroPix 이미지 수신함
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
ExecStart=/usr/bin/env python3 $APP_DIR/receiver.py \\
    --root $DATA_DIR \\
    --host $BIND \\
    --port $PORT
Environment=PEROPIX_TOKEN=$TOKEN
Restart=always
RestartSec=3

# 이 서비스가 건드릴 수 있는 범위를 좁힌다.
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
  chmod 600 "$UNIT"   # 비밀번호가 들어 있으므로 root 만 읽게
  systemctl daemon-reload
  systemctl enable peropix-receiver >/dev/null 2>&1 || true
  systemctl restart peropix-receiver
  sleep 1
  if systemctl is-active --quiet peropix-receiver; then
    info "실행 중 (재부팅해도 자동으로 뜹니다)"
  else
    info "시작하지 못했습니다. 원인:"
    journalctl -u peropix-receiver -n 20 --no-pager || true
    exit 1
  fi
fi

# ── 6. 방화벽 ──────────────────────────────────────────────────────────
say "6/6  방화벽"
if [ "$OPEN" = 0 ]; then
  info "이 컴퓨터 안에서만 열려 있습니다 (127.0.0.1). 인터넷에서 쓰려면 --open 을 주세요."
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi active; then
  run ufw allow "$PORT/tcp" >/dev/null 2>&1 || true
  info "ufw 에 $PORT/tcp 를 열었습니다."
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  run firewall-cmd --permanent --add-port="$PORT/tcp" >/dev/null 2>&1 || true
  run firewall-cmd --reload >/dev/null 2>&1 || true
  info "firewalld 에 $PORT/tcp 를 열었습니다."
elif command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | grep -q 'hook input'; then
  info "nftables 규칙이 있습니다. 아래를 직접 넣으세요:"
  info "  nft add rule inet filter input tcp dport $PORT accept"
else
  info "서버 안에는 켜진 방화벽이 없습니다 (열 것이 없습니다)."
fi
if [ "$OPEN" = 1 ]; then
  info "★클라우드 업체(Contabo·AWS·Oracle 등)의 방화벽은 여기서 못 엽니다."
  info "  콘솔에서 TCP $PORT 인바운드를 따로 허용해야 할 수 있습니다."
fi

# ── 앱에 붙여넣을 한 줄 ────────────────────────────────────────────────
if [ -z "$SHOWN_HOST" ]; then
  if [ "$OPEN" = 1 ]; then
    SHOWN_HOST="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    [ -n "$SHOWN_HOST" ] || SHOWN_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
  else
    SHOWN_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  [ -n "$SHOWN_HOST" ] || SHOWN_HOST="이서버주소"
fi

cat <<EOF

────────────────────────────────────────────────────────────
설치 끝.

앱에 붙여넣을 한 줄 (설정 → 원격 저장 대상 → 한 줄로 붙여넣기):

  peropix://$SHOWN_HOST:$PORT#$TOKEN

EOF
[ "$SHOWN_HOST" = "이서버주소" ] && \
  echo "  ↑ '이서버주소' 는 폰에서 닿는 실제 주소로 바꾸세요."
if [ "$OPEN" = 1 ]; then
cat <<'EOF'
⚠ 평문 HTTP 입니다. 이미지와 비밀번호가 암호화 없이 오갑니다.
  집 안 PC 면 그대로 써도 됩니다. 인터넷에 열린 VPS 라면
  Caddy·nginx 로 TLS 를 씌우거나 VPN 안에서만 여세요.
EOF
fi
cat <<EOF

자주 쓰는 명령
  상태 : systemctl status peropix-receiver
  기록 : journalctl -u peropix-receiver -f
  재시작: systemctl restart peropix-receiver
  지우기: curl -fsSL $RAW/deploy/install.sh | sudo bash -s -- --uninstall
  이미지: $DATA_DIR
────────────────────────────────────────────────────────────
EOF
