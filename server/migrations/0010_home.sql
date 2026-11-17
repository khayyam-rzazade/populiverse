-- Home: what is new for what a reader follows (master plan, section 18, stage 2,
-- batch 5, Part B). One new table. Nothing that exists is changed or dropped.
--
-- To follow is to save: the actors and countries on a reader's shelf, which
-- holds the cases of the reader's projects too. What is new is counted from
-- the reader's last visit, kept here: `home_day` and `home_issue` are the day
-- of the latest visit and the newest Monitor issue the site named that day;
-- `before_issue` and `before_at` are the same of the visit before that day.
-- So what is new stays the same all through one day, however often Home is
-- opened, and the next day it is counted from this one.
create table "home_mark" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "home_day" text not null,
  "home_issue" text not null default '',
  "home_at" text not null,
  "before_issue" text,
  "before_at" text
);
