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
  if (pct === null) return { seta: '', cor: '#484f58' };

  const subiu = pct > 0;

  if (direcaoBoa === 'maior') {
    return { seta: subiu ? '↑' : '↓', cor: subiu ? '#3fb950' : '#f85149' };
  }
  if (direcaoBoa === 'menor') {
    return { seta: subiu ? '↑' : '↓', cor: subiu ? '#f85149' : '#3fb950' };
  }
  if (direcaoBoa === 'estavel') {
    const intenso = Math.abs(pct) > 15;
    return { seta: subiu ? '↑' : '↓', cor: intenso ? '#f0883e' : '#e3b341' };
  }
  // monitorar — neutro
  return { seta: subiu ? '↑' : '↓', cor: '#8b949e' };
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
