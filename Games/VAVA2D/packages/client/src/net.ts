import type { ClientMessage, PlayerInput, ServerMessage } from '@vava/shared';

export class Connection {
  private socket: WebSocket | null = null;
  private pingTimer: number | null = null;
  private opened = false;
  latency = 0;

  onMessage: (message: ServerMessage) => void = () => undefined;
  onClose: () => void = () => undefined;

  async connect(): Promise<void> {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
    this.socket = socket;

    socket.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const message = parsed as ServerMessage;
      if (message.t === 'pong') {
        this.latency = Math.max(0, Math.round(performance.now() - message.id));
        return;
      }
      this.onMessage(message);
    });

    socket.addEventListener('close', () => {
      this.stopPing();
      if (this.opened) {
        this.opened = false;
        this.onClose();
      }
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('Tempo esgotado ao conectar no servidor.'));
      }, 8000);

      socket.addEventListener(
        'open',
        () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          this.opened = true;
          this.startPing();
          resolve();
        },
        { once: true },
      );

      socket.addEventListener(
        'error',
        () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error('Não foi possível conectar no servidor.'));
        },
        { once: true },
      );
    });
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  sendInput(input: PlayerInput): void {
    this.send({ t: 'input', input });
  }

  close(): void {
    this.stopPing();
    this.socket?.close();
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.send({ t: 'ping', id: performance.now() });
    }, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
