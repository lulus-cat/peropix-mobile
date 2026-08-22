# 지시함 규약 (PeroPix 모바일) — Claude Code 용

이 저장소는 **PeroPix 모바일 앱의 「지시함」** 입니다.
여기에 JSON 을 넣어 두면, 폰에 있는 앱이 그것을 읽어 그림을 뽑습니다.

> 이 파일을 만드는 방법: 앱 → 원격 작업 → 출처를 **GitHub** 으로 → 「AI 에게 시킬 말 복사」
> 를 눌러 AI 에게 붙여넣으면 AI 가 이 규약대로 저장소를 채웁니다.

## 앱과 이 저장소의 관계

- 앱은 이 저장소를 **읽기만** 합니다. 쓰지 않습니다.
  (그래서 폰에는 쓰기 권한 토큰을 넣지 않습니다. 비공개 저장소라면 **읽기 전용**
  fine-grained 토큰만 넣으세요.)
- 무엇을 이미 뽑았는지는 **폰이 기억**합니다. 저장소에는 아무 표시도 남지 않습니다.
- NovelAI API 키는 **폰에만** 있습니다. 이 저장소에는 절대 넣지 마세요.
- 저장소가 공개(public)라면 여기 적은 프롬프트는 **누구나 볼 수 있습니다.**

## 폴더 구조

```
<저장소>/
  AGENTS.md            ← 같은 규약 (Codex 등이 읽습니다)
  CLAUDE.md            ← 이 파일 (Claude Code 가 읽습니다)
  <작품 이름>/
    characters/        ← 인물 JSON. 그 작품 안에서 공용입니다.
      미아.json
    slots/             ← 슬롯 묶음 JSON. **파일 하나가 작업 하나**입니다.
      일상.json
      교복.json
```

- 첫 번째 폴더 이름이 **작품 이름**이자 폰에 저장될 **폴더 이름**입니다.
- 인물 폴더 이름은 `characters` `character` `캐릭터` `인물` 중 아무거나.
- 슬롯 폴더 이름은 `slots` `slot` `슬롯` `작업` `jobs` 중 아무거나.
  (작품 폴더 바로 아래에 둔 `.json` 도 슬롯으로 봅니다.)
- 저장소 **루트에 그냥 둔 `.json` 은 무시**됩니다 — 어느 작품인지 알 수 없으니까요.
- 점(`.`)으로 시작하는 폴더(`.github` 등)는 건드리지 않습니다.

## 슬롯 파일 (= 작업 하나)

```json
{
  "name": "미아 · 일상",
  "prefix": "1girl, silver hair, masterpiece",
  "slots": [
    { "name": "1-1", "content": "smile, bedroom" },
    { "name": "1-2", "content": "angry, classroom" }
  ],
  "options": { "count_per_slot": 1 }
}
```

| 칸 | 뜻 |
|---|---|
| `name` | 앱 목록에 뜨는 이름 (없으면 파일 이름) |
| `prefix` | 모든 슬롯에 공통으로 붙는 태그 |
| `slots` | 뽑을 목록. `name` 은 파일 이름, `content` 는 그 슬롯의 태그 |
| `folder` | 저장 폴더를 따로 정하고 싶을 때 (기본값은 작품 폴더 이름) |
| `characters` | 이 작업에만 쓰는 인물 (작품 공용 인물 뒤에 붙습니다) |
| `options` | 아래 표 참고 |

`options` 에 쓸 수 있는 것 — **아는 값만 적으세요.** 모르는 칸은 앱의 현재 설정을 씁니다.

```
nai_model, width, height, steps, cfg, sampler, uc_preset, quality_preset,
negative_prompt, count_per_slot, one_char_mode, transparent_bg, straight_alpha,
save_format, variety_plus, seed
```

## 인물 파일

```json
{ "name": "미아", "content": "1girl, silver hair, blue eyes" }
```

여러 명을 한 파일에 적어도 됩니다.

```json
{ "characters": [
  { "name": "미아", "content": "1girl, silver hair" },
  { "name": "리사", "content": "1girl, red hair" }
] }
```

## 언제 그림이 뽑히나 (트리거)

- **슬롯 파일이 새로 생기거나 내용이 바뀌면** 그것이 새 작업이 됩니다.
  앱이 판단하는 근거는 GitHub 이 주는 blob SHA 입니다 — 내용이 같으면 SHA 도 같아서,
  커밋을 다시 하거나 파일을 옮겼다 되돌려도 같은 작업을 두 번 뽑지 않습니다.
- **인물 파일을 고치는 것은 작업을 만들지 않습니다.** 인물 한 줄 고칠 때마다 그 작품의
  슬롯이 전부 다시 도는 것은 돈이 나가는 사고니까요. 다음에 그 작품을 돌릴 때
  최신 인물이 자동으로 쓰입니다.
- 뽑기는 **앱이 그 저장소를 볼 때** 시작됩니다 (원격 작업 화면을 열거나, 자동 실행을
  켜 두면 주기적으로). GitHub 이 폰을 깨우지는 못합니다.

## AI 에게 (중요)

- **슬롯 파일을 고치는 것은 곧 생성 요청입니다.** 시험 삼아 고치거나, 형식만 다듬으려고
  전체 파일을 다시 쓰지 마세요. 돈이 나갑니다.
- 한 번에 수십 장이 나가는 지시는 비쌉니다. **새 작업은 작게 시작**하세요
  (슬롯 2~3개, `count_per_slot: 1`).
- 커밋 메시지에 무엇을 왜 넣었는지 한 줄 적어 주세요.
- 이 저장소에 API 키·토큰·비밀번호를 넣지 마세요.
