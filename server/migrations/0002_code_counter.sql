-- The counter in front of the door that sends a code (master plan, section 18,
-- Fable's review of batch 1, fix a). One row for each code asked for an email
-- address. The address is not kept, only a fingerprint of it, and the nightly
-- job removes rows older than a day.
create table "code_ask" ("fingerprint" text not null, "asked_at" integer not null);
create index "code_ask_idx" on "code_ask" ("fingerprint", "asked_at");
