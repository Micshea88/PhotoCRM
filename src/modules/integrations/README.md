# Integrations module — the chassis

This module is the in-code framework for the Integrations Hub at
`/settings/integrations`. It ships the **shell** — categories,
providers, the predictive Browse view, the Connected Apps empty
state, the per-provider wizard, and a portable contextual popout for
the "no phone provider connected" affordance.

This module does NOT do any of the following — those land in later
pushes:

- OAuth flows (no client construction, no token exchange).
- Reads from `telephony_connections` or any future provider table.
- Real connect/disconnect actions (the Connect button is a stub).
- Webhook handlers.
- Per-user grant/revoke UI for "use phone as yourself".

## Why a code registry

The registry (`registry.ts`) is a static TS object — no DB. Provider
metadata changes near-never; storing it in the DB would buy nothing
and cost a migration every time we add a provider. Capability flags
are checked on every render; reading them from TS is free, and the
compiler enforces that every provider declares every flag.

## Capability honesty — the "absent never broken" rule

Each provider declares a `capabilityFlags` object. The UI reads it
and renders **only** the chips and affordances that flag as `true`.
Providers must never show a dead "Send SMS" button for a capability
they cannot deliver.

| Provider     | calling | sms | autoLog | webhook | dialer |
| ------------ | ------- | --- | ------- | ------- | ------ |
| ringcentral  | yes     | yes | yes     | yes     | yes    |
| google_voice |         |     |         |         | yes    |
| tel:         |         |     |         |         | yes    |

`connectKind` drives the affordance copy:

- `oauth` → "Connect" button (RingCentral).
- `handoff_only` → "Use as dialer" (Google Voice).
- `none` → "Always available" (tel:).

## Adding a new provider

1. Append to the `PROVIDERS` array in `registry.ts` with all five
   capability flags declared explicitly.
2. Add an entry to the capability honesty table above.
3. If the provider needs an icon the Lucide map doesn't have, add
   it to the icon resolver in `ui/provider-card.tsx`.

That's the whole loop. No migration, no schema edit, no action
plumbing — that all lands in the per-provider integration push.

## Layout

```
integrations/
  types.ts                 — TS shapes (no zod; no actions)
  registry.ts              — static categories + providers + helpers
  ui/
    integrations-page-tabs.tsx     — Browse / Connected Apps switcher
    integrations-browser.tsx       — predictive filter + category sections
    provider-card.tsx              — Card primitive wrap; capability chips
    category-detail.tsx            — single category + its providers
    provider-detail.tsx            — wizard shell; owner/admin gate
    connected-apps-empty.tsx       — empty-state block
    no-phone-provider-picker.tsx   — exported popout; NOT wired this push
```

## Gating

- The Integrations sidebar entry is **owner + admin only**
  (NAV_ROLE_VISIBILITY in `src/modules/org/ui/app-sidebar.tsx`).
- The Integrations route guard mirrors `/settings/custom-fields`:
  session → org → member → extended role; redirect to `/dashboard`
  for non-owner/admin.
- The provider-detail Connect button is also render-gated on
  `extendedRole ∈ {owner, admin}`. Other roles see an explainer
  ("Only owners and admins can connect integrations for this
  workspace.") instead of the button. The connect button itself is
  a stub this push.

## What's next (per the build plan)

1. **OAuth push** — wire the RingCentral connect handler to call into
   the OAuth client, persist the token via the
   `src/modules/telephony/schema.ts` table, and replace the stubbed
   `connectState`.
2. **Connection-state read push** — change `getConnectedProviders()`
   to query the live tables. Wire the `NoPhoneProviderPicker` popout
   to the contact card's Call/SMS no-connection branches without
   changing the existing `tel:` hand-off.
3. **Per-user grant push** — surface the per-member "can use phone as
   yourself" capability under the manager grant/revoke UI.
