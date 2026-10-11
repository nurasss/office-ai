# ФАЗА 0 — Фундамент: монорепо, БД, тенанты, auth, CRUD

> Читать вместе с `00-MASTER.md`. Всё, что там написано, обязательно и здесь.

**Цель фазы:** получить работающий скелет системы, на который можно навешивать всё
остальное: монорепо собирается, БД мигрирует, пользователь регистрируется, создаёт
организацию → компанию → отделы → агентов, и всё это изолировано между тенантами.

**Чего в этой фазе НЕТ:** ни одного вызова LLM. Ни одной очереди. Ни одного агента,
который что-то делает. Только данные и их защита.

---

## 1. Результат фазы (что должно работать руками)

```bash
docker compose up -d          # postgres, redis, minio
pnpm install
pnpm db:migrate
pnpm dev:api                  # Fastify на :3001

# и дальше через curl:
POST /v1/auth/register        -> создаёт user + organization
POST /v1/auth/login           -> access + refresh токены
POST /v1/companies            -> компания
POST /v1/departments          -> отдел
POST /v1/agents               -> агент
GET  /v1/companies/:id/org-chart -> дерево компании
```

---

## 2. Задача 0.1 — Каркас монорепозитория

### Создать файлы

**`package.json`** (корень):

```json
{
  "name": "ai-company",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "dev:api": "pnpm --filter @ai-company/api dev",
    "db:generate": "pnpm --filter @ai-company/db generate",
    "db:migrate": "pnpm --filter @ai-company/db migrate",
    "db:rollback": "pnpm --filter @ai-company/db rollback",
    "db:seed": "pnpm --filter @ai-company/db seed",
    "format": "prettier --write ."
  }
}
```

**`pnpm-workspace.yaml`**:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**`tsconfig.base.json`** — обязательные опции:

```
"target": "ES2023", "module": "NodeNext", "moduleResolution": "NodeNext",
"strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
"noImplicitOverride": true, "verbatimModuleSyntax": true,
"declaration": true, "declarationMap": true, "sourceMap": true,
"skipLibCheck": true, "isolatedModules": true
```

**`turbo.json`** — пайплайны `build` (dependsOn `^build`), `test`, `lint`, `typecheck`.

**`.env.example`** — все переменные из §3, с безопасными dev-значениями.

**`infrastructure/docker/docker-compose.yml`**:

- `postgres:16` с образом, поддерживающим pgvector (`pgvector/pgvector:pg16`), порт 5432,
  volume, healthcheck `pg_isready`.
- `redis:7-alpine`, порт 6379, healthcheck `redis-cli ping`.
- `minio/minio`, порты 9000/9001, healthcheck.
- Все сервисы в одной сети `ai-company`.

Корневой `docker-compose.yml` — симлинк/прокси на файл в `infrastructure/docker`, чтобы
работало `docker compose up` из корня.

### Каждый пакет

`packages/*/package.json` с именем `@ai-company/<name>`, полями
`"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`, `"exports"`,
скриптами `build` (`tsc -b`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

---

## 3. Задача 0.2 — `packages/shared`

Это фундамент. Всё остальное импортирует отсюда.

### `src/env.ts`

Zod-схема окружения. Парсится **один раз**, экспортируется `export const env = parseEnv()`.
Обязательные переменные:

```
NODE_ENV                 enum: development | test | production
LOG_LEVEL                enum: fatal|error|warn|info|debug|trace  (default: info)
API_PORT                 number (default 3001)
API_HOST                 string (default 0.0.0.0)
DATABASE_URL             string url
REDIS_URL                string url
S3_ENDPOINT              string url
S3_BUCKET                string
S3_ACCESS_KEY_ID         string
S3_SECRET_ACCESS_KEY     string
S3_REGION                string (default us-east-1)
JWT_ACCESS_SECRET        string, min 32
JWT_REFRESH_SECRET       string, min 32
JWT_ACCESS_TTL           string (default "15m")
JWT_REFRESH_TTL          string (default "30d")
ENCRYPTION_KEY           string, ровно 64 hex-символа (32 байта)
```

Поведение при ошибке: вывести список невалидных переменных и `process.exit(1)`.
**Нюанс:** в `NODE_ENV=test` допускать значения по умолчанию для секретов, чтобы тесты
не требовали внешнего `.env`.

### `src/errors.ts`

```ts
export class AppError extends Error {
  constructor(opts: {
    code: string
    httpStatus: number
    message: string
    details?: Record<string, unknown>
    retryable?: boolean
    cause?: unknown
  })
}
```

Готовые фабрики: `notFound(resource, id)`, `forbidden(reason)`, `unauthorized()`,
`validationError(issues)`, `conflict(code, message)`, `internal(cause)`,
`rateLimited(retryAfterSec)`.

Полный реестр кодов ошибок фазы (расширяется в следующих фазах):

```
VALIDATION_ERROR, UNAUTHORIZED, INVALID_CREDENTIALS, TOKEN_EXPIRED, TOKEN_INVALID,
FORBIDDEN, NOT_FOUND, CONFLICT, EMAIL_ALREADY_EXISTS, SLUG_ALREADY_EXISTS,
ORG_LIMIT_EXCEEDED, INTERNAL_ERROR, RATE_LIMITED
```

### `src/id.ts`

```ts
export interface IdGenerator {
  next(): string
} // uuid v7
export const realIdGenerator: IdGenerator
export function createFixedIdGenerator(ids: string[]): IdGenerator // для тестов
```

### `src/clock.ts`

```ts
export interface Clock {
  now(): Date
}
export const systemClock: Clock
export function createFixedClock(start: Date): Clock & { advance(ms: number): void }
```

### `src/money.ts`

Работа с USD без float. Внутреннее представление — **целое число микродолларов** (`bigint`).

```ts
export class Usd {
  static fromString(v: string): Usd // "1.234567" -> 1234567 micro
  static fromMicros(v: bigint): Usd
  static zero(): Usd
  add(o: Usd): Usd
  sub(o: Usd): Usd
  mulInt(n: number): Usd
  gt(o: Usd): boolean
  gte(o: Usd): boolean
  toString(): string // "1.234567", 6 знаков всегда
  toMicros(): bigint
}
```

**Нюанс:** округление всегда «вверх» (`ceil`) при расчёте стоимости — мы не должны
недооценивать расход. Функция `mulRate(tokens: number, pricePerMillion: string): Usd`
округляет вверх до микродоллара.

### `src/logger.ts`

Pino-логгер + `createChildLogger(bindings)`. Redaction path'ы обязательны:

```
req.headers.authorization, req.headers.cookie, *.apiKey, *.password,
*.secret, *.token, *.accessToken, *.refreshToken
```

### `src/context.ts`

```ts
export interface RequestContext {
  requestId: string
  orgId: string
  userId: string
  role: OrgRole // 'owner' | 'admin' | 'member' | 'viewer'
  clock: Clock
  ids: IdGenerator
  logger: Logger
}
export interface SystemContext extends Omit<RequestContext, 'userId' | 'role'> {
  userId: null
  role: 'system'
}
```

### `src/crypto.ts`

AES-256-GCM.

```ts
export function encryptSecret(plain: string): string // "v1:<iv b64>:<tag b64>:<ct b64>"
export function decryptSecret(payload: string): string
```

**Нюанс:** формат с версией `v1:` обязателен — понадобится ротация ключа.

### `src/pagination.ts`

Курсор — base64url от `{ createdAt: ISO, id: uuid }`.

```ts
export function encodeCursor(row: { createdAt: Date; id: string }): string
export function decodeCursor(cursor: string): { createdAt: Date; id: string }
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})
```

**Нюанс:** невалидный курсор → `VALIDATION_ERROR`, а не 500.

### Тесты `packages/shared`

- `Usd`: сложение, вычитание, округление вверх, сериализация, отсутствие потери точности
  на 1e9 микродолларов.
- `crypto`: encrypt→decrypt round-trip; повреждённый ciphertext бросает ошибку;
  два вызова encrypt на одном тексте дают разный результат (разный IV).
- `pagination`: round-trip курсора; мусорный курсор бросает `AppError`.
- `clock`/`id`: фиксированные реализации детерминированы.

---

## 4. Задача 0.3 — `packages/db`: схема и миграции

### Расширения (первая миграция)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
```

(`vector` создаём уже сейчас, использовать начнём в Фазе 4.)

### Таблицы фазы 0

**`users`**

| колонка                 | тип           | ограничения                                                |
| ----------------------- | ------------- | ---------------------------------------------------------- |
| id                      | uuid          | PK                                                         |
| email                   | citext / text | NOT NULL, UNIQUE (lower(email))                            |
| password_hash           | text          | NOT NULL                                                   |
| name                    | text          | NOT NULL                                                   |
| status                  | text          | NOT NULL, CHECK in ('active','disabled'), default 'active' |
| last_login_at           | timestamptz   | NULL                                                       |
| created_at / updated_at | timestamptz   | NOT NULL default now()                                     |

**Нюанс:** email хранить в нижнем регистре при записи + уникальный индекс по `lower(email)`.

**`organizations`**
id, name, slug (UNIQUE), plan (`free|pro|enterprise`, default `free`),
monthly_budget_usd numeric(14,6) NOT NULL default 100.000000,
status (`active|suspended`), created_at, updated_at.

**`organization_members`**
id, org_id FK→organizations ON DELETE CASCADE, user_id FK→users ON DELETE CASCADE,
role text CHECK in ('owner','admin','member','viewer'),
created_at. UNIQUE(org_id, user_id).
**Нюанс:** в организации обязан быть минимум один `owner` — при удалении последнего
owner'а возвращать `409 LAST_OWNER`.

**`companies`**
id, org_id NOT NULL, name, slug, description text NULL,
mission text NULL, status (`active|paused|archived`),
monthly_budget_usd numeric(14,6) NOT NULL default 50.000000,
settings jsonb NOT NULL default '{}', created_at, updated_at.
UNIQUE(org_id, slug).

**`departments`**
id, org_id, company_id FK ON DELETE CASCADE, name, code text
(например `engineering`,`marketing`,`finance`,`research`,`operations`),
parent_department_id uuid NULL FK→departments (самоссылка),
monthly_budget_usd numeric(14,6) NULL, created_at, updated_at.
UNIQUE(company_id, code).
**Нюанс:** самоссылка требует защиты от циклов — проверять в сервисе рекурсивным CTE
перед записью `parent_department_id`; при цикле `409 DEPARTMENT_CYCLE`.

**`agents`**

```
id                    uuid PK
org_id                uuid NOT NULL
company_id            uuid NOT NULL FK ON DELETE CASCADE
department_id         uuid NULL FK ON DELETE SET NULL
manager_agent_id      uuid NULL FK -> agents (самоссылка)
name                  text NOT NULL              -- "Alex"
role                  text NOT NULL              -- "senior_backend_developer"
title                 text NOT NULL              -- "Senior Backend Developer"
system_prompt         text NOT NULL
model_policy          jsonb NOT NULL             -- см. ниже
skills                text[] NOT NULL default '{}'
tools                 text[] NOT NULL default '{}'
permissions           text[] NOT NULL default '{}'
max_autonomy_level    smallint NOT NULL default 1  CHECK between 0 and 3
monthly_budget_usd    numeric(14,6) NOT NULL default 10.000000
status                text NOT NULL default 'active' CHECK in ('draft','active','paused','retired')
avatar_url            text NULL
created_at/updated_at timestamptz
```

UNIQUE(company_id, name).
**Нюанс:** `manager_agent_id` — тоже самоссылка, тоже нужна защита от циклов
(`409 AGENT_CYCLE`) и проверка, что менеджер принадлежит той же компании.

`model_policy` (валидируется zod при записи):

```json
{
  "preferred": "claude-sonnet",
  "fallback": ["gpt-mini", "gemini-flash"],
  "temperature": 0.2,
  "maxOutputTokens": 8000
}
```

На Фазе 0 значения — просто строки-алиасы, они станут осмысленными в Фазе 1.

**`secrets`**
id, org_id, scope text (`org`|`company`), company_id uuid NULL,
key text (например `openai_api_key`, `github_token`),
value_encrypted text NOT NULL, created_at, updated_at, created_by uuid.
UNIQUE(org_id, company_id, key) — с `company_id` NULL допускается через
частичный уникальный индекс (два индекса: с company_id и без).
**Нюанс:** значение **никогда** не возвращается из API. Возвращается только
`{ key, isSet: true, updatedAt }`.

**`audit_logs`** (append-only, начинаем писать уже здесь)
id, org_id, actor_type (`user`|`agent`|`system`), actor_id uuid NULL,
action text (`agent.created`, `company.updated`, `auth.login`, ...),
resource_type text, resource_id uuid NULL,
metadata jsonb NOT NULL default '{}',
ip inet NULL, user_agent text NULL, created_at timestamptz.
Индекс `(org_id, created_at desc)`, `(org_id, resource_type, resource_id)`.
**Нюанс:** на таблицу вешается правило — в коде нет ни одного `update`/`delete` для неё;
добавить тест, который это проверяет (например, запретить через ревью + отдельный
репозиторий с единственным методом `append`).

**`refresh_tokens`**
id, user_id, token_hash text (sha256 от токена), expires_at, revoked_at NULL,
created_at, user_agent, ip.
**Нюанс:** храним хеш, не сам токен. При использовании токена — ротация:
старый помечается `revoked_at`, выдаётся новый (refresh token rotation).
Если приходит уже отозванный токен — **отозвать всю цепочку** пользователя
(признак кражи) и вернуть `401 TOKEN_INVALID`.

### Индексы (обязательные)

```
users(lower(email)) unique
organization_members(org_id, user_id) unique
organization_members(user_id)
companies(org_id, created_at desc, id desc)
companies(org_id, slug) unique
departments(org_id, company_id)
agents(org_id, company_id, created_at desc, id desc)
agents(org_id, department_id)
agents(company_id, name) unique
audit_logs(org_id, created_at desc)
refresh_tokens(token_hash) unique
refresh_tokens(user_id, expires_at)
secrets — уникальные индексы описаны выше
```

### Триггер `updated_at`

Одна функция `set_updated_at()` + триггер на каждую таблицу с `updated_at`.

### Миграции

- Инструмент: `drizzle-kit generate` → SQL-файлы в `packages/db/migrations`.
- Каждая миграция имеет парный файл отката `*.down.sql`. Скрипт `db:rollback`
  откатывает последнюю применённую.
- Скрипт `db:migrate` идемпотентен: повторный запуск ничего не ломает.
- Таблица `__drizzle_migrations` ведётся автоматически.

### `packages/db/src/client.ts`

Пул соединений (`pg.Pool`, max 10), graceful shutdown, `withTransaction(fn)`.
**Нюанс:** `withTransaction` должен пробрасывать тот же объект транзакции в репозитории,
чтобы вложенные вызовы не открывали второе соединение. Реализовать через явный параметр
`tx`, не через AsyncLocalStorage (проще отлаживать).

### Репозитории `packages/db/src/repositories/*.ts`

По одному на таблицу. Обязательная сигнатура:

```ts
findById(ctx: RequestContext, id: string): Promise<T | null>   // всегда с org_id фильтром
list(ctx, filter, pagination): Promise<{items: T[]; nextCursor: string|null}>
create(ctx, input, tx?): Promise<T>
update(ctx, id, patch, tx?): Promise<T>
softDeleteOrArchive(ctx, id, tx?): Promise<void>
```

`users` и `organizations` — исключение (создаются до контекста), для них отдельный
`AuthRepository` с явными методами.

### Seed (`db:seed`)

Создаёт демо-организацию, пользователя `demo@example.com / demo12345`,
компанию `Acme AI`, отделы `executive|engineering|research|analytics`,
и 4 агентов: `CEO`, `Researcher`, `Developer`, `Analyst` с осмысленными
`system_prompt` и `model_policy`. Seed идемпотентен (повторный запуск не дублирует).

---

## 5. Задача 0.4 — `apps/api`: HTTP-слой

### Структура

```
apps/api/src/
├── index.ts            # bootstrap, graceful shutdown
├── server.ts           # buildServer(): FastifyInstance  (для тестов)
├── plugins/
│   ├── error-handler.ts
│   ├── request-context.ts
│   ├── auth.ts
│   └── rate-limit.ts
├── routes/
│   ├── health.ts
│   ├── auth.ts
│   ├── organizations.ts
│   ├── companies.ts
│   ├── departments.ts
│   ├── agents.ts
│   └── secrets.ts
└── services/
    ├── auth-service.ts
    ├── company-service.ts
    ├── department-service.ts
    └── agent-service.ts
```

**Нюанс архитектуры:** роут не содержит бизнес-логики. Роут = валидация zod → вызов
сервиса → сериализация. Сервис не знает про Fastify. Это позволит переиспользовать
сервисы из воркеров в Фазе 2.

### Плагины

1. **request-context**: генерирует `requestId` (uuid v7), кладёт в `req.ctx`,
   добавляет заголовок ответа `x-request-id`, логирует начало/конец запроса
   с длительностью.
2. **error-handler**: единый `setErrorHandler`. `AppError` → его статус и код.
   `ZodError` → 400 `VALIDATION_ERROR`. Всё остальное → 500 `INTERNAL_ERROR`,
   с логированием полного стека и **без** стека в ответе.
   Также `setNotFoundHandler` → 404 `NOT_FOUND` в том же формате.
3. **auth**: декоратор `fastify.requireAuth` — читает `Authorization: Bearer`,
   верифицирует access-JWT, грузит членство в организации, наполняет `req.ctx`
   полями `userId`, `orgId`, `role`.
   **Нюанс:** организация выбирается заголовком `X-Org-Id`; если заголовка нет и
   у пользователя ровно одна организация — берётся она; если организаций несколько
   и заголовка нет → `400 ORG_NOT_SELECTED`.
4. **rate-limit**: `@fastify/rate-limit`, глобально 300 req/min на IP,
   на `/v1/auth/login` и `/v1/auth/register` — 10 req/min на IP.
   Ответ при превышении — стандартный error envelope с `RATE_LIMITED`.

Дополнительно: `@fastify/helmet`, `@fastify/cors` (в dev — `*`, в prod — из env
`CORS_ORIGINS`, список через запятую).

### Эндпойнты

```
GET    /health                          -> { status, db: 'up'|'down', redis: 'up'|'down', version }
GET    /v1/me                           -> профиль + список организаций

POST   /v1/auth/register                { email, password, name, organizationName }
POST   /v1/auth/login                   { email, password }
POST   /v1/auth/refresh                 { refreshToken }
POST   /v1/auth/logout                  { refreshToken }

GET    /v1/organizations                -> организации текущего пользователя
GET    /v1/organizations/:id
PATCH  /v1/organizations/:id            (owner|admin)
GET    /v1/organizations/:id/members
POST   /v1/organizations/:id/members    { email, role }   (owner|admin)
PATCH  /v1/organizations/:id/members/:userId  { role }
DELETE /v1/organizations/:id/members/:userId

POST   /v1/companies                    { name, slug?, description?, mission?, monthlyBudgetUsd? }
GET    /v1/companies                    (cursor pagination)
GET    /v1/companies/:id
PATCH  /v1/companies/:id
DELETE /v1/companies/:id                -> архивирует (status='archived'), не удаляет
GET    /v1/companies/:id/org-chart      -> дерево отделов и агентов

POST   /v1/departments                  { companyId, name, code, parentDepartmentId? }
GET    /v1/departments?companyId=
PATCH  /v1/departments/:id
DELETE /v1/departments/:id              -> 409 если есть агенты; иначе удаляет

POST   /v1/agents                       (полная схема агента)
GET    /v1/agents?companyId=&departmentId=&status=
GET    /v1/agents/:id
PATCH  /v1/agents/:id
POST   /v1/agents/:id/pause
POST   /v1/agents/:id/activate
DELETE /v1/agents/:id                   -> status='retired'

GET    /v1/secrets?companyId=           -> [{ key, isSet, updatedAt }]
PUT    /v1/secrets/:key                 { value, companyId? }   (owner|admin)
DELETE /v1/secrets/:key

GET    /v1/audit-logs?resourceType=&resourceId=&from=&to=   (cursor pagination)
```

### Правила доступа (RBAC на уровне org)

| Действие                                   | owner | admin | member | viewer |
| ------------------------------------------ | ----- | ----- | ------ | ------ |
| читать всё в org                           | +     | +     | +      | +      |
| создавать/менять компании, отделы, агентов | +     | +     | +      | −      |
| управлять участниками                      | +     | +     | −      | −      |
| менять настройки org, секреты, бюджет      | +     | +     | −      | −      |
| удалять организацию                        | +     | −     | −      | −      |

**Нюанс:** проверка роли — отдельная функция `assertRole(ctx, ['owner','admin'])`,
не разбросанные `if` по роутам.

### Валидация — нюансы, которые обычно забывают

- `slug`: `^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$`, автогенерация из `name` при отсутствии,
  при коллизии — суффикс `-2`, `-3`, ... (до 50 попыток, потом `409 SLUG_ALREADY_EXISTS`).
- `password`: минимум 10 символов, максимум 200 (защита от DoS через argon2 на длинных строках).
- `name` компании/агента: 1..100 символов, `.trim()`, запрет строк только из пробелов.
- `system_prompt`: максимум 20 000 символов.
- `skills`/`tools`/`permissions`: массив строк, каждая `^[a-z0-9._-]{1,64}$`, максимум 50 элементов,
  дубликаты убираются.
- Любое `PATCH` — частичное: неуказанные поля не трогаются; явный `null` для nullable-полей
  означает «обнулить». Использовать `.optional()` + отдельную обработку `null`.
- Все `:id` в путях валидируются как uuid; невалидный uuid → `400 VALIDATION_ERROR`,
  **не** 404 и не 500.

### Аутентификация — нюансы

- Хеш пароля: **argon2id** (`argon2` пакет), `memoryCost: 19456, timeCost: 2, parallelism: 1`.
- При неверном email и при неверном пароле — **один и тот же** ответ
  `401 INVALID_CREDENTIALS` и **одинаковое время выполнения** (при отсутствии пользователя
  всё равно выполнить фиктивную проверку хеша).
- Access-JWT payload: `{ sub: userId, jti, iat, exp }`. Организации в токене **нет** —
  членство проверяется по БД на каждом запросе (иначе отзыв доступа не работает).
- Refresh-токен: 32 случайных байта, base64url, в БД — sha256-хеш. Ротация обязательна.
- `logout` отзывает конкретный refresh-токен; `logout-all` (опционально) — все.

---

## 6. Тесты фазы

Файлы: `apps/api/test/*.test.ts`, `packages/*/test/*.test.ts`.

### Инфраструктура тестов

- Отдельная БД `ai_company_test`, поднимается из `docker-compose`.
- `globalSetup` в vitest: применить миграции один раз.
- Перед каждым тестом — `TRUNCATE` всех таблиц (кроме `__drizzle_migrations`) в одной
  транзакции с `RESTART IDENTITY CASCADE`.
- Хелпер `createTestOrg()` → возвращает `{ org, user, accessToken, ctx }`.

### Обязательные тест-кейсы

1. **auth**
   - регистрация создаёт user + org + membership(owner) — в одной транзакции;
   - повторная регистрация с тем же email → `409 EMAIL_ALREADY_EXISTS`;
   - login с неверным паролем → `401 INVALID_CREDENTIALS`;
   - refresh ротирует токен; повторное использование старого refresh-токена →
     `401` **и** все токены пользователя отозваны;
   - запрос без токена → `401`; с протухшим → `401 TOKEN_EXPIRED`.
2. **tenant isolation** (по одному на каждую сущность: company, department, agent, secret,
   audit_log): пользователь org B получает `404` на id из org A. Не 403.
3. **RBAC**: `viewer` не может создать компанию (`403 FORBIDDEN`);
   `member` не может добавить участника.
4. **companies**: генерация slug, коллизия slug, архивирование вместо удаления,
   `org-chart` возвращает корректное дерево (отдел без родителя → корень).
5. **departments**: попытка сделать отдел собственным предком → `409 DEPARTMENT_CYCLE`;
   удаление отдела с агентами → `409`.
6. **agents**: цикл в `manager_agent_id` → `409 AGENT_CYCLE`;
   менеджер из другой компании → `400`;
   дубликат имени в компании → `409`;
   `PATCH` с одним полем не затирает остальные.
7. **secrets**: значение не возвращается ни в одном ответе (проверить тело ответа на
   отсутствие подстроки); шифрование в БД (в колонке нет исходного значения).
8. **pagination**: 120 компаний, обход по курсору даёт ровно 120 уникальных, без пропусков
   и дублей при одинаковых `created_at` (сортировка по `(created_at, id)`).
9. **audit**: создание агента пишет запись в `audit_logs` с корректными
   `actor_id`, `resource_id`, `action`.
10. **error format**: любой 4xx/5xx имеет поля `error.code`, `error.message`, `error.requestId`.

---

## 7. Разрешённые зависимости фазы

```
fastify, @fastify/helmet, @fastify/cors, @fastify/rate-limit,
zod, drizzle-orm, drizzle-kit, pg, @types/pg,
argon2, jose (JWT), uuidv7, pino, pino-pretty,
@aws-sdk/client-s3, ioredis,
vitest, @vitest/coverage-v8, typescript, tsx, turbo,
eslint, @eslint/js, typescript-eslint, prettier
```

Ничего сверх этого списка.

---

## 8. Запрещено в этой фазе

- Любые вызовы LLM-провайдеров и любые упоминания моделей в коде, кроме строк-алиасов
  в `model_policy`.
- BullMQ, воркеры, очереди, cron.
- pgvector-запросы (расширение создаём, таблицы эмбеддингов — нет).
- Frontend (Next.js).
- WebSocket / SSE.
- Docker-песочница, MCP.
- Загрузка файлов в S3 (клиент настраиваем, но эндпойнтов загрузки нет).
- Таблицы `tasks`, `runs`, `steps`, `memories`, `approvals` — они появятся в фазах 2–4.
  Не создавать их «на будущее».

---

## 9. Приёмочные критерии

- [ ] `docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed` проходит с нуля.
- [ ] `pnpm -r build`, `pnpm -r test`, `pnpm lint`, `pnpm typecheck` — зелёные.
- [ ] `GET /health` возвращает `db: up`, `redis: up`.
- [ ] Полный сценарий curl из §1 отрабатывает.
- [ ] Все тест-кейсы из §6 присутствуют и проходят.
- [ ] Ни одного `any` в экспортируемых типах.
- [ ] Ни одного прямого `process.env` вне `packages/shared/src/env.ts`.
- [ ] Ни одного запроса к БД в обход репозитория с `ctx.orgId`.
- [ ] `db:rollback` откатывает последнюю миграцию без ошибок.
- [ ] `docs/phases/phase-0.md` написан: как запустить, как проверить, что где лежит.

---

## 10. Что я проверю на ревью (чек-лист приёмки)

1. Grep по `process.env` вне `env.ts` — должно быть пусто.
2. Grep по `db.select(` вне `packages/db/src/repositories` — должно быть пусто.
3. Каждый репозиторный метод фильтрует по `org_id` — проверю глазами все.
4. `audit_logs` не имеет методов update/delete.
5. Секрет не появляется ни в одном JSON-ответе и ни в одном логе.
6. Пароль в БД — argon2id-хеш, не bcrypt, не sha.
7. Курсорная пагинация сортирует по двум полям, а не по одному.
8. Ошибки не текут стеком наружу.
9. Транзакционность регистрации: убью соединение посреди — не должно остаться
   пользователя без организации.
10. Тесты не зависят от порядка выполнения и от реального времени.
