/**
 * Registry central de tools do agente investigador.
 * Agrega as definições (formato Anthropic tool_use) e os executores de
 * todas as tools disponíveis, expondo `TOOLS_REGISTRADAS` (pra passar à
 * API) e `executarTool` (pra rotear chamadas vindas do agente).
 */
import { tool as consultarHistoricoTool, executar as executarConsultarHistorico } from './consultar-historico.tool.js';
import { tool as compararPortfolioTool, executar as executarCompararPortfolio } from './comparar-com-portfolio.tool.js';
import { tool as analisarFrequenciaTool, executar as executarAnalisarFrequencia } from './analisar-frequencia.tool.js';
import { tool as analisarCriativosTool, executar as executarAnalisarCriativos } from './analisar-criativos.tool.js';
import { tool as consultarAudienciaTool, executar as executarConsultarAudiencia } from './consultar-audiencia.tool.js';
import { tool as verificarOrcamentoTool, executar as executarVerificarOrcamento } from './verificar-orcamento.tool.js';
import { tool as buscarEventosMetaTool, executar as executarBuscarEventosMeta } from './buscar-eventos-meta.tool.js';
import { tool as consultarPeersTool, executar as executarConsultarPeers } from './consultar-peers.tool.js';
import { tool as obterDetalhesEntidadeTool, executar as executarObterDetalhesEntidade } from './obter-detalhes-entidade.tool.js';
import { tool as registrarDiagnosticoTool, executar as executarRegistrarDiagnostico } from './registrar-diagnostico.tool.js';
import { tool as decidirNotificarTool, executar as executarDecidirNotificar } from './decidir-notificar.tool.js';
import { ErroTool } from '../../shared/erros.js';

/** Lista de definições de tools no formato esperado pela Anthropic API. */
export const TOOLS_REGISTRADAS = [
  consultarHistoricoTool,
  compararPortfolioTool,
  analisarFrequenciaTool,
  analisarCriativosTool,
  consultarAudienciaTool,
  verificarOrcamentoTool,
  buscarEventosMetaTool,
  consultarPeersTool,
  obterDetalhesEntidadeTool,
  registrarDiagnosticoTool,
  decidirNotificarTool,
];

/** Nomes das tools que finalizam (parcial ou totalmente) a investigação. */
export const TOOLS_FINALIZADORAS = new Set([registrarDiagnosticoTool.name, decidirNotificarTool.name]);

const EXECUTORES = {
  [consultarHistoricoTool.name]: executarConsultarHistorico,
  [compararPortfolioTool.name]: executarCompararPortfolio,
  [analisarFrequenciaTool.name]: executarAnalisarFrequencia,
  [analisarCriativosTool.name]: executarAnalisarCriativos,
  [consultarAudienciaTool.name]: executarConsultarAudiencia,
  [verificarOrcamentoTool.name]: executarVerificarOrcamento,
  [buscarEventosMetaTool.name]: executarBuscarEventosMeta,
  [consultarPeersTool.name]: executarConsultarPeers,
  [obterDetalhesEntidadeTool.name]: executarObterDetalhesEntidade,
  [registrarDiagnosticoTool.name]: executarRegistrarDiagnostico,
  [decidirNotificarTool.name]: executarDecidirNotificar,
};

/**
 * Executa uma tool pelo nome.
 * @param {string} nome - nome da tool (ex: 'consultar_historico_metrica')
 * @param {Object} parametros - input enviado pelo agente
 * @param {Object} contexto - { contaId, anomaliaId, entidadeId, investigacaoId }
 */
export async function executarTool(nome, parametros, contexto) {
  const executor = EXECUTORES[nome];
  if (!executor) throw new ErroTool(`Tool desconhecida: ${nome}`);
  return executor(parametros, contexto);
}
