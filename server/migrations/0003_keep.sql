-- "Save" and "Note" everywhere, the Shelf and the Notes (master plan, section
-- 18, stage 2, batch 2). Every table names its owner, so one person's rows can
-- never be reached through another's.

-- One row is one thing a person keeps. Five kinds: work, item, actor, country,
-- chart. `ref` is the name the thing has on the site itself (a work's id in the
-- Library, "2026-1:14" for a Monitor item, "donald-trump", "DEU", or a Data
-- page with its chart and filters). The other columns are the small card the
-- shelf shows; for a work, `abstract` is the abstract as the Library had it
-- when the work was saved, so that marked passages have a text to sit in.
create table "kept" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "kind" text not null,
  "ref" text not null,
  "title" text not null default '',
  "extra" text not null default '',
  "url" text not null default '',
  "year" text not null default '',
  "country" text not null default '',
  "abstract" text not null default '',
  "status" text,
  "created_at" text not null,
  "updated_at" text not null
);
-- One person keeps one thing once: this is what makes a second "Save" change
-- the card instead of making a second row, however many requests arrive at once.
create unique index "kept_one_idx" on "kept" ("user_id", "kind", "ref");
create index "kept_user_idx" on "kept" ("user_id", "kind", "created_at");

-- One note for one thing: the note's key is the thing, so two requests at the
-- same moment cannot make two notes; the second changes the first.
create table "note" (
  "kept_id" text not null primary key references "kept" ("id") on delete cascade,
  "user_id" text not null references "user" ("id") on delete cascade,
  "body" text not null,
  "created_at" text not null,
  "updated_at" text not null
);
create index "note_user_idx" on "note" ("user_id", "updated_at");

-- The reader's own tags.
create table "tag" (
  "kept_id" text not null references "kept" ("id") on delete cascade,
  "user_id" text not null references "user" ("id") on delete cascade,
  "name" text not null,
  "added_at" text not null,
  primary key ("kept_id", "name")
);
create index "tag_user_idx" on "tag" ("user_id", "name");

-- A marked passage of an abstract: its own words and the place where it begins.
create table "mark" (
  "id" text not null primary key,
  "kept_id" text not null references "kept" ("id") on delete cascade,
  "user_id" text not null references "user" ("id") on delete cascade,
  "at" integer not null,
  "text" text not null,
  "added_at" text not null
);
create index "mark_kept_idx" on "mark" ("kept_id", "at");
