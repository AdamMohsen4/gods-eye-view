# ADR-003: Guest ids now, Clerk later; admin via bearer token

**Status:** accepted (temporary) · 2026-11-09

Auth and payments were explicitly deferred. Until Clerk lands:
- The client generates a UUID v4 and sends it as `x-guest-id`. The server
  upserts a guest user (no personal data; random "Explorer-XXXX" name). This is
  the "guest gets a local id, merged on sign-in" path from the spec; the merge
  happens when Clerk is added (`users.auth_id` is already in the schema).
- Admin endpoints use `Authorization: Bearer $ADMIN_TOKEN`, compared in
  constant time. Disabled when unset. Replace with Clerk roles.
- `users.plan` defaults to `free`; Stripe webhooks will set `plus`.
