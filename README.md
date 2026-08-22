# Peropix Lkit mobile ver.

NovelAI 이미지를 **폰 하나로 대량 생성**하는 안드로이드 앱. 서버가 필요 없습니다.

챗봇 캐릭터용 에셋처럼 *같은 캐릭터를 감정·상황별로 수십~수백 장* 뽑아야 할 때를 위해
만들었습니다. 슬롯마다 다른 프롬프트를 넣고 한 번에 돌린 뒤, 결과를 슬롯별로 훑으며
버릴 것과 남길 것을 갈라냅니다.

> **필요한 것**: NovelAI 구독과 API 키. 키는 첫 실행 때 넣고 이 기기에만 저장됩니다 —
> 앱에 박혀 있지 않으니 APK 를 남에게 줘도 키가 따라가지 않습니다.

Capacitor 로 감싼 하이브리드 앱이라 화면과 로직은 전부 `www/` 안의 HTML·JS 입니다.

## 만들기

```bash
npm install
```

```bash
npx cap sync android
```

그다음 Android Studio 로 열거나 (`npx cap open android`), 명령줄로 바로 뽑습니다.

```bash
cd android && ./gradlew assembleDebug
```

결과물: `android/app/build/outputs/apk/debug/app-debug.apk`

> **JDK 는 17 또는 21 이어야 합니다.** Android Studio 번들 JDK 가 Java 25 면
> Gradle 8.14 가 읽지 못해 `Unsupported class file major version 69` 로 죽습니다.
> 그때는 `~/.gradle/gradle.properties` 에 `org.gradle.java.home=<JDK 21 경로>` 를 적으세요.

## 화면 미리보기 (빌드 없이)

```bash
node tools/serve.js
```

`http://localhost:5173`. 단 **브라우저에서는 실제 생성이 안 됩니다** — NovelAI 가 CORS 로
막습니다. 앱은 네이티브 HTTP 로 보내 이 제약을 받지 않습니다. 화면 확인 전용입니다.

---

## 프롬프트는 세 축입니다

데스크톱판과 같은 구조입니다. **서로 섞이지 않습니다.**

| 축 | 무엇 | NAI 페이로드 |
|---|---|---|
| **공통 프롬프트** | 장면 전체에 걸리는 태그 | `prompt` / `v4_prompt.base_caption` |
| **캐릭터 프롬프트** | 인물별 태그 + 인물별 UC + 5×5 좌표 | `characterPrompts[]` / `v4_prompt.char_captions[]` |
| **생성 슬롯** | 한 장씩 바꿔 가며 뽑을 변주 | 슬롯마다 위 둘 중 하나에 합쳐짐 |

슬롯 프롬프트를 **공통에 붙일지 캐릭터에 붙일지**는 「슬롯 프롬프트를 어디에 붙일까」 에서
고릅니다. **기본값은 「캐릭터에」** — 데스크톱판과 같습니다. 여기가 다르면 같은 설정인데
다른 그림이 나옵니다.

인물마다 「이 인물에는 슬롯 프롬프트를 붙이지 않기」 를 켜면 그 인물만 원본을 유지합니다.

캐릭터 수 상한은 모델이 정합니다 (V4.5 6명 · V5 32명). 넘으면 화면이 미리 알려 주고
초과분은 전송하지 않습니다.

## 앱 아이콘

원본은 `icon.png` (900×900, 배경 `#00a6ca`). 고쳐서 다시 만들려면:

```bash
python tools/make_icons.py icon.png
```

밀도별 런처 아이콘·원형 아이콘·적응형 아이콘을 전부 만듭니다.

★적응형 아이콘은 기기 모양(원형·둥근사각 등)에 따라 **바깥이 잘립니다.** 그래서
배경을 뚫어 글자만 남기고 `SAFE_RATIO`(0.58) 안에 넣습니다. 안드로이드가 보장하는
안전 영역이 108dp 중 지름 66dp 원이라 그렇습니다 — 0.72 로 뒀더니 실제로 P 위쪽과
Kit 아래가 잘렸습니다.

## 폴더 관리

상단 🗂 버튼. **폰 · PC · VPS** 를 같은 화면에서 다룹니다.

- 폴더를 눌러 안으로 들어가고, ↑ 상위로 나옵니다
- 폴더마다 안에 몇 장 있는지 보여 줍니다 (매트릭스 채움 확인용)
- ✎ 이름 바꾸기 · 🗑 지우기 · + 새 폴더
- **비어 있지 않은 폴더는 두 번 묻습니다.** 수백 장이 한 번에 날아가는 사고를 막습니다

## 들어 있지 않은 기능

데스크톱판에는 있지만 이 앱에는 **없습니다.**

| 기능 | 이유 |
|---|---|
| 로컬 생성 (SDXL/LoRA) | 폰 GPU 로 불가능 |
| 자동 검열 (YOLO) | 필요 없다고 하여 제외 |
| LUT 보정 | .cube 파일이 필요 — 로컬 자원 |
| Vibe Transfer | 아직 안 붙임 (**추가 가능**) |
| 인페인트 · img2img · 마스크 편집 | 아직 안 붙임 (**추가 가능**) |

---

## 저장 위치와 이름

### 저장할지 말지

생성 옵션의 **「생성하면 바로 저장」** 으로 정합니다.

| 켬 (기본) | 끔 |
|---|---|
| 나오는 대로 전부 저장 | 아무 데도 쓰지 않음 |
| 대량 생산에 적합 | 뷰어에서 마음에 드는 것만 골라 저장 |

끈 상태에서는 앱을 나가면 저장하지 않은 이미지는 사라집니다.

### 전체화면 뷰어

- 결과 이미지를 누르면 열립니다
- **좌우로 밀어** 이전/다음 장 (짧게 밀거나 세로로 밀면 넘어가지 않습니다)
- 상단 **저장** 버튼으로 그 장만 저장. 이미 저장된 장은 「저장됨」 으로 잠깁니다
- 실패한 장은 뷰어에서 건너뜁니다

### 어디에 저장할지

「저장 위치와 이름」 패널에서 고릅니다.

| 위치 | 저장되는 곳 |
|---|---|
| **이 폰** | 문서/PeroPix/ 아래 |
| **PC · VPS** | 그쪽에 띄워 둔 수신함 (`tools/receiver.py`) |

PC 와 VPS 는 같은 방식으로 다룹니다 — 주소만 다릅니다. 설정 화면에서 여러 개 등록해 두고
필요할 때 골라 쓸 수 있습니다.

### 이름 규칙

기본은 PeroFix 정리 관례를 따릅니다.

```
{persona}/{label}.png     →     미아/1-3.png
```

쓸 수 있는 토큰: `{persona}` `{label}` `{seq}` `{seed}` `{date}` `{time}` `{model}`

- 같은 이름이 겹치면 덮어쓰지 않고 `_2`, `_3` 이 붙습니다 (앱과 수신함 양쪽에서 막습니다)
- 윈도우가 싫어하는 글자·예약 이름(`CON`, `NUL` 등)은 자동으로 비켜 갑니다
- 하이픈은 건드리지 않습니다 — `1-3` 같은 좌표 라벨이 어긋나지 않게

---

## PeroFix JSON 가져오기

슬롯 위 **「JSON 가져오기」** 버튼. Claude Code·Codex·Gemini 가 만든 파일을 그대로 붙여넣습니다.

```json
{
  "name": "미아 · 일상 모드",
  "prefix": "1girl, silver hair, blue eyes",
  "slots": [
    { "name": "1-1", "content": "bedroom, morning light, medium shot, smile", "locked": false }
  ]
}
```

| JSON | 앱 |
|---|---|
| `prefix` | 공통 프롬프트 |
| `slots[].name` | 슬롯 이름 (저장 파일명에 쓰임) |
| `slots[].content` | 슬롯 프롬프트 |

- 「기존 슬롯 교체」 와 「뒤에 추가」 둘 다 있습니다
- ` ```json ` 표시를 같이 붙여넣어도 알아서 벗겨냅니다
- 같은 이름이 둘이면 `_2` 를 붙여 갈라 줍니다 (파일 겹침 방지)
- `locked` 는 앱이 쓰지 않지만 값은 보존합니다

---

## 수신함 설치 (PC · VPS)

`tools/receiver.py` 는 표준 라이브러리만 씁니다. **설치할 것이 없습니다** (Python 3.8+).

### 1. 토큰 만들기

```bash
python tools/receiver.py --new-token
```

출력된 문자열을 앱의 대상 등록 칸에 넣습니다.

### 2. 띄우기

```bash
python tools/receiver.py --root ./images --token 방금만든토큰
```

기본 포트는 8770 입니다. 앱에는 주소를 `192.168.0.5:8770` 처럼 넣습니다.

### 3. ⚠ VPS 라면 반드시 암호화할 것

평문 HTTP 로 인터넷에 열면 **토큰과 이미지가 그대로 노출됩니다.** 셋 중 하나를 쓰세요.

| 방법 | 설명 |
|---|---|
| **리버스 프록시 (권장)** | Caddy 나 nginx 로 TLS 를 씌우고 수신함은 `--host 127.0.0.1` 로만 연다 |
| **직접 인증서** | `--cert cert.pem --key key.pem` |
| **VPN** | Tailscale·WireGuard 안에서만 연다 |

집 LAN 안의 PC 라면 평문도 무방합니다.

Caddy 예시 (도메인이 있을 때 — 인증서를 알아서 받아 갱신합니다):

```
img.내도메인.com {
    reverse_proxy 127.0.0.1:8770
}
```

### 수신함이 지키는 것

- 토큰이 없거나 틀리면 전부 거부 (상수시간 비교)
- 경로 탈출(`../`, 절대경로, 인코딩 우회) 차단 — 저장 폴더 밖으로 절대 못 나감
- 이미지 확장자만 허용, 32MB 상한
- 같은 이름은 덮어쓰지 않고 `_2` 로 비킴
- 다 쓴 뒤 이름을 바꿔 옮김 — 중간에 끊겨도 반쪽 파일이 남지 않음

---

## APK 만들기 (처음 한 번)

**준비물:** [Android Studio](https://developer.android.com/studio) (무료, 기본값 설치).

```bash
npx cap open android
```

Android Studio 가 열리면 아래쪽 Gradle 동기화가 끝날 때까지 기다린 뒤,
**Build → Build Bundle(s) / APK(s) → Build APK(s)**.

결과물:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

폰으로 옮겨 실행하면 설치됩니다 ("출처를 알 수 없는 앱" 허용 필요).

### 앱 코드를 고친 뒤

```bash
npx cap sync android
```

그다음 다시 Build APK.

---

## PC 에서 미리 보기

```bash
npm run preview
```

`http://localhost:5173`. 단, **PC 브라우저에서는 실제 생성이 안 됩니다** — NovelAI 가 CORS 로
막습니다. 화면 확인 전용입니다. 앱은 네이티브 HTTP 로 보내 이 제약을 받지 않습니다.

---

## 검사

```bash
npm test
```

```bash
python tools/test_receiver.py
```

| 검사 | 무엇을 보나 | 건수 |
|---|---|---|
| `verify_payload.js` | NAI 페이로드가 `backend.py` 와 같은가 | 138 |
| `test_naming.js` | 경로·파일명 규칙 (탈출·예약어·겹침) | 18 |
| `test_image.js` | 리샘플이 PIL 과 같은가 · PNG 메타데이터 | 29 |
| `test_import.js` | PeroFix JSON 가져오기 (슬롯·캐릭터) | 31 |
| `test_anlas.js` | Anlas 소모량이 `backend.py` 와 같은가 | 169 |
| `test_wildcards.js` | 와일드카드 치환 규칙 | 24 |
| `test_receiver.py` | 수신함 (경로 탈출 차단·인증·업로드·폴더) | 53 |

### 이 검사가 무엇을 지키나

`www/js/nai-payload.js` 는 NovelAI 웹이 실제로 보내는 요청을 **그대로 재현**합니다.
프리셋 접미사, `tag_hint` 번호표, 모델별 능력 차이(V5 는 Variety+ 가 없고 스케줄러를
고를 수 없다 등), 따옴표 → `teXt:` 자동 조립 같은 것들이 전부 여기 걸려 있습니다.

**조금만 어긋나도 오류가 나지 않고 그냥 다른 그림이 나옵니다.** 눈으로는 못 잡습니다.
그래서 기준 페이로드 138 건을 저장소에 넣어 두고 기계적으로 대조합니다
(`tools/reference_payloads.json`). Anlas 계산도 마찬가지로 169 건을 대조합니다 —
이 숫자가 틀리면 "무료인 줄 알았는데 차감" 이 됩니다.

실제로 이 대조가 `text:` 정규식의 대소문자 무시 플래그 누락을 잡았습니다.
파이썬 쪽은 플래그가 패턴 문자열 밖에 있어서 옮길 때 조용히 빠졌던 것입니다.

> **`backend.py` 는 이 저장소에 없습니다.** PeroPix 데스크톱판의 백엔드이고,
> 이 앱은 거기서 NAI 생성 경로만 떼어 온 것입니다. 기준값은 이미 커밋돼 있으므로
> 데스크톱판 없이도 `npm test` 는 그대로 돌아갑니다.
>
> 데스크톱판을 가지고 있고 그쪽 NAI 코드를 고쳤다면, `tools/export_tables.py` 와
> `tools/capture_reference.py` 로 기준값을 다시 뽑아 맞출 수 있습니다.
> (두 스크립트는 `backend.py` 를 불러오므로 데스크톱판 폴더 안에서 돌려야 합니다.)

---

## 파일 구조

```
www/                      앱 본체 (여기를 고칩니다)
  index.html
  css/app.css
  js/
    nai-tables.js         ⚠ 자동 생성 — 직접 고치지 말 것
    nai-payload.js        NAI 페이로드 조립 (핵심)
    nai-client.js         NAI 통신 · ZIP 해제 · 폰 저장 · 재시도
    remote-store.js       PC·VPS 수신함 통신
    results-model.js      결과 분류 (슬롯 묶기 · 파생본 · 필터)
    anlas.js              Anlas 잔량 · 소모량 계산
    wildcards.js          와일드카드 치환
    naming.js             저장 경로 · 파일명 규칙
    image-util.js         PNG 메타데이터 · lanczos3 리샘플 · 형식 변환
    perofix-import.js     PeroFix JSON 가져오기
    storage.js            키 · 설정 · 슬롯 · 대상 저장
    notify.js             완료 알림
    folders.js            폴더 관리 (폰/원격 공통)
    app.js                화면 동작
    fflate.js             ZIP 해제 라이브러리 (외부)

tools/
  receiver.py             PC·VPS 수신함 서버 (표준 라이브러리만)
  deploy/install.sh       리눅스 서버에 상시 실행으로 설치
  deploy/DEPLOY.md        서버 설치 안내
  make_icons.py           icon.png → 안드로이드 아이콘 전 크기
  serve.js                PC 미리보기 서버
  verify_payload.js       NAI 페이로드 대조        ← 검사
  test_*.js / test_*.py   나머지 검사
  export_tables.py        기준표 재생성 (데스크톱판 필요)
  capture_reference.py    기준 페이로드 재캡처 (데스크톱판 필요)

android/                  Capacitor 안드로이드 프로젝트
icon.png                  앱 아이콘 원본 (900×900)
```

## 라이선스

MIT. 자세한 내용은 [LICENSE](LICENSE).

이 앱은 NovelAI 의 비공식 클라이언트입니다. NovelAI 와 아무 관련이 없으며,
쓰려면 본인의 NovelAI 구독과 API 키가 필요합니다.
