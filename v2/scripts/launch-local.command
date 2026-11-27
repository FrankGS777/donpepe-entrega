#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
DP_PROJECT="$(cd "$(dirname "$0")/../.." && pwd)"
DP_LOG_DIR="${DONPEPE_LAUNCH_LOG_DIR:-$HOME/Library/Logs/DonPepe}"
DP_PORT="${DONPEPE_LAUNCH_PORT:-3010}"
DP_URL="http://127.0.0.1:$DP_PORT"
DP_LOCK="$DP_LOG_DIR/inicio.lock"
DP_OWN_LOCK=0

fail() {
  echo ""
  echo "$1"
  if [[ -t 0 ]]; then read -r -p "Pulsa Enter para cerrar." _; fi
  exit 1
}
cleanup() {
  if [[ "$DP_OWN_LOCK" == 1 ]]; then
    rm -f "$DP_LOCK/pid"
    rmdir "$DP_LOCK" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
command -v node >/dev/null || fail "No se encontró Node.js. Instala Node.js 22.13 o una versión posterior."
DP_NODE="$(command -v node)"
"$DP_NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' || fail "DonPepe necesita Node.js 22.13 o posterior."
"$DP_NODE" -e 'const n=Number(process.argv[1]);process.exit(Number.isInteger(n)&&n>=1024&&n<=65535?0:1)' "$DP_PORT" || fail "El puerto configurado no es válido."
cd "$DP_PROJECT"

ready() {
  local response
  response="$(/usr/bin/curl --noproxy '*' -fsS --max-time 1 "$DP_URL/health" 2>/dev/null)" || return 1
  printf '%s' "$response" | "$DP_NODE" -e 'try{const h=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(h.ok===true&&h.version==="3.1"&&h.mode==="academic-simulation"?0:1)}catch{process.exit(1)}'
}
open_app() {
  if [[ "${1:-}" != '--sin-navegador' ]]; then /usr/bin/open -a "Google Chrome" "$DP_URL/"; fi
  echo "DonPepe disponible en $DP_URL"
  echo "Puedes cerrar esta ventana; la aplicación seguirá funcionando."
}
if [[ "${1:-}" == '--comprobar' ]]; then
  [[ -f v2/server.js && -f package.json ]] || fail "No se encontraron los archivos de DonPepe."
  echo "Acceso preparado. Node.js $("$DP_NODE" --version). Proyecto encontrado."
  exit 0
fi
if ready; then open_app "${1:-}"; exit 0; fi
mkdir -p "$DP_LOG_DIR"

# An atomic lock makes repeated double-clicks share the same startup.
if ! mkdir "$DP_LOCK" 2>/dev/null; then
  DP_PREVIOUS="$(cat "$DP_LOCK/pid" 2>/dev/null || true)"
  if [[ "$DP_PREVIOUS" =~ ^[0-9]+$ ]] && kill -0 "$DP_PREVIOUS" 2>/dev/null; then
    echo "DonPepe se está iniciando…"
    for ((i=0;i<150;i++)); do
      if ready; then open_app "${1:-}"; exit 0; fi
      sleep .2
    done
    fail "El inicio está tardando más de lo previsto. Revisa $DP_LOG_DIR/servidor.log"
  fi
  # An interrupted launch can leave its lock after the owning process exits.
  rm -f "$DP_LOCK/pid"
  rmdir "$DP_LOCK" 2>/dev/null || fail "No se pudo preparar el inicio de DonPepe."
  mkdir "$DP_LOCK" || fail "Ya hay otro inicio de DonPepe en curso."
fi
DP_OWN_LOCK=1
printf '%s\n' "$$" > "$DP_LOCK/pid"
if ready; then open_app "${1:-}"; exit 0; fi
if /usr/sbin/lsof -nP "-iTCP:$DP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "El puerto $DP_PORT está ocupado por otra aplicación. DonPepe no la ha detenido."
fi
if [[ ! -d node_modules/express || ! -x node_modules/.bin/esbuild ]]; then
  echo "Preparando los componentes de DonPepe…"
  npm ci --no-audit --no-fund || fail "No se pudieron preparar los componentes. Revisa la conexión a Internet."
fi
if [[ ! -s v2/public/app.js || ! -s v2/public/app-bundle.css || ! -s v2/public/auth-bundle.css ]] ||
   [[ -n "$(find v2/frontend v2/core -type f \( -name '*.js' -o -name '*.css' \) -newer v2/public/app.js -print -quit 2>/dev/null)" ]] ||
   [[ package.json -nt v2/public/app.js || package-lock.json -nt v2/public/app.js ]]; then
  echo "Preparando los últimos cambios…"
  npm run build:v2 >> "$DP_LOG_DIR/servidor.log" 2>&1 || fail "No se pudieron preparar las vistas. Revisa $DP_LOG_DIR/servidor.log"
fi
echo "Abriendo DonPepe…"
export PORT="$DP_PORT" DONPEPE_PORT="$DP_PORT" DONPEPE_HOST=127.0.0.1 DONPEPE_PUBLIC_URL="$DP_URL" DONPEPE_MODE=demo NODE_ENV=development TZ=America/Lima
nohup "$DP_NODE" v2/server.js >> "$DP_LOG_DIR/servidor.log" 2>&1 < /dev/null &
DP_SERVER_PID=$!
printf '%s\n' "$DP_SERVER_PID" > "$DP_LOG_DIR/servidor.pid"
for ((i=0;i<150;i++)); do
  if ready; then open_app "${1:-}"; exit 0; fi
  kill -0 "$DP_SERVER_PID" 2>/dev/null || fail "DonPepe no pudo iniciarse. Revisa $DP_LOG_DIR/servidor.log"
  sleep .2
done
fail "DonPepe está tardando en responder. Revisa $DP_LOG_DIR/servidor.log"
