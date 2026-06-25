import { useState } from 'react';
import MetricCard from './MetricCard.jsx';
import './HierarchyView.css';

const STATUS_PAUSADO = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED', 'DELETED']);
const STATUS_ERRO    = new Set(['WITH_ISSUES', 'DISAPPROVED', 'PENDING_BILLING_INFO']);
const isAtivo = (e) => !STATUS_PAUSADO.has(e.status ?? '');

/**
 * Verifica se uma entidade passa pelo filtro de status selecionado.
 */
function passaFiltro(entidade, filtro) {
  switch (filtro) {
    case 'ativas':   return entidade.status === 'ACTIVE';
    case 'com_erro': return STATUS_ERRO.has(entidade.status) || (entidade.issues?.length > 0);
    case 'pausadas': return STATUS_PAUSADO.has(entidade.status ?? '');
    default:         return true; // 'todas'
  }
}

/**
 * Constrói a árvore Campaign → Adset → Ad a partir de uma lista plana de entidades.
 * Usa metaId + hierarquia.campanhaId + hierarquia.adsetId para vincular.
 * Aplica filtro: uma campanha é incluída se ela ou algum descendente passa o filtro.
 */
function buildTree(entidades, filtro) {
  const campaigns = entidades.filter((e) => e.tipo === 'campaign');
  const adsets    = entidades.filter((e) => e.tipo === 'adset');
  const ads       = entidades.filter((e) => e.tipo === 'ad');

  return campaigns
    .map((camp) => {
      const adsetFilhos = adsets
        .filter((a) => a.hierarquia?.campanhaId === camp.metaId)
        .map((adset) => {
          const adFilhos = ads.filter((ad) => ad.hierarquia?.adsetId === adset.metaId);
          return { ...adset, filhos: adFilhos };
        })
        .filter((adset) =>
          filtro === 'todas' ||
          passaFiltro(adset, filtro) ||
          adset.filhos.some((ad) => passaFiltro(ad, filtro))
        );

      return { ...camp, filhos: adsetFilhos };
    })
    .filter((camp) =>
      filtro === 'todas' ||
      passaFiltro(camp, filtro) ||
      camp.filhos.length > 0
    );
}

/** Retorna true se a campanha tem ads sincronizados mas nenhum deles está ativo. */
function campanhaTemSemAdAtivo(campNode) {
  const todosAds = campNode.filhos.flatMap((a) => a.filhos);
  return todosAds.length > 0 && !todosAds.some(isAtivo);
}

export default function HierarchyView({ entidades, nivel, statusFiltro = 'todas' }) {
  const [mostrarPausados, setMostrarPausados] = useState(false);

  const totalPausados = entidades.filter((e) => !isAtivo(e)).length;

  if (nivel && nivel !== 'todos') {
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

  const tree = buildTree(entidades, statusFiltro);

  if (!tree.length) {
    const mensagemVazio = statusFiltro !== 'todas'
      ? 'Nenhuma entidade corresponde ao filtro selecionado.'
      : 'Nenhuma campanha sincronizada.';
    return (
      <div className="hv-flat">
        {entidades.length > 0 && statusFiltro === 'todas'
          ? entidades.map((e) => <EntidadeCard key={e.id} entidade={e} />)
          : <p className="hv-vazio">{mensagemVazio}</p>
        }
      </div>
    );
  }

  const campAtivas  = tree.filter(isAtivo);
  const campVisiveis = (statusFiltro !== 'todas' || mostrarPausados) ? tree : campAtivas;

  return (
    <div>
      {statusFiltro === 'todas' && totalPausados > 0 && (
        <button className="hv-pausados-toggle" onClick={() => setMostrarPausados((v) => !v)}>
          {mostrarPausados ? 'Ocultar pausados' : `Mostrar pausados (${totalPausados})`}
        </button>
      )}
      <div className="hv-tree">
        {campVisiveis.map((camp) => (
          <CampaignNode
            key={camp.id}
            node={camp}
            mostrarPausados={mostrarPausados || statusFiltro !== 'todas'}
            semAdAtivo={isAtivo(camp) && campanhaTemSemAdAtivo(camp)}
            statusFiltro={statusFiltro}
          />
        ))}
      </div>
    </div>
  );
}

function CampaignNode({ node, mostrarPausados, semAdAtivo, statusFiltro }) {
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
            <AdsetNode
              key={adset.id}
              node={adset}
              mostrarPausados={mostrarPausados}
              statusFiltro={statusFiltro}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdsetNode({ node, mostrarPausados, statusFiltro }) {
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
  const temErro = STATUS_ERRO.has(entidade.status) || (entidade.issues?.length > 0);

  const TIPO_LABEL = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };
  const STATUS_LABEL = {
    PAUSED:          'Pausado',
    CAMPAIGN_PAUSED: 'Camp. pausada',
    ADSET_PAUSED:    'Conj. pausado',
    DISAPPROVED:     'Reprovado',
    ARCHIVED:        'Arquivado',
    WITH_ISSUES:     'Com problemas',
    PENDING_BILLING_INFO: 'Pagamento pendente',
  };

  return (
    <div className={`hv-card hv-card--${variante ?? entidade.tipo} ${pausado ? 'hv-card--pausado' : ''} ${temErro ? 'hv-card--erro' : ''}`}>
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
        {temErro && !pausado && (
          <span className="hv-card-status-erro">
            {STATUS_LABEL[entidade.status] ?? entidade.status}
          </span>
        )}
        {avisoSemAd && (
          <span className="hv-card-aviso" title="Campanha ativa sem nenhum anúncio veiculando">
            ⚠ sem anúncio ativo
          </span>
        )}
        {entidade.dataReferencia ? (
          <span className="hv-card-sinc">{entidade.dataReferencia}</span>
        ) : entidade.ultimaSincronizacao ? (
          <span className="hv-card-sinc">
            {new Date(entidade.ultimaSincronizacao).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : null}
      </div>

      {/* motivoStatus */}
      {entidade.motivoStatus && (
        <p className="hv-card-motivo">{entidade.motivoStatus}</p>
      )}

      {/* Issues badges */}
      {entidade.issues?.length > 0 && (
        <div className="hv-card-issues">
          {entidade.issues.slice(0, 2).map((issue, idx) => (
            <span key={idx} className="hv-card-issue-badge">
              {issue.error_summary ?? 'Erro de entrega'}
            </span>
          ))}
          {entidade.issues.length > 2 && (
            <span className="hv-card-issue-badge hv-card-issue-badge--mais">
              +{entidade.issues.length - 2} mais
            </span>
          )}
        </div>
      )}

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
