# 05 — Como jogar e executar

## Requisitos

- Node.js 20+ (testado com Node 22.14)
- npm 10+
- Navegador moderno com WebSocket e Canvas 2D

## Instalação

Na raiz do projeto:

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

Isso sobe:

- **cliente:** <http://localhost:5173> (Vite, com hot reload)
- **servidor:** <http://localhost:3000> (WebSocket em `/ws`)
- O Vite faz proxy de `/ws` para o servidor, então o cliente sempre usa a mesma origem.

Abra <http://localhost:5173>, digite um nome e crie uma sala. Para testar sozinho, abra
outra aba anônima e entre com o código da sala.

### Script `start.sh`

```bash
./start.sh          # cliente + servidor (dev, hot reload)
./start.sh lan      # npm run build + npm start (porta 3000)
./start.sh stop     # mata processos presos nas portas 3000/5173
./start.sh install  # npm install
./start.sh help     # ajuda
```

O script checa Node/dependências, avisa se a porta já está ocupada, espera os
servidores abrirem e imprime as URLs (local e da rede). **Ctrl+C derruba o grupo
inteiro de processos** — Vite, `tsx watch` e os filhos — e libera as portas.

### Scripts

| Comando | Efeito |
|---|---|
| `./start.sh` | Atalho com Ctrl+C limpo (ver acima) |
| `npm run dev` | Cliente + servidor em paralelo |
| `npm run dev:client` | Só o Vite |
| `npm run dev:server` | Só o servidor com `tsx watch` |
| `npm run build` | Typecheck + build do cliente em `packages/client/dist` |
| `npm start` | Servidor em produção servindo o build + WebSocket |
| `npm run typecheck` | TypeScript nos três pacotes |
| `npm test` | Testes da física compartilhada |

## Jogar com amigos na mesma rede (Wi-Fi/cabo)

1. Descubra o IP local da sua máquina:

```bash
hostname -I
# exemplo: 192.168.0.42
```

2. Gere o build e suba o servidor:

```bash
npm run build
npm start
```

3. O terminal mostra as URLs, por exemplo:

```
VAVA2D rodando em:
  local:   http://localhost:3000
  rede:    http://192.168.0.42:3000
```

4. Os amigos abrem `http://192.168.0.42:3000` no navegador.
5. Alguém cria a sala, compartilha o link `http://192.168.0.42:3000/?sala=ABCD`,
   e todos entram.

### Firewall

Se ninguém conseguir conectar:

- Linux (ufw): `sudo ufw allow 3000/tcp`
- Windows: permitir Node.js na rede privada no firewall
- macOS: liberar conexões de entrada para o Node
- Confirme que todos estão na mesma rede e que o AP não isola clientes.

## Jogar pela internet

O MVP não tem infraestrutura própria. Opções práticas:

### Túnel temporário

```bash
npm run build
npm start
# em outro terminal:
npx localtunnel --port 3000
# ou: cloudflared tunnel --url http://localhost:3000
```

Compartilhe a URL HTTPS gerada. O cliente detecta `https` e usa `wss` automaticamente.
Túneis gratuitos têm latência variável; para amigos distantes, prefira um VPS próximo.

### VPS / deploy

1. Instale Node 20+.
2. Copie o projeto e rode `npm install && npm run build`.
3. Inicie com `npm start` (porta padrão 3000, configurável via `PORT`).
4. Coloque Nginx/Caddy na frente com HTTPS e proxy WebSocket para `localhost:3000`.
5. Exemplo de proxy (Nginx):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Variáveis de ambiente:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP/WebSocket |
| `HOST` | `0.0.0.0` | Interface de escuta |

## Controles

| Ação | Tecla |
|---|---|
| Mover | `WASD` / setas |
| Mirar | mouse |
| Atirar | botão esquerdo |
| Recarregar | `R` |
| Dash | `Shift` / `Espaço` |
| Sair da sala | `Esc` ou botão `Sair` |

## Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| “Cliente não encontrado” na porta 3000 | Build ausente | `npm run build` |
| Menu não conecta | Servidor não está rodando | `npm run dev` ou `npm start` |
| “Sala não encontrada” | Código errado ou servidor reiniciou | Criar nova sala |
| “Sala cheia” | 8 jogadores | Entrar em outra sala |
| Lag alto | Túnel/Wi-Fi | Testar na LAN; usar VPS próximo |
| Personagem “puxa” para trás | Perda de pacotes/correção de predição | Normal com rede ruim; verifique Wi-Fi |
| Sem acesso de outra máquina | Firewall/rede isolada | Liberar porta 3000 e revisar rede |

## Limpeza de salas

- A sala existe enquanto houver jogadores.
- Sala vazia é removida após 60 segundos.
- Reiniciar o servidor apaga todas as salas e placares (estado em memória).
