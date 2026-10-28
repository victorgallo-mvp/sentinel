-- ============================================================
-- Migration 009: sinais com contexto completo
--
-- Todo sinal passa a dizer exatamente de que campanha › conjunto › anúncio
-- fala, a que categoria pertence, como o R$/dia foi calculado (explicação)
-- e o que fazer a respeito (sugestão). A IA da fase 2 lê isso pronto.
-- ============================================================

ALTER TABLE sinais_conta
  ADD COLUMN IF NOT EXISTS categoria     VARCHAR(12),
  ADD COLUMN IF NOT EXISTS conjunto_nome TEXT,
  ADD COLUMN IF NOT EXISTS explicacao    TEXT,
  ADD COLUMN IF NOT EXISTS sugestao      TEXT;

COMMENT ON COLUMN sinais_conta.categoria     IS 'desperdicio | risco | operacao | orcamento | previsao';
COMMENT ON COLUMN sinais_conta.conjunto_nome IS 'Nome do conjunto quando o sinal é de anúncio (entidade_nome) ou do próprio conjunto';
COMMENT ON COLUMN sinais_conta.explicacao    IS 'Como o número foi calculado, em uma frase, com os valores';
COMMENT ON COLUMN sinais_conta.sugestao      IS 'Ação recomendada ao gestor';
