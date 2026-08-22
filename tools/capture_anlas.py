"""backend.py 의 Anlas 계산 결과를 기준값으로 뽑는다.

★이 숫자가 틀리면 "무료인 줄 알았는데 차감" 또는 그 반대가 된다. 둘 다 실제로 있었던 사고다.
사용: python/python.exe mobile/tools/capture_anlas.py
"""
import sys, json, itertools
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import backend as B

cases = []
models = ["nai-diffusion-4-5-full", "nai-diffusion-5-full", "nai-diffusion-4-full"]
sizes = [(832, 1216), (1024, 1024), (640, 640), (1216, 1216), (2048, 2048)]
steps_list = [23, 28, 29, 50]
opus_list = [True, False]

for model, (w, h), st, opus in itertools.product(models, sizes, steps_list, opus_list):
    cases.append(dict(width=w, height=h, steps=st, is_opus=opus, model=model,
                      strength=1.0, precise_ref_count=0, opus_exhausted=False,
                      smea=False, smea_dyn=False))

# 참조 개수 · strength · Opus 소진 · SMEA
for model in models:
    for refs in (1, 2, 4):
        cases.append(dict(width=832, height=1216, steps=28, is_opus=True, model=model,
                          strength=1.0, precise_ref_count=refs, opus_exhausted=False,
                          smea=False, smea_dyn=False))
    for stg in (0.3, 0.5, 0.7, 1.0):
        cases.append(dict(width=832, height=1216, steps=28, is_opus=False, model=model,
                          strength=stg, precise_ref_count=0, opus_exhausted=False,
                          smea=False, smea_dyn=False))
    for ex in (True, False):
        cases.append(dict(width=832, height=1216, steps=28, is_opus=True, model=model,
                          strength=1.0, precise_ref_count=0, opus_exhausted=ex,
                          smea=False, smea_dyn=False))
    for sm, dyn in ((True, False), (True, True)):
        cases.append(dict(width=832, height=1216, steps=28, is_opus=False, model=model,
                          strength=1.0, precise_ref_count=0, opus_exhausted=False,
                          smea=sm, smea_dyn=dyn))

out = []
for c in cases:
    per = B.calculate_anlas_cost(
        c["width"], c["height"], c["steps"], is_opus=c["is_opus"],
        vibe_count=0, has_char_ref=False, strength=c["strength"],
        precise_ref_count=c["precise_ref_count"], vibe_encode_cost=0,
        smea=c["smea"], smea_dyn=c["smea_dyn"],
        model=c["model"], opus_exhausted=c["opus_exhausted"])
    sample = B.nai_image_sample_cost(c["width"], c["height"], c["steps"],
                                     smea=c["smea"], smea_dyn=c["smea_dyn"], model=c["model"])
    out.append({"input": c, "per_image": per, "sample_cost": sample})

dest = Path(__file__).parent / "reference_anlas.json"
dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"저장: {dest}")
print(f"케이스 {len(out)}건")
