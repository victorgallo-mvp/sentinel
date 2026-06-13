-- ============================================================
-- Migration 001: tabela de séries temporais de métricas
-- Armazena cada coleta de métrica por entidade (campaign/adset/ad).
-- Alto volume de escrita — sem foreign keys pra MongoDB (IDs como string).
-- ============================================================

CREATE TABLE IF NOT EXISTS metricas_serie_temporal (
  id BIGSERIAL PRIMARY KEY,
  conta_id VARCHAR(50) NOT NULL,
  entidade_id VARCHAR(50) NOT NULL,
  entidade_tipo VARCHAR(20) NOT NULL,    -- 'campaign', 'adset', 'ad'
  metrica VARCHAR(50) NOT NULL,
  valor NUMERIC(15, 4) NOT NULL,
  janela_horas INT NOT NULL,             -- 1, 6, 24
  coletada_em TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE metricas_serie_temporal IS 'Série temporal de métricas coletadas da Meta Marketing API';
COMMENT ON COLUMN metricas_serie_temporal.entidade_id IS 'ID da entidade no MongoDB (Entidade._id)';
COMMENT ON COLUMN metricas_serie_temporal.janela_horas IS 'Janela de agregação da métrica: 1h, 6h ou 24h';
