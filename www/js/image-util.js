// 이미지 처리 — PNG 청크(메타데이터), 리샘플, 형식 변환.
//
// ★PNG 메타데이터는 tEXt 청크다. NAI 가 붙여 보낸 Title/Description/Software/Source/
//   Generation time 을 **보존**하고 우리 것(Comment)을 더한다. 원본 청크가 사라지면
//   공홈이 그 그림을 NAI 산출물로 알아보지 못한다.
// ★리샘플은 lanczos3 를 직접 구현한다. 캔버스 기본 축소는 필터가 달라 초기 latent 가
//   바뀌고, 그러면 Enhance 결과가 데스크톱 버전과 갈린다.
'use strict';

const ImageUtil = (function () {
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // NAI 가 붙이는 청크들. 순서·이름을 그대로 유지한다.
  const NAI_TEXT_KEYS = ['Title', 'Description', 'Software', 'Source', 'Generation time'];

  // ── CRC32 (PNG 청크용) ───────────────────────────────────────────────────
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function isPng(bytes) {
    if (!bytes || bytes.length < 8) return false;
    for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
    return true;
  }

  // ── PNG 청크 ─────────────────────────────────────────────────────────────
  function readChunks(bytes) {
    if (!isPng(bytes)) throw new Error('PNG 이 아닙니다.');
    const out = [];
    let p = 8;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (p + 8 <= bytes.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      const dataStart = p + 8;
      if (dataStart + len + 4 > bytes.length) break;
      out.push({ type: type, data: bytes.subarray(dataStart, dataStart + len) });
      p = dataStart + len + 4;
      if (type === 'IEND') break;
    }
    return out;
  }

  function buildChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const forCrc = out.subarray(4, 8 + data.length);
    dv.setUint32(8 + data.length, crc32(forCrc));
    return out;
  }

  function textChunkData(key, value) {
    // tEXt: 키(Latin-1) + 0x00 + 값. 값이 ASCII 를 벗어나면 iTXt(UTF-8)를 쓴다.
    const ascii = /^[\x20-\x7e]*$/.test(value);
    if (ascii) {
      const k = new TextEncoder().encode(key);
      const v = new TextEncoder().encode(value);
      const d = new Uint8Array(k.length + 1 + v.length);
      d.set(k, 0); d[k.length] = 0; d.set(v, k.length + 1);
      return { type: 'tEXt', data: d };
    }
    // iTXt: 키 \0 압축플래그 압축방식 \0 언어 \0 번역키 \0 UTF-8값
    const k = new TextEncoder().encode(key);
    const v = new TextEncoder().encode(value);
    const d = new Uint8Array(k.length + 5 + v.length);
    let i = 0;
    d.set(k, i); i += k.length;
    d[i++] = 0;   // 널
    d[i++] = 0;   // 압축 안 함
    d[i++] = 0;   // 압축 방식
    d[i++] = 0;   // 언어 태그 없음
    d[i++] = 0;   // 번역 키 없음
    d.set(v, i);
    return { type: 'iTXt', data: d };
  }

  function parseTextChunk(chunk) {
    const d = chunk.data;
    let z = d.indexOf(0);
    if (z < 0) return null;
    const key = new TextDecoder().decode(d.subarray(0, z));
    if (chunk.type === 'tEXt') {
      return { key: key, value: new TextDecoder().decode(d.subarray(z + 1)) };
    }
    if (chunk.type === 'iTXt') {
      // 키 \0 압축플래그 압축방식 \0 언어 \0 번역키 \0 값
      let p = z + 1;
      const compressed = d[p]; p += 2;
      let n = 0;
      while (p < d.length && n < 2) { if (d[p] === 0) n++; p++; }
      if (compressed) return { key: key, value: '' };  // 압축된 것은 읽지 않는다
      return { key: key, value: new TextDecoder().decode(d.subarray(p)) };
    }
    return null;
  }

  /** PNG 안의 텍스트 메타데이터를 전부 읽는다. */
  function getTexts(bytes) {
    const out = {};
    readChunks(bytes).forEach(function (c) {
      if (c.type === 'tEXt' || c.type === 'iTXt') {
        const kv = parseTextChunk(c);
        if (kv && out[kv.key] === undefined) out[kv.key] = kv.value;
      }
    });
    return out;
  }

  function assemble(chunks) {
    let total = 8;
    const built = chunks.map(function (c) {
      const b = buildChunk(c.type, c.data);
      total += b.length;
      return b;
    });
    const out = new Uint8Array(total);
    out.set(PNG_SIG, 0);
    let p = 8;
    built.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  /**
   * 텍스트 청크를 더하거나 바꾼다. 기존 NAI 청크는 그대로 둔다.
   * @param {Uint8Array} bytes PNG
   * @param {object} entries {키: 값}
   */
  function setTexts(bytes, entries) {
    const chunks = readChunks(bytes);
    const keys = Object.keys(entries || {});
    // 같은 키의 기존 청크는 걷어낸다 (중복 방지).
    const kept = chunks.filter(function (c) {
      if (c.type !== 'tEXt' && c.type !== 'iTXt') return true;
      const kv = parseTextChunk(c);
      return !kv || keys.indexOf(kv.key) === -1;
    });
    const added = keys.filter(function (k) {
      return entries[k] !== undefined && entries[k] !== null && entries[k] !== '';
    }).map(function (k) { return textChunkData(k, String(entries[k])); });

    // ★IEND 앞에 넣는다. 뒤에 붙이면 읽는 쪽이 무시한다.
    const iendAt = kept.findIndex(function (c) { return c.type === 'IEND'; });
    const at = iendAt === -1 ? kept.length : iendAt;
    return assemble(kept.slice(0, at).concat(added, kept.slice(at)));
  }

  /** 모든 텍스트 메타데이터를 없앤다. */
  function stripTexts(bytes) {
    const kept = readChunks(bytes).filter(function (c) {
      return c.type !== 'tEXt' && c.type !== 'iTXt' && c.type !== 'zTXt' && c.type !== 'eXIf';
    });
    return assemble(kept);
  }

  // ── lanczos3 리샘플 ──────────────────────────────────────────────────────
  function lanczos(x, a) {
    if (x === 0) return 1;
    const ax = Math.abs(x);
    if (ax >= a) return 0;
    const px = Math.PI * x;
    return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
  }

  /**
   * 한 축의 기여도 표.
   *
   * ★PIL(Pillow) 의 ImagingResampleHorizontal 과 **같은 식**이어야 한다.
   *   창 경계를 floor/ceil 로 잡으면 탭이 한 칸씩 어긋나 가는 선에서 최대 70 까지 벌어진다
   *   (실측). PIL 은 `int(center ± support + 0.5)` 로 **반올림**하고 상한은 **배타적**이다.
   */
  function buildWeights(srcLen, dstLen, a) {
    const scaleRatio = srcLen / dstLen;              // PIL 의 scale
    const filterscale = Math.max(1.0, scaleRatio);   // 축소일 때만 커널을 늘린다
    const support = a * filterscale;
    const ss = 1.0 / filterscale;

    const rows = [];
    for (let i = 0; i < dstLen; i++) {
      const center = (i + 0.5) * scaleRatio;
      let xmin = Math.trunc(center - support + 0.5);
      if (xmin < 0) xmin = 0;
      let xmax = Math.trunc(center + support + 0.5);
      if (xmax > srcLen) xmax = srcLen;

      const idx = [];
      const w = [];
      let sum = 0;
      for (let j = xmin; j < xmax; j++) {
        // ★0 인 가중치도 버리지 않는다 — PIL 은 창 안의 탭을 전부 세고 합으로 나눈다.
        const t = lanczos((j - center + 0.5) * ss, a);
        idx.push(j); w.push(t); sum += t;
      }
      // 합으로 나눠 밝기를 보존한다. 안 하면 가장자리가 어두워진다.
      if (sum !== 0) for (let k = 0; k < w.length; k++) w[k] /= sum;
      rows.push({ idx: idx, w: w });
    }
    return rows;
  }

  /**
   * RGBA 픽셀을 lanczos3 로 다시 표본화한다.
   *
   * ★Pillow 는 RGBA 를 리사이즈할 때 **RGBa(미리 곱한 알파)로 바꿔서** 처리하고 되돌린다
   *   (Image.resize 안의 convert("RGBa") → resize → convert("RGBA")).
   *   이걸 빼면 알파 경계에서 색이 번져 최대 27 까지 벌어진다 (실측).
   * @param {Uint8ClampedArray} src RGBA
   */
  function resampleLanczos(src, sw, sh, dw, dh) {
    const A = 3;

    // 알파를 미리 곱한다.
    const pre = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      if (a === 255) {
        pre[i] = src[i]; pre[i + 1] = src[i + 1]; pre[i + 2] = src[i + 2];
      } else if (a === 0) {
        pre[i] = 0; pre[i + 1] = 0; pre[i + 2] = 0;
      } else {
        pre[i] = (src[i] * a + 127) / 255;
        pre[i + 1] = (src[i + 1] * a + 127) / 255;
        pre[i + 2] = (src[i + 2] * a + 127) / 255;
      }
      pre[i + 3] = a;
    }
    src = pre;

    const hx = buildWeights(sw, dw, A);
    const hy = buildWeights(sh, dh, A);

    // ★가로 패스 결과를 **8비트로 반올림·클램프해서** 넘긴다. PIL 이 그렇게 한다
    //   (중간 이미지가 8bpc 다). float 로 넘기면 더 "정확"하지만 원본과 갈린다 —
    //   고대비 경계의 링잉이 잘리는 지점이 달라져 최대 17 까지 벌어졌다 (실측).
    const tmp = new Uint8ClampedArray(dw * sh * 4);
    for (let y = 0; y < sh; y++) {
      const srow = y * sw * 4;
      const trow = y * dw * 4;
      for (let x = 0; x < dw; x++) {
        const { idx, w } = hx[x];
        let r = 0, g = 0, b = 0, al = 0;
        for (let k = 0; k < idx.length; k++) {
          const p = srow + idx[k] * 4;
          const wk = w[k];
          r += src[p] * wk; g += src[p + 1] * wk; b += src[p + 2] * wk; al += src[p + 3] * wk;
        }
        const t = trow + x * 4;
        tmp[t] = Math.round(r); tmp[t + 1] = Math.round(g);
        tmp[t + 2] = Math.round(b); tmp[t + 3] = Math.round(al);
      }
    }

    // 세로
    const out = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      const { idx, w } = hy[y];
      const orow = y * dw * 4;
      for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0, al = 0;
        for (let k = 0; k < idx.length; k++) {
          const p = (idx[k] * dw + x) * 4;
          const wk = w[k];
          r += tmp[p] * wk; g += tmp[p + 1] * wk; b += tmp[p + 2] * wk; al += tmp[p + 3] * wk;
        }
        const o = orow + x * 4;
        out[o] = Math.round(r); out[o + 1] = Math.round(g);
        out[o + 2] = Math.round(b); out[o + 3] = Math.round(al);
      }
    }

    // 미리 곱한 알파를 되돌린다 (RGBa → RGBA).
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      if (a === 255) continue;
      if (a === 0) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; continue; }
      out[i] = Math.round(out[i] * 255 / a);
      out[i + 1] = Math.round(out[i + 1] * 255 / a);
      out[i + 2] = Math.round(out[i + 2] * 255 / a);
    }
    return out;
  }

  // ── 브라우저 전용 (캔버스) ───────────────────────────────────────────────
  async function toImageData(bytes, mime) {
    // ★형식을 알려 주어야 한다. 폰에서 고른 배경은 JPEG·WebP 일 수 있는데,
    //   전부 image/png 라고 우기면 기기에 따라 디코드가 통째로 실패한다.
    const blob = new Blob([bytes], { type: mime || 'image/png' });
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const data = cx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close && bmp.close();
    return data;
  }

  function fromImageData(data) {
    const cv = document.createElement('canvas');
    cv.width = data.width; cv.height = data.height;
    cv.getContext('2d').putImageData(data, 0, 0);
    return cv;
  }

  async function canvasToBytes(cv, mime, quality) {
    const blob = await new Promise(function (res) { cv.toBlob(res, mime, quality); });
    if (!blob) throw new Error(mime + ' 로 저장할 수 없습니다 (이 기기가 지원하지 않음).');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * 베이스 이미지를 요청 해상도로 맞추고 알파를 흰색으로 깐다.
   * ★backend.py 의 preprocess_base_image() 와 같은 절차여야 한다.
   * @returns {Promise<string>} base64 PNG
   */
  async function preprocessBaseImage(bytes, width, height) {
    const src = await toImageData(bytes);
    let px = src.data;
    let w = src.width;
    let h = src.height;

    if (w !== width || h !== height) {
      px = resampleLanczos(px, w, h, width, height);
      w = width; h = height;
    }

    // 알파를 흰 배경에 평탄화
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255;
      if (a < 1) {
        px[i] = Math.round(px[i] * a + 255 * (1 - a));
        px[i + 1] = Math.round(px[i + 1] * a + 255 * (1 - a));
        px[i + 2] = Math.round(px[i + 2] * a + 255 * (1 - a));
        px[i + 3] = 255;
      }
    }

    const out = new ImageData(px instanceof Uint8ClampedArray ? px : new Uint8ClampedArray(px), w, h);
    const cv = fromImageData(out);
    const png = await canvasToBytes(cv, 'image/png');
    return toBase64(png);
  }

  /**
   * 긴 변이 max 를 넘으면 줄인다. 참조 이미지를 저장소에 넣기 전에 쓴다.
   * ★원본을 그대로 담으면 설정 저장소가 몇 MB 로 불어 앱이 느려진다.
   * @returns {Promise<{base64: string, width: number, height: number}>}
   */
  async function shrinkToBase64(bytes, max) {
    const src = await toImageData(bytes);
    let w = src.width, h = src.height;
    let px = src.data;

    const longest = Math.max(w, h);
    if (longest > max) {
      const k = max / longest;
      const nw = Math.max(1, Math.round(w * k));
      const nh = Math.max(1, Math.round(h * k));
      px = resampleLanczos(px, w, h, nw, nh);
      w = nw; h = nh;
    }

    const cv = fromImageData(new ImageData(
      px instanceof Uint8ClampedArray ? px : new Uint8ClampedArray(px), w, h));
    const png = await canvasToBytes(cv, 'image/png');
    return { base64: toBase64(png), width: w, height: h };
  }

  /** PNG 바이트를 다른 형식으로 바꾼다. PNG 면 원본을 그대로 돌려준다(재인코딩 없음). */
  async function convert(bytes, format, quality) {
    const f = (format || 'png').toLowerCase();
    if (f === 'png') return { bytes: bytes, ext: '.png' };

    const data = await toImageData(bytes);
    const cv = fromImageData(data);
    if (f === 'jpg' || f === 'jpeg') {
      // ★JPEG 는 투명을 못 담는다. 흰 배경을 먼저 깔지 않으면 검게 나온다.
      const flat = document.createElement('canvas');
      flat.width = cv.width; flat.height = cv.height;
      const fx = flat.getContext('2d');
      fx.fillStyle = '#fff';
      fx.fillRect(0, 0, flat.width, flat.height);
      fx.drawImage(cv, 0, 0);
      return { bytes: await canvasToBytes(flat, 'image/jpeg', (quality || 95) / 100), ext: '.jpg' };
    }
    if (f === 'webp') {
      return { bytes: await canvasToBytes(cv, 'image/webp', (quality || 95) / 100), ext: '.webp' };
    }
    throw new Error('모르는 저장 형식: ' + format);
  }

  // ── base64 ───────────────────────────────────────────────────────────────
  function toBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function fromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  return {
    isPng: isPng,
    toImageData: toImageData,
    fromImageData: fromImageData,
    canvasToBytes: canvasToBytes,
    readChunks: readChunks,
    getTexts: getTexts,
    setTexts: setTexts,
    stripTexts: stripTexts,
    resampleLanczos: resampleLanczos,
    preprocessBaseImage: preprocessBaseImage,
    shrinkToBase64: shrinkToBase64,
    convert: convert,
    toBase64: toBase64,
    fromBase64: fromBase64,
    crc32: crc32,
    NAI_TEXT_KEYS: NAI_TEXT_KEYS
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ImageUtil;
