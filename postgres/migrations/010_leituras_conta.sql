-- ============================================================
-- Migration 010: leitura diária por IA sobre os sinais
--
-- Uma linha por conta e dia: o modelo lê os sinais já calculados (frase,
-- explicação, sugestão, R$/dia) e devolve o que um responsável precisa ouvir
-- em 30 segundos — resumo, tendência e até 3 prioridades, cada uma amarrada
-- aos sinais que a sustentam. O modelo não calcula nada: todo número vem dos
-- sinais, e o impacto de cada prioridade é somado pelo sistema, não por ele.
--
-- `entrada` guarda o JSON enviado ao modelo: a leitura é auditável.
-- ============================================================

CREATE TABLE IF NOT EXISTS leituras_conta (
  id            BIGSERIAL PRIMARY KEY,
  conta_id      VARCHAR(50)  NOT NULL,
  gerado_em     DATE         NOT NULL,
  resumo        TEXT         NOT NULL,
  tendencia     VARCHAR(12),                       -- melhorando | estavel | piorando | sem_base
  prioridades   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  observacao    TEXT,
  total_sinais  INT          NOT NULL DEFAULT 0,
  vazando_dia   NUMERIC(12,2) NOT NULL DEFAULT 0,
  recuperavel_dia NUMERIC(12,2) NOT NULL DEFAULT 0,
  entrada       JSONB        NOT NULL,
  modelo        VARCHAR(60),
  custo_usd     NUMERIC(10,6),
  criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT leituras_conta_unica UNIQUE (conta_id, gerado_em)
);

COMMENT ON TABLE leituras_conta IS 'Leitura diária por IA dos sinais de cada conta: resumo, tendência e prioridades com os sinais que as sustentam';
COMMENT ON COLUMN leituras_conta.prioridades IS '[{ordem, titulo, onde, porque, acao, sinais: [{tipo, entidadeId}], impactoDia}]';
COMMENT ON COLUMN leituras_conta.entrada IS 'JSON enviado ao modelo; torna a leitura auditável';

CREATE INDEX IF NOT EXISTS idx_leituras_conta_dia ON leituras_conta (conta_id, gerado_em DESC);
