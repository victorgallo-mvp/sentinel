/**
 * Classes de erro customizadas usadas em toda a aplicação.
 * Permitem tratamento diferenciado (ex: erro de validação vs erro de API externa).
 */

export class ErroAplicacao extends Error {
  constructor(mensagem, codigo = 'ERRO_APLICACAO', detalhes = null) {
    super(mensagem);
    this.name = this.constructor.name;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** Erro ao chamar a Meta Marketing API (rate limit, token inválido, etc). */
export class ErroMetaApi extends ErroAplicacao {
  constructor(mensagem, detalhes = null) {
    super(mensagem, 'ERRO_META_API', detalhes);
  }
}

/** Erro ao chamar a API da Anthropic. */
export class ErroAnthropicApi extends ErroAplicacao {
  constructor(mensagem, detalhes = null) {
    super(mensagem, 'ERRO_ANTHROPIC_API', detalhes);
  }
}

/** Erro de validação de entrada (Zod ou manual). */
export class ErroValidacao extends ErroAplicacao {
  constructor(mensagem, detalhes = null) {
    super(mensagem, 'ERRO_VALIDACAO', detalhes);
  }
}

/** Recurso não encontrado (conta, entidade, anomalia, etc). */
export class ErroNaoEncontrado extends ErroAplicacao {
  constructor(mensagem, detalhes = null) {
    super(mensagem, 'ERRO_NAO_ENCONTRADO', detalhes);
  }
}

/** Limite de custo diário excedido — bloqueia novas chamadas ao agente. */
export class ErroLimiteCustoExcedido extends ErroAplicacao {
  constructor(mensagem, detalhes = null) {
    super(mensagem, 'ERRO_LIMITE_CUSTO', detalhes);
  }
}

/** Tool desconhecida ou execução de tool falhou de forma irrecuperável. */
export class ErroTool extends ErroAplicacao {
  constructor(mensagem, detalhes = null) {
    super(mensagem, 'ERRO_TOOL', detalhes);
  }
}
