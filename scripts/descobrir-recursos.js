/**
 * Lista as contas de anúncio acessíveis pelo token configurado (META_*),
 * com a hierarquia de campanhas/adsets/ads de cada uma. Não persiste nada —
 * é o primeiro passo pra descobrir os IDs usados em `configurar-conta.js`.
 *
 * Não requer MongoDB/Postgres/Redis — só as variáveis META_* no .env.
 *
 * Uso: npm run descobrir-recursos
 */
import { config } from '../src/config/index.js';
import { descobrirContasAnuncio, descobrirHierarquiaConta } from '../src/core/coleta/descobridor-entidades.servico.js';

async function main() {
  if (!config.meta.bmId || !config.meta.systemUserToken) {
    throw new Error('Configure META_BM_ID e META_SYSTEM_USER_TOKEN no .env antes de rodar este script.');
  }

  console.log(`Descobrindo recursos da Business Manager ${config.meta.bmId}...\n`);

  const contasAnuncio = await descobrirContasAnuncio(config.meta.bmId);

  if (contasAnuncio.length === 0) {
    console.log('Nenhuma conta de anúncio encontrada para esse token/BM.');
    return;
  }

  for (const conta of contasAnuncio) {
    console.log(`Conta de anúncio: ${conta.nome}  (${conta.id})  — moeda ${conta.moeda}, fuso ${conta.fusoHorario}`);

    const arvore = await descobrirHierarquiaConta(conta.id, { apenasAtivos: true });

    if (arvore.length === 0) {
      console.log('  (nenhuma campanha ativa encontrada)\n');
      continue;
    }

    for (const campanha of arvore) {
      console.log(`  Campanha: ${campanha.nome}  (${campanha.id})  [${campanha.statusEfetivo}]  objetivo: ${campanha.objetivo}`);
      for (const adset of campanha.adsets) {
        console.log(`    Adset: ${adset.nome}  (${adset.id})  [${adset.statusEfetivo}]`);
        for (const ad of adset.ads) {
          console.log(`      Ad: ${ad.nome}  (${ad.id})  [${ad.statusEfetivo}]`);
        }
      }
    }
    console.log('');
  }

  console.log(`BM ID: ${config.meta.bmId}`);
  console.log('IDs de "Conta de anúncio" (act_...) acima são usados em "npm run configurar-conta".');
}

main().catch((erro) => {
  console.error(`\nErro: ${erro.message}`);
  process.exit(1);
});
