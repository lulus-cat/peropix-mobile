"""backend.py 의 NAI 상수표를 그대로 JS 로 내보낸다.

★손으로 옮겨 적지 말 것. 프리셋 본문·CJK 범위·따옴표 짝은 눈으로 구별되지 않는 글자가
  섞여 있어 전사하면 조용히 어긋난다 (backend.py 주석의 경고 그대로).
  backend.py 를 고치면 이 스크립트를 다시 돌려 nai-tables.js 를 갱신한다.
"""
import sys, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import backend as B


def js_flags(rx):
    """파이썬 정규식 플래그를 JS 플래그 문자열로. ★대소문자 구분 여부가 동작을 가른다."""
    f = ""
    if rx.flags & re.IGNORECASE:
        f += "i"
    if rx.flags & re.MULTILINE:
        f += "m"
    if rx.flags & re.DOTALL:
        f += "s"
    return f


tables = {
    "SAMPLER_MAP": B.NAI_SAMPLER_MAP,
    "SCHEDULER_MAP": B.NAI_SCHEDULER_MAP,
    "QUALITY_PRESETS": {k: [list(t) for t in v] for k, v in B.NAI_QUALITY_PRESETS.items()},
    "UC_PRESETS": {k: [list(t) for t in v] for k, v in B.NAI_UC_PRESETS.items()},
    "UC_PRESET_ID": B.NAI_UC_PRESET_ID,
    "UC_CATEGORY_FALLBACK": B.NAI_UC_CATEGORY_FALLBACK,
    "NO_NSFW_PREFIX": sorted(B.NAI_NO_NSFW_PREFIX),
    "TAG_HINT_ID": B.NAI_TAG_HINT_ID,
    "MODEL_CAPS": B.NAI_MODEL_CAPS,
    "CAPS_FALLBACK": B.NAI_CAPS_FALLBACK,
    "BASE_MODEL": B.NAI_BASE_MODEL,
    "INPAINT_MODEL": B.NAI_INPAINT_MODEL,
    "TRANSPARENT_BG_TAG": B.NAI_TRANSPARENT_BG_TAG,
    "ENHANCE_PROMPT_ADD": B.NAI_ENHANCE_PROMPT_ADD,
    "NAIT": {
        "SEP": B.NAIT_SEP,
        "ESCAPED_SEP": B.NAIT_ESCAPED_SEP,
        "MAX_PARTS": B.NAIT_MAX_PARTS,
        "AUTO_TAG": B.NAIT_AUTO_TAG,
        "QUOTES": B.NAIT_QUOTES,
        "CJK_RATIO": B.NAIT_CJK_RATIO,
        "GAP_MAX": B.NAIT_GAP_MAX,
        "SPAN_MAX": B.NAIT_SPAN_MAX,
        "TMP_SEP": B._NAIT_TMP_SEP,
        "TMP_ESC": B._NAIT_TMP_ESC,
        "CJK_CLASS": B.NAIT_CJK_RE.pattern,
        "AUTO_RE": B.NAIT_AUTO_RE.pattern,
        "AUTO_RE_FLAGS": js_flags(B.NAIT_AUTO_RE),
    },
    "TEXT_CLAUSE_RE": B.NAI_TEXT_CLAUSE_RE.pattern,
    "TEXT_CLAUSE_FLAGS": js_flags(B.NAI_TEXT_CLAUSE_RE),
    "CENTER_GRID": list(B.NAI_CENTER_GRID),
}


def esc(o):
    """JSON 을 ASCII 로만 내보낸다 — 파일 인코딩 사고를 원천 차단."""
    return json.dumps(o, ensure_ascii=True, indent=1, sort_keys=False)


dest = ROOT / "mobile" / "www" / "js" / "nai-tables.js"
dest.write_text(
    "// ⚠ 자동 생성 파일 — 직접 고치지 말 것.\n"
    "// 원본: backend.py / 생성: mobile/tools/export_tables.py\n"
    "// 갱신: python/python.exe mobile/tools/export_tables.py\n"
    "'use strict';\n"
    "const NAI_TABLES = " + esc(tables) + ";\n"
    "if (typeof module !== 'undefined') module.exports = NAI_TABLES;\n",
    encoding="utf-8",
)
print("생성:", dest)
print("표:", ", ".join(tables.keys()))
