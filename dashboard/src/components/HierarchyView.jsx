import { useState } from 'react';
import MetricCard from './MetricCard.jsx';
import './HierarchyView.css';

const STATUS_PAUSADO = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED', 'DELETED']);
const isAtivo = (e) => !STATUS_PAUSADO.has(e.status ?? '');

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

/** Retorna true se a campanha tem ads sincronizados mas nenhum deles está ativo. */
function campanhaTemSemAdAtivo(campNode) {
  const todosAds = campNode.filhos.flatMap((a) => a.filhos);
  return todosAds.length > 0 && !todosAds.some(isAtivo);
}

export default function HierarchyView({ entidades, nivel }) {
  const [mostrarPausados, setMostrarPausados] = useState(false);

  const totalPausados = entidades.filter((e) => !isAtivo(e)).length;

  if (nivel !== 'todos') {
    const doTipo  = entidades.filter((e) => e.tipo === nivel);
    const ativas  = doTipo.filter(isAtivo);
    const pausadas = doTipo.filter((e) => !isAtivo(e));
    const visiveis = mostrarPausados ? doTipo : ativas;

    return (
      <div>
        {pausadas.length > 0 && (
          <button className="hv-pausados-toggle" onClick={() => setMostrarPausados((v) => !v)}>
            {mostrarPausados ? 'Ocultar pausados' : `Mostrar pausados (${pausadas.length})`}
          </button>
        )}
        {visiveis.length === 0 ? (
          <p className="hv-vazio">
            {pausadas.length > 0 ? 'Todos pausados.' : 'Nenhuma entidade do tipo selecionado.'}
          </p>
        ) : (
          <div className="hv-flat">
            {visiveis.map((e) => <EntidadeCard key={e.id} entidade={e} />)}
          </div>
        )}
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

  const campAtivas  = tree.filter(isAtivo);
  const campVisiveis = mostrarPausados ? tree : campAtivas;

  return (
    <div>
      {totalPausados > 0 && (
        <button className="hv-pausados-toggle" onClick={() => setMostrarPausados((v) => !v)}>
          {mostrarPausados ? 'Ocultar pausados' : `Mostrar pausados (${totalPausados})`}
        </button>
      )}
      <div className="hv-tree">
        {campVisiveis.map((camp) => (
          <CampaignNode
            key={camp.id}
            node={camp}
            mostrarPausados={mostrarPausados}
            semAdAtivo={isAtivo(camp) && campanhaTemSemAdAtivo(camp)}
          />
        ))}
      </div>
    </div>
  );
}

function CampaignNode({ node, mostrarPausados, semAdAtivo }) {
  const [expandido, setExpandido] = useState(true);

  const filhosVisiveis = mostrarPausados
    ? node.filhos
    : node.filhos.filter(isAtivo);
  const temFilhos = filhosVisiveis.length > 0;

  return (
    <div className={`hv-camp-wrapper ${!isAtivo(node) ? 'hv-pausado' : ''}`}>
      <div className="hv-camp-row">
        <button
          className={`hv-toggle ${!temFilhos ? 'hv-toggle--vazio' : ''}`}
          onClick={() => temFilhos && setExpandido((v) => !v)}
          aria-label={expandido ? 'Colapsar' : 'Expandir'}
        >
          {temFilhos ? (expandido ? '▾' : '▸') : '·'}
        </button>
        <EntidadeCard entidade={node} variante="campaign" avisoSemAd={semAdAtivo} />
      </div>

      {expandido && temFilhos && (
        <div className="hv-adset-list">
          {filhosVisiveis.map((adset) => (
            <AdsetNode key={adset.id} node={adset} mostrarPausados={mostrarPausados} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdsetNode({ node, mostrarPausados }) {
  const [expandido, setExpandido] = useState(false);

  const filhosVisiveis = mostrarPausados
    ? node.filhos
    : node.filhos.filter(isAtivo);
  const temFilhos = filhosVisiveis.length > 0;

  return (
    <div className={`hv-adset-wrapper ${!isAtivo(node) ? 'hv-pausado' : ''}`}>
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
          {filhosVisiveis.map((ad) => (
            <div key={ad.id} className={`hv-ad-row ${!isAtivo(ad) ? 'hv-pausado' : ''}`}>
              <span className="hv-ad-dot">·</span>
              <EntidadeCard entidade={ad} variante="ad" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntidadeCard({ entidade, variante, avisoSemAd }) {
  const semDados = entidade.metricas.every((m) => m.atual === null);
  const metricasVisiveis = entidade.metricas.filter((m) => m.atual !== null);
  const pausado = !isAtivo(entidade);

  const TIPO_LABEL = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };
  const STATUS_LABEL = {
    PAUSED:          'Pausado',
    CAMPAIGN_PAUSED: 'Camp. pausada',
    ADSET_PAUSED:    'Conj. pausado',
    DISAPPROVED:     'Reprovado',
    ARCHIVED:        'Arquivado',
  };

  return (
    <div className={`hv-card hv-card--${variante ?? entidade.tipo} ${pausado ? 'hv-card--pausado' : ''}`}>
      <div className="hv-card-header">
        <span className="hv-card-nome">{entidade.nome}</span>
        <span className={`hv-card-tipo hv-card-tipo--${entidade.tipo}`}>
          {TIPO_LABEL[entidade.tipo] ?? entidade.tipo}
        </span>
        {pausado && (
          <span className="hv-card-status-pausado">
            {STATUS_LABEL[entidade.status] ?? entidade.status}
          </span>
        )}
        {avisoSemAd && (
          <span className="hv-card-aviso" title="Campanha ativa sem nenhum anúncio veiculando">
            ⚠ sem anúncio ativo
          </span>
        )}
        {entidade.ultimaSincronizacao && (
          <span className="hv-card-sinc">
            {new Date(entidade.ultimaSincronizacao).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {semDados ? (
        <p className="hv-card-vazio">
          {pausado ? 'Pausada — sem dados de veiculação.' : 'Sem dados — aguardando coleta.'}
        </p>
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
