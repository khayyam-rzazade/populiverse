-- Write, projects and the Annotated Bibliography (master plan, section 18,
-- stage 2, batch 3). Every table names its owner, so one person's rows can
-- never be reached through another's, and nothing is stored as HTML.

-- The reference of a saved thing, as the site itself gives it: the Library's
-- own reference for a work, the issue's "Cite This Item" line for a Monitor
-- item, a Data page's own "How to cite" line for a chart. Nothing here is
-- formatted by us, and there is no choice of style.
alter table "kept" add column "cite" text not null default '';
alter table "kept" add column "bibtex" text not null default '';

-- A project: a question, and the things, notes, pages and one draft under it.
create table "project" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "title" text not null default '',
  "question" text not null default '',
  "created_at" text not null,
  "updated_at" text not null
);
create index "project_user_idx" on "project" ("user_id", "updated_at");

-- What of the shelf is in a project. Deleting a project deletes these rows
-- and nothing else, so the things themselves stay, loose.
create table "project_thing" (
  "project_id" text not null references "project" ("id") on delete cascade,
  "kept_id" text not null references "kept" ("id") on delete cascade,
  "user_id" text not null references "user" ("id") on delete cascade,
  "added_at" text not null,
  primary key ("project_id", "kept_id")
);
create index "project_thing_kept_idx" on "project_thing" ("kept_id");
create index "project_thing_user_idx" on "project_thing" ("user_id");

-- A page of the Notebook stands in at most one project, or in none.
alter table "notebook_page" add column "project_id" text;
create index "notebook_page_project_idx" on "notebook_page" ("project_id");

-- From this batch a page can carry the five formats, so its text is kept as the
-- editor's own document in `body`. `words` holds the same page as plain words,
-- which is what the list shows and what a search looks through. A page written
-- before this batch has plain words in `body` and nothing in `words`, and opens
-- unchanged.
alter table "notebook_page" add column "words" text not null default '';

-- A draft. `body` is the editor's own document, plain JSON, never HTML.
create table "draft" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "project_id" text,
  "title" text not null default '',
  "body" text not null default '',
  "words" integer not null default 0,
  "created_at" text not null,
  "updated_at" text not null
);
create index "draft_user_idx" on "draft" ("user_id", "updated_at");
-- One draft for one project (the row of 2026-11-13 on the mockup, point 10).
create unique index "draft_one_per_project" on "draft" ("project_id") where "project_id" is not null;

-- A chart or table sent to Write from a Data page: the picture as the page
-- drew it that day, with the page's own source and "How to cite" lines. The
-- data in it is fixed at that day and never changes afterwards.
create table "figure" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "ref" text not null default '',
  "title" text not null default '',
  "source" text not null default '',
  "cite" text not null default '',
  "url" text not null default '',
  "day" text not null default '',
  "width" integer not null default 0,
  "height" integer not null default 0,
  "picture" text not null default '',
  "created_at" text not null
);
create index "figure_user_idx" on "figure" ("user_id", "created_at");
