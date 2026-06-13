/**
 * Integração com Google Sheets — atualiza a planilha configurada pela conta
 * (`conta.configuracoes.googleSheetsId`) com os dados do relatório semanal.
 *
 * Requer `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON da service account, com acesso
 * de editor à planilha) configurado no `.env`.
 */
import { google } from 'googleapis';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { ErroAplicacao } from '../../shared/erros.js';

let cacheAuth = null;

/** Cria (ou reutiliza) o cliente autenticado da Google Auth a partir da service account. */
function obterAuth() {
  if (!cacheAuth) {
    if (!config.googleSheets.serviceAccountJson) {
      throw new ErroAplicacao('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');
    }

    let credenciais;
    try {
      credenciais = JSON.parse(config.googleSheets.serviceAccountJson);
    } catch (erro) {
      throw new ErroAplicacao('GOOGLE_SERVICE_ACCOUNT_JSON inválido — deve ser o JSON da service account', { causa: erro.message });
    }

    cacheAuth = new google.auth.GoogleAuth({
      credentials: credenciais,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return cacheAuth;
}

const CABECALHO = ['Entidade', 'Tipo', 'Objetivo', 'Investimento (R$)', 'Impressões', 'Cliques', 'CTR (%)', 'CPM (R$)', 'Conversões', 'Custo/Conversão (R$)', 'ROAS'];

/**
 * Atualiza (ou cria) a aba da semana na planilha configurada com os dados
 * agregados do portfólio.
 *
 * @param {string} spreadsheetId
 * @param {Array} dadosPortfolio - saída de `compilarDadosPortfolio`
 * @param {{periodoInicio: Date, periodoFim: Date}} periodo
 */
export async function atualizarPlanilhaSemanal(spreadsheetId, dadosPortfolio, { periodoInicio }) {
  const auth = obterAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const nomeAba = `Semana ${formatarDataAba(periodoInicio)}`;
  await garantirAba(sheets, spreadsheetId, nomeAba);

  const linhas = dadosPortfolio.map((entidade) => [
    entidade.nome,
    entidade.tipo,
    entidade.objetivo ?? '',
    entidade.metricas.spend?.soma ?? 0,
    entidade.metricas.impressions?.soma ?? 0,
    entidade.metricas.clicks?.soma ?? 0,
    entidade.metricas.ctr?.media ?? 0,
    entidade.metricas.cpm?.media ?? 0,
    entidade.metricas.conversions?.soma ?? 0,
    entidade.metricas.cost_per_conversion?.media ?? 0,
    entidade.metricas.purchase_roas?.media ?? 0,
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${nomeAba}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [CABECALHO, ...linhas] },
  });

  logger.info({ msg: 'Planilha do Google Sheets atualizada', spreadsheetId, aba: nomeAba, totalLinhas: linhas.length });
}

/** Garante que a aba da semana exista na planilha, criando-a se necessário. */
async function garantirAba(sheets, spreadsheetId, nomeAba) {
  const planilha = await sheets.spreadsheets.get({ spreadsheetId });
  const abaExiste = planilha.data.sheets?.some((aba) => aba.properties?.title === nomeAba);

  if (abaExiste) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: nomeAba } } }],
    },
  });

  logger.info({ msg: 'Aba criada na planilha do relatório semanal', spreadsheetId, aba: nomeAba });
}

/** Formata a data de início do período como `AAAA-MM-DD` pro nome da aba. */
function formatarDataAba(data) {
  return data.toISOString().slice(0, 10);
}
