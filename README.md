# 🏛️ AI Company OS (office-ai) — Корпоративная операционная система ИИ-агентов

**AI Company OS** — масштабируемый промышленный монорепозиторий для оркестрации автономных виртуальных компаний под управлением искусственного интеллекта. Архитектура проекта зафиксирована формальными документами **ADR** (Architecture Decision Records) и **Master-ТЗ**, обеспечивая абсолютную типобезопасность на TypeScript, изоляцию контекстов задач, независимость от провайдеров нейросетей и транзакционную надежность базы данных.

---

## 📌 Архитектурные принципы и ADR

- **ADR 001: Согласование состояний (Reconciliation Engine)**:
  - Механизм распределенного согласования между агентами и общим состоянием компании без риска потери контекста или циклических блокировок.
- **ADR 002: Мультимодельный слой абстракции (Model Provider API)**:
  - Универсальный типизированный интерфейс взаимодействия с LLM: OpenAI, Anthropic, Google Gemini. Возможность бесшовной смены модели под конкретную подзадачу (кодинг, анализ, генерация отчетов).
- **Финансовая точность (Monetary Math)**:
  - Пакет `packages/shared` реализует строгую целочисленную арифметику денег (в центах/тиынах), исключая ошибки округления с плавающей точкой (floating point drift).

---

## 🏗 Архитектура монорепозитория (Turborepo & pnpm)

```text
office-ai/
├── apps/
│   └── api/                # Бэкенд сервис API (Fastify / Hono, WebSocket, REST)
├── packages/
│   ├── shared/             # Общие типы, денежная арифметика, пагинация, ошибки
│   ├── models/             # Абстракция провайдеров нейросетей (OpenAI, Anthropic, Gemini)
│   └── db/                 # Drizzle ORM схемы, миграции PostgreSQL, сиды
│       └── src/schema/     # Модели: company.ts, org.ts, catalog.ts, agent-links.ts, security.ts
├── infrastructure/
│   └── docker/             # Docker Compose для PostgreSQL и Redis
├── docs/
│   ├── adr/                # Документы архитектурных решений (001, 002)
│   └── tz/                 # Мастер-ТЗ и спецификации этапов (00-MASTER.md, PHASE-0.md)
├── turbo.json              # Конвейер сборки Turborepo
└── pnpm-workspace.yaml     # Конфигурация воркспейса pnpm
```

---

## 🛠 Технический стек

- **Рантайм и менеджер**: Node.js 22+, pnpm 9.12+, Turborepo
- **Язык**: TypeScript (режим `strict: true`, Project References)
- **База данных & ORM**: PostgreSQL, Drizzle ORM, `drizzle-kit`
- **Тестирование & качество**: Vitest, ESLint (Flat Config), Prettier
- **Контейнеризация**: Docker Compose

---

## 🚀 Команды разработки

```bash
cd office-ai

# 1. Установка всех пакетов воркспейса
pnpm install

# 2. Поднятие инфраструктуры (БД и Redis)
docker-compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Применение миграций схемы Drizzle
pnpm db:migrate

# 4. Сборка всех пакетов и запуск тестов
pnpm build
pnpm test
```
