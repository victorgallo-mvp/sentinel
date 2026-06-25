import { useEffect, useState } from 'react';
import HierarchyView from './HierarchyView.jsx';
import './AccountModal.css';

const FILTROS = [
  { id: 'todas',    label: 'Todas' },
  { id: 'ativas',   label: 'Ativas' },
  { id: 'com_erro', label: 'Com erro' },
  { id: 'pausadas', label: 'Pausadas' },
];

export default function AccountModal({ conta, customName, onClose }) {
  const [filtroAtivo, setFiltroAtivo] = useState('todas');

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
  const alertas = conta.resumo?.alertas ?? [];

  // Data de referência: primeira entidade que tiver tsAtual
  const entidadeComTs = conta.entidades?.find((e) => e.tsAtual);
  const dataReferencia = entidadeComTs?.dataReferencia ?? null;

  return (
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
          <button className="am-close" onClick={onClose} title="Fechar (ESC)">×</button>
        </div>

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
  );
}
