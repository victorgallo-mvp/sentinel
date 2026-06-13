/**
 * Helper compartilhado por `simular-anomalia.js` e `testar-agente.js`:
 * cria um registro `Anomalia` sintético (sem esperar um desvio real ser
 * detectado), usando o baseline real da entidade quando disponível.
 */
import { Entidade } from '../src/dominio/entidade.modelo.js';
import { Anomalia } from '../src/dominio/anomalia.modelo.js';
import { obterBaseline } from '../src/core/tools/_consultas.js';
import { ErroNaoEncontrado } from '../src/shared/erros.js';

const BASELINE_SINTETICO = { media: 100, desvioPadrao: 10 };

/**
 * Cria uma anomalia sintética pra uma entidade monitorada da conta.
 * @param {Object} conta - documento Conta
 * @param {Object} opcoes - { metaIdEntidade, metrica, direcao, magnitude, janelaMedicao }
 * @returns {Promise<{anomalia: Object, entidade: Object}>}
 */
export async function criarAnomaliaSimulada(conta, opcoes = {}) {
  const { metaIdEntidade, metrica = 'spend', direcao = 'aumento', magnitude = 4, janelaMedicao = '24h' } = opcoes;

  const filtroEntidade = { contaId: conta._id, 'configuracoes.monitorada': true };
  if (metaIdEntidade) filtroEntidade.metaId = metaIdEntidade;

  const entidade = await Entidade.findOne(filtroEntidade);
  if (!entidade) {
    throw new ErroNaoEncontrado('Nenhuma entidade monitorada encontrada pra simular a anomalia. Rode "configurar-conta" primeiro.');
  }

  const janelaHoras = Number(janelaMedicao.replace('h', ''));
  const baseline = (await obterBaseline(String(entidade._id), metrica, janelaHoras)) ?? BASELINE_SINTETICO;

  const baselineMedia = baseline.media;
  const baselineDesvio = baseline.desvioPadrao || BASELINE_SINTETICO.desvioPadrao;

  const valorAtual =
    direcao === 'aumento' ? baselineMedia + magnitude * baselineDesvio : Math.max(0, baselineMedia - magnitude * baselineDesvio);

  const anomalia = await Anomalia.create({
    contaId: conta._id,
    entidadeId: entidade._id,
    metrica,
    valorAtual,
    baselineMedia,
    baselineDesvio,
    magnitudeDesvios: magnitude,
    direcao,
    janelaMedicao,
    detectadaEm: new Date(),
    statusProcessamento: 'detectada',
  });

  return { anomalia, entidade };
}

/** Lê argumentos `--chave=valor` da linha de comando. */
export function lerArgumentos() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}
