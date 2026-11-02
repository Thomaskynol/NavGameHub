// Asfalto Vivo — regressão R4 em navegador real (Chromium headless isolado).
// Cobre o que o nível protocolo não alcança: boot Hub (?hub=1&htok=) cria a
// sala, RECARREGA a página (mesma aba → mesmo sessionStorage) e retoma a MESMA
// identidade/vaga via resume — sem duplicata, sem FULL, sem tela de erro.
// Pula (skip) se o Chromium do ambiente não estiver disponível.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { startServer } from '../server/index.js';

const ROOM = 'BRW232';
const HTOK = 'hub-brw';

test('R4 navegador: boot Hub cria; reload retoma mesma vaga (sem duplicata)', async (t) => {
  let exe = null;
  try { exe = chromium.executablePath(); await stat(exe); }
  catch { t.skip('Chromium do ambiente indisponível'); return; }

  const srv = await startServer({ port: 0, log: () => {} });
  let browser = null;
  try {
    try {
      browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    } catch {
      t.skip('Chromium não iniciou neste ambiente');
      return;
    }
    // Perfil isolado: contexto novo (equivale a aba limpa, fora do perfil pessoal).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err && err.message || err)));

    const url = `http://127.0.0.1:${srv.port}/?hub=1&room=${ROOM}&name=Ana&create=1&htok=${HTOK}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.room-code', { timeout: 15000 });
    await page.waitForFunction(
      (code) => document.querySelector('.room-code')?.textContent === code,
      ROOM, { timeout: 15000 },
    );
    await page.waitForSelector('.player-list-row', { timeout: 15000 });

    const before = srv.rooms.getRoom(ROOM);
    assert.ok(before, 'sala criada pelo boot Hub');
    assert.equal(before.htok, HTOK, 'sala guarda o dono do launch');
    assert.equal(before.players.length, 1, 'um jogador antes do reload');
    const you = before.players[0].id;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (code) => document.querySelector('.room-code')?.textContent === code,
      ROOM, { timeout: 15000 },
    );
    await page.waitForSelector('.player-list-row', { timeout: 15000 });

    const after = srv.rooms.getRoom(ROOM);
    assert.ok(after, 'sala segue existindo após o reload');
    assert.equal(after.players.length, 1, 'reload retomou: sem jogador duplicado');
    assert.equal(after.players[0].id, you, 'mesma identidade/vaga após o reload');
    assert.deepEqual(errors, [], 'sem pageerror na criação nem no reload');

    await ctx.close();
  } finally {
    if (browser) await browser.close();
    await srv.close();
  }
});
