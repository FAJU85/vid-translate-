# Proof-of-origin token server for YouTube (bgutil-ytdlp-pot-provider), built in its own stage
# so git and the build tools stay out of the final image. Keep the tag equal to the plugin
# version in requirements.txt.
FROM node:22-bookworm-slim AS pot
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /src
WORKDIR /src/server
RUN npm ci --no-audit --no-fund && npx tsc && npm prune --omit=dev && rm -rf src types

FROM python:3.12-slim

# The token server: the built JavaScript and its runtime. It listens on localhost only.
COPY --from=pot /usr/local/bin/node /usr/local/bin/node
COPY --from=pot /src/server /opt/bgutil

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JavaScript runtime to solve YouTube's player challenges.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

# Temporary, for /diag/network: a real Chromium, to compare a browser with plain requests.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN pip install --no-cache-dir playwright==1.55.0 \
 && playwright install --with-deps chromium \
 && chmod -R a+rX /opt/playwright \
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
COPY --chown=user start.sh ./

# Bake the default models into the image (changing WHISPER_MODEL at runtime still works;
# the new model is then downloaded on first start).
RUN python -m app.preload

EXPOSE 7860
# start.sh runs the token server (kept alive) next to the API.
CMD ["sh", "start.sh"]
