// Popup "Você ganhou X": nome do recurso por extenso + quantidade.
// Uso: outro componente monta `<RewardToast gains={...} />` ao detectar ganho e
// desmonta após ~3s. O sumiço visual é só CSS (animação `reward-toast-life`, 3s,
// termina invisível); o componente nunca bloqueia input (pointer-events: none).
// Nomes PT vêm de RESOURCE_LABEL (shared/constants: lumber=Mad eira etc. via
// ui/icons); chave desconhecida cai para o texto cru em vez de quebrar.
import { RESOURCE_LABEL, ResourceIcon } from '../ui/icons';
import type { ResourceKind } from '../../shared/constants';

function isResourceKind(r: string): r is ResourceKind {
  return r in RESOURCE_LABEL;
}

export function RewardToast({ gains }: { gains: { resource: string; count: number }[] }) {
  const items = gains.filter((g) => g.count > 0);
  if (items.length === 0) return null;
  return (
    <div className="reward-toast" role="status" aria-live="polite">
      <span className="reward-title">Você ganhou</span>
      <span className="reward-list">
        {items.map((g) => {
          const label = isResourceKind(g.resource) ? RESOURCE_LABEL[g.resource] : g.resource;
          return (
            <span key={g.resource} className="reward-item">
              {isResourceKind(g.resource) && <ResourceIcon kind={g.resource} size={18} />}
              <b>
                {g.count}× {label}
              </b>
            </span>
          );
        })}
      </span>
    </div>
  );
}
