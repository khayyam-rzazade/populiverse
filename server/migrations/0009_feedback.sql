-- The feedback card of the Workspace (master plan, section 18, stage 2, batch 5,
-- Part A, and the plan of the card of 2026-11-16). Two new tables. Nothing that
-- exists is changed or dropped.
--
-- `feedback` holds one answer for each reader, a guest's too. A reader can
-- change it later from the account page, at most once a day, and the row is
-- changed in place, so there is never a second answer of the same reader.
-- `score` is the answer to "How useful is PopuliVerse for your work?", from 1
-- to 5. `uses` and `help` are the boxes ticked, in their own words and joined
-- by a line break. `missing` is what the reader typed under "What is missing
-- or awkward?", kept as plain text.
create table "feedback" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "score" integer not null,
  "uses" text not null default '',
  "missing" text not null default '',
  "help" text not null default '',
  "created_at" text not null,
  "updated_at" text not null
);

-- `feedback_card` counts the different days on which a reader opened the
-- Workspace, so that the card can come on the fifth, and keeps the day the
-- reader pressed "Not Now", so that it does not come again by itself.
create table "feedback_card" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "days" integer not null default 0,
  "last_day" text,
  "later_at" text
);
