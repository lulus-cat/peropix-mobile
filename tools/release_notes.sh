#!/usr/bin/env bash
# 릴리즈에 붙일 「이번 판에 바뀐 것」 을 만든다.
#
# ★파일만 올려 두면 받는 사람은 판 번호만 보고 깔지 말지를 정해야 한다.
#   지난 판(v* 태그) 이후의 커밋 제목을 그대로 쓰고, 자세한 설명은 접어 둔다.
# ★커밋 제목이 곧 릴리즈 노트다 — 그래서 제목을 사람이 읽을 한 줄로 쓴다.
#
# 사용: tools/release_notes.sh [지난판태그]     (안 주면 스스로 찾는다)
#   GitHub Actions 밖에서도 돌아간다 (링크 줄만 빠진다).
set -euo pipefail

PREV="${1-}"
if [ -z "$PREV" ]; then
  # HEAD 에서 닿는 가장 가까운 v* 태그. 첫 판이면 비어 있다.
  PREV="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
fi

if [ -n "$PREV" ]; then
  RANGE="$PREV..HEAD"
else
  RANGE="HEAD"
fi

# ★한 판에 스무 개 넘게 들어가는 일은 없다. 그래도 상한을 둔다 —
#   태그를 한참 안 달았을 때 릴리즈 본문이 수천 줄이 되는 것을 막는다.
MAX=20

SUBJECTS="$(git log --no-merges --pretty=format:'- %s' -n "$MAX" $RANGE || true)"
COUNT="$(git log --no-merges --oneline -n 200 $RANGE | wc -l | tr -d ' ')"

echo "## 이번 판에서 바뀐 것"
echo
if [ -z "$SUBJECTS" ]; then
  # 태그만 다시 단 경우 등 — 빈 목록으로 두지 않는다.
  echo "- 바뀐 내용 없음 (같은 코드로 다시 만든 판입니다)"
else
  echo "$SUBJECTS"
  if [ "$COUNT" -gt "$MAX" ]; then
    echo "- … 그 밖에 $((COUNT - MAX)) 건"
  fi
fi
echo

# 자세한 설명 — 커밋 본문에 「왜 그렇게 했는지」 가 들어 있다. 길어서 접어 둔다.
BODIES="$(git log --no-merges --pretty=format:'### %s%n%n%b' -n "$MAX" $RANGE || true)"
if [ -n "$BODIES" ]; then
  echo "<details><summary>자세한 설명</summary>"
  echo
  # ★Co-Authored-By·Claude-Session 같은 꼬리표는 읽는 사람에게 쓸모가 없다.
  echo "$BODIES" | grep -v -E '^(Co-Authored-By|Claude-Session):' || true
  echo
  echo "</details>"
  echo
fi

if [ -n "$PREV" ] && [ -n "${GITHUB_REPOSITORY-}" ] && [ -n "${VERSION_NAME-}" ]; then
  echo "지난 판과의 차이: https://github.com/$GITHUB_REPOSITORY/compare/$PREV...v$VERSION_NAME"
  echo
fi

echo "---"
echo
echo "폰에서 아래 \`.apk\` 를 눌러 받은 뒤 열면 설치됩니다. **기존 앱 위에 덮어 설치**하면"
echo "API 키·슬롯·프리셋이 그대로 남습니다 (지우지 마세요)."
echo
echo "처음 설치할 때 「출처를 알 수 없는 앱」 허용을 한 번 물어봅니다."
echo "NovelAI API 키는 앱을 처음 켤 때 넣습니다 — 이 파일에는 들어 있지 않습니다."
echo
echo "커밋: ${GITHUB_SHA-$(git rev-parse HEAD)}"
