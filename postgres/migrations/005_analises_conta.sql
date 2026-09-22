-- ============================================================
-- Migration 005: análises periódicas de conta
--
-- Guarda o veredito qualitativo produzido a cada 3 dias pela triagem de
-- performance. Fica no Postgres — e não no MongoDB — porque quem mais consome
-- isso são os relatórios e agentes que já consultam `metricas_serie_temporal`:
-- assim dá para cruzar a leitura com os números que a originaram, no mesmo
-- banco e na mesma consulta.
--
-- `metricas` guarda a tabela pré-computada que foi enviada ao modelo. É o que
-- torna a análise auditável: dá para reconstruir em cima de quê ela foi feita,
-- em vez de confiar na narrativa.
-- ============================================================

CREATE TABLE IF NOT EXISTS analises_conta (
  id            BIGSERIAL PRIMARY KEY,
  conta_id      VARCHAR(50) NOT NULL,     -- Conta.identificador, casa com metricas_serie_temporal.conta_id
  conta_nome    TEXT        NOT NULL,
  situacao      VARCHAR(20) NOT NULL,     -- saudavel | atencao | critico
  resumo        TEXT        NOT NULL,     -- uma frase, legível por humano
  fatores       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  acao          TEXT,                     -- recomendação, quando houver
  metricas      JSONB       NOT NULL,     -- a tabela que embasou a análise
  metrica_resultado VARCHAR(50),          -- qual métrica conta como "resultado" nesta conta
  modelo        VARCHAR(60),
  custo_usd     NUMERIC(10, 6),
  analisada_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analises_conta IS 'Triagem de performance por conta, a cada 3 dias — leitura qualitativa sobre os números agregados';
COMMENT ON COLUMN analises_conta.metricas IS 'Tabela pré-computada enviada ao modelo; torna a análise auditável';
COMMENT ON COLUMN analises_conta.situacao IS 'saudavel | atencao | critico';

CREATE INDEX IF NOT EXISTS idx_analises_conta ON analises_conta (conta_id, analisada_em DESC);
CREATE INDEX IF NOT EXISTS idx_analises_data ON analises_conta (analisada_em DESC);
CREATE INDEX IF NOT EXISTS idx_analises_situacao ON analises_conta (situacao) WHERE situacao <> 'saudavel';
