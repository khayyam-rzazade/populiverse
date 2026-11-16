-- The registration form of batch 4 (master plan, section 18, stage 2, batch 4,
-- Part A). Five columns are added to the profile. Nothing is deleted and
-- nothing an account already gave is changed.
--
-- `interests` is one line a person writes about their research, up to 200
-- characters, and is not required. `commentary` is the answer to the one
-- question that must be answered, in its own words ("Yes", "Maybe Later",
-- "No"), and `commentary_at` is the day it was answered. `position_other` and
-- `field_other` hold what is typed when the answer is "Other"; they stand
-- beside the answer and never in place of it.
--
-- An account from before this day has no answer on the Commentary, so it is
-- asked once, at its next visit, for the answers of this form only (A4).
alter table "profile" add column "interests" text;
alter table "profile" add column "commentary" text;
alter table "profile" add column "commentary_at" text;
alter table "profile" add column "position_other" text;
alter table "profile" add column "field_other" text;
