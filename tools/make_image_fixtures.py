"""이미지 처리 대조용 기준값 생성.

JS 의 lanczos3 리샘플이 PIL LANCZOS 와 같은 그림을 내는지, PNG tEXt 청크를 제대로
읽고 쓰는지 보려면 원본 쪽 결과가 있어야 한다. 여기서 만들어 둔다.

사용: python/python.exe mobile/tools/make_image_fixtures.py
출력: mobile/tools/fixtures/
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(exist_ok=True)


def make_source(w=200, h=140):
    """리샘플 차이가 드러나는 그림 — 고주파(가는 선)와 완만한 그라디언트를 함께 둔다."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    for x in range(w):
        for y in range(h):
            img.putpixel((x, y), (int(255 * x / w), int(255 * y / h), 128, 255))
    # 1px 선 (에일리어싱이 가장 잘 드러난다)
    for x in range(0, w, 3):
        d.line([(x, 0), (x, h)], fill=(255, 255, 255, 255), width=1)
    d.ellipse([w // 4, h // 4, w * 3 // 4, h * 3 // 4], outline=(0, 0, 0, 255), width=2)
    # 반투명 영역 (평탄화 검사용)
    for x in range(w // 2, w):
        for y in range(0, h // 3):
            r, g, b, _ = img.getpixel((x, y))
            img.putpixel((x, y), (r, g, b, 100))
    return img


src = make_source()
(OUT / "source_rgba.bin").write_bytes(src.tobytes())
meta = {"width": src.width, "height": src.height}

# ── 리샘플 기준값 ──────────────────────────────────────────────────────
targets = [(832, 1216), (100, 70), (200, 140), (64, 64)]
resized = {}
for (tw, th) in targets:
    r = src.resize((tw, th), Image.LANCZOS) if (tw, th) != src.size else src.copy()
    name = f"resized_{tw}x{th}.bin"
    (OUT / name).write_bytes(r.tobytes())
    resized[f"{tw}x{th}"] = name
meta["resized"] = resized

# ── 불투명 원본 (NAI 산출물의 대부분) — 여기서는 엄격히 일치해야 한다 ──
opaque = src.convert("RGB").convert("RGBA")
(OUT / "opaque_rgba.bin").write_bytes(opaque.tobytes())
op_resized = {}
for (tw, th) in targets:
    r = opaque.resize((tw, th), Image.LANCZOS) if (tw, th) != opaque.size else opaque.copy()
    name = f"opaque_{tw}x{th}.bin"
    (OUT / name).write_bytes(r.tobytes())
    op_resized[f"{tw}x{th}"] = name
meta["opaque_resized"] = op_resized

# ── 전처리(리샘플 + 흰 배경 평탄화) 기준값 ────────────────────────────
import backend  # noqa: E402
import base64
import io

buf = io.BytesIO()
src.save(buf, format="PNG")
src_png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
(OUT / "source.png").write_bytes(buf.getvalue())

for (tw, th) in [(832, 1216), (100, 70)]:
    processed = backend.preprocess_base_image(src_png_b64, tw, th)
    img = Image.open(io.BytesIO(base64.b64decode(processed))).convert("RGB")
    name = f"preprocessed_{tw}x{th}.bin"
    (OUT / name).write_bytes(img.tobytes())
meta["preprocessed"] = [f"{t[0]}x{t[1]}" for t in [(832, 1216), (100, 70)]]

# ── NAI 스타일 tEXt 청크가 든 PNG ─────────────────────────────────────
info = PngInfo()
info.add_text("Title", "AI generated image")
info.add_text("Description", "1girl, silver hair, smile")
info.add_text("Software", "NovelAI")
info.add_text("Source", "Stable Diffusion XL C1E1DE52")
info.add_text("Generation time", "3.14")
buf2 = io.BytesIO()
Image.new("RGB", (32, 32), (10, 20, 30)).save(buf2, format="PNG", pnginfo=info)
(OUT / "with_text.png").write_bytes(buf2.getvalue())
meta["text_chunks"] = {
    "Title": "AI generated image",
    "Description": "1girl, silver hair, smile",
    "Software": "NovelAI",
    "Source": "Stable Diffusion XL C1E1DE52",
    "Generation time": "3.14",
}

(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
print("기준값 생성:", OUT)
print("  원본", src.size, "· 리샘플", len(targets), "종 · tEXt PNG 1개")
