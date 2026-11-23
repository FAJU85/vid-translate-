# Stage 1: convert the OPUS-MT models (translation/opus.py) to CTranslate2. torch and transformers
# are only needed here; the final image gets the converted models alone.
FROM python:3.12-slim AS opus
RUN pip install --no-cache-dir torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "transformers==4.57.6" "ctranslate2==4.9.1" sentencepiece sacremoses
COPY tools/convert_opus.sh /convert_opus.sh
RUN sh /convert_opus.sh /opus

# Stage 2: the Space.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-noto-cjk espeak-ng \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces run the container as uid 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    HF_HOME=/home/user/.cache/huggingface \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user app ./app
# OPUS-MT models (CC-BY 4.0 / Apache 2.0, Helsinki-NLP), for the pairs where they beat NLLB.
COPY --from=opus --chown=user /opus /home/user/opus

# Bake the default models into the image (changing WHISPER_MODEL at runtime still works;
# the new model is then downloaded on first start).
RUN python -m app.preload

EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
