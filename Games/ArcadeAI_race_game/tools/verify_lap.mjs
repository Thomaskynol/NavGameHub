// Guarda REAL de conclusão de volta do Asfalto Vivo — extração compartilhada
// (fonte única) usada por tools/smoke_e2e.mjs, tools/dnf_check.mjs e
// hub/test/e2e/flow8-arcade-natural.mjs. Não duplicar esta lógica nos
// consumidores: importar daqui para o negativo exercitar o MESMO código do
// positivo.
//
// Tela de resultados ≠ conclusão: o deadline (server/race.js onFirstFinish /
// finish) gera results com dnf=true ("Não concluiu", td.tempo com classe
// r-dnf), que NÃO prova volta. A conclusão exige as 3 condições juntas:
// snapshot (lap) + linha sem DNF + tempo válido.

// Predicado puro (testável sem navegador): lapDone é o booleano do snapshot,
// row é { name, total, totalDnf } da tabela de results (ou undefined).
export function isLapConcluded(lapDone, row) {
  return !!lapDone
    && !!row
    && !row.totalDnf
    && !!row.total
    && row.total !== ''
    && row.total !== 'Não concluiu';
}

// Snapshot: o piloto completou as voltas configuradas (info.laps).
// Aceita Page (Playwright) ou Frame (iframe do Hub): ambos têm .evaluate.
export async function queryLapDone(target) {
  return target.evaluate(() => {
    const av = globalThis.__av;
    const info = av?.info?.();
    const sn = av?.lastSn?.();
    if (!info || !sn || !info.you) return false;
    const me = sn.cars?.find((c) => c.id === info.you);
    return !!me && (info.laps == null ? false : me.lap >= info.laps);
  }).catch(() => false);
}

// Linha da tabela de results p/ um piloto: { name, total, totalDnf }.
// totalDnf=true ⇔ td.tempo com classe r-dnf ("Não concluiu").
export async function queryResultRow(target, frag) {
  const rows = await target.evaluate(() => [...document.querySelectorAll('.results-table tbody tr')].map((tr) => {
    const name = tr.querySelector('.r-name')?.textContent?.trim() ?? '';
    const tds = [...tr.querySelectorAll('td.num')];
    const total = tds[0];
    return { name, total: (total?.textContent ?? '').trim(), totalDnf: !!total?.classList.contains('r-dnf') };
  })).catch(() => []);
  return (rows || []).find((r) => r.name.includes(frag));
}

// Conveniência para o positivo: lê snapshot + linha e aplica a guarda única.
export async function queryConcluded(target, frag) {
  const lap = await queryLapDone(target);
  const row = await queryResultRow(target, frag);
  return { lap, row, concluded: isLapConcluded(lap, row) };
}
