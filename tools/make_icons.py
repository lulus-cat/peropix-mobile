"""앱 아이콘 만들기 — 원본 그림 한 장에서 안드로이드가 쓰는 크기를 전부 뽑는다.

    python/python.exe mobile/tools/make_icons.py mobile/icon.png

원본은 **정사각형 PNG** 하나면 된다 (512×512 이상 권장, 클수록 좋다).

만드는 것
  mipmap-*/ic_launcher.png          런처 아이콘 (구형 안드로이드)
  mipmap-*/ic_launcher_round.png    원형 런처 아이콘
  mipmap-*/ic_launcher_foreground.png  적응형 아이콘의 앞면
  values/ic_launcher_background.xml    적응형 아이콘의 배경색

★적응형 아이콘(안드로이드 8+)은 기기가 바깥을 잘라낸다. 그래서 앞면은 그림을 **가운데
  72% 안**에 넣고 나머지를 투명으로 둔다. 이걸 안 하면 글자 끝이 잘린다.
"""

import sys
import xml.sax.saxutils as _sax
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow 가 필요합니다.", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# 밀도별 런처 아이콘 크기 (안드로이드 표준)
DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
# 적응형 앞면은 108dp 짜리다 (바깥 18dp 씩은 잘려 나간다)
FOREGROUND = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}
# ★적응형에서 안전하게 보이는 비율.
#   안드로이드는 앞면 108dp 중 **지름 66dp 원 안**만 어떤 마스크에서도 보인다고 보장한다.
#   66/108 = 0.611 이므로 그보다 작게 잡는다.
#   ☆0.72 로 뒀더니 원형·둥근사각 마스크 양쪽에서 글자 위아래가 잘렸다 (합성 미리보기로 확인).
SAFE_RATIO = 0.58
BACKGROUND = "#00a6ca"


def dominant_bg(img):
    """네 귀퉁이 색으로 배경색을 추정한다 (대부분의 로고는 귀퉁이가 배경이다)."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    pts = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]
    cols = [rgb.getpixel(p) for p in pts]
    # 네 귀퉁이가 서로 비슷하면 그 색을, 아니면 지정 색을 쓴다.
    r = sum(c[0] for c in cols) // 4
    g = sum(c[1] for c in cols) // 4
    b = sum(c[2] for c in cols) // 4
    spread = max(max(c) - min(c) for c in zip(*cols))
    if spread > 40:
        return None
    return "#%02x%02x%02x" % (r, g, b)


def knockout_background(img, bg_hex, tolerance=26):
    """단색 배경을 투명하게 뚫는다.

    ★가장자리는 원본에서 이미 부드럽게 섞여 있으므로, 배경에 가까울수록 알파를 낮춰
      계단이 생기지 않게 한다. 딱 잘라내면 글자 테두리가 톱니처럼 남는다.
    """
    br, bgc, bb = (int(bg_hex[i:i + 2], 16) for i in (1, 3, 5))
    out = img.convert("RGBA")
    px = out.load()
    w, h = out.size
    span = tolerance * 3.0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            dist = abs(r - br) + abs(g - bgc) + abs(b - bb)
            if dist <= tolerance:
                px[x, y] = (r, g, b, 0)
            elif dist < span:
                # 경계 구간: 배경에서 멀어질수록 서서히 불투명해진다
                px[x, y] = (r, g, b, int(a * (dist - tolerance) / (span - tolerance)))
    return out


def trim_transparent(img, pad_ratio=0.04):
    """투명한 여백을 잘라낸다. 완전히 비어 있으면 None."""
    box = img.getbbox()
    if not box:
        return None
    cropped = img.crop(box)
    # 글자가 테두리에 딱 붙지 않게 약간의 여백을 남긴다.
    pad = int(max(cropped.size) * pad_ratio)
    if pad <= 0:
        return cropped
    padded = Image.new("RGBA", (cropped.width + pad * 2, cropped.height + pad * 2), (0, 0, 0, 0))
    padded.paste(cropped, (pad, pad), cropped)
    return padded


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src_path = Path(sys.argv[1])
    if not src_path.exists():
        print(f"원본을 찾지 못했습니다: {src_path}", file=sys.stderr)
        sys.exit(1)
    if not RES.exists():
        print(f"안드로이드 res 폴더가 없습니다: {RES}\n"
              f"먼저 'npx cap add android' 를 실행하세요.", file=sys.stderr)
        sys.exit(1)

    src = Image.open(src_path).convert("RGBA")
    if src.width != src.height:
        # 정사각형이 아니면 가운데를 잘라 쓴다 (늘리면 로고가 일그러진다).
        side = min(src.width, src.height)
        left = (src.width - side) // 2
        top = (src.height - side) // 2
        src = src.crop((left, top, left + side, top + side))
        print(f"정사각형이 아니라 가운데 {side}×{side} 를 잘라 씁니다.")

    bg = dominant_bg(src) or BACKGROUND
    print(f"원본 {src.width}×{src.height} · 배경색 {bg}")

    made = 0
    for density, size in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)

        square = src.resize((size, size), Image.LANCZOS)
        square.convert("RGB").save(folder / "ic_launcher.png", format="PNG")

        # 원형: 바깥을 둥글게 오려 낸다.
        round_img = square.copy()
        mask = Image.new("L", (size * 4, size * 4), 0)
        from PIL import ImageDraw
        ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
        mask = mask.resize((size, size), Image.LANCZOS)   # 4배로 그린 뒤 줄여 계단을 없앤다
        round_img.putalpha(mask)
        round_img.save(folder / "ic_launcher_round.png", format="PNG")
        made += 2

    # ── 적응형 앞면 ────────────────────────────────────────────────────
    # ★배경이 단색이면 뚫어내고 **그림 부분만** 안전 영역에 맞춘다.
    #   배경째 넣으면 배경 위에 배경을 또 얹는 꼴이라 글자가 실제보다 작게 보인다.
    art_src = src
    if bg != BACKGROUND or dominant_bg(src):
        knocked = knockout_background(src, bg)
        cropped = trim_transparent(knocked)
        if cropped is not None:
            art_src = cropped
            print(f"배경을 뚫어 그림만 남김: {cropped.width}×{cropped.height}")

    for density, size in FOREGROUND.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        inner = int(size * SAFE_RATIO)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

        # 비율을 유지한 채 안전 영역 안에 넣는다 (늘리면 로고가 일그러진다).
        w, h = art_src.size
        k = min(inner / w, inner / h)
        art = art_src.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
        canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
        canvas.save(folder / "ic_launcher_foreground.png", format="PNG")
        made += 1

    # 적응형 배경색
    values = RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="ic_launcher_background">{_sax.escape(bg)}</color>\n'
        '</resources>\n',
        encoding="utf-8")

    # 적응형 아이콘 정의 (앞면 + 배경)
    for folder_name in ("mipmap-anydpi-v26",):
        folder = RES / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        xml = ('<?xml version="1.0" encoding="utf-8"?>\n'
               '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
               '    <background android:drawable="@color/ic_launcher_background"/>\n'
               '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
               '</adaptive-icon>\n')
        (folder / "ic_launcher.xml").write_text(xml, encoding="utf-8")
        (folder / "ic_launcher_round.xml").write_text(xml, encoding="utf-8")

    print(f"아이콘 {made}개 생성 · 적응형 정의 2개 · 배경색 {bg}")
    print(f"위치: {RES}")
    print("\n다음: npx cap sync android 후 Android Studio 에서 다시 빌드하세요.")


if __name__ == "__main__":
    main()
