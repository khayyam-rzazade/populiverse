-- The email of what is new (master plan, section 18, stage 2, batch 5, Part D).
-- One new table: who asked for the email, and what each reader was sent.
-- Nothing that exists is changed or dropped.
--
-- `wanted` is 1 while the reader wants the email, and 0 from the moment they
-- turn it off or use the link in an email. A guest never has a row: a guest
-- has no address. `stop_token` is the long random key in the link that stops
-- the email; it stops it and does nothing else. `sent_issue` is the folder of
-- the last Monitor issue the reader was sent (or, on the first night after the
-- reader asked, the issue that was newest then), and `sent_at` its time, so
-- that a job that runs again sends nothing again, and the works of the Library
-- are counted from that time.
create table "digest" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "wanted" integer not null default 0,
  "wanted_at" text,
  "stop_token" text not null,
  "sent_issue" text,
  "sent_at" text
);
create unique index "digest_stop_idx" on "digest" ("stop_token");
