"""
backend.py 가 NAI 로 실제 전송하는 페이로드를 네트워크 없이 가로채 기준값(JSON)으로 저장한다.
모바일 앱의 JS 포팅본이 이것과 바이트 단위로 같은 페이로드를 만드는지 대조하는 데 쓴다.

사용: python/python.exe mobile/tools/capture_reference.py
출력: mobile/tools/reference_payloads.json
"""
import sys, os, json, base64, asyncio, itertools
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import httpx
import backend

backend.CONFIG["nai_token"] = "pst-TESTTOKEN"


class _Captured(Exception):
    def __init__(self, payload):
        self.payload = payload


async def _fake_post(self, url, **kw):
    raise _Captured({"url": url, "json": kw.get("json")})


httpx.AsyncClient.post = _fake_post


def build_cases():
    """전송 페이로드에 영향을 주는 축들을 조합한다."""
    models = [
        "nai-diffusion-5-full",
        "nai-diffusion-5-curated",
        "nai-diffusion-4-5-full",
        "nai-diffusion-4-5-curated",
        "nai-diffusion-4-full",          # 목록 밖 = FALLBACK 능력
    ]
    ucs = ["Heavy", "Light", "Human Focus", "Furry Focus", "None"]
    qualities = ["standard", "light", "none"]
    sizes = [(832, 1216), (1024, 1024), (780, 780), (800, 800)]  # 뒤 둘은 64 정렬 검사
    prompts = [
        "1girl, smile",
        "1girl, nsfw, smile",                 # nsfw 접두 억제 검사
        "1girl, text:hello, smile",           # text: 절 앞에 붙는지 검사
        # ↓ 따옴표 -> teXt: 자동 조립 경로
        '1girl, "hello world", smile',
        '1girl, "hello", "world", smile',
        '1girl, “hello”, smile',           # 곡선 따옴표
        '1girl, 「안녕」, smile',              # 「」 + 한글
        '1girl, "안녕", "반가워", smile',          # CJK 비율 -> 순서 뒤집기
        "1girl, don't cry, smile",            # 아포스트로피는 따옴표가 아니다
        '1girl, "a" | "b", smile',            # | 조각 분리
        '1girl, "a" || "b", smile',           # || 이스케이프
        '1girl, "unclosed, smile',            # 짝 없는 따옴표
        '1girl, "", smile',                   # 빈 따옴표
        '1girl, teXt: already, smile',        # 이미 teXt: 가 있으면 손대지 않는다
    ]

    cases = []
    # 축별로 하나씩 훑어 조합 폭발을 막되, 각 축의 모든 값이 최소 한 번은 나오게 한다.
    for m in models:
        for uc in ucs:
            cases.append(dict(nai_model=m, uc_preset=uc))
    for q in qualities:
        for m in models:
            cases.append(dict(nai_model=m, quality_preset=q))
    for w, h in sizes:
        cases.append(dict(width=w, height=h))
    for p in prompts:
        for m in ("nai-diffusion-5-full", "nai-diffusion-4-5-curated"):
            cases.append(dict(prompt=p, nai_model=m))
    for m in models:
        cases.append(dict(nai_model=m, variety_plus=True))
        cases.append(dict(nai_model=m, transparent_bg=True, straight_alpha=True))
        cases.append(dict(nai_model=m, enhance_prompt_add=True))
    for s in ("euler_ancestral", "euler", "dpmpp_2m", "ddim", "dpmpp_2s_ancestral"):
        for sch in ("karras", "native", "exponential", "normal"):
            cases.append(dict(sampler=s, scheduler=sch))
    for st, cf, cr in ((28, 5.0, 0.0), (50, 7.5, 0.4), (10, 2.0, 0.1)):
        cases.append(dict(steps=st, cfg=cf, cfg_rescale=cr))
    # ── 캐릭터 프롬프트 (공통 프롬프트와 별개 축) ──────────────────────
    # ★좌표 스냅·캐릭터 상한·v4_prompt char_captions 가 여기서 갈린다.
    for m in ("nai-diffusion-4-5-full", "nai-diffusion-5-full", "nai-diffusion-4-full"):
        # 좌표 없는 평문 캐릭터
        cases.append(dict(nai_model=m, character_prompts=["1girl, blonde", "1boy, black hair"]))
        # 좌표 있는 캐릭터 (스냅 대상)
        cases.append(dict(nai_model=m, character_prompts_with_coords=[
            {"prompt": "1girl, blonde", "uc": "bad hands", "coord": "a1"},
            {"prompt": "1boy, black hair", "uc": "", "coord": "e5"},
        ]))
        # 좌표 일부만
        cases.append(dict(nai_model=m, character_prompts_with_coords=[
            {"prompt": "1girl", "uc": "", "coord": "c3"},
            {"prompt": "1boy", "uc": "blurry", "coord": None},
        ]))
        # 캐릭터 안의 따옴표 → teXt: 수집 대상
        cases.append(dict(nai_model=m, prompt='1girl, "hello"',
                          character_prompts_with_coords=[
                              {"prompt": '1girl, "world"', "uc": "", "coord": "b2"},
                          ]))
    # 캐릭터 상한 초과 (V4.5 는 6명 상한 → 7명 보내면 잘려야 한다)
    cases.append(dict(nai_model="nai-diffusion-4-5-full",
                      character_prompts=["c%d" % i for i in range(7)]))
    cases.append(dict(nai_model="nai-diffusion-5-full",
                      character_prompts=["c%d" % i for i in range(7)]))

    # ── img2img (Enhance 가 쓰는 경로) ────────────────────────────────
    for m in ("nai-diffusion-4-5-full", "nai-diffusion-5-full"):
        for st, ns in ((0.7, 0.0), (0.5, 0.1), (1.0, 0.0)):
            cases.append(dict(nai_model=m, base_image=_TEST_PNG, base_mode="img2img",
                              base_strength=st, base_noise=ns, seed=777))
    # 시드 0 → extra_noise_seed 가 -1 이 되는 경계
    cases.append(dict(nai_model="nai-diffusion-4-5-full", base_image=_TEST_PNG,
                      base_mode="img2img", seed=0))
    # Enhance 문구가 붙는 조합
    cases.append(dict(nai_model="nai-diffusion-4-5-full", base_image=_TEST_PNG,
                      base_mode="img2img", enhance_prompt_add=True, seed=42))

    # ── Precise Reference ─────────────────────────────────────────────
    for m in ("nai-diffusion-4-5-full", "nai-diffusion-5-full"):
        cases.append(dict(nai_model=m, precise_references=[
            {"image": _TEST_PNG, "mode": "character&style", "strength": 1.0, "fidelity": 1.0},
        ]))
        cases.append(dict(nai_model=m, precise_references=[
            {"image": _TEST_PNG, "mode": "character", "strength": 0.8, "fidelity": 0.4},
            {"image": _TEST_PNG, "mode": "style", "strength": 0.6, "fidelity": 0.75},
        ]))

    cases.append(dict(negative_prompt="bad hands, blurry"))
    cases.append(dict(negative_prompt="bad hands", uc_preset="None"))
    return cases


# 검사용 작은 PNG (16x16 흰색). 전처리를 거치므로 내용은 중요하지 않다.
def _make_test_png():
    from PIL import Image
    import io as _io
    buf = _io.BytesIO()
    Image.new("RGB", (16, 16), (255, 255, 255)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


_TEST_PNG = _make_test_png()

DEFAULTS = dict(
    provider="nai",
    prompt="1girl, smile",
    negative_prompt="",
    width=832, height=1216, steps=28, cfg=5.0, seed=12345,
    sampler="euler_ancestral", scheduler="normal",
    nai_model="nai-diffusion-4-5-full",
    uc_preset="Heavy", quality_preset="standard",
)


async def main():
    out = []
    for i, override in enumerate(build_cases()):
        kw = {**DEFAULTS, **override}
        req = backend.GenerateRequest(**kw)
        try:
            await backend.call_nai_api(req)
        except _Captured as c:
            out.append({"case": i, "input": kw, "url": c.payload["url"], "payload": c.payload["json"]})
        except Exception as e:
            out.append({"case": i, "input": kw, "error": f"{type(e).__name__}: {e}"})

    dest = Path(__file__).parent / "reference_payloads.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for o in out if "payload" in o)
    print(f"저장: {dest}")
    print(f"케이스 {len(out)}건 중 페이로드 확보 {ok}건, 실패 {len(out)-ok}건")
    for o in out:
        if "error" in o:
            print("  실패:", o["case"], o["error"])


asyncio.run(main())
