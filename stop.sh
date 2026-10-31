#!/usr/bin/env bash
# Game Hub — encerra tudo que start.sh subiu, sem deixar órfãos.
# Uso: bash stop.sh
#
# Segurança (R1): cada serviço tem .run/pids/<id>.meta com o ID da instância e
# a identidade do processo (starttime de /proc, boot id, cmdline). O PID só é
# sinalizado se os metadados conferirem; senão (PID reutilizado, outro boot,
# metadados ausentes) nada é sinalizado — só limpa e reporta.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PID_DIR="$ROOT/.run/pids"

say() { printf '%s\n' "$*"; }

SERVICES="hub arcade vava catan"

# --- identidade de instância (mesma lógica do start.sh; este arquivo anda sozinho) --
proc_starttime() { # pid → starttime (campo 22 de /proc/<pid>/stat); falha se sumiu
  local stat_
  stat_="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  stat_="${stat_##*)}" # descarta "pid (comm)"; comm pode ter espaços/parênteses
  printf '%s' "$stat_" | awk '{print $20}' # state=1 … starttime=20º após o comm
}
proc_state() { # pid → estado de /proc/<pid>/stat (R, S, Z, …); falha se sumiu
  local stat_
  stat_="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  stat_="${stat_##*)}"
  printf '%s' "$stat_" | awk '{print $1}'
}
proc_cmdline() { # pid → cmdline com espaços; falha se sumiu
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || return 1
}
proc_boot_id() {
  cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf 'desconhecido'
}
proc_morto() { # pid → 0 se saiu ou virou zumbi (sem dono útil)
  kill -0 "$1" 2>/dev/null || return 0
  [ "$(proc_state "$1" 2>/dev/null)" = "Z" ] && return 0
  return 1
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

stop_one() { # id
  local id="$1"
  local pidfile="$PID_DIR/$id.pid" metafile="$PID_DIR/$id.meta"
  [ -f "$pidfile" ] || { say "[stop] $id: não estava rodando (sem pid)."; return 0; }
  local pid
  pid="$(cat "$pidfile" 2>/dev/null)"
  if [ -z "$pid" ] || proc_morto "$pid"; then
    say "[stop] $id: processo ${pid:-?} já tinha saído; limpando."
    rm -f "$pidfile" "$metafile"
    return 0
  fi
  if ! meta_confere "$pid" "$metafile"; then
    say "[stop] $id: pid $pid não pertence a esta instância (metadados obsoletos, ausentes ou de outro boot). NÃO sinalizando; limpando."
    rm -f "$pidfile" "$metafile"
    return 0
  fi
  # Mata o grupo inteiro (o serviço foi iniciado com setsid): o npm e os filhos caem juntos.
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  local i
  for ((i = 0; i < 50; i++)); do
    proc_morto "$pid" && break
    sleep 0.1
  done
  if ! proc_morto "$pid"; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    sleep 0.5
  fi
  if ! proc_morto "$pid"; then
    say "[stop] $id: NÃO saiu (pid $pid). Tente 'kill -9 -$pid' manualmente."
    return 1
  fi
  rm -f "$pidfile" "$metafile"
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
