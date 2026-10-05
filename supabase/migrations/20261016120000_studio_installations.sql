-- ASTRA-P1-019 (lot 1): one credential per Studio installation, for the future production transport
-- Studio → Core (replaces the shared STUDIO_SECRET for execution). Production scope only.
-- The Studio generates its installation id and secret once; Core stores only the SHA-256 of the
-- secret (a 256-bit random value: a fast hash is enough, nothing to brute-force). Revocation is a
-- timestamp checked on every request; a row is never deleted (audit).
create table studio_installations (
  installation_id uuid primary key,
  secret_sha256 text not null check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  label text not null check (length(label) between 1 and 80),
  created_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);
