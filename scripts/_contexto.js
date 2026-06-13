/**
 * Helpers compartilhados pelos scripts utilitários: conexão com bancos e
 * resolução da "conta padrão" (mono-tenant operacional) a partir de
 * `CONTA_ID` (identificador, não ObjectId).
 */
import { conectarMongo, desconectarMongo } from '../src/infra/mongo.js';
import { encerrarPostgres } from '../src/infra/postgres.js';
import { encerrarRedis } from '../src/infra/redis.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { config } from '../src/config/index.js';
import { ErroNaoEncontrado } from '../src/shared/erros.js';

/**
 * Conecta ao MongoDB e retorna o documento da conta padrão (`CONTA_ID`).
 * @param {Object} opcoes - { exigirConta: false } pra scripts que ainda não têm conta criada
 */
export async function obterContaPadrao({ exigirConta = true } = {}) {
  await conectarMongo();

  const conta = await Conta.findOne({ identificador: config.contaIdPadrao });
  if (!conta && exigirConta) {
    throw new ErroNaoEncontrado(
      `Conta com identificador "${config.contaIdPadrao}" não encontrada. Rode "npm run configurar-conta" primeiro.`
    );
  }

  return conta;
}

/** Encerra todas as conexões abertas pelos scripts. */
export async function encerrarScript() {
  await desconectarMongo();
  await encerrarPostgres();
  await encerrarRedis();
}

/** Executa a função principal de um script com tratamento de erro padronizado. */
export function executarScript(principal) {
  principal()
    .then(async () => {
      await encerrarScript();
      process.exit(0);
    })
    .catch(async (erro) => {
      console.error(`\nErro: ${erro.message}`);
      if (erro.detalhes) console.error(JSON.stringify(erro.detalhes, null, 2));
      await encerrarScript();
      process.exit(1);
    });
}
