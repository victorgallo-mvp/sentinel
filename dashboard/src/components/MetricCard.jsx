import './MetricCard.css';

export default function MetricCard({ metrica }) {
  const { nome, unidade, direcaoBoa, atual, variacaoPct } = metrica;
  const { seta, tom } = calcularTendencia(variacaoPct, direcaoBoa);

  return (
    <div className="metric-card">
      <span className="metric-nome">{nome}</span>
      <span className="metric-valor">{formatarValor(atual, unidade)}</span>
      {variacaoPct !== null && (
        <span className={`metric-variacao metric-variacao--${tom}`}>
          {seta} {Math.abs(variacaoPct)}%
        </span>
      )}
    </div>
  );
}

// Tom: 'crit' (piorou) | 'warn' (oscilação relevante) | 'muted' (estável/melhorou)
// Sem verde — minimalismo: melhora não recebe cor de destaque.
function calcularTendencia(pct, direcaoBoa) {
  if (pct === null) return { seta: '', tom: 'muted' };

  const subiu = pct > 0;
  const seta = subiu ? '↑' : '↓';

  if (direcaoBoa === 'maior')  return { seta, tom: subiu ? 'muted' : 'crit' };
  if (direcaoBoa === 'menor')  return { seta, tom: subiu ? 'crit' : 'muted' };
  if (direcaoBoa === 'estavel') return { seta, tom: Math.abs(pct) > 15 ? 'warn' : 'muted' };
  return { seta, tom: 'muted' };
}

function formatarValor(v, unidade) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  switch (unidade) {
    case 'currency':
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
    case 'percent':
      return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    case 'multiplier':
      return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
    case 'integer':
      return n.toLocaleString('pt-BR');
    default:
      return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
}
