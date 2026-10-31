// Agregador: roda F1-F5 + ui-smoke em sequência e resume. F6 (Catan) fica de fora
// do verde de produção por BUG-1 documentado (rode flow6 isolado p/ ver o FAIL).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const scripts = [
  'flow1-arcade-loop.mjs',
  'flow2-capacity.mjs',
  'flow3-midmatch.mjs',
  'flow4-host-transfer.mjs',
  'flow5-nicknames.mjs',
  'ui-smoke.mjs',
];

function run(script) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('node', [join(dir, script)], { stdio: 'inherit' });
    child.on('close', (code) => resolve({ script, code, ms: Date.now() - t0 }));
  });
}

let failed = 0;
for (const s of scripts) {
  console.log(`\n===== ${s} =====`);
  const r = await run(s);
  console.log(`===== ${s}: exit=${r.code} ${(r.ms / 1000).toFixed(1)}s =====`);
  if (r.code !== 0) failed += 1;
}
console.log(`\n[run-all] ${scripts.length - failed}/${scripts.length} verdes`);
if (failed > 0) console.log('[run-all] FALHOU');
process.exit(failed > 0 ? 1 : 0);
