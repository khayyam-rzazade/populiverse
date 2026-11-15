// The fixed lists of the sign-up form. The page shows the same lists; the
// server accepts nothing else.

export const POSITIONS = [
  "PhD Candidate",
  "Postdoctoral Researcher",
  "Lecturer or Assistant Professor",
  "Associate Professor",
  "Professor",
  "Researcher Outside Academia",
  "Student",
  "Journalist",
  "Policy or NGO",
  "Other"
];

export const FIELDS = [
  "Political Science",
  "International Relations",
  "Sociology",
  "Communication and Media",
  "History",
  "Economics",
  "Law",
  "Philosophy",
  "Other"
];

// Two-letter country codes (ISO 3166-1), for an institution typed by hand.
export const COUNTRIES = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
  ).split(" ")
);

// Limits that keep the database safe from misuse.
export const LIMITS = {
  pagesPerAccount: 2000,
  pagesPerGuest: 20,
  charsPerPage: 200000,
  charsPerTitle: 200,
  charsPerName: 120,
  charsPerInstitution: 200,
  invites: 500,
  // What a reader keeps (batch 2). A guest's limit is there so that a script
  // cannot fill the database (section 17, item 37).
  keptPerAccount: 2000,
  keptPerGuest: 50,
  charsPerRef: 200,
  charsPerCard: 600,
  charsPerExtra: 300,
  charsPerAbstract: 6000,
  charsPerNote: 20000,
  charsPerTag: 40,
  tagsPerThing: 12,
  charsPerMark: 1000,
  marksPerWork: 50,
  // Write, projects and the figures sent from the Data pages (batch 3).
  projectsPerAccount: 200,
  projectsPerGuest: 3,
  thingsPerProject: 2000,
  draftsPerAccount: 200,
  draftsPerGuest: 3,
  charsPerDraft: 400000,
  charsPerQuestion: 600,
  // A picture of a whole map, drawn 1200 wide with the typeface inside it, is
  // the largest a Data page sends; the limit leaves room for it, and stays well
  // under what one row of the database may hold (2 MB).
  figuresPerAccount: 30,
  figuresPerGuest: 3,
  charsPerFigure: 900000,
  charsPerSource: 2000,
  charsPerCite: 2000,
  charsPerBibtex: 4000,
  // Cloudflare's database takes a LIKE pattern of at most 50 bytes, so what a
  // reader searches for is cut to fit before it becomes one.
  bytesPerPattern: 46
};
