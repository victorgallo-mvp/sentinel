-- ============================================================
-- Migration 008: sinais de desperdício e risco por conta
--
-- Saída do motor de sinais (determinístico, roda após a coleta diária). Cada
-- linha é um achado sobre uma entidade num dia: o que foi detectado, a
-- evidência numérica que o sustenta e quanto está custando por dia, em reais.
-- A IA lê daqui para ordenar e explicar; não calcula nada.
--
-- `metrica_resultado` e `origem_resultado` registram COMO o sistema decidiu o
-- que é "resultado" para aquela entidade (onboarding, meta, dados ou proxy).
-- ============================================================

CREATE TABLE IF NOT EXISTS sinais_conta (
  id                 BIGSERIAL PRIMARY KEY,
  conta_id           VARCHAR(50)  NOT NULL,
  gerado_em          DATE         NOT NULL,
  tipo               VARCHAR(40)  NOT NULL,
  nivel              VARCHAR(10)  NOT NULL,
  entidade_id        VARCHAR(40)  NOT NULL,
  entidade_nome      TEXT,
  campanha_nome      TEXT,
  metrica_resultado  VARCHAR(50),
  origem_resultado   VARCHAR(12),
  severidade         VARCHAR(8)   NOT NULL,
  desperdicio_dia    NUMERIC(12,2),
  frase              TEXT         NOT NULL,
  evidencia          JSONB        NOT NULL,
  criado_em          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT sinais_conta_unico UNIQUE (conta_id, gerado_em, tipo, entidade_id)
);

COMMENT ON TABLE sinais_conta IS 'Achados diários do motor de sinais: desperdício e risco por entidade, com evidência e custo por dia';
COMMENT ON COLUMN sinais_conta.desperdicio_dia IS 'Estimativa em R$/dia do que está sendo perdido; null = sinal qualitativo';
COMMENT ON COLUMN sinais_conta.origem_resultado IS 'onboarding | meta | dados | proxy';

CREATE INDEX IF NOT EXISTS idx_sinais_conta_dia ON sinais_conta (conta_id, gerado_em DESC);
CREATE INDEX IF NOT EXISTS idx_sinais_dia       ON sinais_conta (gerado_em DESC);
