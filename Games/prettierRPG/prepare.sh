#!/bin/bash
# Prepara o projeto (exige internet uma vez). Depois roda offline.
# Não precisa de root: rode como seu usuário comum.
set -e
cd "$(dirname "$0")"
if [ "$(id -u)" = "0" ]; then echo "AVISO: rodando como root; não é necessário (prefira seu usuário)."; fi
if ! command -v node >/dev/null; then echo "ERRO: node não encontrado (precisa node 18+)."; exit 1; fi
if ! command -v npm >/dev/null; then echo "ERRO: npm não encontrado (vem com o node 18+)."; exit 1; fi
if [ ! -f package.json ]; then echo "ERRO: package.json ausente; rode na pasta do projeto."; exit 1; fi
if [ ! -f package-lock.json ]; then echo "ERRO: package-lock.json ausente; dependências sem versão fixa."; exit 1; fi
if ! npm ci; then echo "ERRO: 'npm ci' falhou (sem internet? dependência ausente no registry?). Rode de novo online."; exit 1; fi
echo "Pronto. Inicie com: bash start.sh"
