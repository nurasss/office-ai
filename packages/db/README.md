# @ai-company/db

Database persistence layer for AI Company OS.

## Overview
- **ORM**: Drizzle ORM
- **Driver**: `pg` (PostgreSQL client pool with max 10 connections)
- **Migrations**: Idempotent SQL runner with `schema_migrations` tracking
- **Seed**: Model catalog, tool catalog, skill catalog, and demo company structure

## Environment Variables
- `DATABASE_URL`: Primary PostgreSQL connection string (defaults to `postgres://ai:ai@localhost:5432/ai_company` in development).
- `TEST_DATABASE_URL`: Test PostgreSQL connection string (defaults to `postgres://ai:ai@localhost:5432/ai_company_test`). In `NODE_ENV=test`, `DATABASE_URL` is automatically forced to `TEST_DATABASE_URL`.
- `REQUIRE_DB`: Boolean flag (`true` / `false`, default `false`). When `REQUIRE_DB=true`, unreachable database triggers a hard failure in test suites instead of skipping tests. **In CI pipelines, always run tests with `REQUIRE_DB=true`.**

## Commands
- `pnpm db:generate`: Generate migrations using Drizzle Kit.
- `pnpm db:migrate`: Apply all pending migrations.
- `pnpm db:rollback`: Rollback the latest migration using paired `.down.sql`.
- `pnpm db:seed`: Seed platform catalogs and MVP demo organization.
