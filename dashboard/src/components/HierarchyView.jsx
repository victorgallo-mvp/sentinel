import { useState } from 'react';
import MetricCard from './MetricCard.jsx';
import './HierarchyView.css';

/**
 * Constrói a árvore Campaign → Adset → Ad a partir de uma lista plana de entidades.
 * Usa metaId + hierarquia.campanhaId + hierarquia.adsetId para vincular.
 */
function buildTree(entidades) {
  const campaigns = entidades.filter((e) => e.tipo === 'campaign');
  const adsets    = entidades.filter((e) => e.tipo === 'adset');
  const ads       = entidades.filter((e) => e.tipo === 'ad');

  return campaigns.map((camp) => ({
    ...camp,
    filhos: adsets
      .filter((a) => a.hierarquia?.campanhaId === camp.metaId)
      .map((adset) => ({
        ...adset,
        filhos: ads.filter((ad) => ad.hierarquia?.adsetId === adset.metaId),
      })),
  }));
}

export default function HierarchyView({ entidades, nivel }) {
  // Entidades sem hierarquia conhecida (não encaixam na árvore)
  const semPai = entidades.filter(
    (e) => e.tipo !== 'campaign' && !entidades.some((c) => c.tipo === 'campaign')
  );

  if (nivel !== 'todos') {
    // Modo plano — filtra por tipo e mostra cards normais
    const filtradas = entidades.filter((e) => e.tipo === nivel);
    if (!filtradas.length) {
      return <p className="hv-vazio">Nenhuma entidade do tipo selecionado.</p>;
    }
    return (
      <div className="hv-flat">
        {filtradas.map((e) => <EntidadeCard key={e.id} entidade={e} />)}
      </div>
    );
  }

  const tree = buildTree(entidades);
  if (!tree.length) {
    return (
      <div className="hv-flat">
        {entidades.map((e) => <EntidadeCard key={e.id} entidade={e} />)}
      </div>
    );
  }

  return (
    <div className="hv-tree">
      {tree.map((camp) => <CampaignNode key={camp.id} node={camp} />)}
    </div>
  );
}

function CampaignNode({ node }) {
  const [expandido, setExpandido] = useState(true);
  const temFilhos = node.filhos?.length > 0;

  return (
    <div className="hv-camp-wrapper">
      <div className="hv-camp-row">
        <button
          className={`hv-toggle ${!temFilhos ? 'hv-toggle--vazio' : ''}`}
          onClick={() => temFilhos && setExpandido((v) => !v)}
          aria-label={expandido ? 'Colapsar' : 'Expandir'}
        >
          {temFilhos ? (expandido ? '▾' : '▸') : '·'}
        </button>
        <EntidadeCard entidade={node} variante="campaign" />
      </div>

      {expandido && temFilhos && (
        <div className="hv-adset-list">
          {node.filhos.map((adset) => <AdsetNode key={adset.id} node={adset} />)}
        </div>
      )}
    </div>
  );
}

function AdsetNode({ node }) {
  const [expandido, setExpandido] = useState(false);
  const temFilhos = node.filhos?.length > 0;

  return (
    <div className="hv-adset-wrapper">
      <div className="hv-adset-row">
        <button
          className={`hv-toggle hv-toggle--sm ${!temFilhos ? 'hv-toggle--vazio' : ''}`}
          onClick={() => temFilhos && setExpandido((v) => !v)}
        >
          {temFilhos ? (expandido ? '▾' : '▸') : '·'}
        </button>
        <EntidadeCard entidade={node} variante="adset" />
      </div>

      {expandido && temFilhos && (
        <div className="hv-ad-list">
          {node.filhos.map((ad) => (
            <div key={ad.id} className="hv-ad-row">
              <span className="hv-ad-dot">·</span>
              <EntidadeCard entidade={ad} variante="ad" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntidadeCard({ entidade, variante }) {
  const semDados = entidade.metricas.every((m) => m.atual === null);
  const metricasVisiveis = entidade.metricas.filter((m) => m.atual !== null);

  const TIPO_LABEL = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };

  return (
    <div className={`hv-card hv-card--${variante ?? entidade.tipo}`}>
      <div className="hv-card-header">
        <span className="hv-card-nome">{entidade.nome}</span>
        <span className={`hv-card-tipo hv-card-tipo--${entidade.tipo}`}>
          {TIPO_LABEL[entidade.tipo] ?? entidade.tipo}
        </span>
        {entidade.ultimaSincronizacao && (
          <span className="hv-card-sinc">
            {new Date(entidade.ultimaSincronizacao).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {semDados ? (
        <p className="hv-card-vazio">Sem dados — pausada ou aguardando coleta.</p>
      ) : (
        <div className="hv-metricas">
          {metricasVisiveis.map((m) => (
            <MetricCard key={m.chave} metrica={m} />
          ))}
        </div>
      )}
    </div>
  );
}
