let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;
  try {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    audioContext = null;
  }
  return audioContext;
}

export function playExplosion(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => undefined);
  }

  const now = ctx.currentTime;
  const duration = 1.35;

  // Rumble grave.
  const rumble = ctx.createOscillator();
  rumble.type = 'sine';
  rumble.frequency.setValueAtTime(72, now);
  rumble.frequency.exponentialRampToValueAtTime(28, now + duration);
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.0001, now);
  rumbleGain.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  rumble.connect(rumbleGain).connect(ctx.destination);
  rumble.start(now);
  rumble.stop(now + duration);

  // Estouro inicial.
  const crack = ctx.createOscillator();
  crack.type = 'square';
  crack.frequency.setValueAtTime(260, now);
  crack.frequency.exponentialRampToValueAtTime(60, now + 0.18);
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.0001, now);
  crackGain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  crack.connect(crackGain).connect(ctx.destination);
  crack.start(now);
  crack.stop(now + 0.25);

  // Ruído de explosão.
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    const t = i / bufferSize;
    const envelope = Math.pow(1 - t, 1.6);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(220, now + duration);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.45, now + 0.02);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noise.connect(filter).connect(noiseGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + duration);
}
