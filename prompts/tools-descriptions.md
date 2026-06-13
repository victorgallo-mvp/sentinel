# Descrições das tools do agente investigador

Referência rápida das ferramentas disponíveis ao agente investigador
(`src/core/tools/`). As descrições "oficiais" (enviadas à API) vivem no
campo `description` de cada arquivo `*.tool.js` — este documento é um
resumo pra humanos.

| Tool | Arquivo | O que faz |
|---|---|---|
| `consultar_historico_metrica` | `consultar-historico.tool.js` | Histórico diário (24h) de uma métrica, N dias, com estatísticas |
| `comparar_com_portfolio` | `comparar-com-portfolio.tool.js` | Compara valor atual com outras entidades do mesmo tipo na conta |
| `analisar_frequencia_audiencia` | `analisar-frequencia.tool.js` | Frequência/alcance histórico, detecta saturação |
| `analisar_criativos` | `analisar-criativos.tool.js` | Lista ads do adset relacionado com performance 24h |
| `consultar_audiencia` | `consultar-audiencia.tool.js` | Targeting do adset + alcance/frequência |
| `verificar_orcamento` | `verificar-orcamento.tool.js` | Orçamento, gasto recente, ritmo, projeção |
| `buscar_eventos_meta` | `buscar-eventos-meta.tool.js` | Stub V1 — eventos externos (outages, políticas) |
| `consultar_peers` | `consultar-peers.tool.js` | Compara baseline com outras contas gerenciadas (anonimizado) |
| `obter_detalhes_entidade` | `obter-detalhes-entidade.tool.js` | Info completa da entidade + hierarquia |
| `registrar_diagnostico` | `registrar-diagnostico.tool.js` | **Finalizadora**: registra causa/severidade/confiança |
| `decidir_notificar` | `decidir-notificar.tool.js` | **Finalizadora**: decide notificação + recomendação |

## Adicionando uma nova tool

1. Crie `src/core/tools/<nome>.tool.js` exportando `tool` (definição
   Anthropic) e `executar(parametros, contexto)`.
2. Registre em `src/core/tools/registro.tools.js`: importe e adicione em
   `TOOLS_REGISTRADAS` e no mapa `EXECUTORES`.
3. Se a tool for "finalizadora" (modifica o estado da investigação como
   `registrar_diagnostico`/`decidir_notificar`), adicione o nome em
   `TOOLS_FINALIZADORAS`.
4. Mantenha a tool rápida (< 3s) e com retorno estruturado (nunca string solta).
5. Atualize este documento.
