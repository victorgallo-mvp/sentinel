/**
 * Alerta de sexta-feira: avisa quando o saldo pré-pago não cobre o fim de semana.
 *
 * Os níveis do alerta horário (`critico` < 6h, `acabando` < 24h) são cegos para
 * o calendário. Numa sexta ao meio-dia, um saldo com 30h de autonomia é "ok" por
 * aquele critério e acaba no sábado de manhã — quando ninguém recarrega e as
 * campanhas ficam paradas até segunda. Este job olha especificamente para a
 * distância até a segunda-feira.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { obterDetalhesContaAnuncio } from '../coleta/meta-api.cliente.js';
import { computarSaldoPrepago } from './alerta-orcamento.servico.js';
import { enviarMensagemWhatsapp, resolverDestinatariosAlerta } from '../notificacao/enviador-whatsapp.servico.js';
import { logger } from '../../infra/logger.js';

const BRT_MS = 3 * 60 * 60 * 1000;

// Até quando o saldo precisa durar: segunda-feira, início do expediente — o
// primeiro momento em que alguém consegue recarregar.
const HORA_ALVO_SEGUNDA = 9;

/**
 * Horas entre `referencia` e a próxima segunda-feira às HORA_ALVO_SEGUNDA (BRT).
 * Exportada para teste: é a conta que decide se o alerta dispara.
 */
export function horasAteSegunda(referencia = new Date()) {
  const brt = new Date(referencia.getTime() - BRT_MS);
  const diaSemana = brt.getUTCDay(); // 0=domingo … 5=sexta

  // Dias até a próxima segunda (1). Na própria segunda, olha para a seguinte.
  let dias = (1 - diaSemana + 7) % 7;
  if (dias === 0) dias = 7;

  const alvo = new Date(brt);
  alvo.setUTCDate(alvo.getUTCDate() + dias);
  alvo.setUTCHours(HORA_ALVO_SEGUNDA, 0, 0, 0);

  return (alvo.getTime() - brt.getTime()) / (60 * 60 * 1000);
}

/** Formata R$ sem centavos, no padrão usado nas demais mensagens. */
function brl(valor) {
  return `R$ ${Math.ceil(valor).toLocaleString('pt-BR')}`;
}

/**
 * Verifica todas as contas pré-pagas e avisa as que não atravessam o fim de semana.
 * Falha numa conta não interrompe as demais.
 */
export async function executarAlertaFimDeSemana() {
  const horasNecessarias = horasAteSegunda();
  const contas = await Conta.find({ ativo: true, 'configuracoes.prepago': true });

  logger.info({ msg: 'Iniciando alerta de fim de semana', contas: contas.length, horasNecessarias: Math.round(horasNecessarias) });

  let avisadas = 0;
  for (const conta of contas) {
    for (const contaAnuncioId of conta.metaConfig?.contasAnuncioIds ?? []) {
      try {
        const avisou = await avaliarContaAnuncio(conta, contaAnuncioId, horasNecessarias);
        if (avisou) avisadas++;
      } catch (erro) {
        logger.warn({ msg: 'Falha ao avaliar saldo de fim de semana — seguindo', conta: conta.nome, contaAnuncioId, erro: erro.message });
      }
    }
  }

  logger.info({ msg: 'Alerta de fim de semana concluído', avisadas });
  return { avisadas };
}

async function avaliarContaAnuncio(conta, contaAnuncioId, horasNecessarias) {
  const token = conta.metaConfig?.systemUserToken || undefined;
  const detalhes = await obterDetalhesContaAnuncio(contaAnuncioId, token);

  // A Meta é a fonte de verdade sobre ser pré-pago (ver alerta-orcamento).
  if (detalhes.is_prepay_account === false) return false;

  const snap = await computarSaldoPrepago(conta, contaAnuncioId, detalhes, token);
  if (!snap) return false;

  const { saldoReais, ritmoHora, runwayHoras } = snap;

  // Sem ritmo determinável não dá para projetar o fim de semana — o alerta
  // horário por limiar de saldo continua cobrindo esse caso.
  if (!ritmoHora || ritmoHora <= 0) return false;
  if (runwayHoras != null && runwayHoras >= horasNecessarias) return false;

  const destinatarios = await resolverDestinatariosAlerta(conta);
  if (!destinatarios.length) return false;

  // Uma notificação por conta de anúncio por fim de semana.
  const chaveAlerta = `alerta_fim_semana_${contaAnuncioId}`;
  const desde = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const jaAvisado = await Notificacao.exists({
    contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
    conteudo: new RegExp(chaveAlerta), enviadaEm: { $gte: desde },
  });
  if (jaAvisado) return false;

  const faltam = Math.max(0, ritmoHora * horasNecessarias - saldoReais);
  const mensagem = [
    `🗓️ *Saldo não cobre o fim de semana — ${conta.nome}*`,
    ``,
    `Conta: \`${contaAnuncioId}\``,
    `Saldo atual: *${brl(saldoReais)}*`,
    `Ritmo: ${brl(ritmoHora)}/h · acaba em ~${Math.floor(runwayHoras ?? 0)}h`,
    ``,
    `Para entregar até segunda de manhã faltam *${brl(faltam)}*.`,
    `Sem recarga, as campanhas param durante o fim de semana.`,
    `<!-- ${chaveAlerta} -->`,
  ].join('\n');

  let status = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de fim de semana', conta: conta.nome, erro: erro.message });
  }

  await Notificacao.create({
    contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
    destinatario: destinatarios.join(','), conteudo: mensagem, enviadaEm: new Date(), status,
  });

  logger.info({ msg: 'Alerta de fim de semana enviado', conta: conta.nome, contaAnuncioId, saldoReais, faltam });
  return true;
}
