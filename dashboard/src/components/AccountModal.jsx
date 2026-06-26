import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import HierarchyView from './HierarchyView.jsx';
import MetricSelector from './MetricSelector.jsx';
import './AccountModal.css';

const API_URL = import.meta.env.VITE_API_URL ?? '';

function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? sessionStorage.getItem('dash_token') ?? '';
}

const FILTROS = [
  { id: 'todas',    label: 'Todas' },
  { id: 'ativas',   label: 'Ativas' },
  { id: 'com_erro', label: 'Com erro' },
  { id: 'pausadas', label: 'Pausadas' },
];

// Rótulos legíveis para os status de entrega que viram alerta
const STATUS_LABEL = {
  WITH_ISSUES: 'Com problema de entrega',
  DISAPPROVED: 'Reprovado pela Meta',
  PENDING_BILLING_INFO: 'Pagamento pendente',
};

const TIPO_LABEL = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };

export default function AccountModal({ conta, customName, onClose, onMetricasSalvas }) {
  const [filtroAtivo, setFiltroAtivo] = useState('todas');
  const [mostrarSelector, setMostrarSelector] = useState(false);
  const [alertas, setAlertas] = useState(conta.resumo?.alertas ?? []);
  const [reconhecendo, setReconhecendo] = useState(null); // chave em processamento

  useEffect(() => { setAlertas(conta.resumo?.alertas ?? []); }, [conta]);

  async function marcarCiente(alerta) {
    setReconhecendo(alerta.chave);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/dashboard/contas/${conta.id}/alertas?token=${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: alerta.chave, reconhecer: true }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setAlertas((prev) => prev.filter((a) => a.chave !== alerta.chave));
    } catch {
      // mantém o alerta na lista; o usuário pode tentar de novo
    } finally {
      setReconhecendo(null);
    }
  }

  // Fecha com ESC
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Impede scroll do body enquanto o modal está aberto
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const nomeExibido = customName ?? conta.nome;

  // Data de referência: primeira entidade que tiver tsAtual
  const entidadeComTs = conta.entidades?.find((e) => e.tsAtual);
  const dataReferencia = entidadeComTs?.dataReferencia ?? null;

  return (
    <>
    {mostrarSelector && createPortal(
      <MetricSelector
        contaId={conta.id}
        selecionadas={conta.metricasSelecionadas ?? []}
        onClose={() => setMostrarSelector(false)}
        onSalvo={(novas) => { onMetricasSalvas?.(conta.id, novas); }}
      />,
      document.body
    )}
    <div className="am-overlay" onClick={onClose}>
      <div className="am-panel" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="am-header">
          <div className="am-header-left">
            <h2 className="am-titulo">{nomeExibido}</h2>
            {alertas.length > 0 && (
              <span className="am-alerta-badge">
                {alertas.length} alerta{alertas.length !== 1 ? 's' : ''}
              </span>
            )}
            {dataReferencia && (
              <span className="am-data-ref">Métricas de {dataReferencia}</span>
            )}
          </div>
          <button
            className="am-metricas-btn"
            onClick={() => setMostrarSelector(true)}
            title="Configurar métricas"
          >
            ⚙ Métricas
          </button>
          <button className="am-close" onClick={onClose} title="Fechar (ESC)">×</button>
        </div>

        {/* ── Alertas (com detalhes + marcar ciente) ── */}
        {alertas.length > 0 && (
          <div className="am-alertas">
            {alertas.map((a) => (
              <div key={a.chave} className="am-alerta">
                <div className="am-alerta-info">
                  <div className="am-alerta-titulo">
                    <span className="am-alerta-tipo">{TIPO_LABEL[a.tipo] ?? a.tipo}</span>
                    <span className="am-alerta-nome">{a.nome}</span>
                  </div>
                  <div className="am-alerta-motivo">
                    {STATUS_LABEL[a.status] ?? a.status}
                    {a.motivoStatus ? ` — ${a.motivoStatus}` : ''}
                  </div>
                  {(a.issues ?? []).map((iss, i) => (
                    <div key={i} className="am-alerta-issue">
                      ⚠ {iss.error_summary || iss.error_message || iss.error_code}
                    </div>
                  ))}
                </div>
                <button
                  className="am-alerta-ciente"
                  onClick={() => marcarCiente(a)}
                  disabled={reconhecendo === a.chave}
                  title="Marcar como ciente / resolvido — remove o alerta da visão"
                >
                  {reconhecendo === a.chave ? '…' : '✓ Ciente'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Filtros ── */}
        <div className="am-filtros">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              className={`am-filtro-btn ${filtroAtivo === f.id ? 'ativo' : ''}`}
              onClick={() => setFiltroAtivo(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ── Hierarquia ── */}
        <div className="am-body">
          {conta.entidades?.length > 0 ? (
            <HierarchyView
              entidades={conta.entidades}
              nivel="todos"
              statusFiltro={filtroAtivo}
            />
          ) : (
            <p className="am-vazio">Nenhuma entidade monitorada nesta conta.</p>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
