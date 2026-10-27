# Деплой Whitespace

Один контейнер: API на Hono отдаёт и `/api/*`, и собранный фронтенд. Демо должно работать без засыпания до **16 ноября 2026, 23:45 ET** (конец оценки, SPEC раздел 13.3).

## Что внутри образа

- `api/dist`, `shared/dist`, `web/dist` и production-зависимости только `api` и `shared`.
- `api/fixtures` — синтетические данные для демо-режима.
- **Записанных ответов Qloo в образе нет**: `api/recordings` исключён в `.dockerignore`. Кэш реальных ответов живёт на томе хостинга (`/data/qloo`), это приватный серверный кэш, условия Qloo его разрешают.
- Процесс работает от пользователя `node`, слушает `PORT` (по умолчанию 8080).

## Переменные окружения

| Переменная | По умолчанию в образе | Что это |
|---|---|---|
| `QLOO_API_KEY` | — | Ключ Qloo, **только через секреты хостинга** |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Хакатонный ключ работает только здесь |
| `DEMO_MODE` | `false` | `true` — без запросов к Qloo, из записей и синтетики, с плашкой «Demo data» |
| `QLOO_CACHE_DIR` | `/data/qloo` | Кэш ответов Qloo, сюда монтируется том |
| `PORT` | `8080` | Обычно задаёт сам хостинг |
| `TRUST_PROXY` | `true` | Брать IP клиента из `Fly-Client-IP` / `X-Forwarded-For`. `false`, если перед сервером нет прокси |
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

## Проверить локально

```bash
npm run docker:build
```

```bash
docker run --rm -p 8090:8080 -e DEMO_MODE=true whitespace
```

```bash
npm run smoke -- http://localhost:8090
```

## Где разместить

Бесплатные тарифы, которые засыпают, не подходят: холодный старт до минуты и потерянный кэш, а судьи могут открыть демо в любой момент до 16 ноября.

| Вариант | Плюсы | Минусы |
|---|---|---|
| **Fly.io** (рекомендую) | Машина не засыпает при `min_machines_running = 1`, том для кэша, регион в США (`iad` или `dfw`), деплой одной командой `fly deploy`. Примерно 3–5 $ в месяц за shared-cpu-1x с 512 МБ и том на 1 ГБ | Нужна карта для аккаунта |
| Render, тариф Starter | Деплой из GitHub без CLI | Около 7 $ в месяц плюс диск отдельно |
| AWS (опыт SafeZone) | Знакомый аккаунт | Lambda не подходит без переделки: нужен response streaming для SSE и S3 вместо диска. App Runner или Lightsail Containers — больше настройки |

Конфиг под выбранную платформу (`fly.toml` или `render.yaml`) добавим, когда выберем.

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
- Следить за квотой Qloo (если мало — просить в Discord `#api-help`), квотой LLM и счётом хостинга.
- Если Qloo недоступен, сервер сам отдаёт последний сохранённый ответ с датой (`cached: true` в Trace). Если и кэша нет — можно временно включить `DEMO_MODE=true`, плашка честно покажет, что данные демонстрационные.
