-- The reader's own events, for the Chronology Maker (master plan, section 18,
-- stage 2, batch 4, Part B, B2 and B4). This is the only place the server
-- grows in Part B; the three case tools otherwise run in the page, from the
-- data files the site already publishes.
--
-- One row is one event a reader adds to a chronology. It is private, it is
-- marked as the reader's own on screen and in every export, and it is never
-- mixed silently into the Monitor's own items. `about_kind` is "actor" or
-- "country" and `about_ref` is the actor's name on the site or the country's
-- three-letter code, so an event sits on the same thing the rest of the
-- Workspace already saves. `day` is a year, a year and month, or a full day.
-- `source` is required, because an event without a source is of no use in
-- research.
create table "own_event" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "about_kind" text not null default '',
  "about_ref" text not null default '',
  "day" text not null default '',
  "what" text not null default '',
  "source" text not null default '',
  "created_at" text not null,
  "updated_at" text not null
);
create index "own_event_user_idx" on "own_event" ("user_id", "day");
create index "own_event_about_idx" on "own_event" ("user_id", "about_kind", "about_ref", "day");
