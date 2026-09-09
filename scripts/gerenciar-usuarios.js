/**
 * Gestão dos usuários do dashboard (login por e-mail + senha).
 *
 * Uso:
 *   npm run usuarios                                    # lista os usuários
 *   npm run usuarios -- criar "Nome" email@ex.com senha [--admin]
 *   npm run usuarios -- senha email@ex.com novaSenha    # troca a senha
 *   npm run usuarios -- desativar email@ex.com
 *   npm run usuarios -- ativar email@ex.com
 *   npm run usuarios -- migrar-token             # remove o índice/campo legado
 *
 * A senha é gravada só como hash scrypt — nunca em texto puro.
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import mongoose from 'mongoose';
import { Usuario } from '../src/dominio/usuario.modelo.js';
import { gerarHashSenha, SENHA_TAMANHO_MINIMO } from '../src/core/auth/senha.js';

const AJUDA = `
Comandos:
  (sem argumentos)                              lista os usuários
  criar "Nome" <email> <senha> [--admin]        cria um usuário
  senha <email> <novaSenha>                     redefine a senha
  desativar <email>                             bloqueia o acesso
  ativar <email>                                libera o acesso
  migrar-token                                  remove o índice único legado token_1
`;

/**
 * Remove o índice único legado `token_1` da coleção `usuarios` e apaga o campo
 * `token` que sobrou do acesso antigo.
 *
 * É DESTRUTIVO e invalida qualquer link por token ainda em uso, por isso é um
 * comando explícito — nunca algo que dispare sozinho ao abrir conexão. Rode só
 * depois que a versão com login por e-mail/senha estiver no ar, senão os
 * usuários ficam sem forma de entrar. Idempotente.
 */
async function migrarToken() {
  const colecao = mongoose.connection.db.collection('usuarios');
  const indices = await colecao.indexes();

  if (indices.some((i) => i.name === 'token_1')) {
    await colecao.dropIndex('token_1');
    console.log('Índice único legado token_1 removido.');
  } else {
    console.log('Índice token_1 já não existe.');
  }

  const { modifiedCount } = await colecao.updateMany(
    { token: { $exists: true } },
    { $unset: { token: '' } }
  );
  console.log(`Campo token apagado de ${modifiedCount} usuário(s).`);

  const semSenha = await colecao.countDocuments({ senhaHash: { $exists: false } });
  if (semSenha > 0) {
    console.log(`Atenção: ${semSenha} usuário(s) sem senha — não conseguem entrar até você definir uma.`);
  }
}

async function listar() {
  // `senhaHash` é `select: false` no schema — sem o `+` explícito, todo usuário
  // pareceria estar sem senha. Só a presença do hash é usada, nunca o valor.
  const usuarios = await Usuario.find().select('+senhaHash').sort({ nome: 1 }).lean();
  if (usuarios.length === 0) {
    console.log('Nenhum usuário cadastrado. Crie o primeiro com:');
    console.log('  npm run usuarios -- criar "Seu Nome" voce@empresa.com suaSenha --admin');
    return;
  }
  console.log(`${usuarios.length} usuário(s):\n`);
  for (const u of usuarios) {
    const marcas = [
      u.superAdmin ? 'super-admin' : `${(u.contaIds ?? []).length} conta(s)`,
      u.ativo ? 'ativo' : 'INATIVO',
      u.senhaHash ? null : 'SEM SENHA (não consegue entrar)',
    ].filter(Boolean);
    console.log(`  ${u.nome} <${u.email ?? '—'}>  [${marcas.join(', ')}]`);
  }
}

async function buscarPorEmail(email) {
  const usuario = await Usuario.findOne({ email: String(email).trim().toLowerCase() });
  if (!usuario) throw new Error(`Usuário com e-mail "${email}" não encontrado.`);
  return usuario;
}

async function main() {
  await conectarMongo();

  const args = process.argv.slice(2);
  const comando = args[0];

  if (!comando) return listar();

  if (comando === 'criar') {
    const admin = args.includes('--admin');
    const [nome, email, senha] = args.slice(1).filter((a) => a !== '--admin');
    if (!nome || !email || !senha) throw new Error(`Uso: npm run usuarios -- criar "Nome" <email> <senha> [--admin]`);
    if (senha.length < SENHA_TAMANHO_MINIMO) throw new Error(`A senha precisa de ao menos ${SENHA_TAMANHO_MINIMO} caracteres.`);

    const emailNormalizado = email.trim().toLowerCase();
    if (await Usuario.exists({ email: emailNormalizado })) {
      throw new Error(`Já existe um usuário com o e-mail ${emailNormalizado}.`);
    }

    const usuario = await Usuario.create({
      nome,
      email: emailNormalizado,
      senhaHash: await gerarHashSenha(senha),
      superAdmin: admin,
    });
    console.log(`Usuário criado: ${usuario.nome} <${usuario.email}>${admin ? ' (super-admin)' : ''}`);
    if (!admin) console.log('Atenção: sem --admin o usuário só vê as contas vinculadas em `contaIds`.');
    return;
  }

  if (comando === 'senha') {
    const [email, novaSenha] = args.slice(1);
    if (!email || !novaSenha) throw new Error('Uso: npm run usuarios -- senha <email> <novaSenha>');
    if (novaSenha.length < SENHA_TAMANHO_MINIMO) throw new Error(`A senha precisa de ao menos ${SENHA_TAMANHO_MINIMO} caracteres.`);

    const usuario = await buscarPorEmail(email);
    usuario.senhaHash = await gerarHashSenha(novaSenha);
    await usuario.save();
    console.log(`Senha redefinida para ${usuario.email}.`);
    return;
  }

  if (comando === 'migrar-token') return migrarToken();

  if (comando === 'desativar' || comando === 'ativar') {
    const usuario = await buscarPorEmail(args[1]);
    usuario.ativo = comando === 'ativar';
    await usuario.save();
    console.log(`${usuario.email} agora está ${usuario.ativo ? 'ativo' : 'inativo'}.`);
    return;
  }

  throw new Error(`Comando desconhecido: "${comando}".${AJUDA}`);
}

executarScript(main);
