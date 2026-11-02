// Modal acessível simples (esc fecha, overlay clicável fecha quando não bloqueante).
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  /** Modal obrigatório: não fecha no esclick/overlay. */
  blocking?: boolean;
}

export default function Modal({ title, children, footer, onClose, wide, blocking }: ModalProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !blocking) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [blocking, onClose]);

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => {
        if (!blocking && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && !blocking && (
            <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Stepper({
  value,
  max,
  min = 0,
  onChange,
  label,
}: {
  value: number;
  max: number;
  min?: number;
  onChange(v: number): void;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Remover de ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="v">{value}</span>
      <button type="button" aria-label={`Adicionar a ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}
