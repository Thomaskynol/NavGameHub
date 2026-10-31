import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';

const VAVA_ROOT = '/home/thomaskyn/Documents/dev/Game_Hub/Games/VAVA2D';
const SECRET = 'vava-htok-test-secret';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function killTree(child) {
  // tsx CLI executa o servidor num processo filho: matar só o wrapper órfã
  // o servidor (porta ocupada, suite pendurada). Com detached:true o grupo
  // é do filho → SIGKILL no grupo derruba a árvore inteira.
  try {
    if (child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // já encerrado
    }
  }
}

async function startVavaServer(t) {
  const port = await freePort();
  const tsx = path.join(VAVA_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = path.join(VAVA_ROOT, 'packages', 'server', 'src', 'index.ts');
  const child = spawn(process.execPath, [tsx, entry], {
    cwd: VAVA_ROOT,
    detached: true,
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', HUB_SECRET: SECRET, HUB_TEST_HOOKS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    killTree(child);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('VAVA não iniciou a tempo')), 15000);
    const onData = () => {
      fetch(`http://127.0.0.1:${port}/health`).then((response) => {
        if (response.ok) {
          clearTimeout(timer);
          resolve();
        }
      }).catch(() => {
        // ainda subindo
      });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`VAVA saiu com código ${code}`));
    });
    onData();
  });
  return { child, port };
}

function gameMessage(ws, payload, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error('tempo esgotado esperando resposta do jogo'));
    }, timeout);
    function onMessage(data) {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.t === 'joined' || message.t === 'error') {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        resolve(message);
      }
    }
    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

async function openSocket(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

async function gameState(port, code, secret = SECRET) {
  const response = await fetch(
    `http://127.0.0.1:${port}/__hub/state?room=${code}`,
    { headers: { 'x-hub-secret': secret } },
  );
  return { status: response.status, body: await response.text() };
}

async function gameClose(port, code, htok) {
  const params = new URLSearchParams({ room: code });
  if (htok !== undefined) params.set('htok', htok);
  const response = await fetch(
    `http://127.0.0.1:${port}/__hub/close?${params.toString()}`,
    { method: 'POST', headers: { 'x-hub-secret': SECRET } },
  );
  return { status: response.status, body: await response.json() };
}

// VAVA-R2: contrato htok contra o servidor real — dono, retry legítimo,
// CODE_TAKEN honesto e close com identidade.
test('VAVA-R2: create guarda dono; mesmo htok retoma; outro htok é CODE_TAKEN', async (t) => {
  const { port } = await startVavaServer(t);
  const sockets = [];
  t.after(() => {
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {
        // já encerrado
      }
    }
  });

  const s1 = await openSocket(port);
  sockets.push(s1);
  const first = await gameMessage(s1, { t: 'create', code: 'AB23', name: 'Alice', htok: 'tok-launch-1' });
  assert.equal(first.t, 'joined');
  assert.equal(first.roomCode, 'AB23');

  // Mesmo código + mesmo dono: retentativa legítima, sem CODE_TAKEN.
  const s2 = await openSocket(port);
  sockets.push(s2);
  const retry = await gameMessage(s2, { t: 'create', code: 'AB23', name: 'Alice2', htok: 'tok-launch-1' });
  assert.equal(retry.t, 'joined');
  assert.equal(retry.roomCode, 'AB23');

  // Mesmo código + dono diferente: CODE_TAKEN, sem join cego.
  const s3 = await openSocket(port);
  sockets.push(s3);
  const collision = await gameMessage(s3, { t: 'create', code: 'AB23', name: 'Eve', htok: 'tok-outro-launch' });
  assert.equal(collision.t, 'error');
  assert.match(collision.message, /CODE_TAKEN/);

  // Mesmo código + sem htok: também CODE_TAKEN.
  const s4 = await openSocket(port);
  sockets.push(s4);
  const noToken = await gameMessage(s4, { t: 'create', code: 'AB23', name: 'Mallory' });
  assert.equal(noToken.t, 'error');
  assert.match(noToken.message, /CODE_TAKEN/);

  // A sala segue com os dois legítimos.
  const state = await gameState(port, 'AB23');
  assert.equal(state.status, 200);
  assert.equal(JSON.parse(state.body).room.players, 2);
});

test('VAVA-R2: close só fecha com o htok do dono', async (t) => {
  const { port } = await startVavaServer(t);
  const sockets = [];
  t.after(() => {
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {
        // já encerrado
      }
    }
  });

  const s1 = await openSocket(port);
  sockets.push(s1);
  const first = await gameMessage(s1, { t: 'create', code: 'CD34', name: 'Alice', htok: 'tok-dono' });
  assert.equal(first.t, 'joined');

  const noToken = await gameClose(port, 'CD34');
  assert.equal(noToken.status, 403);
  const wrong = await gameClose(port, 'CD34', 'tok-errado');
  assert.equal(wrong.status, 403);
  const still = await gameState(port, 'CD34');
  assert.equal(still.status, 200);

  const right = await gameClose(port, 'CD34', 'tok-dono');
  assert.equal(right.status, 200);
  assert.equal(right.body.closed, true);
  const gone = await gameState(port, 'CD34');
  assert.equal(gone.status, 404);

  // Close repetido é idempotente.
  const again = await gameClose(port, 'CD34', 'tok-dono');
  assert.equal(again.status, 200);
});

test('VAVA-R2: sala sem dono mantém close simples', async (t) => {
  const { port } = await startVavaServer(t);
  const sockets = [];
  t.after(() => {
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {
        // já encerrado
      }
    }
  });

  const s1 = await openSocket(port);
  sockets.push(s1);
  const first = await gameMessage(s1, { t: 'create', code: 'EF56', name: 'Bob' });
  assert.equal(first.t, 'joined');
  const closed = await gameClose(port, 'EF56');
  assert.equal(closed.status, 200);
  const gone = await gameState(port, 'EF56');
  assert.equal(gone.status, 404);
});
