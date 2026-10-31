#!/usr/bin/env bash
# Game Hub — prepara dependências e builds (precisa de internet uma vez).
# Uso: bash prepare.sh
#
# O que faz:
#   1. confere Node.js >= 22 e npm;
#   2. instala dependências (root + cada jogo);
#   3. gera os builds de produção (cliente VAVA, servidor+cliente Catan).
#
# Depois de preparado, Hub e jogos rodam na rede local sem internet.
# Rode a partir de qualquer caminho de montagem (sem caminhos absolutos).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT" || exit 1

say() { printf '%s\n' "$*"; }
fail() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

REQUIRED_NODE=22

# --- 1. Node.js e npm -------------------------------------------------------
command -v node >/dev/null 2>&1 || fail "Node.js não encontrado no PATH. Instale Node.js >= $REQUIRED_NODE (openSUSE: 'sudo zypper install nodejs'; Debian/Mint: 'sudo apt install nodejs npm' ou via NodeSource) e rode de novo."
command -v npm >/dev/null 2>&1 || fail "npm não encontrado no PATH. Instale o npm junto com o Node.js e rode de novo."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || fail "não foi possível ler a versão do Node.js."
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE" ]; then
  fail "Node.js $REQUIRED_NODE+ é necessário (encontrado: $(node --version)). Atualize o Node.js e rode de novo."
fi
say "[prepare] Node.js $(node --version), npm $(npm --version)"

# --- 2. dependências ----------------------------------------------------------
install_deps() { # dir label
  local dir="$1" label="$2"
  [ -d "$ROOT/$dir" ] || fail "pasta não encontrada: $dir (o pendrive está montado por inteiro?)"
  say "[prepare] instalando dependências: $label ..."
  if [ -f "$ROOT/$dir/package-lock.json" ]; then
    (cd "$ROOT/$dir" && npm ci --no-audit --no-fund) || fail "'npm ci' falhou em $dir. Confira a rede e rode de novo."
  else
    (cd "$ROOT/$dir" && npm install --no-audit --no-fund) || fail "'npm install' falhou em $dir. Confira a rede e rode de novo."
  fi
}

install_deps "." "Game Hub (root)"
install_deps "Games/ArcadeAI_race_game" "Asfalto Vivo (Arcade)"
install_deps "Games/VAVA2D" "VAVA2D"
install_deps "Games/Catan" "Catan Deluxe"

# --- 3. builds de produção ----------------------------------------------------
say "[prepare] gerando build do cliente VAVA2D ..."
(cd "$ROOT/Games/VAVA2D" && npm run build --silent) || fail "build do cliente VAVA2D falhou."
[ -f "$ROOT/Games/VAVA2D/packages/client/dist/index.html" ] \
  || fail "build do VAVA2D terminou mas packages/client/dist/index.html não existe."

say "[prepare] gerando build do Catan Deluxe ..."
(cd "$ROOT/Games/Catan" && npm run build --silent) || fail "build do Catan falhou."
[ -f "$ROOT/Games/Catan/dist/server.mjs" ] \
  || fail "build do Catan terminou mas dist/server.mjs não existe."

say ""
say "[prepare] pronto! Inicie tudo com: bash start.sh"
