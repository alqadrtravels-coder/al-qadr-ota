# Deployment plan

## Recommended split
- **Vercel:** Next.js web frontend.
- **Node hosting:** NestJS API and background workers on a service that supports long-running processes.
- **Managed PostgreSQL:** production database with backups and point-in-time recovery.
- **Managed Redis:** queue/cache service with authentication and TLS.
- **Object storage:** private storage for permitted documents, with signed URLs and retention controls.

## Before production
1. Validate Prisma schema with Prisma 6.
2. Create and review migrations, including raw SQL for triggers, grants, sequences and other invariants documented in `STEP1_REVISED.md`.
3. Implement and test authentication, 2FA, RBAC and session revocation.
4. Add rate limiting, structured logs, error handling, monitoring and alerting.
5. Configure secrets in each hosting provider; never upload `.env`.
6. Set production CORS, secure cookie policy, TLS and trusted proxy settings.
7. Test backups and restoration.
8. Run integration and security tests before handling customer or passport data.

## Vercel upload note
Vercel is suitable for the `apps/web` Next.js app. For this monorepo, the easiest repeatable deployment is to push it to a private Git repository and import that repository into Vercel, setting the project Root Directory to `apps/web`. Configure the API base URL as an environment variable in the frontend when API calls are implemented. Deploy the API separately.
