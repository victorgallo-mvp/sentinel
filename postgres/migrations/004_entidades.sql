-- ============================================================
-- Migration 004: dimensão de entidades
--
-- `metricas_serie_temporal` guarda só `entidade_id`. Quem consulta o Postgres
-- direto — relatórios, BI, agentes — não tem como saber de que campanha é a
-- linha sem ir ao MongoDB. Esta tabela espelha o essencial da coleção
-- `entidades` para permitir o JOIN.
--
-- Deliberadamente uma DIMENSÃO, e não uma coluna em metricas_serie_temporal:
-- são ~2 mil entidades contra milhões de linhas de métrica, e o nome de uma
-- campanha muda sem que o histórico de métricas deva mudar junto.
--
-- Atualizada pelo job `sincronizar-entidades` (a cada 2h) e por
-- `npm run sincronizar-dimensao`.
-- ============================================================

CREATE TABLE IF NOT EXISTS entidades (
  entidade_id       VARCHAR(50) PRIMARY KEY,   -- Entidade._id do MongoDB, como texto
  conta_id          VARCHAR(50) NOT NULL,      -- Conta.identificador (casa com metricas_serie_temporal.conta_id)
  conta_nome        TEXT        NOT NULL,
  entidade_tipo     VARCHAR(20) NOT NULL,      -- campaign | adset | ad
  nome              TEXT        NOT NULL,
  meta_id           VARCHAR(50),               -- id da entidade na Meta
  conta_anuncio_id  VARCHAR(50),               -- act_... a que a entidade pertence
  campanha_meta_id  VARCHAR(50),               -- hierarquia: campanha à qual pertence
  adset_meta_id     VARCHAR(50),               -- hierarquia: conjunto ao qual pertence
  objetivo          VARCHAR(60),
  optimization_goal VARCHAR(60),
  status            VARCHAR(40),
  monitorada        BOOLEAN     NOT NULL DEFAULT false,
  atualizada_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE entidades IS 'Dimensão de campanhas/conjuntos/anúncios — espelho do MongoDB para permitir JOIN com metricas_serie_temporal';
COMMENT ON COLUMN entidades.conta_id IS 'Conta.identificador — mesma chave usada em metricas_serie_temporal.conta_id';

CREATE INDEX IF NOT EXISTS idx_entidades_conta ON entidades (conta_id);
CREATE INDEX IF NOT EXISTS idx_entidades_tipo ON entidades (entidade_tipo);
CREATE INDEX IF NOT EXISTS idx_entidades_monitorada ON entidades (monitorada) WHERE monitorada;
CREATE INDEX IF NOT EXISTS idx_entidades_hierarquia ON entidades (campanha_meta_id);
