#!/usr/bin/env bash
#
# PeroPix 수신함을 VPS(Contabo 등 리눅스)에 상시 실행으로 설치한다.
#
#   sudo bash install.sh
#
# 하는 일
#   1. 전용 사용자 peropix 를 만든다 (root 로 돌리지 않는다)
#   2. receiver.py 를 /opt/peropix 에 놓는다
#   3. 토큰을 만들어 /etc/peropix/token 에 저장한다 (없을 때만)
#   4. systemd 서비스로 등록해 재부팅해도 자동으로 뜨게 한다
#
# ★기본은 127.0.0.1 (VPS 안에서만). 바깥에서 바로 쓰려면:
#     sudo bash install.sh --open
#   이러면 0.0.0.0 에 붙어 인터넷에서 닿는다. 단 평문이므로 이미지와 토큰이
#   암호화 없이 오간다 — 그래도 괜찮을 때만 쓸 것.
#   암호화를 원하면 DEPLOY.md 의 「바깥에서 닿게 하기」 를 볼 것.

set -euo pipefail

APP_USER=peropix
APP_DIR=/opt/peropix
CONF_DIR=/etc/peropix
DATA_DIR=/var/lib/peropix/images
PORT=8770
UNIT=/etc/systemd/system/peropix-receiver.service
# --open 을 주면 바깥에 연다 (평문). 기본은 이 서버 안에서만.
BIND=127.0.0.1
[ "${1:-}" = "--open" ] && BIND=0.0.0.0

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n오류: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root 로 실행하세요:  sudo bash install.sh"

# receiver.py 는 이 스크립트 옆에 있어도 되고, 한 단계 위에 있어도 된다.
# ★올릴 파일을 둘로 줄이려고 이렇게 둔다 — tools/ 를 통째로 올리면 검사용 파일까지 딸려 온다.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC=""
for cand in "$HERE/receiver.py" "$HERE/../receiver.py"; do
  [ -f "$cand" ] && SRC="$(cd "$(dirname "$cand")" && pwd)/receiver.py" && break
done
[ -n "$SRC" ] || die "receiver.py 를 찾지 못했습니다.
       install.sh 와 같은 폴더에 receiver.py 를 함께 올려 주세요."

# ── 배포판 판별 ────────────────────────────────────────────────────────
say "1/5  시스템 확인"
if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "     배포판: ${PRETTY_NAME:-알 수 없음}"
fi

if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG=yum
else
  PKG=none
  echo "     경고: 아는 패키지 관리자가 없습니다. python3 가 이미 있어야 합니다."
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "     python3 설치 중…"
  case "$PKG" in
    apt) apt-get update -qq && apt-get install -y -qq python3 ;;
    dnf) dnf install -y -q python3 ;;
    yum) yum install -y -q python3 ;;
    *)   die "python3 를 직접 설치한 뒤 다시 실행하세요." ;;
  esac
fi
echo "     python3: $(python3 --version)"

PYV=$(python3 -c 'import sys; print("%d%02d" % sys.version_info[:2])')
[ "$PYV" -ge 308 ] || die "Python 3.8 이상이 필요합니다 (현재 $(python3 --version))"

# ── 사용자 ─────────────────────────────────────────────────────────────
say "2/5  전용 사용자"
if id "$APP_USER" >/dev/null 2>&1; then
  echo "     이미 있음: $APP_USER"
else
  # 로그인 못 하는 시스템 계정으로 만든다 — 이 서비스만 돌리는 용도다.
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER" 2>/dev/null \
    || useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$APP_USER"
  echo "     만듦: $APP_USER"
fi

# ── 파일 배치 ──────────────────────────────────────────────────────────
say "3/5  파일 배치"
install -d -m 755 "$APP_DIR"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR"
install -d -m 750 "$CONF_DIR"
install -m 755 "$SRC" "$APP_DIR/receiver.py"
echo "     프로그램  : $APP_DIR/receiver.py"
echo "     이미지    : $DATA_DIR"

# ── 토큰 ───────────────────────────────────────────────────────────────
say "4/5  토큰"
TOKEN_FILE="$CONF_DIR/token"
if [ -s "$TOKEN_FILE" ]; then
  # ★있으면 절대 덮어쓰지 않는다. 새로 만들면 폰에 넣어둔 값이 조용히 무효가 된다.
  echo "     이미 있음 — 그대로 씁니다 ($TOKEN_FILE)"
else
  python3 "$APP_DIR/receiver.py" --new-token > "$TOKEN_FILE"
  echo "     새로 만듦"
fi
chmod 640 "$TOKEN_FILE"
chown root:"$APP_USER" "$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"

# ── systemd ────────────────────────────────────────────────────────────
say "5/5  서비스 등록"
cat > "$UNIT" <<EOF
[Unit]
Description=PeroPix 이미지 수신함
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
# 바인드 주소 — 기본은 127.0.0.1, --open 을 주면 0.0.0.0.
ExecStart=/usr/bin/env python3 $APP_DIR/receiver.py \\
    --root $DATA_DIR \\
    --host $BIND \\
    --port $PORT
Environment=PEROPIX_TOKEN=$TOKEN
Restart=always
RestartSec=3

# 안전장치 — 이 서비스가 건드릴 수 있는 범위를 좁힌다.
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
chmod 600 "$UNIT"   # 토큰이 들어 있으므로 root 만 읽게 한다

systemctl daemon-reload
systemctl enable --now peropix-receiver >/dev/null 2>&1 || systemctl enable peropix-receiver
systemctl restart peropix-receiver
sleep 1

if systemctl is-active --quiet peropix-receiver; then
  echo "     실행 중"
else
  echo "     시작하지 못했습니다. 아래로 원인을 보세요:"
  echo "       journalctl -u peropix-receiver -n 30 --no-pager"
  exit 1
fi

# ── 확인 ───────────────────────────────────────────────────────────────
say "동작 확인"
if command -v curl >/dev/null 2>&1; then
  if curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/ping"; then
    echo
    echo "     정상"
  else
    echo "     응답이 없습니다 — journalctl -u peropix-receiver -n 30 --no-pager"
  fi
fi

cat <<EOF

────────────────────────────────────────────────────────────
설치 끝. 앱에 넣을 토큰:

  $TOKEN

바인드: $BIND

자주 쓰는 명령
  상태 보기 : systemctl status peropix-receiver
  기록 보기 : journalctl -u peropix-receiver -f
  다시 시작 : systemctl restart peropix-receiver
  이미지 위치: $DATA_DIR
────────────────────────────────────────────────────────────
EOF
