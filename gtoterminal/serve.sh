#!/bin/bash
# Simple local server for GTOTerminal
# Required for Twitch embeds and .env loading (both need http://, not file://)
PORT=${1:-8080}
echo "GTOTerminal serving at http://localhost:$PORT"
python3 -m http.server "$PORT"
