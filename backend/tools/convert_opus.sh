#!/bin/sh
# Convert the OPUS-MT models KAVOX uses (app/modules/translation/opus.py) to CTranslate2 int8.
# Usage: convert_opus.sh <output dir>. Needs torch, transformers 4.x, ctranslate2, sentencepiece.
# transformers 5.x loads the "tc-big" models wrongly (the converted model writes nonsense), so
# conversion is pinned to 4.x; each model is pinned to the exact version that was measured.
set -eu
out="$1"
convert() {
  ct2-transformers-converter --model "Helsinki-NLP/$1" --revision "$2" --output_dir "$out/$1" \
    --quantization int8 --copy_files source.spm target.spm README.md
}
convert opus-mt-tc-big-ar-en bcb4acd39ee8e3552e171653a8e31a10729b4330
convert opus-mt-tc-big-en-ar ae9f1b2fd512000ca9440eb3b8ec9aa9acb298ac
convert opus-mt-en-fr dd7f6540a7a48a7f4db59e5c0b9c42c8eea67f18
