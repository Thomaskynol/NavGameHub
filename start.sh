#!/usr/bin/env bash
# Game Hub — inicia o Hub e os 3 jogos com health checks.
# Uso: bash start.sh
#
# Serviços (porta sobrescrevível por env com o mesmo nome):
#   hub     HUB_PORT=8090     GET /health
#   arcade  ARCADE_PORT=8091  GET /api/info
#   vava    VAVA_PORT=8092    GET /health
#   catan   CATAN_PORT=8093   GET /health (produção: dist/server.mjs)
#
# Logs em .run/logs/<serviço>.log, PIDs em .run/pids/<serviço>.pid.
# HUB_SECRET: usa o env se definido; senão reutiliza/gera .run/hub_secret
# e exporta o mesmo valor para o Hub e os jogos.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
RUN_DIR="$ROOT/.run"
PID_DIR="$RUN_DIR/pids"
LOG_DIR="$RUN_DIR/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

HUB_PORT="${HUB_PORT:-8090}"
ARCADE_PORT="${ARCADE_PORT:-8091}"
VAVA_PORT="${VAVA_PORT:-8092}"
CATAN_PORT="${CATAN_PORT:-8093}"
START_TIMEOUT="${START_TIMEOUT:-60}"

say() { printf '%s\n' "$*"; }

# --- pré-requisitos -----------------------------------------------------------
command -v node >/dev/null 2>&1 || { say "ERRO: Node.js não encontrado. Rode 'bash prepare.sh' primeiro." >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] 2>/dev/null \
  || { say "ERRO: Node.js 22+ necessário (encontrado: $(node --version))." >&2; exit 1; }
[ -f "$ROOT/Games/Catan/dist/server.mjs" ] \
  || { say "ERRO: build do Catan ausente (Games/Catan/dist/server.mjs). Rode 'bash prepare.sh' primeiro." >&2; exit 1; }
[ -f "$ROOT/Games/VAVA2D/packages/client/dist/index.html" ] \
  || { say "ERRO: build do cliente VAVA2D ausente. Rode 'bash prepare.sh' primeiro." >&2; exit 1; }

# --- segredo compartilhado ----------------------------------------------------
SECRET_FILE="$RUN_DIR/hub_secret"
if [ -n "${HUB_SECRET:-}" ]; then
  SECRET="$HUB_SECRET"
elif [ -f "$SECRET_FILE" ]; then
  SECRET="$(cat "$SECRET_FILE")"
else
  SECRET="$(node --input-type=module -e 'import {randomBytes} from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"))')"
  [ -n "$SECRET" ] || { say "ERRO: não foi possível gerar o HUB_SECRET." >&2; exit 1; }
  printf '%s' "$SECRET" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE" 2>/dev/null || true
fi
export HUB_SECRET="$SECRET"
export HOST="0.0.0.0"

# --- helpers ------------------------------------------------------------------
port_open() { # porta → 0 se algo escuta em 127.0.0.1:porta
  node --input-type=module -e '
    import net from "node:net";
    const port = Number(process.argv[1]);
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => { s.end(); process.exit(0); });
    s.on("error", () => process.exit(1));
  ' "$1" >/dev/null 2>&1
}

health_ok() { # url → 0 se HTTP 2xx
  node --input-type=module -e '
    try {
      const r = await fetch(process.argv[1], { signal: AbortSignal.timeout(2000) });
      process.exit(r.ok ? 0 : 1);
    } catch { process.exit(1); }
  ' "$1" >/dev/null 2>&1
}

FAILED=0

start_service() { # id dir comando porta healthpath [env-extra...]
  local id="$1" dir="$2" cmd="$3" port="$4" path="$5"
  shift 5
  local pidfile="$PID_DIR/$id.pid" log="$LOG_DIR/$id.log"

  if [ -f "$pidfile" ]; then
    local oldpid
    oldpid="$(cat "$pidfile" 2>/dev/null)"
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      say "[start] $id já está em execução (pid $oldpid). Para reiniciar, rode 'bash stop.sh' antes."
      FAILED=1
      return 1
    fi
    rm -f "$pidfile"
  fi
  if port_open "$port"; then
    say "[start] porta $port ($id) já está em uso por outro processo. Libere a porta ou rode 'bash stop.sh'."
    FAILED=1
    return 1
  fi

  : > "$log"
  cd "$ROOT/$dir" || { say "[start] pasta não encontrada: $dir" >&2; FAILED=1; return 1; }
  # setsid: o serviço vira líder de sessão/grupo; stop.sh mata o grupo inteiro
  # (cobre wrappers como o npm, sem deixar órfãos).
  PORT="$port" HUB_PORT="$port" "$@" setsid nohup bash -c "$cmd" >>"$log" 2>&1 < /dev/null &
  echo $! > "$pidfile"
  cd "$ROOT" || exit 1

  local i pid
  for ((i = 0; i < START_TIMEOUT; i++)); do
    if health_ok "http://127.0.0.1:$port$path"; then
      say "[start] $id ok em http://localhost:$port$path"
      return 0
    fi
    pid="$(cat "$pidfile" 2>/dev/null)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
      say "[start] $id morreu na partida. Últimas linhas do log ($log):"
      tail -n 20 "$log" 2>/dev/null
      rm -f "$pidfile"
      FAILED=1
      return 1
    fi
    sleep 1
  done
  say "[start] $id não respondeu $path em ${START_TIMEOUT}s. Veja $log"
  FAILED=1
  return 1
}

# --- subida -------------------------------------------------------------------
say "[start] subindo Game Hub (logs em .run/logs/) ..."
start_service "hub" "." "node hub/server.js" "$HUB_PORT" "/health" || true
start_service "arcade" "Games/ArcadeAI_race_game" "npm start --silent" "$ARCADE_PORT" "/api/info" || true
start_service "vava" "Games/VAVA2D" "npm start --silent --workspace @vava/server" "$VAVA_PORT" "/health" || true
start_service "catan" "Games/Catan" "npm start --silent" "$CATAN_PORT" "/health" env NODE_ENV=production || true

if [ "$FAILED" -ne 0 ]; then
  say "[start] FALHOU: nem todos os serviços subiram. Veja os logs em .run/logs/ e, se preciso, rode 'bash stop.sh'."
  exit 1
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say ""
say "[start] tudo no ar! Abra o Hub em:"
say "  local: http://localhost:$HUB_PORT"
[ -n "$LAN_IP" ] && say "  rede:  http://$LAN_IP:$HUB_PORT"
say "Para encerrar: bash stop.sh"
