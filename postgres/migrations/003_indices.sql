-- ============================================================
-- Migration 003: índices de performance
-- ============================================================

-- Consultas de histórico por entidade+métrica (mais comuns no agente)
CREATE INDEX IF NOT EXISTS idx_metricas_entidade_metrica
  ON metricas_serie_temporal (entidade_id, metrica, coletada_em DESC);

-- Consultas agregadas por conta (relatórios, limpeza)
CREATE INDEX IF NOT EXISTS idx_metricas_conta
  ON metricas_serie_temporal (conta_id);

-- Consultas por janela de tempo (limpeza de dados antigos, relatórios)
CREATE INDEX IF NOT EXISTS idx_metricas_data
  ON metricas_serie_temporal (coletada_em DESC);

-- Lookup de baseline durante detecção de anomalia
CREATE INDEX IF NOT EXISTS idx_baselines_lookup
  ON baselines (entidade_id, metrica, janela_horas);

-- Lookup de baselines por conta (job de atualização diária)
CREATE INDEX IF NOT EXISTS idx_baselines_conta
  ON baselines (conta_id);

-- Garante idempotência da coleta: mesma entidade+métrica+janela+timestamp
-- não gera linhas duplicadas (coletor usa ON CONFLICT DO UPDATE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_metricas_dedup
  ON metricas_serie_temporal (entidade_id, metrica, janela_horas, coletada_em);
