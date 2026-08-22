# 지시함 — AI 가 여기에 쓰면 폰이 받아 뽑는다

앱의 **📥 원격 작업 → 「GitHub 지시함」** 에 이 저장소를 적어 두면, 폰이 `queue.json` 을 읽어
새 작업을 뽑습니다. 서버도 토큰도 필요 없습니다 (공개 저장소인 경우).

    저장소   lulus-cat/peropix-mobile
    브랜치   main
    지시 파일 perofix/queue.json

## 쓰는 법

`queue.json` 에 작업을 배열로 적습니다. 모양은 **PeroFix 가져오기와 같고**, `folder` 와
`options` 만 얹습니다.

```json
[
  {
    "id": "mia-01",
    "name": "미아 · 일상 2장",
    "folder": "미아",
    "prefix": "1girl, silver hair, masterpiece",
    "slots": [
      { "name": "1-1", "content": "smile, bedroom, morning light" },
      { "name": "1-2", "content": "angry, classroom" }
    ],
    "characters": [{ "name": "미아", "content": "1girl, silver hair" }],
    "options": { "count_per_slot": 1, "one_char_mode": false, "transparent_bg": true }
  }
]
```

- **`id`** 를 적어 두면 그 작업은 **한 번만** 돕니다. 안 적으면 내용으로 만들어 씁니다
  (내용이 같으면 같은 id — 그래서 두 번 돌지 않습니다).
- 이미 실행한 작업은 **폰이 기억**합니다. 여기서 지우지 않아도 다시 돌지 않습니다.
  (앱은 이 저장소에 **쓰지 않습니다.**)
- `options` 는 아는 값만 받습니다 — 모델·크기·steps·cfg·샘플러·UC·퀄리티·네거티브·배수·
  한 명 모드·투명 배경·저장 형식·Variety+·시드.

## ⚠ 공개 저장소입니다

여기에 적는 프롬프트는 **누구나 봅니다.** 남에게 보이면 안 되는 프롬프트라면 비공개
저장소를 하나 만들고, 앱에 **읽기 전용 토큰**을 넣어 쓰세요.

## 결과는 어디로

앱의 저장 위치를 그대로 씁니다 — 폰이면 `문서/PeroPix/`, PC·VPS 수신함을 골라 두었으면
그리로 올라갑니다. GitHub 으로는 아무것도 되돌려 보내지 않습니다.
