#!/usr/bin/env python3
"""PeroPix 일관성 채점기 — **선택 설치**. 수신함(receiver.py) 옆에 두면 켜진다.

    pip install torch transformers pillow
    (CPU 만 있어도 된다. 작은 모델을 쓴다.)

★receiver.py 는 이 파일이 없어도 그대로 돈다. 표준 라이브러리만 쓴다는 약속을 지키려고
  무거운 것을 전부 여기로 몰아 두었다. 없으면 수신함이 /ping 에서 score:false 를 돌려주고,
  앱은 「이 서버는 검사를 못 합니다」 로 표시한다.

★하는 일은 **특징 벡터를 뽑는 것까지**다. 고른지 아닌지 판정하는 것은 앱의
  consistency.js 가 한다. 폰에서 뽑든 여기서 뽑든 같은 잣대로 채점해야 하기 때문이다.
  판정을 양쪽에 따로 두면 서버를 켰다 껐다 할 때 점수가 달라진다.

무엇을 재느냐에 따라 모델이 다르다:
  style    그림체 — CLIP 이미지 인코더. 화풍·색감·선에 민감하다.
  identity 인물   — DINOv2. 같은 사람인지에 강하다 (배경·포즈가 달라도).
"""

import io
import os
import sys

# 모델 이름은 바꿔 끼울 수 있게 환경변수로 연다. 기본은 CPU 에서도 돌아가는 작은 것.
STYLE_MODEL = os.environ.get("PEROPIX_STYLE_MODEL", "openai/clip-vit-base-patch32")
ID_MODEL = os.environ.get("PEROPIX_ID_MODEL", "facebook/dinov2-small")

_cache = {}
_why = ""


def available() -> bool:
    """지금 채점이 가능한가. 무거운 것을 실제로 불러오지는 않는다."""
    global _why
    try:
        import torch          # noqa: F401
        import transformers   # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception as e:
        _why = str(e)
        return False


def why() -> str:
    """왜 못 하는지 한 줄. 사람이 바로 고칠 수 있게 설치 명령까지 붙인다."""
    if available():
        return ""
    return (_why or "필요한 것이 없습니다") + " — pip install torch transformers pillow"


def _load(kind: str):
    """모델을 한 번만 불러 두고 재사용한다. 매번 부르면 한 장에 수십 초가 걸린다."""
    key = "identity" if kind == "identity" else "style"
    if key in _cache:
        return _cache[key]
    import torch
    from transformers import AutoImageProcessor, AutoModel, CLIPVisionModelWithProjection

    name = ID_MODEL if key == "identity" else STYLE_MODEL
    proc = AutoImageProcessor.from_pretrained(name)
    if key == "style":
        model = CLIPVisionModelWithProjection.from_pretrained(name)
    else:
        model = AutoModel.from_pretrained(name)
    model.eval()
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    _cache[key] = (proc, model, key)
    return _cache[key]


def _vector(out, key):
    """모델마다 어디서 벡터를 꺼내는지가 다르다."""
    if key == "style":
        return out.image_embeds                      # CLIP 은 투영된 임베딩
    if getattr(out, "pooler_output", None) is not None:
        return out.pooler_output                     # DINOv2 는 CLS 풀링
    return out.last_hidden_state.mean(dim=1)


def embed(images, kind="style", batch=8):
    """이미지 여러 장 → 길이 1 로 맞춘 특징 벡터들.

    @param images  PNG/JPG 바이트들의 목록
    @param kind    'style' 또는 'identity'
    @returns       [[float, ...], ...]  — 못 읽은 장은 빈 목록 []
    """
    import torch
    from PIL import Image

    proc, model, key = _load(kind)
    out = [[] for _ in images]

    # 못 읽는 파일이 하나 섞였다고 전체가 죽으면 안 된다. 그 장만 빈 자리로 남긴다.
    good, idx = [], []
    for i, raw in enumerate(images):
        try:
            im = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            continue
        good.append(im)
        idx.append(i)

    for s in range(0, len(good), batch):
        chunk = good[s:s + batch]
        inputs = proc(images=chunk, return_tensors="pt")
        with torch.no_grad():
            vecs = _vector(model(**inputs), key)
        vecs = torch.nn.functional.normalize(vecs.float(), dim=-1)
        for j in range(vecs.shape[0]):
            out[idx[s + j]] = [round(float(x), 6) for x in vecs[j]]
    return out


def main():
    """직접 불러서 확인해 보는 용도. `python score.py a.png b.png`"""
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    kind = "identity" if "--identity" in sys.argv else "style"
    if not args:
        print("사용: python score.py [--identity] 그림1.png 그림2.png ...")
        print("설치 상태:", "가능" if available() else why())
        return 0
    if not available():
        print("못 합니다:", why())
        return 1
    raws = [open(p, "rb").read() for p in args]
    vecs = embed(raws, kind)
    for p, v in zip(args, vecs):
        print(p, "→", (str(len(v)) + "칸") if v else "못 읽음")
    return 0


if __name__ == "__main__":
    sys.exit(main())
