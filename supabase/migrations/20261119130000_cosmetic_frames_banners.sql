-- Cadres d'avatar et bannières (raptoru.fr, lot 3; docs/COSMETIC_SHOP.md § 9) — PRODUCTION schema. Same content as the
-- Lab file 20261119120000_cosmetic_frames_banners_lab.sql. Additive: widened checks NOT VALID (no table scan, no long
-- lock), two nullable columns without default (no rewrite); nothing existing is changed or deleted.
-- - progression_rewards: two new kinds, `frame` (the ornament around the viewer's avatar) and `banner` (the wide image
--   behind the player card). Same catalogue, possession (grants), shop, awards and revocation as titles and badges.
-- - progression_equipped: the equipped frame and banner (one each; checked owned by the Core, like the title).
-- - cosmetic_images: room for frames (square, up to 512 px, 96 Ko) and banners (4:1, up to 2048 px, 256 Ko). The
--   Core still checks every file on its bytes and against its kind's own rule (badges keep ≤ 128 px, ≤ 40 Ko).
-- Rollback (only once no frame / banner exists): alter table progression_equipped drop column frame_id, drop column
--   banner_id; then restore the three cosmetic_images checks (width / height between 1 and 128, size between 1 and
--   40960) and progression_rewards_kind_check (kind in ('title', 'badge')), each NOT VALID;
--   delete from schema_migrations where name = '20261119130000_cosmetic_frames_banners.sql';

alter table progression_rewards drop constraint if exists progression_rewards_kind_check;
alter table progression_rewards add constraint progression_rewards_kind_check
  check (kind in ('title', 'badge', 'frame', 'banner')) not valid;

alter table progression_equipped
  add column if not exists frame_id text,
  add column if not exists banner_id text;

alter table cosmetic_images drop constraint if exists cosmetic_images_width_check;
alter table cosmetic_images add constraint cosmetic_images_width_check check (width between 1 and 2048) not valid;
alter table cosmetic_images drop constraint if exists cosmetic_images_height_check;
alter table cosmetic_images add constraint cosmetic_images_height_check check (height between 1 and 2048) not valid;
alter table cosmetic_images drop constraint if exists cosmetic_images_size_check;
alter table cosmetic_images add constraint cosmetic_images_size_check check (size between 1 and 262144) not valid;
