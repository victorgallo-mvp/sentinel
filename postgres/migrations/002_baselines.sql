-- ============================================================
-- Migration 002: tabela de baselines calculados
-- Atualizada diariamente (ou após coleta significativa) com
-- estatísticas (média, desvio padrão, min, max) por entidade+métrica+janela.
-- ============================================================

CREATE TABLE IF NOT EXISTS baselines (
  id BIGSERIAL PRIMARY KEY,
  conta_id VARCHAR(50) NOT NULL,
  entidade_id VARCHAR(50) NOT NULL,
  metrica VARCHAR(50) NOT NULL,
  janela_horas INT NOT NULL,

  media NUMERIC(15, 4),
  desvio_padrao NUMERIC(15, 4),
  minimo NUMERIC(15, 4),
  maximo NUMERIC(15, 4),

  quantidade_observacoes INT,
  dias_historico INT,

  calculado_em TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(conta_id, entidade_id, metrica, janela_horas)
);

COMMENT ON TABLE baselines IS 'Baselines estatísticos (média + desvio padrão) usados para detecção de anomalias';
