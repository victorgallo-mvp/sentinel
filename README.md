# Sentinela Ads

Sistema de monitoramento inteligente para campanhas de Meta Ads (Facebook/Instagram), que combina:

1. **Pipeline determinístico** — coleta periódica de métricas via Meta Marketing API, cálculo de baselines estatísticos (média + desvio padrão) e detecção de anomalias por desvio.
2. **Agente de IA investigador** — quando uma anomalia é detectada, um agente baseado em Claude (com *tool use*) investiga o contexto (histórico, portfólio, criativos, audiência, orçamento, eventos externos), diagnostica a causa provável e decide se vale a pena notificar.
3. **Notificação via WhatsApp** (Evolution API) — alertas acionáveis, com diagnóstico e recomendação, mais um loop de feedback pra calibrar a sensibilidade ao longo do tempo.
4. **Relatório semanal** — visão consolidada do portfólio, gerada por um segundo agente (análise textual) e enviada por WhatsApp, com atualização opcional de uma planilha Google Sheets.

> Arquitetura **operacionalmente mono-tenant** (uma conta ativa por instância, configurada via `CONTA_ID`), mas **estruturalmente multi-tenant**: todo dado é gravado com `contaId`, então novas contas podem ser adicionadas sem mudanças de schema.

---

## Índice

- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [Configuração inicial](#configuração-inicial)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Como adicionar uma nova tool ao agente](#como-adicionar-uma-nova-tool-ao-agente)
- [Scripts utilitários](#scripts-utilitários)
- [API administrativa](#api-administrativa)
- [Jobs e filas](#jobs-e-filas)
- [Deploy (Railway)](#deploy-railway)
- [Custos esperados](#custos-esperados)
- [Troubleshooting](#troubleshooting)

---

## Arquitetura

```
┌──────────────────────┐     ┌──────────────────────────┐
│   Meta Marketing API  │────▶│  Coleta de métricas       │  cron: 5 * * * *
└──────────────────────┘     │  (MongoDB + Postgres)      │
                              └──────────────┬─────────────┘
                                              │
                                              ▼
                              ┌──────────────────────────┐
                              │  Detecção de anomalias     │  cron: 20 * * * *
                              │  (baseline ± sensibilidade)│
                              └──────────────┬─────────────┘
                                              │ fila TRIAGEM
                                              ▼
                              ┌──────────────────────────┐
                              │  Triagem (Claude Haiku)    │  filtra ruído
                              └──────────────┬─────────────┘
                                              │ fila INVESTIGACAO
                                              ▼
                              ┌──────────────────────────┐
                              │  Agente investigador       │  Claude Sonnet
                              │  (Sonnet + 11 tools)       │  + tool use, loop ≤10
                              └──────────────┬─────────────┘
                                              │ fila NOTIFICAR
                                              ▼
                              ┌──────────────────────────┐
                              │  Notificação WhatsApp       │  Evolution API
                              │  (Evolution API)            │
                              └──────────────────────────┘

┌──────────────────────────┐
│  Relatório semanal         │  cron: 0 8 * * 1 (segunda 08h)
│  (agente analista Sonnet)  │  → WhatsApp + Google Sheets (opcional)
└──────────────────────────┘
```

### Bases de dados

- **MongoDB** — dados de "estado" e domínio: `Conta`, `Entidade` (campanha/adset/ad), `Anomalia`, `Investigacao`, `Notificacao`, `Feedback`, `Relatorio`.
- **PostgreSQL (Supabase)** — séries temporais (`metricas_serie_temporal`) e baselines (`baselines`), otimizadas para consultas estatísticas.
- **Redis (Upstash)** — filas BullMQ (`TRIAGEM`, `INVESTIGACAO`, `NOTIFICAR`, `RELATORIO`).

### Pipeline determinístico vs. agente

| | Pipeline determinístico | Agente de IA |
|---|---|---|
| Onde | `src/core/coleta`, `src/core/deteccao` | `src/core/agente`, `src/core/tools`, `src/core/ia` |
| O que faz | Coleta métricas, calcula baseline, detecta desvios estatísticos | Investiga a causa do desvio, cruza dados, diagnostica e recomenda ação |
| Modelo | — (regras + estatística) | Haiku (triagem) + Sonnet (investigação e relatório) |
| Resultado | `Anomalia` (registro estruturado) | `Investigacao` (diagnóstico + recomendação) |

---

## Pré-requisitos

- **Node.js 20+**
- **MongoDB** (ex: MongoDB Atlas — free tier serve)
- **PostgreSQL** (ex: Supabase)
- **Redis** (ex: Upstash)
- **Conta Anthropic** com chave de API (`ANTHROPIC_API_KEY`)
- **Meta Business Manager** com:
  - Um **App** (Facebook for Developers) com permissão `ads_read` (e `ads_management` se for usar tools que leem orçamento/configuração)
  - Um **System User** com token de acesso de longa duração e acesso às contas de anúncio que serão monitoradas
- **Evolution API** rodando (instância própria ou hospedada) para envio de WhatsApp
- (Opcional) **Service Account do Google** com acesso de edição a uma planilha do Google Sheets, se for usar o relatório semanal nela

---

## Configuração inicial

```bash
git clone <repo>
cd sentinela-ads
npm install
cp .env.exemplo .env
```

Preencha o `.env` (veja [PROXIMOS-PASSOS.md](./PROXIMOS-PASSOS.md) para o passo a passo detalhado de cada variável).

Depois de configurar as variáveis de banco de dados, rode as migrations do Postgres:

```bash
npm run migrate
```

Para o passo a passo completo de primeira configuração (descobrir contas de anúncio, sincronizar entidades, popular histórico, validar o agente), siga **[PROXIMOS-PASSOS.md](./PROXIMOS-PASSOS.md)**.

Para iniciar a aplicação (API + workers + cron):

```bash
npm start       # produção
npm run dev     # desenvolvimento (recarrega com --watch)
```

---

## Estrutura do projeto

```
sentinela-ads/
├── index.js                      # entrypoint: conecta bancos, sobe API, inicia orquestrador
├── postgres/migrations/          # migrations SQL (séries temporais + baselines)
├── prompts/                       # system prompts dos agentes (PT-BR, em Markdown)
├── scripts/                       # scripts utilitários (setup, simulação, testes manuais)
├── tests/                         # testes unitários (Vitest) das funções puras
└── src/
    ├── api/
    │   ├── servidor.js            # configuração do Express
    │   ├── middlewares/            # autenticação admin
    │   ├── rotas/                  # /saude, /admin, /admin/feedback, /relatorios
    │   └── webhooks/               # webhook da Evolution API (respostas de feedback)
    ├── config/
    │   ├── index.js                # config central (validada com Zod)
    │   ├── conta.yaml               # referência/documentação da conta (config viva fica no Mongo)
    │   ├── metricas.config.js       # catálogo de métricas monitoradas
    │   └── thresholds-padrao.js     # sensibilidade padrão por métrica
    ├── core/
    │   ├── coleta/                  # cliente Meta API, normalização, coletor, descobridor de entidades
    │   ├── deteccao/                # cálculo de baseline, thresholds, deduplicação, detector de anomalia
    │   ├── ia/                      # cliente Anthropic (custo, limite diário) + triagem (Haiku)
    │   ├── agente/                  # loop do agente investigador (Sonnet + tool use)
    │   ├── tools/                   # as 11 tools do agente + registry
    │   ├── notificacao/             # envio de WhatsApp, throttling, formatação de mensagens
    │   ├── feedback/                # interpretação de respostas, registro, ajuste de sensibilidade
    │   └── relatorio/                # geração do relatório semanal (agente analista + templates)
    ├── dominio/                    # modelos Mongoose (Conta, Entidade, Anomalia, Investigacao, ...)
    ├── infra/                       # conexões mongo/postgres/redis, logger (Winston), filas (BullMQ)
    ├── jobs/                        # jobs cron + workers BullMQ + orquestrador
    └── shared/                      # erros customizados, utilitários estatísticos
```

---

## Como adicionar uma nova tool ao agente

O agente investigador (`src/core/agente/investigador.agente.js`) usa um **registry central** de tools em `src/core/tools/registro.tools.js`. Para adicionar uma nova capacidade:

1. **Crie o arquivo da tool** em `src/core/tools/minha-nova-tool.tool.js`, exportando:
   - `tool`: a definição no formato Anthropic (`name`, `description`, `input_schema` em JSON Schema)
   - `executar(parametros, contexto)`: função assíncrona que recebe o input do agente e o contexto da investigação (`{ contaId, anomaliaId, entidadeId, investigacaoId }`) e retorna um objeto serializável (será enviado de volta ao modelo como `tool_result`)

   ```js
   // src/core/tools/minha-nova-tool.tool.js
   export const tool = {
     name: 'minha_nova_tool',
     description: 'Explica em PT-BR o que essa tool faz e quando o agente deve usá-la.',
     input_schema: {
       type: 'object',
       properties: {
         exemploParametro: { type: 'string', description: '...' },
       },
       required: ['exemploParametro'],
     },
   };

   export async function executar(parametros, contexto) {
     // ... lógica da tool
     return { resultado: '...' };
   }
   ```

2. **Registre a tool** em `src/core/tools/registro.tools.js`:
   - Importe `tool` e `executar` com aliases (`as minhaNovaTool` / `as executarMinhaNovaTool`)
   - Adicione `minhaNovaTool` ao array `TOOLS_REGISTRADAS`
   - Adicione a entrada correspondente em `EXECUTORES`
   - Se a tool **finaliza** a investigação (como `registrar_diagnostico` e `decidir_notificar`), adicione seu nome ao `Set` `TOOLS_FINALIZADORAS`

3. **Documente a tool** em `prompts/tools-descriptions.md` (referência usada no prompt do agente) e, se necessário, ajuste `prompts/investigador-system.md` para orientar quando usá-la.

4. **Teste isoladamente** com `npm run testar-agente -- --metrica=... --direcao=...` para confirmar que o agente consegue chamar a nova tool e que o resultado é útil.

Nenhuma outra parte do código precisa ser alterada — o loop do agente (`investigador.agente.js`) e o executor (`executor-tools.js`) trabalham apenas com `TOOLS_REGISTRADAS` e `executarTool`, então novas tools são "plug and play".

---

## Scripts utilitários

Todos em `scripts/`, executados com `npm run <nome>`. Operam sobre a conta padrão (`CONTA_ID` no `.env`).

| Script | O que faz |
|---|---|
| `npm run migrate` | Aplica migrations pendentes do Postgres (`postgres/migrations/*.sql`) |
| `npm run descobrir-recursos` | Lista as contas de anúncio e a hierarquia (campanhas/adsets/ads) acessíveis pelo token Meta configurado — não grava nada |
| `npm run configurar-conta` | Cria/atualiza o documento `Conta` no Mongo e sincroniza as `Entidade`s (campanhas/adsets/ads) a partir da Meta API |
| `npm run popular-historico` | Faz backfill de métricas históricas (janela de 24h) via `time_range`/`time_increment`, para acelerar o primeiro cálculo de baseline |
| `npm run simular-anomalia` | Cria uma anomalia sintética e a enfileira para triagem (requer os workers rodando) |
| `npm run testar-agente` | Roda triagem + investigação de ponta a ponta de forma síncrona (sem depender dos workers), imprimindo diagnóstico, recomendação, tools chamadas e custo. Use `--notificar` para também enviar via WhatsApp |
| `npm run enviar-relatorio-manual` | Gera e envia o relatório semanal imediatamente (use `-- --dias=N` para outro período) |
| `npm test` | Roda os testes unitários (Vitest) das funções puras |

---

## API administrativa

Servidor Express em `src/api/servidor.js`, exposto na porta `PORT` (padrão `3000`).

- `GET /saude` — health check público, sem autenticação
- `GET /relatorios/:id` — página HTML pública do relatório semanal (link enviado no WhatsApp)
- `POST /webhooks/evolution` — webhook da Evolution API (respostas de feedback dos usuários)

Rotas abaixo exigem header `Authorization: Bearer <ADMIN_TOKEN>`:

- `GET /admin/contas` / `POST /admin/contas`
- `GET /admin/entidades?contaId=&tipo=&monitorada=` / `PATCH /admin/entidades/:id` (ativar/desativar monitoramento, sensibilidade custom, métricas ignoradas)
- `GET /admin/anomalias?contaId=&entidadeId=&status=&limite=`
- `GET /admin/investigacoes/:id`
- `GET /admin/notificacoes?contaId=&status=&limite=`
- `GET /admin/estatisticas?contaId=` — contadores gerais, atividade dos últimos 7 dias e custo dos últimos 30 dias
- `POST /admin/disparar/coleta` / `POST /admin/disparar/baselines` / `POST /admin/disparar/sincronizar-entidades` / `POST /admin/disparar/relatorio` — disparam manualmente os jobs correspondentes (respondem `202` e processam em background)
- `GET /admin/feedback/sugestoes-sensibilidade?contaId=&dias=` / `POST /admin/feedback/sugestoes-sensibilidade/aplicar` — sugestões e aplicação de ajuste de sensibilidade por entidade, com base no histórico de feedback

---

## Jobs e filas

Agendados em `src/jobs/orquestrador.js` (node-cron, horário do servidor):

| Job | Frequência | O que faz |
|---|---|---|
| `coleta-metricas` | `5 * * * *` (a cada hora, minuto 5) | Coleta métricas de todas as entidades monitoradas de todas as contas ativas |
| `deteccao-anomalias` | `20 * * * *` (minuto 20, após a coleta) | Compara métricas recém-coletadas com baselines e cria `Anomalia`s, enfileirando-as para triagem |
| `sincronizar-entidades` | `0 1 * * *` (diariamente às 01:00) | Redescobre campanhas/adsets/ads ativos na Meta API e sincroniza com o Mongo, criando `Entidade`s para campanhas novas ou reativadas (`monitorada: true` por padrão) |
| `atualizar-baselines` | `0 2 * * *` (diariamente às 02:00) | Recalcula média/desvio padrão por entidade+métrica+janela com base no histórico |
| `relatorio-semanal` | `0 8 * * 1` (segundas às 08:00) | Enfileira a geração do relatório semanal de cada conta ativa |
| `limpeza-dados-antigos` | `0 3 * * *` (diariamente às 03:00) | Remove métricas e registros antigos (retenção configurável) |

Filas BullMQ (Redis), processadas por workers iniciados junto com o orquestrador:

| Fila | Job data | Processado por |
|---|---|---|
| `TRIAGEM` | `{ anomaliaId }` | Triagem rápida via Claude Haiku — decide se vale investigar |
| `INVESTIGACAO` | `{ anomaliaId }` | Agente investigador (Sonnet + tools), concorrência 1 |
| `NOTIFICAR` | `{ investigacaoId }` | Envio da notificação via WhatsApp |
| `RELATORIO` | `{ contaId }` | Geração + envio do relatório semanal |

---

## Deploy (Railway)

1. Crie um novo projeto no Railway a partir do repositório.
2. Configure todas as variáveis de ambiente do `.env` (veja `.env.exemplo`) nas *Variables* do serviço — **incluindo** `URL_BASE` com a URL pública gerada pelo Railway (usada para montar o link do relatório no WhatsApp).
3. O `Procfile`/start command padrão é `npm start` (definido em `package.json` → `scripts.start`), que executa `index.js`: conecta os bancos, sobe a API e inicia o orquestrador (cron + workers) no mesmo processo.
4. Garanta que MongoDB, Postgres (Supabase) e Redis (Upstash) estejam acessíveis publicamente (ou via rede privada do Railway) e que as credenciais estejam corretas.
5. Após o primeiro deploy, rode `npm run migrate` (via `railway run npm run migrate` ou um *one-off* job) para criar as tabelas do Postgres.
6. Siga os passos de [PROXIMOS-PASSOS.md](./PROXIMOS-PASSOS.md) para a configuração inicial da conta (descoberta de recursos, sincronização de entidades, backfill de histórico).

> Como o processo único cuida de API + cron + workers, **não é necessário** configurar serviços/processos adicionais no Railway para esta versão (v1).

---

## Custos esperados

Os custos variam com o **volume de anomalias detectadas** (cada anomalia gera 1 chamada de triagem via Haiku e, se aprovada, 1 investigação via Sonnet com várias chamadas de tool use) e com o **tamanho do portfólio** (relatório semanal).

Tabela de preços usada em `src/core/ia/cliente.claude.js` (confira valores atuais em https://docs.claude.com antes de ir para produção):

| Modelo | Input (por MTok) | Output (por MTok) |
|---|---|---|
| `claude-haiku-4-5` (triagem) | US$ 1,00 | US$ 5,00 |
| `claude-sonnet-4-5` (investigação + relatório) | US$ 3,00 | US$ 15,00 |

Estimativas grosseiras (portfólio pequeno/médio):

- **Triagem (Haiku)**: poucos milhares de tokens por anomalia → tipicamente < US$ 0,01 por triagem
- **Investigação (Sonnet, tool use, até 10 iterações)**: cada iteração inclui o histórico acumulado + resultados de tools → algo entre US$ 0,05 e US$ 0,40 por investigação completa, dependendo de quantas tools o agente usa
- **Relatório semanal (Sonnet, 1 chamada)**: tipicamente entre US$ 0,02 e US$ 0,10, dependendo do tamanho do portfólio

**Proteção de custo**: `LIMITE_CUSTO_DIARIO_USD` (padrão US$ 3,00) é verificado antes de cada investigação e relatório via `verificarLimiteCusto()` — somando o custo de `Investigacao` + `Relatorio` criados desde 00:00 do dia. Se o limite for atingido, novas investigações/relatórios são bloqueados (`ErroLimiteCustoExcedido`, HTTP 429 na API admin) até o dia seguinte. Ajuste esse valor em `conta.configuracoes.limiteCustoDiarioUsd` (Mongo) conforme o orçamento disponível.

---

## Troubleshooting

Veja a seção de debugging em [PROXIMOS-PASSOS.md](./PROXIMOS-PASSOS.md#debugging-e-observabilidade) para um guia mais completo. Pontos rápidos:

- **`Erro de configuração — variáveis de ambiente inválidas`** ao iniciar: alguma variável obrigatória do `.env` está faltando (`MONGO_URI`, `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`). O processo encerra com a lista de campos inválidos.
- **Nenhuma anomalia é detectada**: confirme que `npm run popular-historico` foi executado e que `atualizar-baselines` já rodou pelo menos uma vez (baselines exigem um mínimo de observações — `MINIMO_OBSERVACOES_BASELINE` em `src/config/thresholds-padrao.js`).
- **Investigação não dispara notificação**: verifique `investigacao.decidiuNotificar` e `investigacao.motivoNaoNotificar` via `GET /admin/investigacoes/:id` — o agente pode ter concluído que o desvio não é relevante o suficiente.
- **WhatsApp não chega**: confira `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`/`EVOLUTION_INSTANCE_NAME` e `NOTIFICACAO_WHATSAPP_JID`, e os logs de `src/core/notificacao/enviador-whatsapp.servico.js`. Verifique também o `throttling` (`src/core/notificacao/throttling.js`) e a janela permitida (`notificacao.horarioPermitidoInicio/Fim`, `diasUteis`).
- **`ErroLimiteCustoExcedido`**: o limite diário de custo de IA foi atingido — aguarde o próximo dia ou aumente `configuracoes.limiteCustoDiarioUsd` na conta.
