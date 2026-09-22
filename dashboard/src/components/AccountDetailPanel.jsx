import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import HierarchyView from './HierarchyView.jsx';
import MetricSelector from './MetricSelector.jsx';
import PerfilConta from './PerfilConta.jsx';
import AnaliseConta from './AnaliseConta.jsx';
import { apiFetch } from '../api.js';
import './AccountDetailPanel.css';

const FILTROS = [
  { id: 'todas',    label: 'Todas' },
  { id: 'ativas',   label: 'Ativas' },
  { id: 'com_erro', label: 'Com erro' },
  { id: 'pausadas', label: 'Pausadas' },
];

const STATUS_LABEL = {
  WITH_ISSUES:          'Com problema de entrega',
  DISAPPROVED:          'Reprovado pela Meta',
  PENDING_BILLING_INFO: 'Pagamento pendente',
};

const TIPO_LABEL = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };

export default function AccountDetailPanel({ conta, customName, onMetricasSalvas, onRefresh }) {
  const [filtroAtivo,     setFiltroAtivo]     = useState('todas');
  const [mostrarSelector, setMostrarSelector] = useState(false);
  const [mostrarPerfil,   setMostrarPerfil]   = useState(false);
  const [mostrarDetalhe,  setMostrarDetalhe]  = useState(false);
  const [miniResumo,      setMiniResumo]      = useState(null);
  const [carregando,      setCarregando]      = useState(true);
  const [alertas,         setAlertas]         = useState(conta.resumo?.alertas ?? []);
  const [reconhecendo,    setReconhecendo]    = useState(null);

  useEffect(() => { setAlertas(conta.resumo?.alertas ?? []); }, [conta]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setMiniResumo(null);
    setMostrarDetalhe(false);
    apiFetch(`/dashboard/contas/${conta.id}/mini-resumo`)
      .then((d) => { if (vivo) setMiniResumo(d.texto ?? null); })
      .catch(() => { if (vivo) setMiniResumo(null); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [conta.id]);

  async function marcarCiente(alerta) {
    setReconhecendo(alerta.chave);
    try {
      await apiFetch(`/dashboard/contas/${conta.id}/alertas`, {
        method: 'PATCH',
        body: JSON.stringify({ chave: alerta.chave, reconhecer: true }),
      });
      setAlertas((prev) => prev.filter((a) => a.chave !== alerta.chave));
      onRefresh?.();
    } catch { /* mantém na lista */ }
    finally { setReconhecendo(null); }
  }

  const nomeExibido = customName ?? conta.nome;
  const actBm = conta.contaAnuncioId?.replace(/^act_/, '');
  const linkBm = actBm
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${actBm}${conta.bmId ? `&business_id=${conta.bmId}` : ''}`
    : null;
  const dataReferencia = conta.entidades?.find((e) => e.dataReferencia)?.dataReferencia ?? null;

  return (
    <>
      {mostrarSelector && createPortal(
        <MetricSelector
          contaId={conta.id}
          selecionadas={conta.metricasSelecionadas ?? []}
          onClose={() => setMostrarSelector(false)}
          onSalvo={(novas) => onMetricasSalvas?.(conta.id, novas)}
        />,
        document.body
      )}

      <div className="adp">
        {/* ── Cabeçalho do painel ── */}
        <div className="adp-header">
          <div className="adp-header-left">
            <h2 className="adp-nome">{nomeExibido}</h2>
            {alertas.length > 0 && (
              <span className="adp-alerta-badge">
                {alertas.length} alerta{alertas.length > 1 ? 's' : ''}
              </span>
            )}
            {dataReferencia && (
              <span className="adp-data-ref">métricas de {dataReferencia}</span>
            )}
          </div>
          <div className="adp-header-right">
            {linkBm && (
              <a className="adp-btn" href={linkBm} target="_blank" rel="noopener noreferrer">
                Abrir na BM ↗
              </a>
            )}
            <button
              className={`adp-btn${mostrarPerfil ? ' adp-btn--ativo' : ''}`}
              onClick={() => setMostrarPerfil((v) => !v)}
            >Perfil</button>
            <button className="adp-btn" onClick={() => setMostrarSelector(true)}>Métricas</button>
          </div>
        </div>

        {/* ── Perfil ── */}
        {mostrarPerfil && (
          <div className="adp-section">
            <PerfilConta conta={conta} onSalvo={() => onRefresh?.()} />
          </div>
        )}

        {/* ── Leitura da triagem (a cada 3 dias) ── */}
        {conta.resumo?.analise && (
          <div className="adp-section">
            <AnaliseConta analise={conta.resumo.analise} />
          </div>
        )}

        {/* ── Mini-resumo IA ── */}
        <div className="adp-resumo">
          {carregando ? (
            <span className="adp-resumo-load">Gerando resumo…</span>
          ) : miniResumo ? (
            <p className="adp-resumo-txt">{miniResumo}</p>
          ) : (
            <span className="adp-resumo-load">Sem resumo disponível.</span>
          )}
        </div>

        {/* ── Alertas ── */}
        {alertas.length > 0 && (
          <div className="adp-alertas">
            {alertas.map((a) => (
              <div key={a.chave} className="adp-alerta">
                <div className="adp-alerta-info">
                  <div className="adp-alerta-titulo">
                    <span className="adp-alerta-tipo">{TIPO_LABEL[a.tipo] ?? a.tipo}</span>
                    <span className="adp-alerta-nome">{a.nome}</span>
                  </div>
                  <div className="adp-alerta-motivo">
                    {STATUS_LABEL[a.status] ?? a.status}
                    {a.motivoStatus ? ` — ${a.motivoStatus}` : ''}
                  </div>
                  {(a.issues ?? []).map((iss, i) => (
                    <div key={i} className="adp-alerta-issue">
                      {iss.error_summary || iss.error_message || iss.error_code}
                    </div>
                  ))}
                </div>
                <button
                  className="adp-alerta-ciente"
                  onClick={() => marcarCiente(a)}
                  disabled={reconhecendo === a.chave}
                >
                  {reconhecendo === a.chave ? 'Salvando…' : 'Ciente'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Toggle campanhas ── */}
        <button
          className="adp-toggle"
          onClick={() => setMostrarDetalhe((v) => !v)}
        >
          {mostrarDetalhe ? '▾ Ocultar campanhas' : '▸ Ver campanhas'}
        </button>

        {mostrarDetalhe && (
          <div className="adp-hierarquia">
            <div className="adp-filtros">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  className={`adp-filtro-btn${filtroAtivo === f.id ? ' adp-filtro-btn--ativo' : ''}`}
                  onClick={() => setFiltroAtivo(f.id)}
                >{f.label}</button>
              ))}
            </div>
            {conta.entidades?.length > 0 ? (
              <HierarchyView entidades={conta.entidades} nivel="todos" statusFiltro={filtroAtivo} />
            ) : (
              <p className="adp-vazio">Nenhuma entidade monitorada.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
