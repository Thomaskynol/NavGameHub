#!/bin/bash
# Inicia o servidor. Uso: [PORT=8094] [HOST=0.0.0.0] bash start.sh
cd "$(dirname "$0")"
PORT="${PORT:-8094}"
HOST="${HOST:-0.0.0.0}"
# PORT inválida no ambiente nunca quebra: volta ao padrão com aviso.
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "AVISO: PORT='$PORT' inválida; usando 8094." >&2
  PORT="8094"
fi
# HOST herdado do ambiente (ex.: localhost.localdomain) pode resolver/bindar
# só ::1 e quebrar 127.0.0.1: só aceita IP literal p/ LAN; resto volta ao
# padrão com aviso (PORT segue configurável).
if ! [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || "$HOST" == "::" ]]; then
  echo "AVISO: HOST='$HOST' não é IP válido p/ LAN; usando 0.0.0.0." >&2
  HOST="0.0.0.0"
fi
if ! command -v node >/dev/null; then echo "ERRO: node não encontrado."; exit 1; fi
if [ ! -d node_modules ]; then echo "Rode primeiro: bash prepare.sh"; exit 1; fi
if [ -f .prettierrpg.pid ]; then
  OLDPID="$(cat .prettierrpg.pid)"
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    echo "Servidor já em execução (pid $OLDPID). Para reiniciar: bash stop.sh && bash start.sh"
    exit 0
  fi
  rm -f .prettierrpg.pid
fi
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3>&-; exec 3<&-
  echo "Porta $PORT ocupada. Tente outra: PORT=8095 bash start.sh"
  exit 1
fi
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$IP" ] && IP="localhost"
echo "PrettierRPG na porta $PORT (host $HOST)"
echo "Neste PC:  http://localhost:$PORT"
echo "Rede local: http://$IP:$PORT"
HOST="$HOST" PORT="$PORT" nohup node server.js > .prettierrpg.log 2>&1 &
echo $! > .prettierrpg.pid
sleep 1
if kill -0 "$(cat .prettierrpg.pid)" 2>/dev/null; then
  echo "Servidor rodando (pid $(cat .prettierrpg.pid)). Log: .prettierrpg.log"
else
  echo "Falha ao iniciar. Veja .prettierrpg.log"; rm -f .prettierrpg.pid; exit 1
fi
