import './DashboardCard.css';

const LS_NOMES = 'sentinela_nomes_customizados';
function lerNomes() {
  try { return JSON.parse(localStorage.getItem(LS_NOMES)) ?? {}; } catch { return {}; }
}

function moedaBR(v) {
  if (v == null || v === 0) return '—';
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Extrai o título da primeira linha do conteúdo de uma notificação
// Formato: "🔴 *Saldo esgotado*\n\n..." → "Saldo esgotado"
function tituloNotif(conteudo) {
  const primeira = (conteudo ?? '').split('\n')[0];
  return primeira.replace(/<!--.*?-->/g, '').replace(/\*/g, '').trim();
}

const STATUS_LABEL = {
  critico: { cor: 'dc-col-problema', texto: 'Problema' },
  atencao: { cor: 'dc-col-alerta',   texto: 'Atenção' },
  pausado: { cor: 'dc-col-pausado',  texto: 'Pausada' },
  normal:  { cor: 'dc-col-normal',   texto: 'Normal' },
};

const SALDO_LABEL = {
  zerado:   { cor: 'dc-tag-critico', texto: 'Saldo esgotado' },
  bloqueado:{ cor: 'dc-tag-critico', texto: 'Conta bloqueada' },
  critico:  { cor: 'dc-tag-alerta',  texto: 'Saldo crítico' },
  acabando: { cor: 'dc-tag-alerta',  texto: 'Saldo acabando' },
};

export default function DashboardCard({ conta, notificacoesConta }) {
  const nomes = lerNomes();
  const nome = nomes[conta.id] ?? conta.nome;
  const gestor = conta.perfil?.gerenteResponsavel;
  const investimento = conta.perfil?.investimentoMensalPlanejado;
  const gastoHoje = conta.resumo?.gastoHoje ?? 0;
  const statusConta = conta.resumo?.status ?? 'normal';
  const alertas = conta.resumo?.alertas ?? [];
  const saldoPrepago = conta.resumo?.saldoPrepago ?? [];
  const veredito = conta.resumo?.veredito;

  const statusInfo = STATUS_LABEL[statusConta] ?? STATUS_LABEL.normal;

  // Progresso do gasto no período vs investimento mensal
  const pctGasto = investimento && gastoHoje > 0
    ? Math.min(Math.round((gastoHoje / investimento) * 100), 999)
    : null;

  // Tags de problemas/alertas a mostrar no card
  const tags = [];

  // 1. Saldo de pré-pago
  for (const s of saldoPrepago) {
    if (SALDO_LABEL[s.nivel]) {
      tags.push({ ...SALDO_LABEL[s.nivel], key: `saldo-${s.contaAnuncioId}` });
    }
  }

  // 2. Issues de entrega (entities com status problemático)
  for (const a of alertas.slice(0, 2)) {
    tags.push({
      cor: 'dc-tag-alerta',
      texto: a.nome ? `${a.nome} — ${a.status}` : a.status,
      key: a.chave,
    });
  }

  // 3. Notificações de performance recentes (máx 2)
  for (const n of (notificacoesConta ?? []).slice(0, 2)) {
    tags.push({
      cor: 'dc-tag-info',
      texto: tituloNotif(n.conteudo),
      key: n.id,
    });
  }

  // 4. Veredito negativo (só se não há outros alertas)
  if (tags.length === 0 && veredito?.direcao === 'cai') {
    tags.push({ cor: 'dc-tag-alerta', texto: 'Performance caindo', key: 'veredito' });
  }

  return (
    <div className={`dc-card ${statusInfo.cor}`}>
      <div className="dc-header">
        <span className="dc-nome">{nome}</span>
        <span className={`dc-badge ${statusInfo.cor}`}>{statusInfo.texto}</span>
      </div>

      {gestor && <div className="dc-gestor">{gestor}</div>}

      <div className="dc-gasto">
        <span className="dc-gasto-valor">{moedaBR(gastoHoje)}</span>
        {investimento && (
          <span className="dc-gasto-meta"> / {moedaBR(investimento)}/mês</span>
        )}
        {pctGasto != null && (
          <span className="dc-gasto-pct">{pctGasto}%</span>
        )}
      </div>

      {pctGasto != null && (
        <div className="dc-progress-bar">
          <div
            className={`dc-progress-fill ${pctGasto >= 100 ? 'dc-progress-over' : ''}`}
            style={{ width: `${Math.min(pctGasto, 100)}%` }}
          />
        </div>
      )}

      {tags.length > 0 && (
        <div className="dc-tags">
          {tags.slice(0, 3).map((t) => (
            <span key={t.key} className={`dc-tag ${t.cor}`}>{t.texto}</span>
          ))}
        </div>
      )}

      {tags.length === 0 && statusConta === 'normal' && (
        <div className="dc-ok">Tudo normal</div>
      )}
    </div>
  );
}
