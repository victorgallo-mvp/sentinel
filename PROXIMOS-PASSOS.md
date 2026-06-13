# Próximos passos

Este documento é o guia prático para colocar o **sentinela-ads** no ar pela primeira vez:
preencher configurações manuais, validar o sistema em ordem (do mais simples ao agente
completo) e diagnosticar problemas. Para entender a arquitetura, veja o [README.md](./README.md).

---

## 1. Preencher o `.env`

Copie `.env.exemplo` para `.env` e preencha cada bloco abaixo.

### Bancos de dados

| Variável | Onde obter |
|---|---|
| `MONGO_URI` | String de conexão do MongoDB (ex: MongoDB Atlas → *Connect* → *Drivers*). Inclua o nome do banco no final da URI. |
| `DATABASE_URL` | String de conexão do PostgreSQL (ex: Supabase → *Project Settings* → *Database* → *Connection string*, modo "URI"). |
| `REDIS_URL` | String de conexão do Redis (ex: Upstash → *Database* → *Connect* → "Redis URL", já com `rediss://...`). |

Depois de preencher os três, rode:

```bash
npm run migrate
```

Isso cria a tabela de controle `schema_migrations` e aplica `postgres/migrations/001..003` (séries
temporais, baselines e índices).

### Anthropic

| Variável | Onde obter |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → *API Keys* |
| `MODELO_TRIAGEM` | Pode deixar o padrão (`claude-haiku-4-5`) |
| `MODELO_AGENTE` | Pode deixar o padrão (`claude-sonnet-4-5`) |

### Meta (Facebook/Instagram Ads)

1. Crie (ou use) um **App** em https://developers.facebook.com/apps — tipo "Business".
   - Anote o **App ID** (`META_APP_ID`) e o **App Secret** (`META_APP_SECRET`, em *Configurações → Básico*).
2. No **Business Manager** (https://business.facebook.com), anote o **ID da BM** (`META_BM_ID`) — em *Configurações do negócio → Informações do negócio*.
3. Crie um **System User** (*Configurações do negócio → Usuários → Usuários do sistema*):
   - Dê a ele acesso às **contas de anúncio** que serão monitoradas (papel "Funcionário" basta para leitura).
   - Gere um **token de acesso** para esse System User, com as permissões `ads_read` (mínimo) — se for usar tools que leem orçamento/configuração de campanhas, inclua também `ads_management`.
   - Esse é o `META_SYSTEM_USER_TOKEN`. Tokens de System User não expiram automaticamente (a menos que revogados), o que é importante para um serviço de longa duração.
4. `META_API_VERSION` pode ficar no padrão (`v21.0`) — atualize se a versão for descontinuada.

### Evolution API (WhatsApp)

| Variável | Onde obter |
|---|---|
| `EVOLUTION_API_URL` | URL base da sua instância da Evolution API |
| `EVOLUTION_API_KEY` | Chave de API configurada na instância |
| `EVOLUTION_INSTANCE_NAME` | Nome da instância (sessão do WhatsApp) já conectada/pareada |
| `NOTIFICACAO_WHATSAPP_JID` | JID do WhatsApp que receberá os alertas (ex: `5511999999999@s.whatsapp.net` para número individual, ou `...@g.us` para grupo) |

### Conta atual

| Variável | Valor |
|---|---|
| `CONTA_ID` | Um identificador (slug) para a sua conta, ex: `victor-pessoal`. Será usado pelos scripts via `obterContaPadrao()` e gravado como `Conta.identificador`. |

### Google Sheets (opcional)

Só necessário se quiser que o relatório semanal também atualize uma planilha.

1. Crie uma **Service Account** no Google Cloud (*IAM & Admin → Service Accounts*), com a **Google Sheets API** habilitada no projeto.
2. Gere uma chave JSON para essa service account.
3. Compacte o conteúdo do JSON em **uma única linha** e cole em `GOOGLE_SERVICE_ACCOUNT_JSON` (ex: `cat credenciais.json | jq -c .` ou similar).
4. Crie/abra a planilha que receberá os dados e **compartilhe-a** (permissão de Editor) com o e-mail `client_email` presente no JSON da service account.
5. Anote o **ID da planilha** (da URL `https://docs.google.com/spreadsheets/d/<ID>/edit`) — ele será configurado em `Conta.configuracoes.googleSheetsId` (via `npm run configurar-conta` ou diretamente no Mongo/`/admin/contas`).

Se deixar `GOOGLE_SERVICE_ACCOUNT_JSON` vazio ou `googleSheetsId` vazio, o relatório semanal funciona normalmente (HTML + WhatsApp), apenas sem atualizar planilha.

### Limites e segurança

| Variável | Recomendação |
|---|---|
| `LIMITE_CUSTO_DIARIO_USD` | `3.00` é um bom ponto de partida para uma conta pequena/média. Ajuste depois de observar o custo real por investigação (`/admin/estatisticas`). |
| `MAX_ITERACOES_AGENTE` | `10` (padrão) — limite rígido de iterações do loop do agente investigador, evita loops caros. |
| `ADMIN_TOKEN` | Gere um token aleatório forte (ex: `openssl rand -hex 32`) — protege todas as rotas `/admin/*`. |

### Servidor

| Variável | Valor |
|---|---|
| `URL_BASE` | URL pública da aplicação (ex: a URL gerada pelo Railway). Usada para montar o link `GET /relatorios/:id` enviado no WhatsApp. Pode ficar vazio em desenvolvimento local — o link simplesmente não será incluído na mensagem. |
| `PORT` | `3000` (padrão) |
| `NODE_ENV` | `development` localmente, `production` em deploy |
| `LOG_LEVEL` | `info` (use `debug` para depurar) |

---

## 2. Ordem de validação (do zero ao agente funcionando)

Siga esta ordem — cada passo depende do anterior.

### Passo 1 — Descobrir recursos da Meta (sem gravar nada)

```bash
npm run descobrir-recursos
```

Lista as contas de anúncio acessíveis pelo `META_SYSTEM_USER_TOKEN`/`META_BM_ID`, com a hierarquia de
campanhas/adsets/ads ativos. Use para **confirmar que as credenciais Meta estão corretas** antes de
gravar qualquer coisa no banco.

### Passo 2 — Configurar a conta e sincronizar entidades

```bash
npm run configurar-conta
```

Cria (ou atualiza) o documento `Conta` no Mongo com `identificador = CONTA_ID`, descobre todas as
contas de anúncio da BM e sincroniza campanhas/adsets/ads como `Entidade`s monitoráveis
(`monitorada: true` por padrão).

> Se quiser monitorar só algumas campanhas, use depois `PATCH /admin/entidades/:id` com
> `{ "monitorada": false }` para as que não devem ser acompanhadas.

> A partir daqui, o cron `sincronizar-entidades` (diariamente às 01:00) repete essa descoberta
> automaticamente — campanhas/adsets/ads novos ou reativados na Meta entram como `Entidade`
> monitorada (`monitorada: true`) sem precisar rodar `npm run configurar-conta` de novo. Para
> rodar manualmente: `POST /admin/disparar/sincronizar-entidades { "contaId": "<id>" }`.

### Passo 3 — Popular histórico (backfill)

```bash
npm run popular-historico
```

Busca métricas diárias retroativas (via `time_range`/`time_increment` da Meta API) para todas as
entidades monitoradas, cobrindo `configuracoes.diasHistoricoBaseline` dias (padrão 21). Isso permite
calcular um baseline confiável **sem esperar 3 semanas de coleta em tempo real**.

### Passo 4 — Observar a coleta em tempo real por alguns dias

Com `npm start` rodando (ou via cron no Railway), o job `coleta-metricas` roda a cada hora
(`5 * * * *`). Você pode também disparar manualmente:

```bash
curl -X POST http://localhost:3000/admin/disparar/coleta \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Deixe rodar por **2-3 dias** (ou confie no backfill do Passo 3 + algumas horas de coleta real) antes
do próximo passo, para ter dados suficientes (`MINIMO_OBSERVACOES_BASELINE = 10` observações).

### Passo 5 — Calcular baselines

```bash
curl -X POST http://localhost:3000/admin/disparar/baselines \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

(ou espere o cron diário `0 2 * * *`). Isso popula a tabela `baselines` no Postgres com
média/desvio padrão por entidade+métrica+janela.

### Passo 6 — Validar o agente de ponta a ponta (sem esperar uma anomalia real)

```bash
npm run testar-agente -- --metrica=spend --direcao=aumento --magnitude=4
```

Esse script:
1. Cria uma `Anomalia` sintética (usando o baseline real da entidade, se existir)
2. Roda a **triagem** (Haiku) — imprime `merece` e `motivo`
3. Se aprovada, roda a **investigação completa** (Sonnet + tools) — imprime iterações, custo, tools
   chamadas, diagnóstico e recomendação
4. **Não envia WhatsApp** por padrão — adicione `--notificar` para enviar de fato

Use isso para validar prompts, tools e custo **antes** de habilitar a detecção real.

### Passo 7 — Simular o pipeline completo via filas

```bash
npm run simular-anomalia -- --metrica=ctr --direcao=queda --magnitude=3.5
```

Cria a anomalia e enfileira para a fila `TRIAGEM` — requer `npm start` rodando (workers ativos).
Acompanhe os logs (Winston) ou consulte:

```bash
curl "http://localhost:3000/admin/anomalias?contaId=<id>&limite=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Passo 8 — Habilitar a detecção real

Com baselines calculados e o agente validado, o cron `deteccao-anomalias` (`20 * * * *`) já está
ativo junto com `npm start` — não há nada extra para "ligar". A partir daqui, anomalias reais
detectadas pelo pipeline determinístico seguirão automaticamente para triagem → investigação →
notificação.

### Passo 9 — Validar o relatório semanal

```bash
npm run enviar-relatorio-manual -- --dias=7
```

Gera o relatório do período e envia via WhatsApp imediatamente (sem esperar a segunda-feira). Use
para validar o template HTML (acessível em `GET /relatorios/:id`), o texto gerado pelo agente
analista e a integração com Google Sheets (se configurada).

---

## 3. Debugging e observabilidade

- **Logs**: tudo é logado via Winston (`src/infra/logger.js`), em JSON estruturado. Em desenvolvimento,
  ajuste `LOG_LEVEL=debug` para ver detalhes de cada chamada à Meta API e à Anthropic API.
- **`GET /admin/estatisticas?contaId=<id>`**: visão geral — totais de anomalias/investigações/
  notificações, atividade dos últimos 7 dias e custo de IA dos últimos 30 dias.
- **`GET /admin/anomalias?contaId=&status=&limite=`**: lista anomalias por `statusProcessamento`
  (`detectada`, `triada`, `investigada`, `notificada`, `ignorada`).
- **`GET /admin/investigacoes/:id`**: detalhe completo de uma investigação — `diagnostico`,
  `recomendacao`, `toolsChamadas` (com duração de cada chamada), `iteracoes`, `custoTokensUsd`,
  `decidiuNotificar`/`motivoNaoNotificar`.
- **`GET /admin/notificacoes?contaId=&status=&limite=`**: histórico de notificações enviadas
  (verifique `status` para falhas de envio).
- **Feedback e sensibilidade**: `GET /admin/feedback/sugestoes-sensibilidade?contaId=&dias=` mostra
  sugestões de ajuste de sensibilidade por entidade com base nas respostas de feedback recebidas
  (`útil`/`ruído`/`snooze`); `POST .../aplicar` aplica a sugestão.
- **Custo travado (`ErroLimiteCustoExcedido`, HTTP 429)**: significa que `Investigacao` +
  `Relatorio` criados hoje já somam `>= configuracoes.limiteCustoDiarioUsd`. Aguarde o próximo dia
  ou aumente o limite na conta.
- **Nada está sendo detectado**: confirme que existem linhas em `baselines` (Postgres) para as
  entidades esperadas — sem baseline, a métrica é ignorada na detecção
  (`MINIMO_OBSERVACOES_BASELINE` em `src/config/thresholds-padrao.js`).

---

## 4. Ideias para V2

- **Agente com permissão de ação**: hoje o agente só recomenda; uma evolução natural é permitir que,
  com confirmação humana (via resposta no WhatsApp), ele execute ações na Meta API — pausar um anúncio,
  ajustar orçamento, etc. (exigiria `ads_management` e novas tools de escrita, com salvaguardas extras).
- **Dashboard web**: interface visual sobre a API admin existente (`/admin/*`) — gráficos de
  métricas/baselines, timeline de anomalias e investigações, configuração de entidades sem precisar
  de `curl`.
- **Auto-tuning de sensibilidade via ML**: o loop de feedback já registra `útil`/`ruído` por
  entidade+métrica; um passo natural é treinar um modelo simples (ou heurística mais sofisticada)
  que ajuste `sensibilidadeCustom` automaticamente com base em padrões históricos, além das
  sugestões manuais atuais.
- **Tool `buscar_eventos_meta` com busca real**: hoje essa tool pode depender de fontes limitadas;
  integrar uma API de busca (ex: Brave Search) permitiria ao agente correlacionar anomalias com
  eventos externos (feriados, mudanças de política da Meta, notícias do setor).
- **Multi-tenant ativo**: o schema já suporta múltiplas `Conta`s (`contaId` em tudo); falta apenas
  ativar o fluxo de onboarding (`POST /admin/contas` + `configurar-conta` parametrizado) para rodar
  várias contas na mesma instância, com `CONTA_ID` deixando de ser "a" conta e passando a ser só a
  conta padrão dos scripts.
- **Canais de notificação adicionais**: `notificacao.canalPrimario` já é um enum (`whatsapp`,
  `email`, `telegram`) no schema — implementar os outros enviadores seguindo o padrão de
  `enviador-whatsapp.servico.js`.
