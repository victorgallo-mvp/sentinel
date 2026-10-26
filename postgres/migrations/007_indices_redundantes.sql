-- ============================================================
-- Migration 007: remove índices redundantes de metricas_serie_temporal
--
-- Medido em 26/10/2026: a tabela tinha 1,6 GB de dados e 3,5 GB de índices.
--
-- `idx_metricas_entidade_metrica` (entidade_id, metrica, coletada_em) — 1,3 GB —
-- é um prefixo do índice único de deduplicação (entidade_id, metrica,
-- janela_horas, coletada_em), que serve as mesmas buscas. Dois índices para o
-- mesmo trabalho dobram o custo de cada escrita e de cada autovacuum.
--
-- `idx_metricas_conta` (conta_id) — 88 MB — teve 114 leituras na vida inteira
-- da tabela; nenhuma consulta do sistema filtra a série por conta sem passar
-- antes pela entidade.
-- ============================================================

DROP INDEX IF EXISTS idx_metricas_entidade_metrica;
DROP INDEX IF EXISTS idx_metricas_conta;
