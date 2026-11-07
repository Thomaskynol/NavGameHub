#!/bin/bash
# Para APENAS o processo do projeto (via pidfile). Não toca em outros.
cd "$(dirname "$0")"
HERE="$(pwd -P)"
if [ ! -f .prettierrpg.pid ]; then echo "Nada para parar (sem .prettierrpg.pid)."; exit 0; fi
PID="$(cat .prettierrpg.pid)"
if [ -z "$PID" ]; then echo "Pidfile vazio; removendo."; rm -f .prettierrpg.pid; exit 0; fi
OURS=""
if kill -0 "$PID" 2>/dev/null; then
  ARGS="$(ps -p "$PID" -o args= 2>/dev/null || true)"
  case "$ARGS" in
    *server.js*) OURS=maybe ;;
    *) echo "pid $PID não é do projeto ($ARGS); não vou matar." ;;
  esac
  if [ "$OURS" = "maybe" ]; then
    # PID reutilizado nunca mata alheio: exige cwd do processo = este projeto.
    CWD="$(readlink "/proc/$PID/cwd" 2>/dev/null || true)"
    if [ -n "$CWD" ]; then
      if [ "$CWD" = "$HERE" ]; then OURS=yes; else echo "pid $PID roda em $CWD (aqui é $HERE); não vou matar."; OURS=""; fi
    else
      echo "AVISO: sem /proc/$PID/cwd (não-Linux); validando só pelo comando."
      case "$ARGS" in *"$HERE"*) OURS=yes ;; *) OURS="" ;; esac
    fi
  fi
  if [ "$OURS" = "yes" ]; then
    kill "$PID" && sleep 1
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
    echo "Servidor (pid $PID) parado."
  else
    echo "Removendo pidfile obsoleto."
  fi
else
  echo "Processo $PID já não existe."
fi
rm -f .prettierrpg.pid
