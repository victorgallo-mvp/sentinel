import './MetricCard.css';

export default function MetricCard({ metrica }) {
  const { nome, unidade, direcaoBoa, atual, variacaoPct } = metrica;
  const { seta, cor } = calcularTendencia(variacaoPct, direcaoBoa);

  return (
    <div className="metric-card">
      <span className="metric-nome">{nome}</span>
      <span className="metric-valor">{formatarValor(atual, unidade)}</span>
      {variacaoPct !== null && (
        <span className="metric-variacao" style={{ color: cor }}>
          {seta} {Math.abs(variacaoPct)}%
          <span className="metric-hint">{labelDirecao(direcaoBoa, variacaoPct)}</span>
        </span>
      )}
    </div>
  );
}

function calcularTendencia(pct, direcaoBoa) {
  if (pct === null) return { seta: '', cor: '#9ca3af' };

  const subiu = pct > 0;

  if (direcaoBoa === 'maior') {
    return { seta: subiu ? '↑' : '↓', cor: subiu ? '#16a34a' : '#dc2626' };
  }
  if (direcaoBoa === 'menor') {
    return { seta: subiu ? '↑' : '↓', cor: subiu ? '#dc2626' : '#16a34a' };
  }
  if (direcaoBoa === 'estavel') {
    const intenso = Math.abs(pct) > 15;
    return { seta: subiu ? '↑' : '↓', cor: intenso ? '#ea580c' : '#ca8a04' };
  }
  return { seta: subiu ? '↑' : '↓', cor: '#6b7280' };
}

function labelDirecao(direcaoBoa, pct) {
  if (direcaoBoa === 'estavel') return ' ⚡';
  if (direcaoBoa === 'monitorar') return '';
  return '';
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
