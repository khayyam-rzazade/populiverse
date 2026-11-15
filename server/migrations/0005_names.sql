-- The name in three pieces: first name, middle name, surname (master plan,
-- section 18, Fable's check of batches 2 and 3, point 16). Kept apart, so that
-- the download of accounts has a surname to sort by and the newsletter gets
-- the first name itself.
--
-- Nothing is deleted. Three columns are added to the profile, and the name an
-- account gave before is copied into the first name, so that it stands there
-- when the account is asked once for its surname. The account's own name line
-- ("user"."name") is not touched here.
alter table "profile" add column "first_name" text;
alter table "profile" add column "middle_name" text;
alter table "profile" add column "surname" text;
update "profile" set "first_name" = (select "name" from "user" where "user"."id" = "profile"."user_id")
 where "first_name" is null;
