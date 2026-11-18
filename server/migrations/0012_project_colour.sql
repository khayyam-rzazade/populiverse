-- A colour for each project (the tidy-up and colour round of 17 November
-- 2026, Part F). One new column on a project: the colour the reader picked,
-- one of six fixed names, or nothing. Nothing that exists is changed or
-- dropped, and every project keeps no colour until its reader picks one.
--
-- The server accepts only the six names (src/lists.js, PROJECT_COLOURS), and
-- the database refuses any other word as well.
alter table "project" add column "colour" text
  check ("colour" is null or "colour" in ('moss', 'plum', 'slate', 'sand', 'rose', 'stone'));
