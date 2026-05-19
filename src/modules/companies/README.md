# companies module

Lightweight company reference, used by the contacts module's typeahead +
inline-create picker. Per Tech Arch §2.2 and Build Spec §2: explicitly
**NOT** a full CRM company object in V1.

## What's here

- `schema.ts` — `companies` table. Standard lifecycle (soft-delete) +
  `custom_fields jsonb`. Partial unique index on `(organization_id, name)
WHERE deleted_at IS NULL` — same name can be reused after soft-delete.
  FK to organization is `ON DELETE RESTRICT` (matches files/items).
- `types.ts` — Zod input schemas for the 4 actions + `searchCompaniesInput`.
- `queries.ts` — `listCompaniesForOrg`, `getCompanyForOrg`,
  `searchCompaniesByName(q, limit)` for typeahead.
- `actions.ts` — `createCompany`, `updateCompany`, `deleteCompany` (soft),
  `restoreCompany`. Every action via `orgAction`; every state change
  audits; every action revalidates `/contacts` (the eventual consumer).

## What's deferred (parked decision per the spec)

This module ships the data layer only. **No routes**, no record page,
no pipelines, no activity timeline. The only UI surface in V1 is a
typeahead picker that lives in the contacts module's contact form
(when that ships).

V2+ may expand `companies` into a full HubSpot-style company object;
that is explicitly out of scope.

## Hard rules

1. **`website` and `main_phone` live HERE, not on contacts.** The whole
   point of the reference is that 5 contacts at "Evergreen Planning"
   share one website + one main line; entering them on each contact
   defeats the disambiguation case. The contact's own primary/secondary
   phones (their cell, etc.) stay on the contact.
2. **`category` is plain text in V1.** The Vendor Matrix module curates
   an enum and runs a migration to constrain values. Inline-create from
   the contact form shouldn't have to know the enum yet.
3. **Soft-delete only.** `deleteCompany` sets `deletedAt`; the cron
   purge (Phase 8 — already in `app/api/jobs/cron/purge-deleted/route.ts`)
   handles hard removal after the retention window. Add a `companies`
   case to that route when the module is wired into production
   workflows.
4. **RLS enforces org isolation.** Single policy, any org member can
   read and write companies — they're shared lightweight references.
   The 4 negative tests in `tests/integration/companies-rls.test.ts`
   prove cross-org reads/writes are blocked.
5. **All UI labels for "Company" go through the terminology resolver.**
   `getLabel("company")` returns the per-org label (defaults to
   "Company"/"Companies" via the photographer pack).

## Contact module's display rule (preview)

When contacts ships, the standard "Name — Company" display label
(Requirements §6.1) is built by:

```ts
import { contactLabel } from "@/modules/contacts/display"
// contactLabel({ first_name, last_name, company_id?, primary_email })
//   → "Smith, Kelly — Evergreen Planning"  (with company)
//   → "Smith, Kelly — kelly@example.com"  (no company; email fallback)
```

`contactLabel` resolves the company name by `company_id` via this
module's `getCompanyForOrg`. Two same-named contacts are always
distinguishable at a glance — that is the architectural reason this
table exists.
