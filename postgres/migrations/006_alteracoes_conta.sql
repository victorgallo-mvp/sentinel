-- ============================================================
-- Migration 006: registro de alterações nas contas de anúncio
--
-- Cada linha é um evento do histórico de alterações da plataforma (hoje a
-- Meta, via `act_<id>/activities`), já traduzido para uma frase legível e
-- classificado em categoria. A tradução acontece na coleta, não na leitura:
-- quem consulta recebe "pausou conjunto X", nunca `update_ad_set_run_status`.
--
-- `plataforma` existe desde o início porque o Google Ads tem o equivalente
-- (`change_event`). Quando entrar, muda a coleta, não esta tabela.
--
-- `chave` é um hash determinístico do evento (conta, hora, tipo, objeto, autor,
-- conteúdo): a Meta não devolve id de evento, e sem isso reler os últimos dias
-- toda madrugada duplicaria tudo.
--
-- `dados` guarda o evento bruto. É o que permite reprocessar a tradução quando
-- o dicionário melhorar, sem voltar à API.
-- ============================================================

CREATE TABLE IF NOT EXISTS alteracoes_conta (
  id                BIGSERIAL PRIMARY KEY,
  plataforma        VARCHAR(20)  NOT NULL DEFAULT 'meta',
  conta_id          VARCHAR(50)  NOT NULL,      -- Conta.identificador
  conta_anuncio_id  VARCHAR(40)  NOT NULL,      -- act_<id>
  chave             TEXT         NOT NULL,
  ocorrida_em       TIMESTAMPTZ  NOT NULL,
  autor_id          VARCHAR(40),                -- id do usuário na plataforma; '0' = a própria Meta
  autor_nome        TEXT,
  aplicacao         TEXT,                       -- Power Editor, Ads Manager, API...
  gestor_id         VARCHAR(40),                -- Gestor._id (Mongo) resolvido a partir do autor; null = não vinculado
  sistema           BOOLEAN      NOT NULL DEFAULT false,  -- feito pela plataforma, não por pessoa
  oculto            BOOLEAN      NOT NULL DEFAULT false,  -- ruído: transições pendentes, edição de imagem...
  categoria         VARCHAR(20)  NOT NULL,      -- estrutura | status | orcamento | segmentacao | criativo | faturamento | sistema
  tipo              VARCHAR(80)  NOT NULL,      -- event_type bruto da plataforma
  frase             TEXT         NOT NULL,      -- complemento do autor: "pausou conjunto X"
  objeto_tipo       VARCHAR(20),                -- campanha | conjunto | anúncio | conta
  objeto_id         VARCHAR(40),
  objeto_nome       TEXT,
  campanha_id       VARCHAR(40),                -- campanha à qual o objeto pertence (via hierarquia das entidades)
  campanha_nome     TEXT,
  dados             JSONB        NOT NULL,
  coletada_em       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT alteracoes_conta_chave_unica UNIQUE (chave)
);

COMMENT ON TABLE alteracoes_conta IS 'Histórico de alterações das contas de anúncio, traduzido e classificado na coleta';
COMMENT ON COLUMN alteracoes_conta.chave IS 'Hash determinístico do evento — a plataforma não fornece id';
COMMENT ON COLUMN alteracoes_conta.gestor_id IS 'Gestor (Mongo) ao qual o autor foi vinculado; null quando o autor ainda não tem vínculo';

CREATE INDEX IF NOT EXISTS idx_alteracoes_conta_data   ON alteracoes_conta (conta_id, ocorrida_em DESC);
CREATE INDEX IF NOT EXISTS idx_alteracoes_gestor_data  ON alteracoes_conta (gestor_id, ocorrida_em DESC);
CREATE INDEX IF NOT EXISTS idx_alteracoes_data         ON alteracoes_conta (ocorrida_em DESC);
CREATE INDEX IF NOT EXISTS idx_alteracoes_autor        ON alteracoes_conta (autor_id) WHERE gestor_id IS NULL AND sistema = false;
