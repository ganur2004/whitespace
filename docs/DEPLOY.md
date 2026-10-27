# Деплой Whitespace

Основной вариант — AWS: стек на CDK в `infra/`, по образцу SafeZone. Тот же сервер собирается и в Docker-образ для любого другого хостинга. Демо должно работать до **16 ноября 2026, 23:45 ET** (конец оценки, SPEC раздел 13.3).

## AWS

```
CloudFront              один адрес: /api/* и /health → Lambda, остальное → S3
S3, приватный (OAC)     собранный web/dist
Lambda + Function URL   API на Hono, режим RESPONSE_STREAM для SSE
S3, приватный           сохранённый кэш ответов Qloo
Secrets Manager         ключи Qloo и Anthropic; секрет заголовка между CloudFront и Lambda
CloudWatch Logs         хранение месяц
AWS Budgets             по желанию: письмо при 80 % месячного лимита
```

Чем отличается от SafeZone и почему:

- **Один адрес для сайта и API.** Браузер ходит на домен CloudFront и за страницей, и за `/api/*`, поэтому CORS не нужен и адрес API не надо передавать фронтенду.
- **SSE через Lambda.** Function URL в режиме `RESPONSE_STREAM`, вход `api/src/lambda.ts` через `streamHandle` из `@hono/aws-lambda`. Для `/api/*` и `/health` в CloudFront выключены кэш и сжатие: сжатие копит поток и шаги анализа пришли бы разом в конце.
- **Кэш Qloo в S3.** Диска между вызовами у Lambda нет, поэтому сохранённый кэш (`ResponseStore`) пишется в бакет (`api/src/qloo/s3-store.ts`, переменная `QLOO_CACHE_BUCKET`). LRU в памяти остаётся у каждого экземпляра Lambda. Политика «устаревшее лучше ошибки» работает как раньше: кэш переживает холодные старты и новые деплои.
- **Function URL отвечает только CloudFront.** Сам URL публичный: доступ через OAC требует подписывать тело POST, а браузер этого не делает. Поэтому CloudFront добавляет заголовок `x-origin-secret` со значением из Secrets Manager, а API без него отвечает 403. IP клиента для лимитов берётся из `CloudFront-Viewer-Address`; другие заголовки, которыми можно подменить IP, CloudFront до API не пропускает.
- **Регион `ap-southeast-2`.** AWS закрепил этот аккаунт за Сиднеем (подробности в `docs/DEPLOY.md` SafeZone). Судьи в США, так что первый анализ идёт на 1–2 секунды дольше: запросы к Qloo пересекают океан. Ответы из кэша это почти не замедляет. Другой регион: `-c region=...`.

### Перед первым деплоем

1. Войти в AWS и проверить аккаунт:

   ```bash
   aws login
   ```

   ```bash
   aws sts get-caller-identity
   ```

2. CDK bootstrap нужен один раз на аккаунт и регион. Для `ap-southeast-2` он уже сделан при деплое SafeZone (стек `CDKToolkit`). В новом регионе:

   ```bash
   npx --workspace @whitespace/infra cdk bootstrap aws://<account-id>/ap-southeast-2
   ```

3. Положить ключи в Secrets Manager одним секретом JSON с полями `QLOO_API_KEY` и `ANTHROPIC_API_KEY`. Команда берёт значения из `.env`, так что ключи не попадают ни в историю команд, ни в репозиторий:

   ```bash
   aws secretsmanager create-secret --region ap-southeast-2 --name whitespace/keys --secret-string "$(node -e "process.loadEnvFile('.env'); const { QLOO_API_KEY, ANTHROPIC_API_KEY } = process.env; console.log(JSON.stringify({ QLOO_API_KEY, ANTHROPIC_API_KEY }))")"
   ```

   Оба поля обязательны: без них деплой упадёт на чтении секрета. CloudFormation подставляет значения при деплое, в шаблоне только ссылки на секрет. Сменить ключ: `aws secretsmanager put-secret-value` с тем же `--secret-string`, затем снова деплой.

### Деплой

```bash
npm run deploy -- -c keysSecret=whitespace/keys
```

Скрипт собирает все пакеты (стеку нужны `web/dist` и `shared/dist`) и запускает `cdk deploy`. В конце CDK печатает адрес:

```
Whitespace.SiteUrl = https://d111111abcdef8.cloudfront.net
```

| Контекст `-c` | По умолчанию | Что делает |
|---|---|---|
| `keysSecret` | — | Имя секрета с `QLOO_API_KEY` и `ANTHROPIC_API_KEY` |
| `demoMode` | `true` без `keysSecret`, иначе `false` | `true` — демо-данные без запросов к Qloo |
| `anthropicModel` | модель по умолчанию из `api/src/config.ts` | Значение `ANTHROPIC_MODEL_ID` |
| `region` | `ap-southeast-2` | Регион стека |
| `budgetEmail` | — | Адрес для письма о расходах; без адреса бюджета нет |
| `budgetLimit` | `20` | Месячный лимит в долларах, письмо при 80 % |
| `stackName` | `Whitespace` | Имя стека, чтобы поднять вторую копию рядом |

Посмотреть изменения до деплоя: `npm run diff --workspace @whitespace/infra -- -c keysSecret=whitespace/keys`.

### Стоимость

Lambda, CloudFront и S3 при трафике хакатона стоят центы. Secrets Manager — 0,40 $ в месяц за каждый из двух секретов. LLM оплачивается по ключу Anthropic, запросы к Qloo тратят его квоту. Бюджетное письмо включается через `-c budgetEmail=...`.

### Удалить

```bash
npm run destroy --workspace @whitespace/infra
```

Бакеты очищаются сами, вместе с ними пропадает кэш Qloo. Остаётся только секрет `whitespace/keys`, созданный вручную.

### Ограничения

- **Лимиты по IP и ограничитель запросов к Qloo живут в памяти каждого экземпляра Lambda.** При нескольких одновременных пользователях у каждого экземпляра свои счётчики. В сумме экземпляры могут превысить 5 запросов в секунду к Qloo; на `429` клиент делает паузу и повторяет запрос.
- **Холодный старт** около секунды после простоя. LRU в памяти при этом теряется, сохранённый кэш в S3 остаётся.
- **CDK на Windows передаёт баннер esbuild одной строкой через `cmd`.** Поэтому баннер с `createRequire` в `infra/lib/whitespace-stack.ts` собран без перевода строки. Иначе вторая строка теряется и бандл падает при загрузке с `Dynamic require of "node:https" is not supported`.

## Контейнер

Для любого хостинга, который запускает Docker-образ: API на Hono отдаёт и `/api/*`, и собранный фронтенд.

- В образе `api/dist`, `shared/dist`, `web/dist` и production-зависимости только `api` и `shared`.
- `api/fixtures` — синтетические данные для демо-режима.
- **Записанных ответов Qloo в образе нет**: `api/recordings` исключён в `.dockerignore`. Кэш реальных ответов живёт на томе хостинга (`/data/qloo`). Это приватный серверный кэш, условия Qloo его разрешают.
- Процесс работает от пользователя `node`, слушает `PORT` (по умолчанию 8080).
- Хостинг не должен засыпать: холодный старт до минуты и потерянный кэш, а судьи могут открыть демо в любой момент до 16 ноября.

Проверить локально:

```bash
npm run docker:build
```

```bash
docker run --rm -p 8090:8080 -e DEMO_MODE=true whitespace
```

```bash
npm run smoke -- http://localhost:8090
```

## Переменные окружения

В AWS их задаёт стек; в контейнере — секреты и настройки хостинга.

| Переменная | По умолчанию в образе | Что это |
|---|---|---|
| `QLOO_API_KEY` | — | Ключ Qloo, **только через секреты хостинга** |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Хакатонный ключ работает только здесь |
| `DEMO_MODE` | `false` | `true` — без запросов к Qloo, из записей и синтетики, с плашкой «Demo data» |
| `QLOO_CACHE_DIR` | `/data/qloo` | Кэш ответов Qloo на диске, сюда монтируется том |
| `QLOO_CACHE_BUCKET` | — | Бакет S3 для кэша вместо диска. Стек AWS задаёт его сам |
| `ORIGIN_SECRET` | — | Если задан, API отвечает только на запросы с этим значением в `x-origin-secret`. Стек AWS задаёт его сам |
| `PORT` | `8080` | Обычно задаёт сам хостинг |
| `TRUST_PROXY` | `true` | Брать IP клиента из `Fly-Client-IP`, `CF-Connecting-IP`, `CloudFront-Viewer-Address` или `X-Forwarded-For`. `false`, если перед сервером нет прокси |
| `SCOUT_LIMIT_BURST` | `8` | Сколько анализов подряд можно с одного IP |
| `SCOUT_LIMIT_PER_MINUTE` | `3` | Скорость восстановления лимита. Ответы целиком из кэша лимит не тратят |
| `PROFILE_LIMIT_BURST` | `20` | Сколько запросов профилей зон подряд с одного IP (ползунок и исключения) |
| `PROFILE_LIMIT_PER_MINUTE` | `10` | Скорость восстановления лимита профилей. Ответы из кэша не тратят |
| `CHAT_LIMIT_BURST` | `12` | Сколько сообщений в чат подряд с одного IP |
| `CHAT_LIMIT_PER_MINUTE` | `4` | Скорость восстановления лимита чата |
| `ANTHROPIC_API_KEY` | — | Ключ Anthropic API из Claude Console. Достаточно его одного, **только через секреты хостинга** |
| `ANTHROPIC_MODEL_ID` | `claude-sonnet-5-5` | Модель агента, брифов и разбора концепции в Anthropic API |
| `ANTHROPIC_FALLBACK_MODEL_ID` | `claude-opus-4-8` | Куда повторить запрос, если основная модель отказала (`stop_reason: refusal`). `none` — без повтора |
| `AWS_BEARER_TOKEN_BEDROCK` | — | Вместо Anthropic API: API-ключ Amazon Bedrock. Достаточно его одного, **только через секреты хостинга** |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | — | Вместо API-ключа: ключи IAM с доступом к Bedrock (`bedrock-mantle`). Подходят и `AWS_PROFILE` и роль контейнера |
| `AWS_REGION` | `us-east-1` | Регион Bedrock, где включён доступ к модели |
| `BEDROCK_MODEL_ID` | `anthropic.claude-opus-5-5` | Модель агента, брифов и разбора концепции |
| `BEDROCK_FALLBACK_MODEL_ID` | `anthropic.claude-opus-4-8` | Куда повторить запрос, если основная модель отказала (`stop_reason: refusal`). `none` — без повтора |
| `LLM_PROVIDER` | авто | Авто: Anthropic API, если задан `ANTHROPIC_API_KEY`, иначе Bedrock при наличии ключей AWS. `anthropic` или `bedrock` выбирают провайдера явно (`bedrock` работает и без явных ключей, через цепочку AWS по умолчанию), `none` выключает LLM |

## LLM

Агент, брифы зон и разбор концепции в якоря работают через Claude. Провайдеров два, код запросов у них общий (Messages API), различается только клиент:

- **Anthropic API** (основной): `@anthropic-ai/sdk`, ключ из Claude Console (API keys → Create key). Включается сам, как только задан `ANTHROPIC_API_KEY`. Расход списывается с организации, которой принадлежит ключ; лимиты запросов видны в Claude Console на странице Limits.
- **Amazon Bedrock**: `@anthropic-ai/bedrock-sdk`, клиент `AnthropicBedrockMantle`, эндпоинт `https://bedrock-mantle.<region>.api.aws/anthropic`. Включается сам при ключах AWS (`AWS_BEARER_TOKEN_BEDROCK` или пара `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, плюс `AWS_REGION`), если `ANTHROPIC_API_KEY` не задан. В AWS-аккаунте должен быть открыт доступ к модели из `BEDROCK_MODEL_ID` в выбранном регионе и ненулевая квота на инференс.

Общее для обоих:

- `/health` показывает `"llm": true`, когда провайдер настроен.
- Без ключей или при ошибке провайдера ничего не ломается: чат отвечает в «Basic mode» (шаблонные команды), концепция разбирается по ключевым словам, брифы — шаблонные или не пишутся. В логе строка `The agent failed; answering in basic mode. <причина>`.
- Проверка после деплоя: `curl <url>/health`, затем в интерфейсе написать в чат «Compare zone 1 and zone 2». Ответ без пометки «basic mode» значит, что LLM отвечает.

## После каждого деплоя

1. Прогреть кэш готовых сценариев:

   ```bash
   npm run warm -- https://<адрес демо>
   ```

2. Проверить, что всё живо:

   ```bash
   npm run smoke -- https://<адрес демо>
   ```

3. Один раз после первого деплоя: в репозитории на GitHub завести переменную `DEMO_URL` (Settings → Secrets and variables → Actions → Variables). Тогда workflow `Uptime` будет прогонять smoke-тест каждые 4 часа и пришлёт письмо, если демо упало.

## До 16 ноября

- Раз в день смотреть результаты `Uptime` в GitHub Actions.
- Не выкатывать рискованные изменения во время оценки.
- Следить за квотой Qloo (если мало — просить в Discord `#api-help`), квотой LLM и счётом AWS.
- Если Qloo недоступен, сервер сам отдаёт последний сохранённый ответ с датой (`cached: true` в Trace). Если и кэша нет, можно временно включить демо-режим: в AWS — деплой с `-c demoMode=true`, в контейнере — `DEMO_MODE=true`. Плашка честно покажет, что данные демонстрационные.
