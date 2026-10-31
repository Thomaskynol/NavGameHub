// Tutorial contextual dispensável (5 passos curtos).
import { useEffect, useState } from 'react';

export interface TutorialState {
  step: number; // 0..4; -1 = desligado
  done: boolean;
}

export const TUTORIAL_STEPS: { targetId: string | null; title: string; body: string }[] = [
  {
    targetId: 'btn-roll',
    title: '1. Role os dados',
    body: 'Toda rodada começa com a produção: clique em “Rolar dados”. Hexes com o número sorteado entregam recursos.',
  },
  {
    targetId: 'btn-road',
    title: '2. Construa',
    body: 'Use sua mão para erguer estradas, assentamentos e cidades. As posições legais acendem no tabuleiro — clique e confirme.',
  },
  {
    targetId: 'btn-bank',
    title: '3. Troque',
    body: 'Negocie com o banco (4:1, ou melhor com portos) e propõe trocas com os jogadores.',
  },
  {
    targetId: 'btn-buy-dev',
    title: '4. Compre desenvolvimentos',
    body: 'Cavaleiros, Monopólio, Fartura, Estradas grátis e Pontos de Vitória. Cartas compradas só valem no próximo turno.',
  },
  {
    targetId: null,
    title: '5. Vencer',
    body: 'Assentamento vale 1, cidade 2, Maior Estrada e Maior Exército 2. Com 10 pontos no seu turno, a ilha é sua!',
  },
];

export default function Tutorial({
  step,
  onNext,
  onSkip,
  onFinish,
}: {
  step: number;
  onNext(): void;
  onSkip(): void;
  onFinish(): void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const def = TUTORIAL_STEPS[step];

  useEffect(() => {
    if (!def?.targetId) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = document.getElementById(def.targetId!);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener('resize', update);
    const t = setTimeout(update, 350); // espera animações de entrada
    return () => {
      window.removeEventListener('resize', update);
      clearTimeout(t);
    };
  }, [def]);

  if (!def) return null;
  const last = step === TUTORIAL_STEPS.length - 1;

  const spotStyle = rect
    ? { left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 }
    : { left: '50%', top: '40%', width: 200, height: 80, transform: 'translateX(-50%)' };

  const cardStyle = rect
    ? {
        left: Math.min(Math.max(12, rect.left - 40), window.innerWidth - 360),
        top: Math.min(rect.bottom + 14, window.innerHeight - 240),
      }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <>
      <div className="tut-spot" style={spotStyle} aria-hidden="true" />
      <div className="tut-card" style={cardStyle} role="dialog" aria-label={`Tutorial: ${def.title}`}>
        <h3>{def.title}</h3>
        <p className="small" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>{def.body}</p>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--ink)', borderColor: 'var(--parchment-shadow)' }} onClick={onSkip}>
            Pular tutorial
          </button>
          <div className="row">
            <span className="small muted">
              {step + 1}/{TUTORIAL_STEPS.length}
            </span>
            <button type="button" className="btn btn-sm btn-primary" onClick={last ? onFinish : onNext}>
              {last ? 'Entendi!' : 'Avançar'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
