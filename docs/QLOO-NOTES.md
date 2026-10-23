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

## Проверено на S0 (13 октября 2026)

Живые запросы к `hackathon.api.qloo.com`, около 30 запросов на разведку. Сырые ответы лежат локально в `api/recordings/s0/` и в git не попадают.

### Лимиты

- Заголовки ответа: `x-second-ratelimit-limit: 5`, **`x-month-ratelimit-limit: 10000`**, плюс `-remaining` и `-reset`.
- То есть **5 запросов в секунду и 10 000 в месяц.** Клиент держит 4 запроса в секунду. Анализ одного города — 3–5 запросов, повторы берутся из кэша на диске. Если квоты станет мало, просить в Discord `#api-help`.

### Тепловая карта

- `results.heatmap[]`: `location.{latitude, longitude, geohash}` и `query.affinity`, `affinity_rank`, `popularity`, плюс **разбивка по типам якорей**: `entity_place_affinity`, `entity_brand_affinity`, `entity_artist_affinity` и их `_rank` (могут быть `null`, если якорей такого типа нет).
- `affinity` — равномерный процентиль от 0 до 1.
- **`query.localities.filter` — массив**, а не объект, как в документации. Внутри `location: { lat, lon }` в правильном порядке (в документации было `{ lat, lng }` и перепутано). При запросе по ID локальности `query.localities` нет вовсе.
- Запрос по ID локальности (`filter.location=<UUID>`) даёт ровно ту же карту, что и по названию.
- Остин — 1653 ячейки, Бруклин — 2166, Чикаго — 2574–2755 (зависит от якорей). Везде geohash-7. Ответ 0.4–1 МБ, 2–3 с.
- `output.heatmap.boundary=urn:entity:locality` отвечает `500 System Error` (E7 недоступен).

### Места

| Что | Путь |
|---|---|
| Список | `results.entities[]` в insights, `results[]` в `/search` |
| ID, название | `entity_id`, `name` |
| Координаты | `location.lat`, `location.lon` (+ `geohash` из 12 символов) |
| Район | `properties.neighborhood`, **часто `null`**; запасной вариант `properties.geocode.name`, если он не равен городу |
| Ценовой уровень | `properties.price_level` (1–4) |
| Жанр | `properties.primary_genre.id`, например `urn:tag:genre:place:restaurant:ramen` |
| Теги | `tags[]`: в insights поле `id`, в `/search` — `tag_id`; у каждого есть `type`. Около 150 тегов на место, `parsePlaces` оставляет около 50 полезных типов |
| Совпадение со вкусом | `query.affinity`, только когда есть сигнал |
| Объяснение | `query.explainability["signal.interests.entities"] = [{ entity_id, score }]`; сводка по выдаче — `query.explainability["signal.interests.entities"].effect_on_top3_recs` и т. п. |

- Без сигнала у места в `query` только `distance` и `measurements`.
- Пагинация работает (`take` + `page`). `offset` за пределами выдачи даёт пустой ответ.
- Рамен-мест (`urn:tag:genre:place:restaurant:ramen`) в границах локальности: Остин 20, Бруклин 59, Чикаго 41.
- `filter.results.entities` + сигнал возвращают совпадение для заданных мест, но **якоря-места в выдачу не попадают** (17 из 20 в Остине). Такие конкуренты получают полный вес.
- Совпадение конкурентов узкое, 0.80–0.95, поэтому вес `0.5 + 0.5·affinity` различает их слабо. Оставили формулу как есть: это честная оценка.
- Запрос по WKT-полигону (`filter.location=POLYGON((…))`) работает, это основа профиля зоны.

### Другие эндпоинты

- `/v2/tags?filter.query=ramen`: `results.tags[]` с `id`, `name`, `type`, `popularity`. Для конкурентов берём `urn:tag:genre:place:restaurant:ramen` (есть и `urn:tag:category:place:ramen_restaurant`, даёт тех же 20).
- `urn:demographics`: `results.demographics[]` **по каждому якорю отдельно**, для портрета концепции значения надо усреднять.
- `urn:tag` + `signal.location=<полигон>` + якоря работает, но теги получаются общие («Bar», «Chicken Wings»).

### Решения по экспериментам

| | Результат | Решение |
|---|---|---|
| E1 | Карты рамен-бара и семейного кафе в Остине: Спирмен 0.51, лучшие 5% совпадают на 10% | Карта различает концепции, режим `lift` не нужен |
| E2 | Местные якоря против якорей из других городов: Спирмен 0.97, вокруг Ramen Tatsu-Ya 0.90 против 0.84 | Карта на якорях не замыкается, местные якоря остаются в сигнале |
| E3 | Все конкуренты одним-двумя запросами, совпадение через `filter.results.entities` | Как в шаге 5 |
| E4 | Бруклин и Чикаго — geohash-7 | Адаптивный радиус DBSCAN остаётся страховкой |
| E5 | 5 в секунду, 10 000 в месяц | Ограничитель 4 в секунду, кэш, лимит по IP |
| E6 | Bedrock через `AnthropicBedrockMantle`; ключа пока нет | Без ключа чат в «Basic mode», концепция по ключевым словам |
| E7 | `500 System Error` | Районы — из мест; исключение района — оболочка его мест |

### Что поменялось в модели после живых данных

- **Сглаживание тепловой карты.** Живая карта рябит, а у аэропорта Остина почти 1.0 по всем типам якорей — туда ходят все. Конвейер сглаживает `affinity` по ячейке и восьми соседям (гаусс, σ = размер ячейки, отсутствующие соседи считаются нулём) и снова переводит в процентиль (`smoothCells`). Одиночные всплески вроде аэропорта ушли из зон, районы стали цельными.

### Города

| Город | `localityId` | Якоря сценария |
|---|---|---|
| Austin, TX | `C93C0541-F43D-484E-AC86-E27A54E5B1D0` | Ramen Tatsu-Ya, Kitty Cohen's, Khruangbin, Lagunitas Brewing Company |
| Brooklyn, NY | `86BAEBAE-2980-43B6-9E75-2A5CDB898628` | Ivan Ramen, Khruangbin, Lagunitas, LP Vinyl Bar |
| Chicago, IL | `27748652-BB63-461D-9C65-207D06E18716` | RAMEN-SAN, Khruangbin, Lagunitas, LP Vinyl Bar |
