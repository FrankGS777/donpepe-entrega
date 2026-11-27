#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
DP_PROJECT="$(cd "$(dirname "$0")/../.." && pwd)"
DP_PID_FILE="$HOME/Library/Logs/DonPepe/servidor.pid"
DP_CANDIDATES=""
if [[ -f "$DP_PID_FILE" ]]; then
  DP_SAVED="$(cat "$DP_PID_FILE")"
  if [[ "$DP_SAVED" =~ ^[0-9]+$ ]]; then DP_CANDIDATES="$DP_SAVED"; fi
fi
DP_LISTENER="$(/usr/sbin/lsof -tiTCP:3010 -sTCP:LISTEN 2>/dev/null || true)"
DP_CANDIDATES="$DP_CANDIDATES $DP_LISTENER"
DP_STOPPED=0
for DP_PID in $DP_CANDIDATES; do
  kill -0 "$DP_PID" 2>/dev/null || continue
  DP_COMMAND="$(ps -p "$DP_PID" -o command= 2>/dev/null || true)"
  DP_CWD="$(/usr/sbin/lsof -a -p "$DP_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  # A reused PID or an unrelated application on this port must never be killed.
  if [[ "$DP_CWD" != "$DP_PROJECT" || "$DP_COMMAND" != *node* || "$DP_COMMAND" != *v2/server.js* ]]; then continue; fi
  kill -TERM "$DP_PID" 2>/dev/null || continue
  for ((i=0;i<100;i++)); do
    kill -0 "$DP_PID" 2>/dev/null || break
    sleep .1
  done
  if kill -0 "$DP_PID" 2>/dev/null; then
    echo "DonPepe todavía está cerrando sus conexiones. Intenta nuevamente en unos segundos."
    exit 1
  fi
  DP_STOPPED=1
done
if [[ -f "$DP_PID_FILE" ]]; then
  DP_SAVED="$(cat "$DP_PID_FILE")"
  if [[ "$DP_SAVED" =~ ^[0-9]+$ ]] && ! kill -0 "$DP_SAVED" 2>/dev/null; then rm -f "$DP_PID_FILE"; fi
fi
if [[ "$DP_STOPPED" == 1 ]]; then echo "DonPepe cerrado. Puedes cerrar esta ventana."
else echo "DonPepe ya está apagado. Puedes cerrar esta ventana."; fi
