#!/usr/bin/env bash
# Regressão dos scripts start.sh/stop.sh/prepare.sh (R1, R7, R10).
# Seguro: só usa tmpdirs, só sinaliza processos `sleep` próprios (em grupo
# dedicado via setsid) e só abre portas em 127.0.0.1. Sem rede externa.
# Uso: bash scripts/test/test-scripts.sh
set -u

PASS=0
FAIL=0
SKIP=0
ok() { PASS=$((PASS + 1)); printf 'ok: %s\n' "$1"; }
nok() { FAIL=$((FAIL + 1)); printf 'FALHA: %s\n' "$1" >&2; }
skip() { SKIP=$((SKIP + 1)); printf 'pulado: %s\n' "$1"; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
TMPBASE="$(mktemp -d "${TMPDIR:-/tmp/opencode}/scripts-test-XXXXXX")"
PIDS=""
cleanup() {
  for p in $PIDS; do kill -9 "$p" 2>/dev/null || true; done
  rm -rf "$TMPBASE"
}
trap cleanup EXIT
lembrar() { PIDS="$PIDS $1"; }

porta_livre() { # imprime uma porta livre em 127.0.0.1
  python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1])"
}
porta_aberta() { # porta → 0 se algo escuta em 127.0.0.1:porta
  (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}
servir() { # porta → sobe http.server só em 127.0.0.1 e espera responder
  python3 -m http.server "$1" --bind 127.0.0.1 >/dev/null 2>&1 &
  lembrar "$!"
  local i
  for ((i = 0; i < 50; i++)); do porta_aberta "$1" && return 0; sleep 0.1; done
  return 1
}
identidade() { # pid → "starttime|cmdline"
  local raw st cmd
  raw="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  raw="${raw##*)}"
  st="$(printf '%s' "$raw" | awk '{print $20}')"
  cmd="$(tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null)" || return 1
  printf '%s|%s' "$st" "$cmd"
}
mk_meta() { # metafile pid [boot_id] — escreve .meta VÁLIDO para o pid atual
  local boot
  boot="${3:-$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)}"
  local id st cmd
  id="$(identidade "$2")" || return 1
  st="${id%%|*}"; cmd="${id#*|}"
  printf 'instance=%s\npid=%s\nstarttime=%s\nboot_id=%s\ncmdline=%s\n' \
    "teste" "$2" "$st" "$boot" "$cmd" > "$1"
}
sandbox_stop() { # nome → imprime dir com cópia de stop.sh + .run/pids
  local d="$TMPBASE/$1"
  mkdir -p "$d/.run/pids"
  cp "$REPO/stop.sh" "$d/stop.sh"
  printf '%s' "$d"
}

# --- t0: sintaxe --------------------------------------------------------------
for s in start.sh stop.sh prepare.sh scripts/test/test-scripts.sh; do
  if bash -n "$REPO/$s"; then ok "bash -n $s"; else nok "bash -n $s"; fi
done

# --- t1 (R1): pid vivo SEM .meta não é sinalizado ------------------------------
d="$(sandbox_stop t1)"
setsid sleep 30 & spid=$!; lembrar "$spid"
printf '%s' "$spid" > "$d/.run/pids/hub.pid"
out="$(bash "$d/stop.sh" 2>&1)"; code=$?
if kill -0 "$spid" 2>/dev/null; then ok "R1 sem-meta: processo alheio preservado"; else nok "R1 sem-meta: processo alheio foi morto"; fi
[ ! -f "$d/.run/pids/hub.pid" ] && ok "R1 sem-meta: pid obsoleto limpo" || nok "R1 sem-meta: pid não limpo"
[ "$code" -eq 0 ] && ok "R1 sem-meta: exit 0" || nok "R1 sem-meta: exit $code"
case "$out" in *"NÃO sinalizando"*) ok "R1 sem-meta: reporta que não sinalizou";; *) nok "R1 sem-meta: sem aviso (saída: $out)";; esac

# --- t2 (R1): .meta com starttime errado (PID reutilizado) não é sinalizado ----
d="$(sandbox_stop t2)"
setsid sleep 30 & spid=$!; lembrar "$spid"
printf '%s' "$spid" > "$d/.run/pids/hub.pid"
mk_meta "$d/.run/pids/hub.meta" "$spid"
sed -i 's/^starttime=.*/starttime=0/' "$d/.run/pids/hub.meta"
out="$(bash "$d/stop.sh" 2>&1)"; code=$?
if kill -0 "$spid" 2>/dev/null; then ok "R1 pid-reutilizado: preservado"; else nok "R1 pid-reutilizado: morto indevidamente"; fi
[ ! -f "$d/.run/pids/hub.pid" ] && ok "R1 pid-reutilizado: limpo" || nok "R1 pid-reutilizado: não limpo"
[ "$code" -eq 0 ] && ok "R1 pid-reutilizado: exit 0" || nok "R1 pid-reutilizado: exit $code"

# --- t3 (R1): .meta de outro boot não é sinalizado ------------------------------
d="$(sandbox_stop t3)"
setsid sleep 30 & spid=$!; lembrar "$spid"
printf '%s' "$spid" > "$d/.run/pids/hub.pid"
mk_meta "$d/.run/pids/hub.meta" "$spid" "boot-de-outra-maquina-1234"
out="$(bash "$d/stop.sh" 2>&1)"; code=$?
if kill -0 "$spid" 2>/dev/null; then ok "R1 outro-boot: preservado"; else nok "R1 outro-boot: morto indevidamente"; fi
[ ! -f "$d/.run/pids/hub.pid" ] && ok "R1 outro-boot: limpo" || nok "R1 outro-boot: não limpo"
case "$out" in *"outro boot"*) ok "R1 outro-boot: reporta o motivo";; *) nok "R1 outro-boot: sem motivo (saída: $out)";; esac

# --- t4 (R1): PID inexistente só limpa ------------------------------------------
d="$(sandbox_stop t4)"
setsid sleep 1 & spid=$!; lembrar "$spid"
wait "$spid" 2>/dev/null || true
kill -0 "$spid" 2>/dev/null && skip "R1 pid-morto: sleep ainda vivo (lento?)" || {
  printf '%s' "$spid" > "$d/.run/pids/hub.pid"
  mk_meta "$d/.run/pids/hub.meta" "999999999" 2>/dev/null || printf 'instance=x\npid=%s\nstarttime=1\nboot_id=y\ncmdline=z\n' "$spid" > "$d/.run/pids/hub.meta"
  out="$(bash "$d/stop.sh" 2>&1)"; code=$?
  [ ! -f "$d/.run/pids/hub.pid" ] && ok "R1 pid-morto: limpo" || nok "R1 pid-morto: não limpo"
  [ "$code" -eq 0 ] && ok "R1 pid-morto: exit 0" || nok "R1 pid-morto: exit $code"
  case "$out" in *"já tinha saído"*) ok "R1 pid-morto: reporta";; *) nok "R1 pid-morto: sem aviso (saída: $out)";; esac
}

# --- t5 (R1): ciclo normal — dono legítimo é encerrado --------------------------
d="$(sandbox_stop t5)"
setsid sleep 30 & spid=$!; lembrar "$spid"
kill -0 "$spid" 2>/dev/null || { skip "R1 ciclo-normal: setsid morreu cedo"; spid=""; }
if [ -n "$spid" ]; then
  printf '%s' "$spid" > "$d/.run/pids/hub.pid"
  mk_meta "$d/.run/pids/hub.meta" "$spid"
  out="$(bash "$d/stop.sh" 2>&1)"; code=$?
  sleep 0.3
  if kill -0 "$spid" 2>/dev/null; then nok "R1 ciclo-normal: dono legítimo não foi encerrado"; else ok "R1 ciclo-normal: dono legítimo encerrado"; fi
  [ ! -f "$d/.run/pids/hub.pid" ] && [ ! -f "$d/.run/pids/hub.meta" ] \
    && ok "R1 ciclo-normal: metadados limpos" || nok "R1 ciclo-normal: metadados restaram"
  [ "$code" -eq 0 ] && ok "R1 ciclo-normal: exit 0" || nok "R1 ciclo-normal: exit $code"
  case "$out" in *"hub encerrado"*) ok "R1 ciclo-normal: reporta encerramento";; *) nok "R1 ciclo-normal: sem aviso (saída: $out)";; esac
fi

# --- t6 (R1 estrutural): start.sh só considera "já em execução" com identidade --
if grep -q 'meta_confere "$oldpid" "$metafile"' "$REPO/start.sh" \
  && grep -q 'já está em execução' "$REPO/start.sh"; then
  ok "R1 start-duplicado: recusa acoplada à identidade (estrutural)"
else
  nok "R1 start-duplicado: recusa sem checar identidade"
fi

# --- t7 (R7): vars de porta valem (conflito) e padrões mantidos -----------------
command -v python3 >/dev/null 2>&1 || skip "R7: sem python3 para ocupar portas"
if command -v python3 >/dev/null 2>&1; then
  d="$TMPBASE/t7"; mkdir -p "$d/.run/pids"
  cp "$REPO/start.sh" "$d/start.sh"
  mkdir -p "$d/Games/Catan/dist" "$d/Games/VAVA2D/packages/client/dist"
  touch "$d/Games/Catan/dist/server.mjs" "$d/Games/VAVA2D/packages/client/dist/index.html"
  p1="$(porta_livre)"; p2="$(porta_livre)"; p3="$(porta_livre)"; p4="$(porta_livre)"; p5="$(porta_livre)"
  servir "$p1" && servir "$p2" && servir "$p3" && servir "$p4" && servir "$p5" || skip "R7: não deu para ocupar portas"
  if porta_aberta "$p1" && porta_aberta "$p5"; then
    out="$(HUB_PORT="$p1" ARCADE_PORT="$p2" VAVA_PORT="$p3" CATAN_PORT="$p4" NETWARS_PORT="$p5" START_TIMEOUT=5 bash "$d/start.sh" 2>&1)"; code=$?
    [ "$code" -ne 0 ] && ok "R7 conflito: exit != 0" || nok "R7 conflito: exit 0 indevido"
    for par in "hub $p1 HUB_PORT" "arcade $p2 ARCADE_PORT" "vava $p3 VAVA_PORT" "catan $p4 CATAN_PORT" "netwars $p5 NETWARS_PORT"; do
      set -- $par
      case "$out" in *"porta $2 ($1, $3)"*) ok "R7 conflito: $1 usa $3=$2";; *) nok "R7 conflito: $1 não honrou $3=$2";; esac
    done
    case "$out" in *"HUB_PORT="*|*"ARCADE_PORT="*) ;; *) :;; esac
  else
    skip "R7 conflito: portas não abriram"
  fi
  # inválida falha cedo, antes de subir qualquer coisa
  out="$(ARCADE_PORT="banana" bash "$d/start.sh" 2>&1)"; code=$?
  [ "$code" -ne 0 ] && ok "R7 inválida: exit != 0" || nok "R7 inválida: exit 0 indevido"
  case "$out" in *"ARCADE_PORT"*"inválida"*) ok "R7 inválida: mensagem cita a variável";; *) nok "R7 inválida: mensagem fraca (saída: $out)";; esac
  [ -z "$(ls "$d/.run/pids" 2>/dev/null)" ] && ok "R7 inválida: nada subiu" || nok "R7 inválida: criou pid"
  # (regressão openSUSE: /usr/bin/node é um seletor que lê $NODE_VERSION;
  # o script não pode reutilizar esse nome de variável)
  out="$(NODE_VERSION=24 ARCADE_PORT="banana" bash "$d/start.sh" 2>&1)"; code=$?
  case "$out" in *"ARCADE_PORT"*"inválida"*) ok "R10 NODE_VERSION exportado: gate do node passou";; *) nok "R10 NODE_VERSION exportado: node quebrou (saída: $out)";; esac
fi
# padrões anunciados (estrutural: defaults + export para o Hub)
for par in "HUB_PORT 8090" "ARCADE_PORT 8091" "VAVA_PORT 8092" "CATAN_PORT 8093" "NETWARS_PORT 8095"; do
  set -- $par
  if grep -q "$1=\"\${$1:-$2}\"" "$REPO/start.sh"; then ok "R7 padrão: $1=${2}"; else nok "R7 padrão: $1=${2} ausente"; fi
done
if grep -q 'export HUB_PORT ARCADE_PORT VAVA_PORT CATAN_PORT NETWARS_PORT' "$REPO/start.sh"; then
  ok "R7 export: Hub herda as 5 vars (contrato hub/games.json)"
else
  nok "R7 export: faltou exportar as 5 vars"
fi

# --- t8 (R10): gate >= 22.13.0 com mínima + encontrada --------------------------
STUB="$TMPBASE/bin"; mkdir -p "$STUB"
cat > "$STUB/node" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "-p" ]; then printf '%s' "$FAKE_NODE_VERSION"; exit 0; fi
if [ "$1" = "--version" ]; then printf 'v%s\n' "$FAKE_NODE_VERSION"; exit 0; fi
echo "stub node: chamada inesperada: $*" >&2; exit 99
EOF
cat > "$STUB/npm" <<'EOF'
#!/usr/bin/env bash
printf '9.9.9-stub\n'; exit 0
EOF
chmod +x "$STUB/node" "$STUB/npm"
gate() { # versão script esperado(rotulo) → checa saída
  local ver="$1" scr="$2" want="$3"
  local d="$TMPBASE/t8-$ver"
  mkdir -p "$d"; cp "$REPO/$scr" "$d/$scr"
  out="$(FAKE_NODE_VERSION="$ver" PATH="$STUB:/usr/bin:/bin" bash "$d/$scr" 2>&1)"; code=$?
  if [ "$want" = "pass" ]; then
    case "$out" in *"instalando dependências"*|*"subindo Game Hub"*) ok "R10 $scr aceita $ver";; *) nok "R10 $scr rejeitou $ver (saída: $out)";; esac
  else
    if [ "$code" -ne 0 ]; then ok "R10 $scr rejeita $ver (exit $code)"; else nok "R10 $scr aceitou $ver indevidamente"; fi
    case "$out" in *"22.13.0"*"$ver"*) ok "R10 $scr $ver: diz mínima + encontrada";; *) nok "R10 $scr $ver: mensagem fraca (saída: $out)";; esac
    case "$out" in *"instalando dependências"*|*"subindo Game Hub"*) nok "R10 $scr $ver: passou do gate";; *) ok "R10 $scr $ver: parou no gate";; esac
  fi
}
gate "22.5.0" "prepare.sh" "fail"
gate "22.12.9" "prepare.sh" "fail"
gate "22.13.0" "prepare.sh" "pass"
gate "24.22.1" "prepare.sh" "pass"
gate "22.5.0" "start.sh" "fail"

# --- resumo ---------------------------------------------------------------------
printf '\npass=%s fail=%s skip=%s\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
