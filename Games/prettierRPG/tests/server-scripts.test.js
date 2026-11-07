// Seção 8: scripts param só a instância correta; HOST/PORT sem depender do ambiente.
// stop.sh roda em cópia temporária (nunca no pidfile do projeto).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('start.sh: HOST não-IP cai p/ 0.0.0.0; PORT inválida cai p/ 8094', () => {
  const src = fs.readFileSync(path.join(ROOT, 'start.sh'), 'utf8');
  assert.ok(/0\.0\.0\.0/.test(src), 'fallback HOST');
  assert.ok(/PORT=.*8094/.test(src), 'fallback PORT');
  assert.ok(/1.*65535|lt 1.*gt 65535/.test(src), 'PORT valida faixa');
});

test('stop.sh: valida exe+cmdline+cwd do PID (nunca mata alheio)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'stop.sh'), 'utf8');
  assert.ok(/server\.js/.test(src), 'checa comando server.js');
  assert.ok(/\/proc\/\$PID\/cwd/.test(src), 'valida cwd do processo via /proc');
  assert.ok(/Removendo pidfile obsoleto/.test(src), 'pidfile obsoleto removido');
});

test('stop.sh funcional: PID alheio sobrevive, pidfile sai', () => {
  if (process.platform !== 'linux') return; // /proc só no Linux (alvo §2)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-test-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'stop.sh'), path.join(dir, 'stop.sh'));
    const sleeper = spawn('sleep', ['300'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(dir, '.prettierrpg.pid'), String(sleeper.pid));
      const out = execFileSync('bash', ['stop.sh'], { cwd: dir, encoding: 'utf8' });
      assert.ok(/não é do projeto|não vou matar/.test(out), `recusa matar alheio: ${out}`);
      assert.ok(!fs.existsSync(path.join(dir, '.prettierrpg.pid')), 'pidfile removido');
      // sleeper segue vivo (stop não matou)
      let alive = true;
      try { process.kill(sleeper.pid, 0); } catch { alive = false; }
      assert.ok(alive, 'processo alheio sobreviveu');
    } finally {
      try { sleeper.kill('SIGKILL'); } catch { /* já morto */ }
    }
    // pid inexistente: informa e limpa
    fs.writeFileSync(path.join(dir, '.prettierrpg.pid'), '424242');
    const out2 = execFileSync('bash', ['stop.sh'], { cwd: dir, encoding: 'utf8' });
    assert.ok(/já não existe/.test(out2));
    assert.ok(!fs.existsSync(path.join(dir, '.prettierrpg.pid')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
