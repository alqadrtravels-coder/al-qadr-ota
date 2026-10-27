# Al-Qadr OTA — Step 1 REVISED (v2)

Status: **FINAL DRAFT FOR APPROVAL. No Step 2 work has started.**
Companion: `backend/prisma/schema.prisma` (rewritten as v2).

How to read the docs: `STEP1_ARCHITECTURE.md` (v1) stays valid for everything **not** listed below
(monorepo layout, module rules, response/error standard, base endpoint tables, most of security).
This file **supersedes** v1 wherever they differ. Sections 1–14 below are the revisions; section 15 is the final consolidated checklist.

## 0. What changed

| # | Your decision | Result in the design |
|---|---|---|
| 1 | Two levels now, deeper later | `parent_partner_id` + **closure table `partner_hierarchy`**; depth limit is the setting `partner.max_depth` (=1), not a schema rule |
| 2 | Wallet may go negative to credit limit | Credit used/available **derived**; limit enforced in service **and** by a DB trigger |
| 3 | snake_case DB, camelCase code | `@@map`/`@map` on every model/field/enum; CI check forbids upper-case identifiers |
| 4 | Domains not final | `FRONTEND_URL`, `API_URL`, `CORS_ORIGINS`, `AUTH_COOKIE_DOMAIN` (+ cookie knobs); boot-time validation; no hardcoded domains |
| 5 | Mandatory TOTP for sensitive staff | `user_two_factor`, `user_recovery_codes`, role + permission flags, enrolment-only sessions, per-user `REQUIRED` switch for later B2B rollout |
| 6 | Invoice numbers: sequential, not gapless, configurable | Template-driven `business_id_config` (`{YYYY}`, `{SEQ}`), optional yearly reset, separate immutable UUID |
| + | Safety requirements | Sections 7–13 |

## 1. Partner hierarchy (revised)

- **Adjacency**: `partners.parent_partner_id` answers "who is my parent".
- **Closure table**: `partner_hierarchy(ancestor_id, descendant_id, depth)`. Every partner has a self row (depth 0) plus one row per ancestor.
  - tree of P: `WHERE ancestor_id = P`
  - "is X inside Y's tree": one primary-key lookup
  - works identically for 2 levels or 10.
- **Depth limit is configuration**: `system_settings.partner.max_depth = 1` (root = depth 0, sub-partner = depth 1). `PartnersService.createSubPartner` rejects deeper nesting with `HIERARCHY_DEPTH_EXCEEDED`. Allowing a third level later = change the setting; **no migration, no data rewrite**.
- DB safety net only: `CHECK (depth BETWEEN 0 AND 8)` and `CHECK (root ⇔ no parent, sub ⇔ has parent)`.
- `PARTNER_TREE` data scope = join on the closure table. Parent controls over sub-partners are rules over `status`, `credit_lines.allocated_from_partner_id`, partner-owned roles, and group FKs.
- Re-parenting (not in initial scope) is supported by the model: delete the subtree's old ancestor links and insert new ones in one transaction.

## 2. Credit model (revised)

```
wallet balance          = ledger_accounts.cached_balance          (verified against entries)
held                    = ledger_accounts.held_amount             (verified against ACTIVE holds)
credit limit            = credit_lines.credit_limit (ACTIVE, within valid_from/valid_to)

credit used             = max(0, -balance)
available credit        = max(0, credit_limit - credit_used)
available purchasing    = balance - held + credit_limit
```
Example: balance 10,000 + limit 50,000 → purchasing power **60,000**. Buying 55,000 → balance −45,000, credit used 45,000, available credit 5,000.

Nothing but `credit_limit` is stored; the rest is computed on read (and by the reconciliation job).

**Safeguards (defence in depth)**
1. **Service check** (inside the ledger transaction, after locking the account row): `balance − held + credit_limit ≥ amount`, else `INSUFFICIENT_FUNDS`. Holds count against capacity, so two parallel bookings cannot both pass.
2. **Hold at booking start**: capacity is checked and reserved atomically (section 8). Capturing a hold converts reserved funds to a posting.
3. **Database trigger** `wallet_floor` on `ledger_entries` (BEFORE INSERT): for a debit on a `PARTNER_WALLET`, `balance_after ≥ −credit_limit` of the active credit line, otherwise `RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED'`. This catches any bug or direct SQL path.
4. **No bypass flag.** The v1 "unless user has permission" override is **removed**. If staff must allow a purchase beyond capacity, they raise the limit via `credit.manage` (step-up auth, 2FA, audited), which is visible and reversible.
5. Credit limit **reduced below current usage** is allowed only with `credit.manage`; the partner becomes "over limit": new purchases are blocked, deposits and refunds still post.
6. Deposits and refunds (credits to the wallet) are never blocked by the floor.
7. Sub-partner limits are carved from the parent's allocation (`allocated_from_partner_id`); sum of children's limits ≤ parent's allocatable amount (service rule, audited).

## 3. Naming convention (snake_case in PostgreSQL)

- Prisma: `createdAt`, `partnerId`, `partnerCode` → DB: `created_at`, `partner_id`, `partner_code`.
- Tables: plural snake_case (`ledger_entries`). Enum types: snake_case (`ledger_account_type`); enum **values** stay `UPPER_SNAKE`.
- Implemented with `@@map` / `@map` everywhere in schema v2 (it is the rule for every future table too).
- Index/constraint names: Prisma derives defaults from mapped names; migrations may set explicit names. A CI query fails the build if any identifier in `information_schema` matches `[A-Z]`.
- All raw-SQL migrations, views, triggers and report queries use the snake_case names.
- Your example (`b2bPartnerId` → `b2b_partner_id`) is followed literally; the schema uses `partnerId` → `partner_id` because there is one partner entity with a type, not a separate "b2b partner" table.

## 4. Authentication / cookie architecture (domain-independent)

**No domain is hardcoded anywhere.** Everything comes from validated environment variables:

| Variable | Purpose | Dev | Production (example, not fixed) |
|---|---|---|---|
| `FRONTEND_URL` | Base URL of the Next.js app. Used in email links, redirects, CORS default | `http://localhost:3000` | `https://<frontend-host>` |
| `API_URL` | Public base URL of the API. Used for absolute links, webhooks, OpenAPI server | `http://localhost:4000` | `https://<api-host>` |
| `CORS_ORIGINS` | Comma-separated allow-list (exact origins, never `*`) | `http://localhost:3000` | `https://<frontend-host>` |
| `AUTH_COOKIE_DOMAIN` | Cookie `Domain` attribute. **Empty = host-only cookie** | *(empty)* | `.<parent-domain>` or empty |
| `AUTH_COOKIE_NAME` | Refresh cookie name | `aq_rt` | `__Host-aq_rt` if host-only |
| `AUTH_COOKIE_SAMESITE` | `strict` \| `lax` \| `none` | `strict` | `strict` / `none` for cross-site |
| `AUTH_COOKIE_SECURE` | `true` \| `false` | `false` | `true` |
| `AUTH_COOKIE_PATH` | Cookie path | `/api/v1/auth` | same |

**One design, three deployment shapes, selected only by env:**

| Shape | Example | Settings |
|---|---|---|
| A. Same registrable domain (frontend and API are subdomains of the same parent) | `app.X` + `api.X` | `AUTH_COOKIE_DOMAIN=.X`, `SAMESITE=strict`, `SECURE=true` |
| B. Different registrable domains | frontend on a Vercel domain, API elsewhere | `SAMESITE=none`, `SECURE=true`, CSRF header + Origin check mandatory (already always on) — **or** run the Next.js BFF route handlers for `/auth/*` so the cookie is first-party to the frontend (then A-style settings apply to the frontend host) |
| C. Local dev | `localhost:3000` + `localhost:4000` | ports do not matter for "site": `SAMESITE=strict`, `SECURE=false`, empty domain |

Why a domain change will not require redesign:
- Access token is a bearer token held in memory; it is domain-agnostic.
- The refresh cookie is the only domain-sensitive piece and its attributes are 100% env-driven.
- `/auth/refresh` and `/auth/logout` **always** require (a) an allowed `Origin`/`Referer`, (b) a custom header `X-AQ-CSRF: 1` (cannot be sent cross-site without a CORS preflight that our allow-list rejects), regardless of SameSite value.
- CORS uses `credentials: true` with the exact-origin allow-list from `CORS_ORIGINS`.
- JWT has no `aud`/`iss` tied to a hostname: `iss` = configured `JWT_ISSUER` string, `aud` = `aq-api`.

**Boot-time validation (process refuses to start in production if violated)**
- `FRONTEND_URL`, `API_URL` are valid URLs; production requires `https`.
- `CORS_ORIGINS` is non-empty, has no `*`, every entry is a valid origin.
- If `AUTH_COOKIE_DOMAIN` is set, it must be a parent-domain suffix of **both** hosts.
- `SAMESITE=none` ⇒ `SECURE=true`. Production ⇒ `SECURE=true`.
- A `__Host-` cookie name requires: Secure, no Domain, Path `/`.

Login flow with 2FA is in section 5. Everything else from v1 section 5 (ES256 access token 15 min, hashed rotating refresh tokens with reuse detection, argon2id, lockout, rate limits) is unchanged.

## 5. Two-factor authentication (TOTP)

**Who must have 2FA (STAFF users)** — a user is *required* if **any** is true:
1. `users.two_factor_policy = REQUIRED` (manual switch — also the future path for B2B agents), or
2. any of the user's roles has `requires_two_factor = true`, or
3. the user's effective permissions include any permission with `requires_two_factor = true`, or
4. a system policy setting `security.mfa.required_user_types` includes the user's type (default `[]`; not set for partners at launch).

**Seeded `roles.requires_two_factor = true`:** SUPER_ADMIN, ADMIN, FINANCE_MANAGER, OPERATIONS_MANAGER, TICKETING_MANAGER.

**Seeded `permissions.requires_two_factor = true`** (staff holding any of these must have 2FA, even in other roles):

| Area (your list) | Permission codes |
|---|---|
| Wallet / finance | `wallet.view`, `wallet.deposit`, `wallet.approve`, `wallet.adjust`, `wallet.reconcile`, `deposit.approve`, `credit.view`, `credit.manage`, `invoice.issue` |
| Refund / reissue / void | `refund.approve`, `reissue.approve`, `void.approve` |
| Supplier credentials | `supplier.credential.manage` |
| Pricing / markup | `markup.manage`, `discount.manage`, `commission.manage`, `fmg.manage` |
| Partner approval | `partner.approve`, `partner.suspend` |
| Employee / role management | `employee.create`, `employee.update`, `employee.status`, `role.manage`, `user.assign_role`, `user.reset_password`, `user.reset_2fa` |
| Configuration | `config.manage` |

Note: `wallet.view` is flagged, so a staff user with wallet visibility needs 2FA. B2B partner users hold `wallet.view` too, but they are not STAFF and no rule above applies to them at launch.

**Enrolment & login flow**
```
POST /auth/login (email+password OK)
 ├─ 2FA not required, not enrolled        → full session
 ├─ 2FA enrolled (ACTIVE)                 → { mfaRequired:true, mfaToken }  → POST /auth/2fa/challenge {code|recoveryCode} → full session
 └─ 2FA required but NOT enrolled         → { mfaEnrollmentRequired:true, enrollmentToken }
        enrollmentToken = 10-min token with scope "mfa_enroll": can call ONLY
        /auth/2fa/setup, /auth/2fa/enable, /auth/me, /auth/logout. Every other route → 403 MFA_ENROLLMENT_REQUIRED.
```
- Required-but-not-enrolled users cannot do anything else. Optional `security.mfa.grace_days` (default **0** for staff) exists if you ever need a transition window.
- `setup` creates a `user_two_factor` row (`PENDING`) with a new secret (160-bit) and returns an `otpauth://` URI/QR once; `enable` verifies a code, sets `ACTIVE`, creates 10 recovery codes (hashed, shown once), bumps `permission_version`, audits.
- TOTP: RFC 6238, SHA-1, 6 digits, 30 s step, ±1 step window (compatible with Google/Microsoft Authenticator, Authy, 1Password…). **Replay protection**: `last_used_step` — a code for a step ≤ last used is rejected. Constant-time compare. 5 failures → `locked_until` backoff + audit.
- Secret stored with the same envelope encryption as supplier credentials (AES-256-GCM + wrapped DEK, `key_id`).
- Session carries `mfa_verified_at` (`refresh_tokens`) and an `amr` claim in the access token (`["pwd","otp"]`).
- **Step-up** for sensitive actions: valid if password/TOTP was confirmed within 10 minutes (`POST /auth/step-up`), else 403 `REAUTH_REQUIRED`. Staff with 2FA must use TOTP for step-up.
- **Disable**: users who are *required* cannot disable (403 `MFA_REQUIRED_BY_POLICY`). Others may, with step-up.
- **Lost device**: admin with `user.reset_2fa` (maker-checker + step-up + audited) deactivates the method; user must re-enrol at next login. Recovery codes work once each.
- Future: more `two_factor_method` values (WebAuthn) are additive; `users.two_factor_policy = REQUIRED` for any B2B user or partner type switches it on without code change.

## 6. Invoice numbering (and all business IDs)

Not gapless; safe; configurable; UUID immutable.

- `invoices` (Phase 5) will have `id uuid` (immutable internal key) **and** `invoice_no text UNIQUE`, assigned **when the invoice is issued**, not when a draft is created (fewer wasted numbers). Both are protected by an `BEFORE UPDATE` trigger that rejects changes to `id`/`invoice_no`.
- Number comes from `next_business_id('invoice')`, backed by a native PostgreSQL sequence (atomic, concurrency-safe, no locks). Gaps from rollbacks/failures are accepted.
- Format is data, not code, in `business_id_config`:

| key | template | pad | reset | example |
|---|---|---|---|---|
| partner | `AQ-B{SEQ}` | 6 | NEVER | AQ-B000001 |
| employee | `AQ-EMP{SEQ}` | 6 | NEVER | AQ-EMP000001 |
| invoice (initial) | `AQ-INV-{SEQ}` | 6 | NEVER | AQ-INV-000001 |
| invoice (later option) | `AQ-INV-{YYYY}-{SEQ}` | 6 | YEARLY | AQ-INV-2026-000001 |

- Switching the invoice format later = `UPDATE business_id_config`; old invoices keep their numbers.
- `YEARLY` uses one sequence per year (`seq_invoice_2026`), created on first use by the function (SECURITY DEFINER, fixed `search_path`). Year is computed in `Asia/Dhaka`.
- If Bangladesh tax/accounting rules later demand gapless numbers, only the `invoice` key changes to a locked-counter implementation; callers still use `next_business_id('invoice')`.

```sql
CREATE OR REPLACE FUNCTION next_business_id(p_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_year text; v_seq text; n bigint;
BEGIN
  SELECT template, pad_width, sequence_name, reset_policy INTO c
    FROM business_id_config WHERE key = p_key AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown or inactive business id key: %', p_key; END IF;
  v_year := to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYY');
  v_seq  := CASE WHEN c.reset_policy = 'YEARLY' THEN c.sequence_name || '_' || v_year ELSE c.sequence_name END;
  IF c.reset_policy = 'YEARLY' THEN EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq); END IF;
  n := nextval(v_seq::regclass);
  RETURN replace(replace(replace(c.template,
           '{YYYY}', v_year), '{YY}', right(v_year, 2)),
           '{SEQ}', lpad(n::text, c.pad_width, '0'));
END $$;
```
(Tracking ID `AQ-639` + 12 non-sequential digits is a separate function as in v1.)

## 7. Ledger: transaction safety

Every ledger operation is **one PostgreSQL transaction** performed only by `LedgerService`:

```
BEGIN;                                            -- READ COMMITTED + explicit row locks
 1. INSERT ledger_transactions (…, status 'PENDING', idempotency_key, fingerprint)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING *;
      -> no row returned: SELECT existing; if fingerprint differs -> ERROR IDEMPOTENCY_KEY_REUSED;
         if POSTED -> return it (retry is a no-op); if PENDING by another tx -> wait/retry
 2. SELECT * FROM ledger_accounts WHERE id = ANY($ids) ORDER BY id FOR UPDATE;   -- deterministic order = no deadlocks
 3. Validate: accounts ACTIVE, single currency, partner wallet capacity (section 2), hold rules
 4. For each entry: seq = last_entry_seq + 1; before = cached_balance; after = before ± amount;
      INSERT ledger_entries; UPDATE ledger_accounts SET cached_balance, last_entry_seq, version = version + 1
      WHERE id = $id AND version = $expectedVersion;     -- rowcount must be 1
 5. UPDATE ledger_transactions SET status = 'POSTED', posted_at = now();
 6. INSERT activity_logs (same tx);  INSERT outbox_events (same tx);
COMMIT;                                            -- deferred trigger asserts SUM(debit) = SUM(credit)
```
- Any error → full rollback; no partial postings, no balance drift. `wallet_floor`, `balanced`, `immutable`, `CHECK` constraints are the **database-level** guarantees.
- **Never call a supplier or any network service inside this transaction.** Pattern: *hold (tx 1, commit) → supplier call → capture/post (tx 2)* or *release*.
- Retry policy: on `40001`/`40P01` retry up to 3 times with jitter; the idempotency key makes retries safe.
- Reversals are new transactions (`REVERSAL`, `reversal_of_id` unique ⇒ reversible once); original is marked `REVERSED` in the same tx.
- `PENDING` transactions (approval flows) contain **no entries**; approving posts them with the procedure above.
- Reconciliation job recomputes `SUM(entries)` and `SUM(ACTIVE holds)` per account and writes `ledger_reconciliations`; mismatch ⇒ alert and optional account `FROZEN`.

## 8. Wallet holds: expiry and safe release

State machine: `ACTIVE → CAPTURED | RELEASED | EXPIRED` (terminal).

- **Create**: under the account row lock, check capacity, `INSERT wallet_holds`, `UPDATE ledger_accounts SET held_amount = held_amount + amount`. Idempotent by `idempotency_key`.
- **Capture**: lock account + hold; require `status='ACTIVE'`; post the real transaction; `held_amount −= amount`; hold → `CAPTURED` with `captured_txn_id`. All in one tx.
- **Release**: lock; only from `ACTIVE`; `held_amount −= amount`; `RELEASED` + `release_reason`. Releasing an already released/expired/captured hold is a **no-op success** (idempotent).
- **Expiry sweeper** (BullMQ repeatable job, every minute, safe to run on many workers):
  ```sql
  WITH due AS (
    SELECT id, account_id, amount FROM wallet_holds
    WHERE status = 'ACTIVE' AND is_pinned = false AND expires_at < now()
    ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE wallet_holds h SET status = 'EXPIRED', release_reason = 'EXPIRED', released_at = now()
    FROM due WHERE h.id = due.id RETURNING h.account_id, h.amount
  )
  UPDATE ledger_accounts a SET held_amount = a.held_amount - s.total, version = a.version + 1
  FROM (SELECT account_id, SUM(amount) AS total FROM upd GROUP BY account_id) s
  WHERE a.id = s.account_id;
  ```
  (account rows are locked in `id` order inside the job transaction.)
- **Race: capture vs expiry** — both take the row lock; whichever wins decides. A capture after expiry fails with `HOLD_EXPIRED`; the caller re-runs the capacity check as a new purchase. Never a silent overspend.
- **Unknown supplier outcome** (request sent, no response): the booking service sets `is_pinned = true` + `pinned_reason`; the sweeper **skips pinned holds** (funds stay reserved) and raises an alert; a staff action (`wallet.adjust`, step-up, audited) or an automatic supplier status poll resolves it (capture if ticketed, release if not).
- **Extensions**: allowed up to `max_expires_at` (`extension_count`), never beyond; configurable via `booking.hold_minutes`, `booking.hold_max_minutes`.
- Reconciliation also checks `held_amount == SUM(ACTIVE holds)`.

## 9. Idempotency scoping

Two levels, both scoped:

1. **Client-level** (`idempotency_keys`): unique on **(scope_type, scope_id, action, key)**.
   - `scope_type/scope_id` = `PARTNER` (the acting partner) for B2B actions, `USER` for staff/customer actions, `SYSTEM` for jobs.
   - `action` = e.g. `booking.create`, `deposit.request`, `refund.request`.
   - So partner A and partner B can use the same key; the same key under a different action is a different record.
   - Header `Idempotency-Key` (16–64 chars) **required** on money/booking-creating endpoints. Stores `request_hash`; same key + different hash ⇒ `422 IDEMPOTENCY_KEY_REUSED`; same key, in progress ⇒ `409 REQUEST_IN_PROGRESS` (with `locked_until` so a crashed request frees itself); completed ⇒ replay the stored response.
2. **Ledger-level**: `ledger_transactions.idempotency_key` / `wallet_holds.idempotency_key`, deterministic and business-derived: `<action>:<referenceType>:<referenceUuid>:<step>`. The reference UUID belongs to exactly one partner, so the key is implicitly partner-scoped; the fingerprint prevents a reused key from silently producing a different posting.
- Expiry: client keys 24 h (cleanup job); ledger keys are permanent.

## 10. Supplier credentials are never exposed

Layers, each independently enough to stop a leak:
1. **Separate table** + **explicit column selection**: repositories use a `SupplierPublic` select that omits credential tables; `ciphertext/iv/auth_tag/encrypted_dek` are never loaded outside `CredentialVault`.
2. **Response schemas are whitelists** (Zod `.strict()` output DTOs). Supplier responses contain `hasCredentials`, `usernameHint`, `agencyCode`, `pcc`, `version`, `rotatedAt` — nothing else. Credential endpoint is **write-only** (`PUT`) plus metadata (`GET`).
3. **Envelope encryption**: AES-256-GCM; per-record DEK wrapped by the master key; plaintext exists only in memory inside the adapter call.
4. **DB grants**: reporting/read-only roles have no `SELECT` on the secret columns.
5. **Redaction**: logger, `api_logs`, `activity_logs`, error filter strip keys matching `password|secret|token|apiKey|authorization|ciphertext|dek|*_enc|card|cvv`. Audit records "credential rotated v3" without values.
6. **Config validation**: `suppliers.config`/`capabilities` reject secret-looking keys, so secrets cannot be smuggled into non-secret JSON.
7. **Tests in CI**: a contract test walks every supplier endpoint response and fails if any key/value matches a secret pattern or equals a known test secret.
8. Sensitive: `supplier.credential.manage` = 2FA + step-up + audit; credentials are never shown again after save, not even to SUPER_ADMIN.

## 11. Audit log cannot be modified

- Table `activity_logs` is append-only:
  - `BEFORE UPDATE OR DELETE` trigger → `RAISE EXCEPTION 'activity_logs is append-only'`; same for `TRUNCATE`.
  - Application DB role: `GRANT INSERT, SELECT ON activity_logs`; **no** UPDATE/DELETE/TRUNCATE. The migration role owns the table; the app role is not owner.
  - No API endpoint creates, edits or deletes logs; the only write path is `AuditService`. The only read/export path requires `activity_log.view` / `activity_log.export` (export is itself audited).
  - Retention/archival is a DBA-role operation (partition detach), never from the app.
  - `ledger_entries` get the same protection.
- Audit write failure on a **sensitive** action aborts the action (audit insert is in the same DB transaction), so there are no unaudited sensitive changes.
- Phase 10 adds optional hash-chaining for tamper evidence.

## 12. Sensitive actions: controlled and audited

Every sensitive action runs through one decorator pipeline: `@RequirePermission(code)` → (if flagged) **2FA enrolled** → **step-up within 10 min** → **maker-checker** → business rules → **audit in same transaction** (`is_sensitive = true`, plus a `DENIED` audit row on refusal).

| Action | Permission | 2FA | Step-up | Maker-checker | Audit |
|---|---|---|---|---|---|
| View/rotate supplier credentials | `supplier.credential.manage` | ✔ | ✔ | — | ✔ (no values) |
| Change credit limit | `credit.manage` | ✔ | ✔ | ✔ above configurable threshold | ✔ old/new |
| Approve deposit | `deposit.approve` | ✔ | ✔ | ✔ | ✔ |
| Manual wallet adjustment / hold release | `wallet.adjust` | ✔ | ✔ | ✔ | ✔ |
| Approve refund / reissue / void | `refund.approve` etc. | ✔ | ✔ | ✔ | ✔ |
| Change markup / discount / commission / FMG | `markup.manage` … | ✔ | ✔ | — | ✔ old/new |
| Approve / suspend partner | `partner.approve` / `partner.suspend` | ✔ | ✔ | — | ✔ |
| Create/modify employee, assign roles, edit role permissions | `employee.*`, `user.assign_role`, `role.manage` | ✔ | ✔ | — | ✔ |
| Reset password / reset 2FA of another user | `user.reset_password`, `user.reset_2fa` | ✔ | ✔ | ✔ (2FA reset) | ✔ |
| Change system configuration / ID formats | `config.manage` | ✔ | ✔ | — | ✔ |

Flags live in the `permissions` table (`requires_two_factor`, `requires_step_up`, `requires_maker_checker`), seeded from `shared/permissions.ts`, so policy is data, reviewable, and changeable without code deploys of controllers.

## 13. Readiness for Flight, Hotel, Visa, Umrah, Booking, Ticket, Refund, Reissue, Void, Finance

Nothing in schema v2 needs altering for these modules; each only **adds tables** that point at existing ones:

| Module | Adds | Plugs into |
|---|---|---|
| Flight / Search | `airlines`, `airports`, `search_sessions`, `fare_cache`, `supplier_partner_access` | `suppliers`, `api_logs`, `partners` |
| Pricing | `markup_rules`, `discount_rules`, `commission_rules`, `fmg_rules` | `partner_groups`, `suppliers`, `partners` |
| Booking / PNR / Ticket | `bookings`, `booking_segments`, `booking_passengers`, `pnrs`, `tickets` (+ `ledger_txn_id`, `hold_id`, `idempotency` refs) | `partners`, `users`, `suppliers`, `wallet_holds`, `ledger_transactions`, `idempotency_keys` |
| Refund / Reissue / Void | `refunds`, `reissues`, `voids` + quote/calculation tables | `tickets`, `ledger_transactions` (reference types exist) |
| Finance | `deposits`, `deposit_attachments`, `payment_gateway_txns`, `invoices`, `invoice_lines` (invoice: `id` UUID immutable + `invoice_no`) | `ledger_*`, `credit_lines`, `business_id_config`, `outbox_events` |
| Hotel / Visa / Umrah | `hotel_bookings`, `visa_products`, `visa_applications`, `umrah_packages`, `umrah_bookings`, `vouchers` | `partners`, `suppliers`, `ledger_*` (reference types exist), `attachments` (Phase 8 generic file table) |
| Ancillary | `ancillaries` | `bookings`, `ledger_*` |
| Reports / Notifications / Support | `report_jobs`, `notifications`, `notification_templates`, `support_tickets`, `support_messages` | `outbox_events`, `users`, `partners` |
| Deeper partner tree | none (change `partner.max_depth`) | `partner_hierarchy` |

Extensibility mechanisms already in place: polymorphic ledger references, enum `ADD VALUE` for new reference/transaction types, `business_id_config` rows for new ID formats, permission catalogue sync, `outbox_events` for async integration, generic `idempotency_keys`.

## 14. API delta vs v1 (Phase 1)

Added/changed endpoints (everything else in v1 section 4 stands):

| METHOD | ENDPOINT | AUTH | ROLE/PERMISSION | DESCRIPTION |
|---|---|---|---|---|
| POST | /auth/login | No | — | Returns session, or `mfaRequired`, or `mfaEnrollmentRequired` + enrolment-only token |
| POST | /auth/step-up | Yes | any | Confirm password/TOTP to unlock sensitive actions for 10 min |
| POST | /auth/2fa/recovery-codes/regenerate | Yes + step-up | any | New recovery codes (old ones invalidated) |
| GET | /auth/2fa/status | Yes | any | Enrolled?, required?, reason (role/permission/policy) |
| PUT | /users/:id/two-factor-policy | Yes + step-up | user.update | `INHERIT` / `REQUIRED` (enables 2FA for a B2B user later) |
| POST | /users/:id/two-factor/reset | Yes + step-up + maker-checker | user.reset_2fa | Remove lost device; forces re-enrolment |
| GET | /partners/:id/credit-line | Yes | credit.view | Limit, status, **derived** used/available/purchasing power |
| PUT | /partners/:id/credit-line | Yes + step-up | credit.manage | Set limit/validity (audited, maker-checker above threshold) |
| GET | /ledger/holds | Yes | wallet.view | Holds by status; filter pinned/expiring |
| POST | /ledger/holds/:id/release | Yes + step-up | wallet.adjust | Manual release of a pinned/stuck hold |
| GET | /business-ids | Yes | config.view | ID formats (invoice, partner…) |
| PATCH | /business-ids/:key | Yes + step-up | config.manage | Change template/pad/reset policy (future IDs only) |
| GET | /partners/:id/hierarchy | Yes | subpartner.view | Ancestors/descendants via closure table |

`Idempotency-Key` header is required on money-creating endpoints (none are public in Phase 1; the contract is fixed now).

## 15. Final consolidated checklist (what Step 2 will implement)

- [x] Schema v2 (snake_case, closure hierarchy, 2FA tables, credit-limit trigger design, holds, scoped idempotency, configurable ID formats)
- [x] Raw-SQL migration plan: `0000_bootstrap` (sequences, `next_business_id`, tracking fn) → `0001_init` (Prisma) → `0002_constraints` (CHECKs, partial uniques, `wallet_floor`, balanced-txn trigger, immutability triggers for `ledger_entries` and `activity_logs`, closure maintenance, `wallet_transactions_v` view, DB roles/grants, `[A-Z]` identifier lint)
- [x] Seeds: `seed:core` (permissions + flags, roles + `requires_two_factor`, role matrix, `business_id_config`, settings incl. `partner.max_depth=1`, platform ledger accounts, one SUPER_ADMIN via env — forced password change + forced 2FA enrolment at first login), `seed:dev` (development only)
- [x] Env contract (`FRONTEND_URL`, `API_URL`, `CORS_ORIGINS`, `AUTH_COOKIE_*`, plus v1 secrets/keys), boot-time validation
- [x] Security/audit/sensitive-action pipeline specified

**Remaining questions (small; I will use the defaults if you do not object):**
1. Default `booking.hold_minutes` = 15, hard cap 30 — OK?
2. Maker-checker threshold for credit-limit changes = any change above BDT 100,000 — OK, or always?
3. Step-up window = 10 minutes — OK?
4. Wallet currency = BDT only at launch (schema already supports more).

Please approve (or amend) and I will start **Step 2** (monorepo scaffold, Docker, env, NestJS/Next.js shells, Prisma migrations, auth + 2FA, RBAC, seeds).
