# VPS 에 수신함 올리기 (Contabo · 리눅스)

폰에서 생성한 이미지를 VPS 로 바로 보내려면 VPS 에 **수신함**을 띄워야 합니다.
아래 순서대로만 하면 됩니다. 명령은 전부 복사해서 붙여넣으면 됩니다.

---

## 0. 먼저 확인할 것

VPS 에 접속합니다. Contabo 가 메일로 보내준 IP 와 root 비밀번호를 씁니다.

```bash
ssh root@내VPS주소
```

접속되면 배포판을 확인합니다.

```bash
cat /etc/os-release | head -3
```

Ubuntu 든 Debian 이든 AlmaLinux 든 상관없습니다 — 설치 스크립트가 알아서 맞춥니다.
확인만 해 두고 넘어가세요.

---

## 1. 파일 올리기

**내 PC 에서** (VPS 가 아니라 PC 에서 실행합니다):

```bash
scp -r mobile/tools root@내VPS주소:/root/peropix-tools
```

비밀번호를 물으면 Contabo 비밀번호를 넣습니다.

---

## 2. 설치

다시 **VPS 에서**:

```bash
sudo bash /root/peropix-tools/deploy/install.sh
```

끝나면 화면에 **토큰**이 찍힙니다. 이 값을 앱 설정의 「토큰」 칸에 넣습니다.
지금 복사해 두세요 (나중에 다시 보려면 `sudo cat /etc/peropix/token`).

이 시점에서 수신함은 **VPS 안에서만** 닿습니다. 바깥에서는 아직 못 씁니다.
일부러 그렇게 해 둔 것입니다 — 암호화 없이 인터넷에 열리는 사고를 막기 위해서입니다.

---

## 3. 바깥에서 닿게 하기

두 가지 중 하나를 고릅니다.

| | 방법 A — Tailscale | 방법 B — 도메인 + Caddy |
|---|---|---|
| 도메인 | **필요 없음** | 필요함 |
| 폰에 앱 설치 | Tailscale 앱 필요 | 없음 |
| 인터넷 노출 | 없음 (내 기기끼리만) | 있음 (토큰이 유일한 방어) |
| 난이도 | 쉬움 | 보통 |

도메인이 없으시면 **A 를 쓰세요.** 더 쉽고 더 안전합니다.

---

### 방법 A — Tailscale (도메인 없이, 권장)

내 기기들(폰·PC·VPS)만 서로 보이는 사설망을 만듭니다. 인터넷에는 아무것도 열리지 않습니다.

**VPS 에서:**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

(Tailscale 공식 설치 스크립트입니다.)

```bash
sudo tailscale up
```

화면에 링크가 뜹니다. 그 링크를 열어 로그인하면 이 VPS 가 내 사설망에 들어옵니다.

이제 수신함을 사설망에 붙입니다. **인증서를 알아서 받아 주므로 HTTPS 가 됩니다.**

```bash
sudo tailscale serve --bg 8770
```

주소를 확인합니다:

```bash
sudo tailscale serve status
```

`https://무언가.ts.net` 형태의 주소가 나옵니다. **이것을 앱에 넣습니다.**

**폰에서:** Play 스토어에서 Tailscale 앱을 받아 같은 계정으로 로그인하면 끝입니다.
이후 앱의 저장 위치에 위 주소와 토큰을 넣으면 바로 연결됩니다.

---

### 방법 B — 도메인 + Caddy

도메인이 있고, 폰에 따로 앱을 깔기 싫을 때 씁니다.

**1) 도메인의 A 레코드를 VPS IP 로 지정합니다.** (도메인 산 곳의 DNS 설정)

**2) Caddy 설치** — Ubuntu·Debian 기준:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
```

```bash
sudo apt update && sudo apt install -y caddy
```

AlmaLinux·Rocky 라면 대신:

```bash
sudo dnf install -y 'dnf-command(copr)' && sudo dnf copr enable -y @caddy/caddy && sudo dnf install -y caddy
```

**3) 설정** — `/etc/caddy/Caddyfile` 을 이렇게 만듭니다:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
img.내도메인.com {
    reverse_proxy 127.0.0.1:8770
}
EOF
```

`img.내도메인.com` 은 실제 도메인으로 바꾸세요.

```bash
sudo systemctl restart caddy
```

Caddy 가 Let's Encrypt 인증서를 자동으로 받아 갱신합니다.

**4) 방화벽 열기** — 80·443 만 엽니다.

```bash
sudo ufw allow 80,443/tcp && sudo ufw --force enable
```

방화벽이 firewalld 라면:

```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

**★8770 은 절대 열지 마세요.** 수신함은 127.0.0.1 에만 붙어 있고, 바깥 통신은 Caddy 가
암호화해서 넘겨줍니다. 8770 을 직접 열면 그 암호화를 건너뛰게 됩니다.

앱에는 `https://img.내도메인.com` 을 넣습니다.

---

## 4. 앱에 등록

1. 앱 → 우측 상단 ⚙ → 「원격 저장 대상」 → **+ 추가**
2. **이름**: `VPS` (아무거나)
3. **주소**: 방법 A 면 `https://무언가.ts.net`, 방법 B 면 `https://img.내도메인.com`
4. **토큰**: 2번에서 복사해 둔 값
5. **연결 확인** 을 눌러 「연결됨」 이 뜨면 됩니다

메인 화면 「저장 위치와 이름」 에서 저장 위치를 `VPS` 로 바꾸면 이후 생성물이 그쪽으로 갑니다.

---

## 자주 쓰는 명령

| 하고 싶은 것 | 명령 |
|---|---|
| 잘 돌고 있나 | `systemctl status peropix-receiver` |
| 무슨 일이 있었나 | `journalctl -u peropix-receiver -f` |
| 다시 시작 | `sudo systemctl restart peropix-receiver` |
| 토큰 다시 보기 | `sudo cat /etc/peropix/token` |
| 이미지 어디 있나 | `/var/lib/peropix/images` |
| 몇 장 쌓였나 | `find /var/lib/peropix/images -type f \| wc -l` |

### 이미지를 PC 로 가져오기

```bash
rsync -avz root@내VPS주소:/var/lib/peropix/images/ ./내려받기/
```

같은 명령을 다시 돌리면 **바뀐 것만** 받아 옵니다. 백업 용도로 그대로 쓸 수 있습니다.

---

## 문제가 생기면

**「연결 확인」 이 실패합니다**

VPS 안에서 먼저 확인합니다. 여기서 되면 수신함은 정상이고, 바깥 연결(3번) 문제입니다.

```bash
curl -H "Authorization: Bearer $(sudo cat /etc/peropix/token)" http://127.0.0.1:8770/ping
```

**「토큰이 맞지 않습니다」**

앱에 넣은 값과 `sudo cat /etc/peropix/token` 이 같은지 봅니다.
복사할 때 앞뒤 공백이나 줄바꿈이 섞이기 쉽습니다.

**서비스가 안 뜹니다**

```bash
journalctl -u peropix-receiver -n 30 --no-pager
```

**토큰을 바꾸고 싶습니다**

```bash
sudo python3 /opt/peropix/receiver.py --new-token | sudo tee /etc/peropix/token
```

```bash
sudo bash /root/peropix-tools/deploy/install.sh
```

설치 스크립트를 다시 돌리면 새 토큰이 서비스에 반영됩니다. 앱에도 새 값을 넣어야 합니다.
