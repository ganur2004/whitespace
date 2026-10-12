# Qloo API: заметки

Выписка из документации Qloo (https://docs.qloo.com), прочитана 12 октября 2026 в браузере: сайт не отдаёт страницы автоматическим инструментам. Раздел «Проверено на S0» заполняется живыми запросами. Реальные ответы API сюда не вставлять: условия Qloo запрещают хранить их в публичном репозитории. Сырые ответы — только в `api/recordings/` (в `.gitignore`).

## Доступ

- Базовый адрес только `https://hackathon.api.qloo.com`. Staging и production с хакатонным ключом дают `401`.
- Заголовок `X-Api-Key: <key>`. Не `Authorization: Bearer`, не параметр запроса.
- Ключ выдают вручную через Google Form, обычно за несколько рабочих дней, часто попадает в спам. Если долго нет, форму можно отправить повторно.
- Ключ действует до конца оценки, затем отключается.
- Лимиты частоты и месячная квота «достаточны для типичного проекта», поднимаются по запросу в Discord, `#api-help`. Превышение: `429`.
- Приватный кэш на сервере разрешён без ограничения по времени. Хранить ответы в публичном репозитории нельзя.

## Ошибки и ловушки

| Симптом | Причина |
|---|---|
| `401` | Не тот базовый адрес или ключ не в `X-Api-Key` |
| `404`, «No path matching request parameters» | Нет пути после базового адреса или POST вместо GET |
| `403 You do not have permission to access urn:entity:...` | Тип сущности не поддерживается (например, `urn:entity:music` вместо `urn:entity:artist`) |
| «at least one valid signal or filter is required» | Свободные строки вместо ID тегов или аудиторий |
| `200` и пустой `entities` | Параметр не подходит для этого `filter.type` и **молча проигнорирован**, или нет данных |
| `400` при `filter.location.query` | Локальность не найдена |

- `/v2/insights` — только GET, все параметры в строке запроса.
- `/recommendations` и `/recs` — легаси, не поддерживаются.
- `/search` и `/v2/insights` — разные эндпоинты. `/v2/insights/search` не существует.
- Ответ нельзя сократить: приходят все поля, включая объёмные `akas`.

## Эндпоинты

### `GET /search`

| Параметр | Значение |
|---|---|
| `query` | Текст поиска |
| `types` | Типы для поиска. Отличаются от `filter.type` в insights; легаси-типы только для поиска: `urn:entity:actor`, `album`, `author`, `director`, `locality` |
| `filter.location` | `lat,lon`, WKT или UUID сущности |
| `filter.radius` | Радиус в **милях**, 0–100, по умолчанию 10 |
| `filter.tags`, `operator.filter.tags` | Теги, `union` (по умолчанию) или `intersection` |
| `filter.popularity` | Минимальная популярность 0–1 |
| `filter.address` | Частичное совпадение адреса |
| `sort_by` | `match` (по умолчанию), `distance`, `popularity` |
| `page`, `take` | Пагинация, `page` 1–100 |

### `GET /v2/tags`

| Параметр | Значение |
|---|---|
| `filter.query` | Частичный поиск по названию тега |
| `filter.tag.types` | Типы тегов, точное совпадение. Список типов — через Get Tag Types |
| `filter.parents.types` | Родительские типы |
| `feature.typo_tolerance` | Терпимость к опечаткам |
| `feature.semantic_search` | Семантический поиск, бета |
| `filter.results.tags` | Ограничить выдачу заданными тегами |
| `take`, `page` | `take` 1–50, по умолчанию 20 |

Статичного списка тегов нет.

### `GET /v2/insights` — общее

- `filter.type`: `urn:entity:artist`, `book`, `brand`, `destination`, `movie`, `person`, `place`, `podcast`, `tv_show`, `video_game` (в Deep Dive — `videogame`), `locality`, а также `urn:heatmap`, `urn:tag`, `urn:demographics`.
- `take` 1–50 (по умолчанию 20), `page` 1–100, `offset`.
- `signal.interests.entities` — ID через запятую. `signal.interests.entities.weight`.
- `signal.interests.tags` — ID тегов через запятую. `operator.signal.interests.tags`, `signal.interests.tags.weight`.
- `signal.demographics.age` (`24_and_younger`, `25_to_29`, `30_to_34`, `35_to_44`, `45_to_54`, `55_and_older`, а также `35_and_younger`, `36_to_55`), `signal.demographics.gender` (`male`, `female`), `signal.demographics.audiences`, и у каждого `.weight`.
- `bias.trends`: `off` … `very_high`, **по умолчанию `medium`**.
- `filter.results.entities` — ограничить выдачу заданными ID: так получают совпадение конкретных сущностей с сигналом.
- `filter.exclude.entities`, `filter.tags`, `operator.filter.tags`, `filter.exclude.tags`, `filter.popularity.min/max`.
- `backfill.cross_domain.take` (по умолчанию 20, максимум 20) и `backfill.content_based.take` (по умолчанию 10) — запасные результаты, если основных мало. Выдачу дофильтровываем у себя.
- `diversify.by` (`properties.geocode.city`, `properties.geocode.metro`), `diversify.take`.

### Локация

| Параметр | Значение |
|---|---|
| `filter.location` | `lat,lon`, WKT (`POINT`, `POLYGON`, `MULTIPOLYGON`, долгота первой) или UUID локальности |
| `filter.location.query` | Нечёткий поиск локальности по названию. Не найдена — `400` |
| `filter.location.radius` | Метры, до 800 000, по умолчанию 15 000. Для локальности без радиуса граница расширяется на меньшее из 10% диаметра и 2 414 м. `0` — строго внутри границы |
| `filter.exclude.location`, `filter.exclude.location.query`, `filter.exclude.location.radius` | Исключить область |
| `filter.location.geohash` | Места, чей geohash (pygeohash, 12 символов) начинается с префикса |
| `filter.exclude.location.geohash` | Исключить места по префиксу geohash |
| `filter.geocode.name`, `admin1_region`, `admin2_region`, `country_code`, `filter.location.metro` | Точное совпадение города, штата, округа, страны, агломерации |
| `signal.location` | WKT `POINT` или `POLYGON`, либо ID локальности. Для не-мест |
| `signal.location.query` | Название локальности для сигнала |
| `signal.location.radius` | Только для `POINT`; документация советует не задавать |
| `signal.location.weight` | Сила влияния локации |

Для артистов, брендов и других не-мест `filter.location` даёт 200 и ноль результатов (по чужим репозиториям). Для них — `signal.location`.

### Тепловая карта: `filter.type=urn:heatmap`

Параметры по Entity Type Parameter Guide: `filter.location`, `filter.location.query`, `filter.location.radius`, `signal.interests.entities`, `signal.interests.tags`, `signal.demographics.age`, `signal.demographics.gender`, `signal.demographics.audiences`, `output.heatmap.boundary`, `heatmap.dimensions`, `filter.dimensions.price_level`, `filter.dimensions.hotel_class`, `take`. Страница Heatmap Insights добавляет `bias.trends`.

Структура ответа (по примеру из документации):

```
success: boolean
results.heatmap[]:
  location.latitude: number
  location.longitude: number
  location.geohash: string
  query.affinity: number        0–1, процентиль по ячейкам (в примере шаг 1/N)
  query.affinity_rank: number   0–1, ранговая нормализация affinity
  query.popularity: number      0–1, распространённость сигнала в ячейке
query.localities.filter:
  entity_id: string             UUID распознанной локальности
  name: string
  subtype: "urn:entity:locality"
  location.lat, location.lng    в примере перепутаны: lat = долгота, lng = широта
  disambiguation: string
duration: number
```

- Возвращаются все ячейки области, `take` и `page` игнорируются.
- Точность geohash зависит от размера области: для «NYC» в примере geohash-6.
- `output.heatmap.boundary`: по умолчанию geohash, ещё город или район (`urn:entity:locality`).
- `heatmap.dimensions` (`quality`, `popularity`, `hotel_class`, `price_level`) работает только с `output.heatmap.boundary=urn:geohash`. Добавляет `<dim>_affinity` и `<dim>_affinity_rank`, **но влияет и на общий рейтинг `query.affinity`**.
- `filter.dimensions.price_level=[…]`: доля мест выбранных ценовых уровней в ячейке. Добавляет `price_level_count_affinity` и `price_level_count_affinity_rank`. Требует `price_level` в `heatmap.dimensions`.
- В примере сигнал — тег (`urn:tag:genre:media:non_fiction`). По чужим репозиториям сигнал только из тегов кухни даёт 0 ячеек.

### Места: `filter.type=urn:entity:place`

Параметры по Entity Type Parameter Guide (без `signal.location` и `filter.location.query`):
`bias.trends`, `bias.quality`, `filter.address`, `filter.exclude.entities`, `filter.exclude.tags`, `filter.external.exists`, `filter.external.tripadvisor.rating.*`, `filter.geocode.*`, `filter.hotel_class.*`, `filter.hours`, `filter.location`, `filter.location.geohash`, `filter.exclude.location.geohash`, `filter.location.radius`, `filter.parents.types`, `filter.popularity.*`, `filter.price_level.min/max` (1–4), `filter.price_range.*`, `filter.properties.business_rating.*`, `filter.properties.resy.rating.*`, `filter.references_brand`, `filter.results.entities`, `filter.results.entities.query`, `filter.resy.*`, `filter.tags`, `operator.filter.tags`, `offset`, `signal.demographics.*`, `signal.interests.entities`, `signal.interests.tags`, `sort_by` (`affinity`, `distance`, `rating`, `quality`), `take`.

Пример ответа для мест в документации не приведён: пути к координатам, `neighborhood`, тегам и полю совпадения проверить на S0.

### Объяснения: `feature.explainability=true`

- У каждого результата `query.explainability`: какие входные сущности-сигналы повлияли на рекомендацию, оценки 0–1. Сущности с оценкой от 0.1 всегда включены, менее значимые могут быть опущены.
- На верхнем уровне `query.explainability` — среднее влияние каждой входной сущности по подмножествам выдачи (топ-3, 5, 10, все).
- Если посчитать не удалось, `query.explainability.warning`, результаты остаются.
- Это объяснение через якоря, а не через теги.

### Taste analysis: `filter.type=urn:tag`

- Сигналы: `signal.interests.entities`, `signal.interests.tags`, `signal.demographics.audiences`, `signal.location`, `signal.location.query`.
- Фильтры: `filter.tag.types`, `filter.parents.types`. Также `diversify.by=subtype`, `diversify.take`, `take`, `offset`.
- Ответ: `results.tags[]` с `tag_id`, `name`, `types`, `subtype`, `tag_value`, `query`.

### Демография: `filter.type=urn:demographics`

- Сигнал: `signal.interests.entities` и/или `signal.interests.tags`.
- Ответ: `results.demographics[]`, у каждой входной сущности `entity_id`, `query.age` (`24_and_younger` … `55_and_older`) и `query.gender` (`male`, `female`). Значения от −1 до 1: больше нуля — выше среднего.

### `GET /v2/analysis/compare`

- `a.signal.interests.entities`, `b.signal.interests.entities` (обязательные), `filter.type`, `filter.subtype` (`urn:tag:genre`, `urn:tag:occupation`), `model` (`descriptive`, `predictive`), `filter.location.query`, `filter.location.radius`, `take`, `page`, `offset`.
- Формат ответа в документации не приведён.

## Пробелы в документации

- Entity Type Parameter Guide не упоминает `signal.location`, `feature.explainability` и `filter.location.query` для мест, хотя другие страницы ими пользуются. Раз неподходящие параметры молча игнорируются, каждый проверяем сравнением ответа с параметром и без.
- Пример `curl` в документации обращается к `https://api.qloo.com/v2/insights/`. Для хакатона заменить на `https://hackathon.api.qloo.com/v2/insights`.

## Шаблоны запросов для S0

```bash
export QLOO_API_KEY=...
export Q=https://hackathon.api.qloo.com
```

```bash
curl -sG "$Q/search" -H "X-Api-Key: $QLOO_API_KEY" --data-urlencode "query=Ramen Tatsu-Ya" --data-urlencode "types=urn:entity:place" --data-urlencode "filter.location=30.2672,-97.7431" -o api/recordings/search-tatsuya.json
```

```bash
curl -sG "$Q/v2/tags" -H "X-Api-Key: $QLOO_API_KEY" --data-urlencode "filter.query=ramen" --data-urlencode "feature.typo_tolerance=true" -o api/recordings/tags-ramen.json
```

```bash
curl -sG "$Q/v2/insights" -H "X-Api-Key: $QLOO_API_KEY" --data-urlencode "filter.type=urn:heatmap" --data-urlencode "filter.location.query=Austin" --data-urlencode "signal.interests.entities=<ID1>,<ID2>,<ID3>" -o api/recordings/heatmap-austin-ramen.json
```

```bash
curl -sG "$Q/v2/insights" -H "X-Api-Key: $QLOO_API_KEY" --data-urlencode "filter.type=urn:entity:place" --data-urlencode "filter.location=<LOCALITY_ID>" --data-urlencode "filter.tags=<RAMEN_TAG_ID>" --data-urlencode "take=50" --data-urlencode "page=1" -o api/recordings/places-austin-ramen-p1.json
```

```bash
curl -sG "$Q/v2/insights" -H "X-Api-Key: $QLOO_API_KEY" --data-urlencode "filter.type=urn:entity:place" --data-urlencode "filter.results.entities=<PLACE_IDS>" --data-urlencode "signal.interests.entities=<ID1>,<ID2>,<ID3>" --data-urlencode "feature.explainability=true" --data-urlencode "take=50" -o api/recordings/places-austin-affinity.json
```

```bash
curl -sG "$Q/v2/insights" -H "X-Api-Key: $QLOO_API_KEY" --data-urlencode "filter.type=urn:heatmap" --data-urlencode "filter.location.query=Austin" --data-urlencode "signal.interests.entities=<ID1>,<ID2>,<ID3>" --data-urlencode "output.heatmap.boundary=urn:entity:locality" -o api/recordings/heatmap-austin-localities.json
```

```bash
curl -sG "$Q/v2/insights" -H "X-Api-Key: $QLOO_API_KEY" --data-urlencode "filter.type=urn:demographics" --data-urlencode "signal.interests.entities=<ID1>,<ID2>,<ID3>" -o api/recordings/demographics-ramen.json
```

## Проверено на S0

Заполнить по итогам S0: пути к полям мест, поле совпадения, лимиты, решения по экспериментам E1–E7, список городов с `localityId`.

### Предварительный формат мест

Пока формат не проверен, `parsePlaces` в `api/src/qloo/types.ts` и синтетический `api/fixtures/places.json` используют такие пути. На S0 сверить с живым ответом и поправить оба места:

| Что | Путь сейчас |
|---|---|
| Список мест | `results.entities[]` |
| ID и название | `entity_id`, `name` |
| Координаты | `location.lat`, `location.lon` (без них место пропускается) |
| Район | `properties.neighborhood` |
| Ценовой уровень | `properties.price_level` |
| Теги | `tags[].id` или `tags[].tag_id` |
| Совпадение со вкусом | `query.affinity` |
| Объяснение | любые массивы `{ entity_id, score }` внутри `query.explainability` |

Демо-сценарий в `shared/src/scenarios.ts` пока использует синтетические ID якорей и тега. После S0 заменить их на реальные ID из `/search` и `/v2/tags`.
