// Suíte E2E agregada (entrypoint de `npm run e2e`).
//
// Orquestração segura (R9): sobe Hub + 3 jogos como serviços EFÊMEROS em
// portas livres, sem depender do start.sh global e sem colidir com uma
// instância do usuário. Ao final derruba tudo. Perfis de navegador isolados
// (cada script cria seus próprios contexts). Nenhuma alteração de rede.
//
// Tabela da suíte (o relatório imprime o rótulo proof por fluxo):
//   fluxo                      prova      o que cobre
//   flow1-arcade-loop          hooks      Hub<->Arcade: criar/entrar/prontos,
//                                         mesmo game code, finish, retorno
//   flow2-capacity             regras     limites de capacidade + corrida
//                                         pela última vaga (servidor)
//   flow3-midmatch             hooks      waiting sem mid-match + isolamento
//                                         entre 2 salas VAVA (fins por hook)
//   flow4-host-transfer        regras     anfitrião sai -> outro assume;
//                                         sala vazia some da lista
//   flow5-nicknames            regras     nick único global + liberação
//                                         pós-grace
//   flow6-catan                hooks      protocolo Catan real; win por hook
//   flow7-play-real            play-real  inputs reais (Arcade largada +
//                                         snapshots; VAVA movimento) sem hook
//                                         e sem fim natural (ver README)
//   flow8-arcade-natural       play-real  Arcade NATURAL via Hub (navegador):
//                                         sala→ready→iframe→1 volta pilotada
//                                         até o pódio SEM hook→retorno
//   flow9-catan-vava-natural     play-real  Catan setup+turnos e VAVA 70s+carta,
//                                         tudo real sem hook; fins naturais
//                                         declarados como NÃO cobertos
//   flow10-offline               offline    Hub+Arcade completos no navegador
//                                         com hosts externos ABORTADOS (0
//                                         tolerados); fim por hook
//   ui-smoke                   hooks      Hub no navegador (VAVA); fim por hook
//   verify-arcade-browser      hooks      iframes entram sozinhos; fim por hook
//   verify-catan-browser       hooks      UI real até o start; win por hook
//
// "hooks" NÃO é partida completa: o rótulo existe p/ não confundir fixture
// com jogabilidade. O play-real prova ações/progresso reais, mas terminar uma
// partida inteira (corrida, arena 5min, Catan) é longo demais p/ a suíte.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

const SUITE = [
  { script: 'flow1-arcade-loop.mjs', proof: 'hooks' },
  { script: 'flow2-capacity.mjs', proof: 'regras' },
  { script: 'flow3-midmatch.mjs', proof: 'hooks' },
  { script: 'flow4-host-transfer.mjs', proof: 'regras' },
  { script: 'flow5-nicknames.mjs', proof: 'regras' },
  { script: 'flow6-catan.mjs', proof: 'hooks' },
  { script: 'flow7-play-real.mjs', proof: 'play-real' },
  { script: 'flow8-arcade-natural.mjs', proof: 'play-real' },
  { script: 'flow9-catan-vava-natural.mjs', proof: 'play-real' },
  { script: 'flow10-offline.mjs', proof: 'offline' },
  { script: 'ui-smoke.mjs', proof: 'hooks' },
  { script: 'verify-arcade-browser.mjs', proof: 'hooks' },
  { script: 'verify-catan-browser.mjs', proof: 'hooks' },
];

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolvePromise(port));
    });
  });
}

async function waitHealth(url, label, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        console.log(`[run-all] ${label} ok (${url})`);
        return;
      }
    } catch { /* ainda subindo */ }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`${label} sem health em ${timeoutMs}ms (${url})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const children = [];
function startService(label, cmd, args, opts, logFile) {
  console.log(`[run-all] subindo ${label}: ${cmd} ${args.join(' ')} (cwd=${opts.cwd})`);
  // detached: o serviço vira líder de grupo; o teardown mata o grupo inteiro
  // (cobre wrappers como o npm, sem órfãos — mesmo padrão do stop.sh).
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.on('data', (d) => logFile.write(`[${label}] ${d}`));
  child.stderr.on('data', (d) => logFile.write(`[${label}:err] ${d}`));
  child.on('exit', (code, sig) => {
    try { logFile.write(`[${label}] exit code=${code} sig=${sig}\n`); } catch { /* ok */ }
  });
  children.push({ label, child });
  return child;
}

function killGroup(child, sig) {
  try {
    process.kill(-child.pid, sig);
  } catch {
    try { child.kill(sig); } catch { /* ok */ }
  }
}

async function teardown() {
  // Mata o grupo de cada serviço e espera a saída (máximo 5s), senão
  // SIGKILL. Só depois o chamador fecha o log e remove o tmp.
  const pending = children.splice(0);
  for (const { child } of pending) {
    if (child.exitCode !== null) continue;
    killGroup(child, 'SIGTERM');
  }
  const t0 = Date.now();
  let remaining = pending.filter(({ child }) => child.exitCode === null);
  while (remaining.length > 0 && Date.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 200));
    remaining = remaining.filter(({ child }) => child.exitCode === null);
  }
  // Restos teimosos (ex.: wrapper npm): SIGKILL no grupo.
  for (const { label, child } of remaining) {
    try {
      console.log(`[run-all] ${label} não saiu; SIGKILL no grupo`);
      killGroup(child, 'SIGKILL');
    } catch { /* ok */ }
  }
}

async function main() {
  const only = process.argv[2]; // ex.: node run-all.mjs flow6-catan.mjs
  const scripts = only ? SUITE.filter((s) => s.script === only) : SUITE;
  if (only && scripts.length === 0) {
    console.error(`[run-all] fluxo desconhecido: ${only}`);
    process.exit(1);
  }

  const tmpDir = await fs.mkdtemp(join(tmpdir(), 'hub-e2e-'));
  const logDir = join(tmpDir, 'logs');
  await fs.mkdir(logDir, { recursive: true });
  const logFile = await fs.open(join(logDir, 'services.log'), 'w');

  // Portas efêmeras: sem colisão com instância do usuário.
  const [hubPort, arcadePort, vavaPort, catanPort] = [
    await freePort(), await freePort(), await freePort(), await freePort(),
  ];
  console.log(`[run-all] portas efêmeras hub=${hubPort} arcade=${arcadePort} vava=${vavaPort} catan=${catanPort}`);
  console.log(`[run-all] tmp=${tmpDir}`);

  // Manifesto efêmero p/ o Hub apontar p/ as portas efêmeras.
  const baseManifest = JSON.parse(
    await fs.readFile(join(REPO_ROOT, 'hub', 'games.json'), 'utf8'),
  );
  const portById = { arcade: arcadePort, vava: vavaPort, catan: catanPort };
  for (const g of baseManifest.games) {
    if (portById[g.id]) g.port = portById[g.id];
  }
  baseManifest.hubPort = hubPort;
  const manifestFile = join(tmpDir, 'games.json');
  await fs.writeFile(manifestFile, JSON.stringify(baseManifest, null, 2));

  const secret = randomBytes(32).toString('hex');
  const flowEnv = {
    ...process.env,
    E2E_HUB_PORT: String(hubPort),
    E2E_ARCADE_PORT: String(arcadePort),
    E2E_VAVA_PORT: String(vavaPort),
    E2E_CATAN_PORT: String(catanPort),
    E2E_HUB_SECRET: secret,
    E2E_SHOT_DIR: join(tmpDir, 'shots'),
  };
  const svcEnv = {
    ...process.env,
    // HOST do ambiente (ex.: localhost.localdomain) resolveria p/ ::1 e
    // quebraria o 127.0.0.1 — igual ao start.sh, força 0.0.0.0.
    HOST: '0.0.0.0',
    HUB_HOST: '0.0.0.0',
    HUB_PORT: String(hubPort),
    PORT: '', // cada serviço define o seu abaixo
    HUB_GAMES_FILE: manifestFile,
    HUB_SECRET: secret,
    HUB_TEST_HOOKS: '1',
  };

  let failed = 0;
  try {
    startService('hub', 'node', ['hub/server.js'],
      { cwd: REPO_ROOT, env: { ...svcEnv, PORT: String(hubPort) } }, logFile);
    startService('arcade', 'node', ['server/index.js'],
      { cwd: join(REPO_ROOT, 'Games', 'ArcadeAI_race_game'), env: { ...svcEnv, PORT: String(arcadePort) } }, logFile);
    startService('vava', 'npm', ['start', '--silent', '--workspace', '@vava/server'],
      { cwd: join(REPO_ROOT, 'Games', 'VAVA2D'), env: { ...svcEnv, PORT: String(vavaPort) } }, logFile);
    startService('catan', 'node', ['dist/server.mjs'],
      {
        cwd: join(REPO_ROOT, 'Games', 'Catan'),
        env: {
          ...svcEnv, PORT: String(catanPort), NODE_ENV: 'production', DB_PATH: join(tmpDir, 'catan-e2e.db'),
        },
      }, logFile);

    await waitHealth(`http://127.0.0.1:${hubPort}/health`, 'hub');
    await waitHealth(`http://127.0.0.1:${arcadePort}/api/info`, 'arcade');
    await waitHealth(`http://127.0.0.1:${vavaPort}/health`, 'vava');
    await waitHealth(`http://127.0.0.1:${catanPort}/health`, 'catan');

    for (const { script, proof } of scripts) {
      console.log(`\n===== ${script} [proof=${proof}] =====`);
      const t0 = Date.now();
      const code = await new Promise((resolvePromise) => {
        const c = spawn('node', [join(HERE, script)], { cwd: REPO_ROOT, env: flowEnv, stdio: 'inherit' });
        c.on('close', resolvePromise);
      });
      console.log(`===== ${script} [proof=${proof}]: exit=${code} ${((Date.now() - t0) / 1000).toFixed(1)}s =====`);
      if (code !== 0) failed += 1;
    }

    console.log(`\n[run-all] ${scripts.length - failed}/${scripts.length} verdes`);
  } catch (e) {
    console.error(`[run-all] FALHOU na orquestração: ${e.message}`);
    failed += 1;
  } finally {
    // Derruba os serviços ANTES de fechar o log: eles escrevem nele até morrer.
    await teardown();
    try { await logFile.close(); } catch { /* ok */ }
    const keepTmp = process.env.E2E_KEEP_TMP === '1' || failed > 0;
    if (keepTmp) {
      console.log(`[run-all] tmp preservado em ${tmpDir} (E2E_KEEP_TMP=1 ou houve falha)`);
      try {
        const tail = (await fs.readFile(join(logDir, 'services.log'), 'utf8')).split('\n').slice(-30).join('\n');
        console.log('[run-all] cauda do log dos serviços:');
        console.log(tail);
      } catch { /* ok */ }
    } else {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch { /* ok */ }
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

// CTRL+C no meio da suíte não pode deixar serviços órfãos.
process.on('SIGINT', () => {
  for (const { child } of children) {
    killGroup(child, 'SIGTERM');
  }
  process.exit(130);
});

await main();
