-- The Researcher's Workspace, batch 1 (master plan, section 18).
--
-- Part 1: the tables of the sign-in library, Better Auth 1.7.22, exactly as
-- the library itself writes them (with its "anonymous" plugin for guests).
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- One ORCID iD can belong to one account only.
create unique index "account_provider_idx" on "account" ("providerId", "accountId");

-- Part 2: our own tables.

-- What an account tells about itself at sign-up, and the dates the server keeps.
create table "profile" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "institution" text,
  "ror_id" text,
  "country" text,
  "position" text,
  "field" text,
  "newsletter" integer not null default 0,
  "newsletter_at" text,
  "newsletter_sent_at" text,
  "newsletter_error" text,
  "completed_at" text,
  "last_seen_at" text,
  "warned_at" text
);

-- The Notebook: one row is one page.
create table "notebook_page" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "title" text not null default '',
  "body" text not null default '',
  "created_at" text not null,
  "updated_at" text not null
);
create index "notebook_page_user_idx" on "notebook_page" ("user_id", "updated_at");

-- The editor's two settings: invited emails, and whether the workspace is open.
create table "invite" ("email" text not null primary key, "invited_at" text not null);
create table "setting" ("key" text not null primary key, "value" text not null);
insert into "setting" ("key", "value") values ('open', 'no');
