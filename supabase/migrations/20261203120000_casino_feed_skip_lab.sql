-- Lab twin of 20261203130000_casino_feed_skip.sql (same content).
-- Casino spectators (docs/CASINO.md § 6): the feed also carries « skip » — the player pressed Passer on an animation
-- whose stage is already public; the spectators jump to the same end (no data: what is shown is already public).
-- Additive: the kind's check gains one value.
-- Rollback: redeploy the previous Core (it never writes « skip »); the wider check is harmless.

alter table casino_feed drop constraint if exists casino_feed_kind_check;
alter table casino_feed add constraint casino_feed_kind_check
  check (kind in ('start', 'result', 'coffre', 'step', 'end', 'draft', 'presence', 'skip'));
