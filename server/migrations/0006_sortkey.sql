-- The order of names with accents (the live check before the trial, point 4).
-- SQLite's own order folds only the plain letters A to Z, so "Böller" came
-- after "Bruno" on the shelf, in the "@" list and in the Annotated
-- Bibliography. Each saved thing now carries its name folded for ordering:
-- small letters, accents taken off ("Böller" is kept as "boller").
--
-- Nothing is deleted or changed here: one column is added, empty, and an index
-- for it. The server fills the column when a thing is saved, and fills it for
-- the things saved before this day the first time a person's list is read in
-- order (server/src/keep.js, fillSortNames). Until then the old order stands.
alter table "kept" add column "sort_name" text;
create index "kept_sort_idx" on "kept" ("user_id", "kind", "sort_name");
