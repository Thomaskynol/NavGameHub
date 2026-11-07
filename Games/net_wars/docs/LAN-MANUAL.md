# LAN-MANUAL — roteiro 2 PCs + áudio + lock + feel da câmera

Pré-req: anfitrião com `node server/main.js` (escuta `0.0.0.0:8080`); nos dois PCs,
a mesma versão do jogo (sem build, sem CDN — 100% offline depois de preparado).

## 1. Subir e conectar (2 PCs na mesma rede)

Anfitrião:

```bash
hostname -I | awk '{print $1}'   # ex.: 192.168.1.202
MATCH_LEN_S=30 node server/main.js
```

Nos dois PCs abrir `http://192.168.1.202:8080` (**nunca `localhost`** no convidado).
Firewall: `sudo ufw allow 8080/tcp`. Se a página não abrir: mesma Wi-Fi? IP mudou?
porta liberada? (`curl http://IP:8080/__hub/state` tem que responder JSON.)

## 2. Roteiro mínimo (15 min, 2 pilotos)

1. A cria sala (anotar código), B entra com o código. Apelidos/cores diferentes.
2. Hangar: A marca **Estou pronto**, B vê `PRONTO ✓`; host (♛) clica **VOAR!** nos dois.
3. **Clique na arena** nos dois (trava a mira + liga o som 🔊).
4. Voar 1 min: cada um confirma que vê a nave do outro se mover + lasers replicados.
5. B fecha a aba no meio (disconnect) → A segue jogando; B reabre e volta (resume 30 s).
6. Aguardar o fim (`MATCH_LEN_S=30`): tela de resultados nos dois + **🔁 revanche**.
7. Repetir uma vez em **teams** (fogo amigo desligado: atirar no aliado = nada) e,
   se der, uma em **survival** (bots, sem timer).

## 3. Áudio (audível de verdade — headless é mudo)

Checklist por PC, com som ligado: clique no menu (click), laser (rajada), míssil (E),
lock (◉), explosão, coleta de power-up, contagem/revanche, motor contínuo em voo.
Anotar o que **não se ouve** ou soa errado — o E2E automatizado não cobre ouvido.

## 4. Pointer-lock (o headless NÃO cobre)

- 1º clique na arena: trava a mira **sem tiro fantasma**; `Esc` abre pausa; continuar
  retoma o lock; permissão negada ⇒ cai em freeAim (jogo segue jogável).
- Marcar: browser+SO onde o lock falhou e o que apareceu (pausa? mira livre?).

## 5. Feel da câmera (relato humano — o que anotar)

- **1ª pessoa**: mouse gira a nave direto? cruz ✛ = tiro real? rolagem A/D manual ok?
- **3ª pessoa (WT)**: ○ amarelo nunca some? direita é sempre direita? bank-to-turn
  natural? manete W/S persiste? mira × tiro paralela em 10/40/80/130 m?
- **Imobilidade**: sem input, a câmera fica parada (sem deriva/oscilação)?
  Anotar: `TP-still-spins? SIM/NÃO + quando` (curva? pós-teleporte? respawn?).
- Tremor/efeitos: `⚙ Reduzir tremor` ajuda? Qualidade baixa muda o feel?

## 6. Registro mínimo por sessão

`data, PCs (browser+SO), modo, len` + tabela PASS/FAIL por item acima + 1 frase de
feel por piloto. Falha de rede (loss/lag) anotar à parte — servidor é autoritativo
em 20 Hz, input obsoleto > 1,5 s é neutralizado (P1-11), mas LAN real com 2 máquinas
físicas **nunca foi testada** até 2026-11-06.
