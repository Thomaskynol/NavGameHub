#!/usr/bin/env bash
# Game Hub — inicia o Hub e os 3 jogos com health checks.
# Uso: bash start.sh
#
# Serviços (porta via env, exportada também para o Hub — que lê o env com
# fallback para hub/games.json — e para os jogos via PORT):
#   hub     HUB_PORT=8090     GET /health
#   arcade  ARCADE_PORT=8091  GET /api/info
#   vava    VAVA_PORT=8092    GET /health
#   catan   CATAN_PORT=8093   GET /health (produção: dist/server.mjs)
#
# Logs em .run/logs/<serviço>.log, PIDs em .run/pids/<serviço>.pid + .meta
# (ID da instância + identidade do processo; ver stop.sh).
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
REQUIRED_NODE="22.13.0"
# Exporta de ponta a ponta: o Hub lê HUB_PORT/ARCADE_PORT/VAVA_PORT/CATAN_PORT
# do ambiente (fallback: hub/games.json); cada jogo recebe a sua via PORT.
export HUB_PORT ARCADE_PORT VAVA_PORT CATAN_PORT

say() { printf '%s\n' "$*"; }

node_ok() { # 0 se o Node.js atual >= $REQUIRED_NODE (compara major.minor.patch)
  local cur min i c m
  cur="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  min="$REQUIRED_NODE"
  for i in 1 2 3; do
    c="${cur%%.*}"; m="${min%%.*}"
    cur="${cur#*.}"; min="${min#*.}"
    c="${c%%[^0-9]*}"; m="${m%%[^0-9]*}"
    [ -n "$c" ] || c=0; [ -n "$m" ] || m=0
    c=$((10#$c)); m=$((10#$m))
    [ "$c" -gt "$m" ] && return 0
    [ "$c" -lt "$m" ] && return 1
  done
  return 0
}

porta_valida() { # nome valor → 0 se inteiro 1-65535
  case "$2" in
    ''|*[!0-9]*)
      say "ERRO: $1 inválida ('$2'). Use um número de 1 a 65535." >&2
      return 1 ;;
  esac
  { [ "$2" -ge 1 ] && [ "$2" -le 65535 ]; } 2>/dev/null \
    || { say "ERRO: $1 inválida ('$2'). Use um número de 1 a 65535." >&2; return 1; }
}

# --- identidade de instância (mesma lógica do stop.sh) ---------------------------
proc_starttime() { # pid → starttime (campo 22 de /proc/<pid>/stat); falha se sumiu
  local stat_
  stat_="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  stat_="${stat_##*)}" # descarta "pid (comm)"; comm pode ter espaços/parênteses
  printf '%s' "$stat_" | awk '{print $20}' # state=1 … starttime=20º após o comm
}
proc_cmdline() { # pid → cmdline com espaços; falha se sumiu
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || return 1
}
proc_boot_id() {
  cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf 'desconhecido'
}
meta_confere() { # pid metafile → 0 se o processo atual é o dono da instância
  local pid="$1" meta="$2"
  [ -n "$pid" ] && [ -f "$meta" ] || return 1
  local m_pid m_start m_boot m_cmd agora_boot agora_start agora_cmd
  m_pid="$(sed -n 's/^pid=//p' "$meta")"
  m_start="$(sed -n 's/^starttime=//p' "$meta")"
  m_boot="$(sed -n 's/^boot_id=//p' "$meta")"
  m_cmd="$(sed -n 's/^cmdline=//p' "$meta")"
  [ "$m_pid" = "$pid" ] || return 1
  [ -n "$m_start" ] || return 1
  agora_boot="$(proc_boot_id)"
  if [ "$m_boot" != "desconhecido" ] && [ "$agora_boot" != "desconhecido" ]; then
    [ "$m_boot" = "$agora_boot" ] || return 1
  fi
  agora_start="$(proc_starttime "$pid")" || return 1
  [ "$agora_start" = "$m_start" ] || return 1
  agora_cmd="$(proc_cmdline "$pid")" || return 1
  [ "$agora_cmd" = "$m_cmd" ] || return 1
  return 0
}

# --- pré-requisitos -----------------------------------------------------------
command -v node >/dev/null 2>&1 || { say "ERRO: Node.js não encontrado. Rode 'bash prepare.sh' primeiro." >&2; exit 1; }
# (nome fora do padrão NODE_*: o openSUSE usa um seletor /usr/bin/node que lê
# $NODE_VERSION do ambiente — reutilizar esse nome quebraria o node seguinte.)
NODE_VER_FOUND="$(node -p 'process.versions.node' 2>/dev/null || true)"
node_ok || { say "ERRO: Node.js >= $REQUIRED_NODE necessário (encontrado: v${NODE_VER_FOUND:-?}). Atualize o Node.js e rode 'bash prepare.sh' de novo." >&2; exit 1; }
n="HUB_PORT"; porta_valida "$n" "$HUB_PORT" || exit 1
n="ARCADE_PORT"; porta_valida "$n" "$ARCADE_PORT" || exit 1
n="VAVA_PORT"; porta_valida "$n" "$VAVA_PORT" || exit 1
n="CATAN_PORT"; porta_valida "$n" "$CATAN_PORT" || exit 1
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

# ID desta subida + boot atual: gravados em .run/instance_id e em cada .meta.
BOOT_ID="$(proc_boot_id)"
INSTANCE_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || printf 'instancia-%s-%s' "$$" "$RANDOM")"
printf '%s' "$INSTANCE_ID" > "$RUN_DIR/instance_id"

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

start_service() { # id dir comando porta healthpath varname [env-extra...]
  local id="$1" dir="$2" cmd="$3" port="$4" path="$5" varname="$6"
  shift 6
  local pidfile="$PID_DIR/$id.pid" metafile="$PID_DIR/$id.meta" log="$LOG_DIR/$id.log"

  if [ -f "$pidfile" ]; then
    local oldpid
    oldpid="$(cat "$pidfile" 2>/dev/null)"
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null && meta_confere "$oldpid" "$metafile"; then
      say "[start] $id já está em execução (pid $oldpid). Para reiniciar, rode 'bash stop.sh' antes."
      FAILED=1
      return 1
    fi
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      say "[start] $id: pid $oldpid não pertence a esta instância (metadados obsoletos); limpando e subindo de novo."
    fi
    rm -f "$pidfile" "$metafile"
  fi
  if port_open "$port"; then
    say "[start] porta $port ($id, $varname) já está em uso por outro processo. Libere a porta, ajuste $varname ou, se for resto de subida anterior, rode 'bash stop.sh'."
    FAILED=1
    return 1
  fi

  : > "$log"
  cd "$ROOT/$dir" || { say "[start] pasta não encontrada: $dir" >&2; FAILED=1; return 1; }
  # setsid: o serviço vira líder de sessão/grupo; stop.sh mata o grupo inteiro
  # (cobre wrappers como o npm, sem deixar órfãos). PORT é por serviço; as
  # *_PORT já estão exportadas acima para o Hub e os jogos.
  PORT="$port" "$@" setsid nohup bash -c "$cmd" >>"$log" 2>&1 < /dev/null &
  echo $! > "$pidfile"
  {
    printf 'instance=%s\n' "$INSTANCE_ID"
    printf 'pid=%s\n' "$!"
    printf 'starttime=%s\n' "$(proc_starttime "$!" 2>/dev/null)"
    printf 'boot_id=%s\n' "$BOOT_ID"
    printf 'cmdline=%s\n' "$(proc_cmdline "$!" 2>/dev/null)"
  } > "$metafile"
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
      rm -f "$pidfile" "$metafile"
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
say "[start] subindo Game Hub (instância $INSTANCE_ID; logs em .run/logs/) ..."
start_service "hub" "." "node hub/server.js" "$HUB_PORT" "/health" "HUB_PORT" || true
start_service "arcade" "Games/ArcadeAI_race_game" "npm start --silent" "$ARCADE_PORT" "/api/info" "ARCADE_PORT" || true
start_service "vava" "Games/VAVA2D" "npm start --silent --workspace @vava/server" "$VAVA_PORT" "/health" "VAVA_PORT" || true
start_service "catan" "Games/Catan" "npm start --silent" "$CATAN_PORT" "/health" "CATAN_PORT" env NODE_ENV=production || true

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
