#!/usr/bin/env bash
# Game Hub — encerra tudo que start.sh subiu, sem deixar órfãos.
# Uso: bash stop.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PID_DIR="$ROOT/.run/pids"

say() { printf '%s\n' "$*"; }

SERVICES="hub arcade vava catan"

stop_one() { # id
  local id="$1"
  local pidfile="$PID_DIR/$id.pid"
  [ -f "$pidfile" ] || { say "[stop] $id: não estava rodando (sem pid)."; return 0; }
  local pid
  pid="$(cat "$pidfile" 2>/dev/null)"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    say "[stop] $id: processo $pid já tinha saído; limpando."
    rm -f "$pidfile"
    return 0
  fi
  # Mata o grupo inteiro (o serviço foi iniciado com setsid): o npm e os filhos caem juntos.
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  local i
  for ((i = 0; i < 50; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    sleep 0.5
  fi
  if kill -0 "$pid" 2>/dev/null; then
    say "[stop] $id: NÃO saiu (pid $pid). Tente 'kill -9 -$pid' manualmente."
    return 1
  fi
  rm -f "$pidfile"
  say "[stop] $id encerrado."
  return 0
}

FAILED=0
for svc in $SERVICES; do
  stop_one "$svc" || FAILED=1
done

if [ "$FAILED" -ne 0 ]; then
  say "[stop] nem tudo saiu limpo; confira acima."
  exit 1
fi
say "[stop] tudo encerrado."
