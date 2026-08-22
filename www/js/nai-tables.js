// ⚠ 자동 생성 파일 — 직접 고치지 말 것.
// 원본: backend.py / 생성: mobile/tools/export_tables.py
// 갱신: python/python.exe mobile/tools/export_tables.py
'use strict';
const NAI_TABLES = {
 "SAMPLER_MAP": {
  "euler_ancestral": "k_euler_ancestral",
  "euler": "k_euler",
  "dpmpp_2m": "k_dpmpp_2m",
  "dpmpp_2m_sde": "k_dpmpp_2m_sde",
  "dpmpp_sde": "k_dpmpp_sde",
  "dpmpp_3m_sde": "k_dpmpp_sde",
  "dpmpp_2s_ancestral": "k_dpmpp_2s_ancestral",
  "ddim": "ddim",
  "uni_pc": "k_euler",
  "lcm": "k_euler"
 },
 "SCHEDULER_MAP": {
  "normal": "karras",
  "karras": "karras",
  "exponential": "exponential",
  "sgm_uniform": "karras",
  "simple": "karras",
  "ddim_uniform": "karras",
  "beta": "karras"
 },
 "QUALITY_PRESETS": {
  "nai-diffusion-5-full": [
   [
    "standard",
    ", very aesthetic, masterpiece, no text"
   ],
   [
    "light",
    ", very aesthetic, amazing quality, no text"
   ],
   [
    "none",
    ""
   ]
  ],
  "nai-diffusion-4-5-full": [
   [
    "standard",
    ", very aesthetic, masterpiece, no text"
   ],
   [
    "none",
    ""
   ]
  ],
  "nai-diffusion-4-5-curated": [
   [
    "standard",
    ", very aesthetic, masterpiece, no text, -0.8::feet::, rating:general"
   ],
   [
    "none",
    ""
   ]
  ],
  "nai-diffusion-4-full": [
   [
    "standard",
    ", no text, best quality, very aesthetic, absurdres"
   ],
   [
    "none",
    ""
   ]
  ],
  "nai-diffusion-4-curated-preview": [
   [
    "standard",
    ", rating:general, best quality, very aesthetic, absurdres"
   ],
   [
    "none",
    ""
   ]
  ],
  "nai-diffusion-5-curated": [
   [
    "standard",
    ", very aesthetic, masterpiece, no text"
   ],
   [
    "light",
    ", very aesthetic, amazing quality, no text"
   ],
   [
    "none",
    ""
   ]
  ]
 },
 "UC_PRESETS": {
  "nai-diffusion-5-full": [
   [
    "heavy",
    "Heavy",
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"
   ],
   [
    "light",
    "Light",
    "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::"
   ],
   [
    "furry",
    "Furry Focus",
    "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic"
   ],
   [
    "human",
    "Human Focus",
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"
   ],
   [
    "none",
    "None",
    ""
   ]
  ],
  "nai-diffusion-4-5-full": [
   [
    "heavy",
    "Heavy",
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"
   ],
   [
    "light",
    "Light",
    "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page"
   ],
   [
    "furry",
    "Furry Focus",
    "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic"
   ],
   [
    "human",
    "Human Focus",
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"
   ],
   [
    "none",
    "None",
    ""
   ]
  ],
  "nai-diffusion-4-5-curated": [
   [
    "heavy",
    "Heavy",
    "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page"
   ],
   [
    "light",
    "Light",
    "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page"
   ],
   [
    "human",
    "Human Focus",
    "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page"
   ],
   [
    "none",
    "None",
    ""
   ]
  ],
  "nai-diffusion-5-curated": [
   [
    "heavy",
    "Heavy",
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page"
   ],
   [
    "light",
    "Light",
    "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::"
   ],
   [
    "furry",
    "Furry Focus",
    "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic"
   ],
   [
    "human",
    "Human Focus",
    "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy"
   ],
   [
    "none",
    "None",
    ""
   ]
  ]
 },
 "UC_PRESET_ID": {
  "heavy": "heavy",
  "light": "light",
  "human": "humanFocus",
  "furry": "furryFocus",
  "none": "none"
 },
 "UC_CATEGORY_FALLBACK": {
  "none": [
   "none",
   "light",
   "heavy"
  ],
  "light": [
   "light",
   "none",
   "heavy"
  ],
  "heavy": [
   "heavy",
   "light",
   "none"
  ],
  "human": [
   "human",
   "heavy",
   "light",
   "none"
  ],
  "furry": [
   "furry",
   "heavy",
   "light",
   "none"
  ]
 },
 "NO_NSFW_PREFIX": [
  "nai-diffusion-4-5-curated",
  "nai-diffusion-4-5-curated-inpainting",
  "nai-diffusion-5-curated",
  "nai-diffusion-5-curated-inpainting"
 ],
 "TAG_HINT_ID": {
  "none": 0,
  "standard": 1,
  "heavy": 2,
  "light": 3,
  "human": 4,
  "furry": 5
 },
 "MODEL_CAPS": {
  "nai-diffusion-5-full": {
   "vibe": false,
   "char_ref": false,
   "noise_schedule": false,
   "cfg_rescale": true,
   "cfg_delay": false,
   "transparency": true,
   "enhance_prompt_add": true,
   "text": true,
   "freeform_position": true,
   "max_characters": 32,
   "cfg_delay_sigma": 58,
   "opus_usage_limit": true,
   "anlas_multiplier": 1.5
  },
  "nai-diffusion-5-curated": {
   "vibe": false,
   "char_ref": false,
   "noise_schedule": false,
   "cfg_rescale": true,
   "cfg_delay": false,
   "transparency": true,
   "enhance_prompt_add": true,
   "text": true,
   "freeform_position": true,
   "max_characters": 32,
   "cfg_delay_sigma": 58,
   "opus_usage_limit": true,
   "anlas_multiplier": 1.5
  },
  "nai-diffusion-4-5-full": {
   "vibe": true,
   "char_ref": true,
   "noise_schedule": true,
   "cfg_rescale": true,
   "cfg_delay": true,
   "transparency": false,
   "enhance_prompt_add": true,
   "text": true,
   "freeform_position": false,
   "max_characters": 6,
   "cfg_delay_sigma": 58,
   "opus_usage_limit": false,
   "anlas_multiplier": 1.0
  },
  "nai-diffusion-4-5-curated": {
   "vibe": true,
   "char_ref": true,
   "noise_schedule": true,
   "cfg_rescale": true,
   "cfg_delay": true,
   "transparency": false,
   "enhance_prompt_add": true,
   "text": true,
   "freeform_position": false,
   "max_characters": 6,
   "cfg_delay_sigma": 58,
   "opus_usage_limit": false,
   "anlas_multiplier": 1.0
  }
 },
 "CAPS_FALLBACK": {
  "vibe": true,
  "char_ref": false,
  "noise_schedule": true,
  "cfg_rescale": true,
  "cfg_delay": true,
  "transparency": false,
  "enhance_prompt_add": false,
  "text": true,
  "freeform_position": false,
  "max_characters": 6,
  "cfg_delay_sigma": 19,
  "opus_usage_limit": false,
  "anlas_multiplier": 1.0
 },
 "BASE_MODEL": {
  "nai-diffusion-5-full-inpainting": "nai-diffusion-5-full",
  "nai-diffusion-5-curated-inpainting": "nai-diffusion-5-curated",
  "nai-diffusion-4-5-full-inpainting": "nai-diffusion-4-5-full",
  "nai-diffusion-4-5-curated-inpainting": "nai-diffusion-4-5-curated",
  "nai-diffusion-4-full-inpainting": "nai-diffusion-4-full",
  "nai-diffusion-4-curated-inpainting": "nai-diffusion-4-curated-preview"
 },
 "INPAINT_MODEL": {
  "nai-diffusion-5-full": "nai-diffusion-5-full-inpainting",
  "nai-diffusion-5-curated": "nai-diffusion-4-5-curated-inpainting",
  "nai-diffusion-4-5-full": "nai-diffusion-4-5-full-inpainting",
  "nai-diffusion-4-5-curated": "nai-diffusion-4-5-curated-inpainting",
  "nai-diffusion-4-full": "nai-diffusion-4-full-inpainting",
  "nai-diffusion-4-curated-preview": "nai-diffusion-4-curated-inpainting",
  "custom": "custom"
 },
 "TRANSPARENT_BG_TAG": "transparent background",
 "ENHANCE_PROMPT_ADD": ", -2::upscaled, blurry::,",
 "NAIT": {
  "SEP": "|",
  "ESCAPED_SEP": "||",
  "MAX_PARTS": 6,
  "AUTO_TAG": "teXt:",
  "QUOTES": {
   "\"": "\"",
   "\u201c": "\u201d",
   "\u300c": "\u300d",
   "'": "'",
   "\u2018": "\u2019"
  },
  "CJK_RATIO": 0.3,
  "GAP_MAX": 0.1,
  "SPAN_MAX": 0.15,
  "TMP_SEP": "\ud800\udfb9",
  "TMP_ESC": "\ud808\udd37",
  "CJK_CLASS": "[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]",
  "AUTO_RE": "(?:^|\\s|[,.:\\[\\]{}\u3001\u3002])teXt:(?!:)",
  "AUTO_RE_FLAGS": ""
 },
 "TEXT_CLAUSE_RE": "(?:^|\\s|[,.:\\[\\]{}\u3001\u3002])text:(?!:)",
 "TEXT_CLAUSE_FLAGS": "i",
 "CENTER_GRID": [
  0.1,
  0.3,
  0.5,
  0.7,
  0.9
 ]
};
if (typeof module !== 'undefined') module.exports = NAI_TABLES;
