/**
 * Renderiza o relatório semanal em HTML a partir do template
 * `relatorio.html`, preenchendo dados agregados do portfólio e o resumo
 * gerado pelo agente analisador.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatarMoeda, formatarPercentual, arredondar } from '../../../shared/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMINHO_TEMPLATE = path.resolve(__dirname, 'relatorio.html');

let cacheTemplate = null;

async function carregarTemplate() {
  if (!cacheTemplate) {
    cacheTemplate = await readFile(CAMINHO_TEMPLATE, 'utf-8');
  }
  return cacheTemplate;
}

/**
 * Renderiza o HTML do relatório semanal.
 *
 * @param {Object} dados
 * @param {Object} dados.conta - documento Conta
 * @param {Date} dados.periodoInicio
 * @param {Date} dados.periodoFim
 * @param {Array} dados.dadosPortfolio - saída de `compilarDadosPortfolio`
 * @param {Object} dados.resumoOperacional - saída de `compilarResumoOperacional`
 * @param {string} dados.resumoTexto - markdown gerado pelo agente analisador
 * @returns {Promise<string>}
 */
export async function renderizarRelatorioHtml({ conta, periodoInicio, periodoFim, dadosPortfolio, resumoOperacional, resumoTexto }) {
  const template = await carregarTemplate();

  const substituicoes = {
    '{{CONTA_NOME}}': escaparHtml(conta.nome),
    '{{PERIODO}}': `${formatarData(periodoInicio)} a ${formatarData(periodoFim)}`,
    '{{RESUMO_HTML}}': markdownParaHtml(resumoTexto),
    '{{TOTAL_ANOMALIAS}}': String(resumoOperacional.totalAnomalias),
    '{{TOTAL_INVESTIGACOES}}': String(resumoOperacional.totalInvestigacoes),
    '{{TOTAL_NOTIFICACOES}}': String(resumoOperacional.totalNotificacoes),
    '{{LINHAS_TABELA}}': construirLinhasTabela(dadosPortfolio),
    '{{DATA_GERACAO}}': new Date().toLocaleString('pt-BR'),
  };

  let html = template;
  for (const [chave, valor] of Object.entries(substituicoes)) {
    html = html.replaceAll(chave, valor);
  }

  return html;
}

/** Constrói as linhas `<tr>` da tabela de métricas por entidade. */
function construirLinhasTabela(dadosPortfolio) {
  if (dadosPortfolio.length === 0) {
    return '<tr><td colspan="10">Nenhum dado de métricas disponível para o período.</td></tr>';
  }

  return dadosPortfolio
    .map((entidade) => {
      const m = entidade.metricas;
      return `<tr>
        <td>${escaparHtml(entidade.nome)}</td>
        <td>${escaparHtml(entidade.tipo)}</td>
        <td>${formatarMoeda(m.spend?.soma ?? 0, 'BRL')}</td>
        <td>${arredondar(m.impressions?.soma ?? 0, 0)}</td>
        <td>${arredondar(m.clicks?.soma ?? 0, 0)}</td>
        <td>${formatarPercentual(m.ctr?.media ?? 0)}</td>
        <td>${formatarMoeda(m.cpm?.media ?? 0, 'BRL')}</td>
        <td>${arredondar(m.conversions?.soma ?? 0, 0)}</td>
        <td>${formatarMoeda(m.cost_per_conversion?.media ?? 0, 'BRL')}</td>
        <td>${arredondar(m.purchase_roas?.media ?? 0, 2)}x</td>
      </tr>`;
    })
    .join('\n');
}

/** Conversor mínimo de markdown (títulos, listas, negrito, parágrafos) pra HTML. */
function markdownParaHtml(markdown) {
  if (!markdown) return '<p>Sem resumo disponível.</p>';

  const linhas = markdown.split('\n');
  const html = [];
  let dentroDeLista = false;

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trim();

    if (linha === '') {
      if (dentroDeLista) {
        html.push('</ul>');
        dentroDeLista = false;
      }
      continue;
    }

    if (linha.startsWith('## ')) {
      if (dentroDeLista) {
        html.push('</ul>');
        dentroDeLista = false;
      }
      html.push(`<h3>${formatarInline(linha.slice(3))}</h3>`);
      continue;
    }

    if (linha.startsWith('- ')) {
      if (!dentroDeLista) {
        html.push('<ul>');
        dentroDeLista = true;
      }
      html.push(`<li>${formatarInline(linha.slice(2))}</li>`);
      continue;
    }

    if (dentroDeLista) {
      html.push('</ul>');
      dentroDeLista = false;
    }

    html.push(`<p>${formatarInline(linha)}</p>`);
  }

  if (dentroDeLista) html.push('</ul>');

  return html.join('\n');
}

/** Aplica formatação inline (negrito) e escapa HTML do restante do texto. */
function formatarInline(texto) {
  const escapado = escaparHtml(texto);
  return escapado.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function escaparHtml(texto) {
  return String(texto ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatarData(data) {
  return new Date(data).toLocaleDateString('pt-BR');
}
