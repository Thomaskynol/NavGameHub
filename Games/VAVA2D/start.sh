#!/usr/bin/env bash
#
# VAVA2D — script de inicialização
#
# Uso:
#   ./start.sh            sobe cliente + servidor em modo dev (hot reload)
#   ./start.sh lan        builda o cliente e sobe só o servidor (porta 3000)
#   ./start.sh stop       mata qualquer processo preso nas portas do jogo
#   ./start.sh install    roda npm install
#   ./start.sh help       mostra esta ajuda
#
# Ctrl+C encerra TUDO (cliente, servidor e processos filhos).
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
cd "$ROOT" || exit 1

PORT_SERVER="${PORT:-3000}"
PORT_CLIENT="${PORT_CLIENT:-5173}"

R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
BLUE=$'\033[34m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'

info() { printf '%s %s\n' "${BLUE}•${R}" "$*"; }
ok()   { printf '%s %s\n' "${GREEN}✔${R}" "$*"; }
warn() { printf '%s %s\n' "${YELLOW}!${R}" "$*"; }
err()  { printf '%s %s\n' "${RED}✘${R}" "$*" >&2; }

usage() {
  sed -n '3,12p' "$ROOT/start.sh" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------- utilidades

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && { exec 3>&- 3<&-; return 0; }
  return 1
}

kill_port() {
  local port="$1" pids=""
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -TERM "tcp/${port}" >/dev/null 2>&1
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti tcp:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -n "$pids" ]] && kill -TERM $pids 2>/dev/null
  fi
}

lan_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

ensure_deps() {
  if [[ ! -d "$ROOT/node_modules" ]]; then
    info "node_modules não encontrado — rodando npm install..."
    npm install || { err "falha no npm install"; exit 1; }
  fi
  if ! command -v node >/dev/null 2>&1; then
    err "Node.js não encontrado no PATH (instale Node 20+)"
    exit 1
  fi
}

# ---------------------------------------------------------------- encerramento

APP_PID=""
CLEANED=0

cleanup() {
  local code=$?
  [[ "$CLEANED" == "1" ]] && exit "$code"
  CLEANED=1
  trap - INT TERM HUP EXIT

  echo
  info "Encerrando VAVA2D..."

  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    # sinaliza o GRUPO de processos (concurrently, tsx watch, vite e filhos)
    kill -INT -- "-$APP_PID" 2>/dev/null || kill -INT "$APP_PID" 2>/dev/null

    local i
    for ((i = 0; i < 50; i++)); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.1
    done

    if kill -0 "$APP_PID" 2>/dev/null; then
      warn "ainda vivo — mandando SIGTERM"
      kill -TERM -- "-$APP_PID" 2>/dev/null
      sleep 0.7
      kill -KILL -- "-$APP_PID" 2>/dev/null
      kill -KILL "$APP_PID" 2>/dev/null
    fi
  fi

  ok "Servidores encerrados. Até a próxima!"
  exit 0
}

trap cleanup INT TERM HUP EXIT

# Espera a porta abrir, abortando se o processo morrer antes.
wait_for_port() {
  local port="$1" timeout="${2:-30}" i
  for ((i = 0; i < timeout * 10; i++)); do
    port_in_use "$port" && return 0
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      err "o processo morreu antes de abrir a porta ${port}"
      return 1
    fi
    sleep 0.1
  done
  err "tempo esgotado esperando a porta ${port}"
  return 1
}

check_ports() {
  local busy=()
  port_in_use "$PORT_SERVER" && busy+=("$PORT_SERVER")
  [[ "$MODE" == "dev" ]] && port_in_use "$PORT_CLIENT" && busy+=("$PORT_CLIENT")
  if ((${#busy[@]} > 0)); then
    warn "porta(s) em uso: ${busy[*]}"
    info "rode './start.sh stop' para liberar e tente de novo"
    exit 1
  fi
}

print_banner() {
  local ip
  ip="$(lan_ip)"
  echo
  printf '%s\n' "${B}${CYAN}  ██╗   ██╗ ██████╗ ██████╗  ██████╗ ███████╗██████╗${R}"
  printf '%s\n' "${B}${CYAN}  ██║   ██║██╔═══██╗██╔══██╗██╔═══██╗██╔════╝██╔══██╗${R}"
  printf '%s\n' "${B}${CYAN}  ╚██╗ ██╔╝██║   ██║██║  ██║██║   ██║█████╗  ██████╔╝${R}"
  printf '%s\n' "${B}${CYAN}   ╚████╔╝ ╚██████╔╝██████╔╝╚██████╔╝██╔══╝  ██╔══██╗${R}"
  printf '%s\n' "${B}${CYAN}    ╚═══╝   ╚═════╝ ╚═════╝  ╚═════╝ ╚════╝  ╚═╝  ╚═╝${R}"
  echo
  if [[ "$MODE" == "dev" ]]; then
    printf '%s %s\n' "${GREEN}LOCAL :${R}" "${B}http://localhost:${PORT_CLIENT}/${R}"
    [[ -n "$ip" ]] && printf '%s %s\n' "${GREEN}REDE  :${R}" "${B}http://${ip}:${PORT_CLIENT}/${R}"
  else
    printf '%s %s\n' "${GREEN}LOCAL :${R}" "${B}http://localhost:${PORT_SERVER}/${R}"
    [[ -n "$ip" ]] && printf '%s %s\n' "${GREEN}REDE  :${R}" "${B}http://${ip}:${PORT_SERVER}/${R}"
  fi
  echo
  printf '  %s%scrie uma sala e mande o link pros amigos%s\n' "$DIM" "" "$R"
  printf '  %s%sCtrl+C encerra o servidor%s\n' "$DIM" "" "$R"
  echo
}

# ---------------------------------------------------------------- modos

start_dev() {
  MODE="dev"
  ensure_deps
  check_ports
  info "subindo cliente + servidor (dev, hot reload)..."
  set -m                      # job control: filho ganha seu próprio grupo
  npm run dev &
  APP_PID=$!
  set +m

  wait_for_port "$PORT_SERVER" 40 || exit 1
  wait_for_port "$PORT_CLIENT" 40 || exit 1
  print_banner
  wait "$APP_PID"
}

start_lan() {
  MODE="lan"
  ensure_deps
  check_ports
  info "buildando o cliente (tsc + vite)..."
  npm run build || { err "build falhou"; exit 1; }
  info "subindo servidor em modo produção (porta ${PORT_SERVER})..."
  set -m
  npm start &
  APP_PID=$!
  set +m

  wait_for_port "$PORT_SERVER" 40 || exit 1
  print_banner
  wait "$APP_PID"
}

do_stop() {
  CLEANED=1          # desliga o trap: aqui a saída é intencional
  trap - INT TERM HUP EXIT
  info "liberando portas ${PORT_SERVER}/${PORT_CLIENT}..."
  kill_port "$PORT_CLIENT"
  kill_port "$PORT_SERVER"
  sleep 0.5
  local still=()
  port_in_use "$PORT_SERVER" && still+=("$PORT_SERVER")
  port_in_use "$PORT_CLIENT" && still+=("$PORT_CLIENT")
  if ((${#still[@]} > 0)); then
    warn "continuam ocupadas: ${still[*]} (talvez precise de sudo)"
    exit 1
  fi
  ok "portas livres"
}

# ---------------------------------------------------------------- main

MODE="${1:-dev}"

case "$MODE" in
  -h | --help | help)
    trap - INT TERM HUP EXIT
    usage
    exit 0
    ;;
  dev)
    start_dev
    ;;
  lan | prod | start)
    start_lan
    ;;
  stop)
    do_stop
    ;;
  install | i)
    trap - INT TERM HUP EXIT
    ensure_deps
    ok "dependências instaladas"
    ;;
  *)
    err "modo desconhecido: $MODE"
    usage
    exit 1
    ;;
esac
