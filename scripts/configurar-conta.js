/**
 * Cria (ou atualiza) o documento `Conta` correspondente a `CONTA_ID`,
 * descobre as contas de anúncio acessíveis pela BM configurada e
 * sincroniza a hierarquia de campanhas/adsets/ads como `Entidade`s
 * monitoráveis.
 *
 * Pré-requisito: variáveis META_* preenchidas no `.env`.
 *
 * Uso: npm run configurar-conta
 */
import { obterContaPadrao, executarScript } from './_contexto.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { descobrirContasAnuncio, sincronizarEntidades } from '../src/core/coleta/descobridor-entidades.servico.js';
import { config } from '../src/config/index.js';

async function main() {
  const { meta, evolution, contaIdPadrao } = config;

  if (!meta.bmId || !meta.systemUserToken || !meta.appId || !meta.appSecret) {
    throw new Error('Configure META_BM_ID, META_SYSTEM_USER_TOKEN, META_APP_ID e META_APP_SECRET no .env antes de rodar este script.');
  }

  let conta = await obterContaPadrao({ exigirConta: false });

  console.log(`Descobrindo contas de anúncio da BM ${meta.bmId}...`);
  const contasAnuncio = await descobrirContasAnuncio(meta.bmId);
  const contasAnuncioIds = contasAnuncio.map((c) => c.id);

  if (contasAnuncioIds.length === 0) {
    throw new Error('Nenhuma conta de anúncio encontrada para essa BM/token.');
  }
  console.log(`Encontradas: ${contasAnuncioIds.join(', ')}`);

  if (!conta) {
    conta = await Conta.create({
      identificador: contaIdPadrao,
      nome: contaIdPadrao,
      metaConfig: {
        bmId: meta.bmId,
        contasAnuncioIds,
        systemUserToken: meta.systemUserToken,
        appId: meta.appId,
        appSecret: meta.appSecret,
      },
      notificacao: {
        whatsappJid: evolution.whatsappJidPadrao,
      },
    });
    console.log(`\nConta criada: ${conta._id} (identificador "${conta.identificador}")`);
  } else {
    conta.metaConfig.contasAnuncioIds = contasAnuncioIds;
    conta.metaConfig.systemUserToken = meta.systemUserToken;
    conta.metaConfig.appId = meta.appId;
    conta.metaConfig.appSecret = meta.appSecret;
    if (evolution.whatsappJidPadrao) conta.notificacao.whatsappJid = evolution.whatsappJidPadrao;
    await conta.save();
    console.log(`\nConta atualizada: ${conta._id} (identificador "${conta.identificador}")`);
  }

  for (const contaAnuncioId of contasAnuncioIds) {
    console.log(`\nSincronizando entidades de ${contaAnuncioId}...`);
    const resultado = await sincronizarEntidades(String(conta._id), meta.bmId, contaAnuncioId);
    console.log(`  criadas: ${resultado.criadas}, atualizadas: ${resultado.atualizadas}, total: ${resultado.total}`);
  }

  console.log('\nConfiguração concluída. Próximo passo: "npm run popular-historico" pra preencher o histórico de métricas.');
}

executarScript(main);
