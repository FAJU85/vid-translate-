#!/bin/sh
# Container entry point: the proof-of-origin token server for YouTube, then the API.
#
# The token server (bgutil-ytdlp-pot-provider) listens on 127.0.0.1:4416 only, where yt-dlp's
# plugin finds it by default. It is restarted if it ever exits, so a crash costs a few seconds
# of YouTube downloads without tokens, never the API.
if [ -f /opt/bgutil/build/main.js ]; then
  (
    while true; do
      # Its normal output prints every token it makes, and the Space's log is published by the
      # Logs workflow, so only its errors are kept.
      node /opt/bgutil/build/main.js --port 4416 > /dev/null
      echo "token server exited ($?); restarting in 5 s" >&2
      sleep 5
    done
  ) &
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 7860
