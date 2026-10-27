# Al-Qadr Travels & Tours — OTA Platform

Phase 2 starter scaffold (v0.1). This is the beginning of the application, not a production-ready OTA yet.

## Included
- pnpm workspace monorepo
- Next.js frontend shell
- NestJS API shell with health endpoint
- PostgreSQL and Redis local services via Docker Compose
- Revised Phase 1 Prisma schema and architecture documents
- Preliminary heuristic schema linter
- Environment-variable template

## Requirements
- Node.js 20.19+ (or a current supported Node LTS)
- pnpm 10+
- Docker Desktop (for local PostgreSQL and Redis)

## Run locally
1. Extract this ZIP into a folder.
2. Copy `.env.example` to `.env` and change the local database password consistently in `DATABASE_URL` and `DIRECT_DATABASE_URL`.
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Start local infrastructure:
   ```bash
   docker compose up -d
   ```
5. Run the preliminary schema linter:
   ```bash
   pnpm lint:schema
   ```
   This is heuristic only and is not Prisma validation.
6. Validate the Prisma schema:
   ```bash
   pnpm prisma:validate
   ```
   Resolve all errors before creating migrations.
7. Start the API and website:
   ```bash
   pnpm dev
   ```
   Website: http://localhost:3000
   API health: http://localhost:4000/health

## Important safety notes
- No live supplier integration is enabled.
- Authentication, 2FA, RBAC enforcement, finance and booking workflows are not complete in this starter.
- Do not expose this scaffold publicly as a production OTA.
- Do not use real customer/passport data or real supplier credentials yet.
- Do not run a production migration until the schema, hand-written SQL requirements and backup/recovery plan have been reviewed.
- Keep all secrets in environment variables; never commit `.env`.

## Deployment recommendation
- Frontend: Vercel (Next.js).
- API: a persistent Node/NestJS hosting service that supports background workers.
- Database: managed PostgreSQL.
- Queue/cache: managed Redis.
See `docs/DEPLOYMENT_PLAN.md`.

## Source of Phase 1 design
`docs/STEP1_REVISED.md` supersedes the original architecture document where they differ.
