# ---------------------------------------------------------------------------
# PopuliVerse Library: search the open catalogue OpenAlex for works that name
# populism in their title, and check every DOI at the DOI registry (Crossref).
#
# HOW TO RUN IT (in RStudio, with the populiverse project open):
#
#     source("scripts/search_works.R")
#
# WHAT IT DOES, IN ORDER
#   1. Counts. Asks OpenAlex how many journal articles and books carry
#      "populism" or "populist" in their title, and shows what fetching the
#      list costs out of today's free allowance. Nothing else happens until
#      you type yes.
#   2. The list. Fetches the list of these works (title, year, journal, DOI,
#      citations; no abstracts), also for rarer forms of the word such as
#      "neopopulism", and sorts out, by fixed rules, what cannot enter: works
#      already in the Library, other languages, corrections, book reviews,
#      preprints, repeats. Every work left out or set aside keeps the reason,
#      in plain words.
#   3. The records. For the most cited works that are not yet in the Library it
#      fetches the abstract from OpenAlex and asks the DOI registry (Crossref)
#      for the same DOI. A DOI counts as confirmed only when the two catalogues
#      agree on the title, the year, the kind of work, the journal and the
#      first author, and nothing says the work is not in English. Everything
#      else is set aside with its reason. Nothing is guessed.
#   4. Writes two files into drafts/ and prints a report.
#
# WHAT IT NEVER DOES
#   It spends nothing: it uses only the free daily allowance of OpenAlex and
#   stops before that is used up (a prepaid balance, if there were one, is never
#   touched). It never touches Zotero and never changes the site. The drafts
#   folder is never published.
#
# It can be stopped and started again: what was fetched is kept. Once the list
# is fetched it is not fetched again: running the same line later (for example
# after a batch has entered the Library) checks the next most cited works from
# the same list, which costs almost nothing. To search afresh, delete the file
# drafts/search-01-cache.rds first.
# ---------------------------------------------------------------------------

local({

  SCRIPT_VERSION <- "2026-10-02.1"
  SEARCH_ID <- "01"                 # the files of this search: drafts/search-01-...
  DRAFTS    <- "drafts"
  TOP       <- 2000                 # how many of the most cited works get their record checked
  RESERVE   <- 0.10                 # dollars of today's free allowance that are never touched
  BLIND_CAP <- 0.80                 # the most one run spends when OpenAlex does not tell what is left

  # The words asked for in the title. OpenAlex looks for whole words, so every
  # form needs its own question; a plural is found with its singular.
  MAIN_TERMS <- c("populism", "populist")
  RARE_TERMS <- c("populistic", "neopopulism", "neopopulist", "technopopulism", "technopopulist",
                  "ethnopopulism", "ethnopopulist", "antipopulism", "antipopulist",
                  "postpopulism", "postpopulist", "petropopulism", "telepopulism", "cyberpopulism")
  # Only needed if OpenAlex's search without word-stemming has to be used:
  PLURALS    <- c("populisms", "populists", "neopopulists", "technopopulists", "ethnopopulists",
                  "antipopulists", "postpopulists")

  # The two kinds of work the Library takes, as OpenAlex's filters say them.
  KINDS <- list(
    article = "type:article|review,primary_location.source.type:journal,has_doi:true,is_retracted:false",
    book    = "type:book,has_doi:true,is_retracted:false")
  LIST_FIELDS <- paste0("id,doi,display_name,publication_year,publication_date,type,language,",
                        "cited_by_count,is_retracted,primary_location,authorships,biblio,open_access,indexed_in")

  # DOIs of preprint servers and repositories: never the published work.
  REPOSITORY_DOIS <- c("10.2139/", "10.31235/", "10.31219/", "10.17605/", "10.5281/", "10.13140/", "10.48550/",
                       "10.21203/", "10.20944/", "10.31234/", "10.6084/", "10.7910/", "10.33774/")

  # The settings below exist for automated tests only.
  OPENALEX <- Sys.getenv("OPENALEX_API_BASE", "https://api.openalex.org")
  CROSSREF <- Sys.getenv("CROSSREF_API_BASE", "https://api.crossref.org")
  PAUSE    <- as.numeric(Sys.getenv("SEARCH_WORKS_PAUSE", "0.25"))    # between two questions to Crossref
  WAIT     <- as.numeric(Sys.getenv("SEARCH_WORKS_WAIT", "1"))        # 0 in tests: no waiting between retries
  if (nzchar(Sys.getenv("SEARCH_WORKS_TOP"))) TOP <- as.integer(Sys.getenv("SEARCH_WORKS_TOP"))
  USER_AGENT <- "PopuliVerse search_works.R (github.com/khayyam-rzazade/populiverse)"

  COST_SEARCH <- 0.001              # OpenAlex's price list of 2026: a request with a text search
  COST_LIST   <- 0.0001             # a request with filters only

  `%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a
  say <- function(...) cat(..., "\n", sep = "")
  halt <- function(...) stop(structure(class = c("pv_stop", "error", "condition"),
                                       list(message = paste0(...), call = NULL)))
  pause_run <- function(...) stop(structure(class = c("pv_pause", "error", "condition"),
                                            list(message = paste0(...), call = NULL)))
  short <- function(x, n = 60) { x <- x %||% ""; if (nchar(x) > n) paste0(substr(x, 1, n - 3), "...") else x }
  num <- function(x) format(x, big.mark = ",", scientific = FALSE, trim = TRUE)
  money <- function(x) sprintf("$%.2f", x)
  one_line <- function(x) trimws(gsub("\\s+", " ", x, perl = TRUE))
  txt <- function(x) if (is.null(x) || length(x) == 0 || is.na(x[[1]])) "" else as.character(x[[1]])
  # A title as plain text: "&amp;" and the like written out, markup such as <i> removed.
  plain_title <- function(x) {
    x <- gsub("&amp;", "&", x, fixed = TRUE); x <- gsub("&lt;", "<", x, fixed = TRUE); x <- gsub("&gt;", ">", x, fixed = TRUE)
    x <- gsub("&quot;", "\"", x, fixed = TRUE); x <- gsub("&#39;|&apos;", "'", x)
    one_line(gsub("</?[A-Za-z][^>]*>", "", x))
  }

  use_utf8 <- function() {
    if (!isTRUE(l10n_info()[["UTF-8"]])) {
      for (loc in c("C.UTF-8", "en_US.UTF-8", "UTF-8")) {
        if (nzchar(suppressWarnings(Sys.setlocale("LC_CTYPE", loc)))) break
      }
    }
  }

  ensure_packages <- function() {
    needed  <- c("httr", "jsonlite", "yaml")
    missing <- needed[!vapply(needed, requireNamespace, logical(1), quietly = TRUE)]
    if (!length(missing)) return(invisible())
    if (!interactive()) halt("These R packages are missing: ", paste(missing, collapse = ", "), ".")
    say("Installing R packages this script needs (one time only): ", paste(missing, collapse = ", "))
    utils::install.packages(missing)
    still <- missing[!vapply(missing, requireNamespace, logical(1), quietly = TRUE)]
    if (length(still)) halt("These R packages could not be installed: ", paste(still, collapse = ", "),
                            ". Paste this message to Claude.")
  }

  read_yaml_utf8 <- function(path) yaml::yaml.load(paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n"))

  # ---- comparing two records (the same rules as scripts/find_works.R) --------

  # Lower case, accents removed, everything but letters and digits dropped.
  fold <- function(x) {
    x <- tolower(x)
    x <- gsub("<[^>]+>", " ", x)
    x <- gsub("&amp;", " and ", x, fixed = TRUE)
    x <- gsub("&", " and ", x, fixed = TRUE)
    from <- "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u0101\u0103\u0105\u00e7\u0107\u010d\u010f\u0111\u00e8\u00e9\u00ea\u00eb\u0113\u0117\u0119\u011b\u011f\u00ec\u00ed\u00ee\u00ef\u012b\u0131\u0142\u00f1\u0144\u0148\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u0151\u0159\u015b\u015f\u0161\u0219\u0165\u021b\u00f9\u00fa\u00fb\u00fc\u016b\u016f\u0171\u00fd\u00ff\u017a\u017c\u017e"
    to   <- "aaaaaaaaacccddeeeeeeeegiiiiiilnnnoooooooorsssstttuuuuuuuyyzzz"
    x <- chartr(from, to, x)
    x <- gsub("\u00df", "ss", x, fixed = TRUE)
    x <- gsub("\u00e6", "ae", x, fixed = TRUE)
    x <- gsub("\u0153", "oe", x, fixed = TRUE)
    trimws(gsub("[^a-z0-9]+", " ", x))
  }

  close_enough <- function(a, b) {
    if (!nzchar(a) || !nzchar(b)) return(FALSE)
    if (identical(a, b)) return(TRUE)
    sa <- gsub(" ", "", a, fixed = TRUE); sb <- gsub(" ", "", b, fixed = TRUE)
    if (identical(sa, sb)) return(TRUE)
    longer <- max(nchar(a), nchar(b)); shorter <- min(nchar(a), nchar(b))
    if (shorter >= 20 && shorter >= 0.6 * longer && (startsWith(sa, sb) || startsWith(sb, sa))) return(TRUE)
    # one is the other plus a subtitle
    if (shorter >= 12 && shorter >= 0.6 * longer &&
        (startsWith(a, paste0(b, " ")) || startsWith(b, paste0(a, " ")))) return(TRUE)
    # a slip of a few letters in a long title
    if (shorter >= 25 && abs(nchar(a) - nchar(b)) <= 4) {
      return(as.integer(utils::adist(a, b)) <= max(2, floor(0.05 * longer)))
    }
    FALSE
  }

  # Do the two catalogues give the same title? A catalogue often stores a book
  # without its subtitle, so the part before the colon may stand for the whole.
  main_part <- function(x) fold(sub("\\s*[:.?!]\\s.*$", "", x))
  same_title <- function(a, b, b_sub = "") {
    ta <- fold(a); tb <- fold(b)
    if (close_enough(ta, tb)) return(TRUE)
    if (nzchar(b_sub) && close_enough(ta, fold(paste(b, b_sub)))) return(TRUE)
    ma <- main_part(a); mb <- main_part(b)
    (nchar(ma) >= 8 && identical(ma, tb)) || (nchar(mb) >= 8 && identical(mb, ta))
  }

  # The last word of a name ("Cristobal Rovira Kaltwasser" -> "kaltwasser").
  last_word <- function(x) sub("^.* ", "", fold(x))

  # Is the first author that OpenAlex names among the people the registry names?
  # NA when one of the two names nobody.
  same_author <- function(first_author, families) {
    fam <- last_word(first_author)
    names <- gsub(" ", "", vapply(families, fold, ""))
    names <- names[nzchar(names)]
    if (!nzchar(fam) || !length(names)) return(NA)
    any(names == fam | (nchar(fam) >= 4 & grepl(fam, names, fixed = TRUE)) |
          (nchar(names) >= 4 & vapply(names, function(n) grepl(n, fam, fixed = TRUE), logical(1))))
  }

  # Journal names are compared loosely, so that "JCMS: Journal of Common Market
  # Studies" still equals "Journal of Common Market Studies": at least half of
  # the words of the shorter name must agree.
  same_journal <- function(a, b) {
    words <- function(x) setdiff(strsplit(fold(x), " ", fixed = TRUE)[[1]], c("", "the", "of", "and", "for", "in", "a", "an"))
    wa <- words(a); wb <- words(b)
    if (!length(wa) || !length(wb)) return(NA)
    length(intersect(wa, wb)) / min(length(wa), length(wb)) >= 0.5
  }

  # Is this a whole abstract? At least 250 characters, ending like a sentence,
  # not cut off (the rule of scripts/tag_library.R), and not a publisher's placeholder.
  whole_abstract <- function(a) {
    a <- one_line(a)
    nchar(a) >= 250 && grepl("[.!?\"'\u201d\u2019)\\]]$", a, perl = TRUE) && !grepl("(\\.\\.\\.|\u2026)$", a, perl = TRUE) &&
      !grepl("(?i)abstract (is )?not available|no abstract|preview has been provided|click on the article title|get access link",
             a, perl = TRUE)
  }

  clean_jats <- function(x) {
    x <- gsub("<jats:title>[^<]*</jats:title>", " ", x)
    one_line(gsub("<[^>]+>", " ", x))
  }

  norm_doi <- function(x) sub("^(https?://(dx\\.)?doi\\.org/|doi:\\s*)", "", trimws(tolower(x)))

  # ---- asking a catalogue -----------------------------------------------------

  get_json <- function(url, query = NULL, longest_wait = 60) {
    last <- 0L; body <- NULL
    for (attempt in 1:4) {
      resp <- tryCatch(httr::GET(url, query = query, httr::user_agent(USER_AGENT), httr::timeout(60)),
                       error = function(e) NULL)
      if (is.null(resp)) { last <- 0L; body <- NULL; Sys.sleep(WAIT * 2 * attempt); next }
      last <- httr::status_code(resp)
      body <- tryCatch(jsonlite::fromJSON(httr::content(resp, as = "text", encoding = "UTF-8"), simplifyVector = FALSE),
                       error = function(e) NULL)
      if (last %in% c(429L, 500L, 502L, 503L, 504L)) {
        wait <- suppressWarnings(as.numeric(httr::headers(resp)[["retry-after"]] %||% NA))
        Sys.sleep(WAIT * min(if (is.na(wait)) 3 * attempt else wait, longest_wait)); next
      }
      return(list(status = last, body = body))
    }
    list(status = last, body = body)
  }

  # What a catalogue itself says about a refused request, in one line.
  no_key <- function(x) gsub("api_key=[^&[:space:]\"']+", "api_key=...", x)      # the key never appears in a message
  why_refused <- function(r) {
    b <- r$body
    msg <- if (is.list(b)) one_line(paste(txt(b$error), txt(b$message))) else ""
    paste0("code ", r$status, if (nzchar(msg)) paste0(": ", short(no_key(msg), 300)) else "")
  }

  # ---- OpenAlex: the key and today's free allowance ----------------------------

  oa <- new.env()
  oa$total <- 0; oa$left <- NA_real_; oa$prepaid <- 0; oa$budget <- NA_real_; oa$before <- 0; oa$reserve <- RESERVE

  read_allowance <- function(key) {
    r <- get_json(paste0(OPENALEX, "/rate-limit"), list(api_key = key), longest_wait = 5)
    rl <- if (is.list(r$body)) r$body$rate_limit else NULL
    left <- suppressWarnings(as.numeric(rl$daily_remaining_usd %||% NA))
    if (r$status == 200L && length(left) == 1 && !is.na(left)) {
      prepaid <- suppressWarnings(as.numeric(rl$prepaid_remaining_usd %||% rl$prepaid_balance_usd %||% 0))
      return(list(left = left, prepaid = if (length(prepaid) == 1 && !is.na(prepaid)) prepaid else 0,
                  budget = suppressWarnings(as.numeric(rl$daily_budget_usd %||% NA))))
    }
    NULL
  }
  # What can still be spent in this run without touching the reserve. The
  # allowance is read once, at the start; from then on the script counts what
  # it spends itself.
  available <- function() (if (is.na(oa$left)) BLIND_CAP else oa$left) - oa$total - oa$reserve

  # One paid question to OpenAlex. It is not sent if it would touch the reserve.
  oa_get <- function(query, cost, key) {
    if (available() < cost) {
      pause_run("Today's free allowance at OpenAlex is nearly used up, and the script keeps a reserve. ",
                "What was fetched is kept. Run the same line again tomorrow: it goes on where it stopped.")
    }
    r <- get_json(paste0(OPENALEX, "/works"), c(query, list(api_key = key)), longest_wait = 10)
    if (r$status == 429L) {
      pause_run("OpenAlex says that today's free allowance is used up. What was fetched is kept. ",
                "Run the same line again tomorrow: it goes on where it stopped.")
    }
    if (r$status == 200L) {
      paid <- suppressWarnings(as.numeric(r$body$meta$cost_usd %||% NA))
      if (length(paid) != 1 || is.na(paid)) paid <- cost
      oa$total <- oa$total + paid
    }
    r
  }

  # A list request. It asks for the short form of the records (only the fields
  # needed); if OpenAlex refuses that, it asks for the full records, from then on.
  oa_list <- function(query, fields, cost, key) {
    fewer <- function(f) paste(setdiff(strsplit(f, ",", fixed = TRUE)[[1]], c("publication_date", "is_retracted", "indexed_in")), collapse = ",")
    form <- cache$short_form %||% "all"
    first <- NULL
    if (identical(form, "all")) {
      r <- oa_get(c(query, list(select = fields)), cost, key)
      if (r$status != 400L) return(r)
      first <- r; form <- "fewer"
    }
    if (identical(form, "fewer")) {
      r <- oa_get(c(query, list(select = fewer(fields))), cost, key)
      if (r$status == 200L) { cache$short_form <- "fewer"; return(r) }
      if (r$status != 400L) return(r)
      first <- first %||% r; form <- "none"
    }
    r <- oa_get(query, cost, key)
    if (r$status == 200L) { cache$short_form <- "none"; return(r) }
    if (is.null(first)) r else first
  }

  save_setting <- function(name, value) {
    path <- path.expand("~/.Renviron")
    old <- if (file.exists(path)) readLines(path, warn = FALSE) else character()
    old <- old[!grepl(paste0("^\\s*", name, "\\s*="), old)]
    writeLines(c(old, paste0(name, "=", value)), path)
    Sys.chmod(path, mode = "0600")
    do.call(Sys.setenv, stats::setNames(list(value), name))
  }

  ask <- function(title, text, secret) {
    if (!interactive()) return("")
    v <- NULL
    if (requireNamespace("rstudioapi", quietly = TRUE) && rstudioapi::isAvailable()) {
      v <- if (secret) rstudioapi::askForPassword(text) else rstudioapi::showPrompt(title, text)
    } else if (requireNamespace("askpass", quietly = TRUE) && secret) {
      v <- askpass::askpass(text)
    } else {
      v <- readline(paste0(text, ": "))
    }
    trimws(v %||% "")
  }

  settings <- function() {
    email <- Sys.getenv("POPULIVERSE_EMAIL")
    if (!nzchar(email) && interactive()) {
      email <- ask("Your email address", "Your email address (Crossref asks for one, to answer faster; it is kept on this Mac only)", FALSE)
      if (grepl("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", email, perl = TRUE)) save_setting("POPULIVERSE_EMAIL", email) else email <- ""
    }
    key <- Sys.getenv("OPENALEX_API_KEY"); fresh <- FALSE
    if (!nzchar(key) && interactive()) {
      say("  No OpenAlex key on this Mac yet: a box asks for it now.")
      key <- ask("OpenAlex key", "Paste your OpenAlex key (free, from openalex.org, Settings, API key)", TRUE)
      if (grepl("\\s", key)) key <- ""
      fresh <- TRUE
    }
    if (!nzchar(key)) halt("This search needs your free OpenAlex key, and none was found on this Mac. ",
                           "Nothing was asked. Run the line again and paste the key into the box.")
    # one free question shows whether OpenAlex accepts the key
    r <- get_json(paste0(OPENALEX, "/works/doi:10.1017/S0260210519000184"), list(select = "id", api_key = key), longest_wait = 5)
    if (r$status == 0L) halt("OpenAlex did not answer. Check the internet connection and run the line again.")
    if (r$status == 429L) halt("OpenAlex says that today's free allowance is used up. Nothing was fetched. Run the line again tomorrow.")
    if (!(r$status %in% c(200L, 404L))) {
      halt("OpenAlex does not accept this key (", why_refused(r), "). Nothing was fetched. ",
           "Check the key on openalex.org (Settings, API key) and run the line again.")
    }
    if (fresh) save_setting("OPENALEX_API_KEY", key)
    list(email = email, key = key)
  }

  # ---- what the Library holds already ------------------------------------------

  read_library <- function() {
    if (!file.exists("library/library.json")) halt("library/library.json is missing. In GitHub Desktop, click \"Pull origin\", then run the line again.")
    lib <- jsonlite::fromJSON(paste(readLines("library/library.json", encoding = "UTF-8", warn = FALSE), collapse = "\n"),
                              simplifyVector = FALSE)
    e <- lib$entries %||% list()
    first_person <- function(x) {
      p <- (x$authors %||% list()); if (!length(p)) p <- (x$editors %||% list())
      if (length(p)) txt(p[[1]]$family) else ""
    }
    dois <- norm_doi(vapply(e, function(x) txt(x$doi), ""))
    titles <- vapply(e, function(x) txt(x$title), "")
    people <- vapply(e, first_person, "")
    types <- vapply(e, function(x) txt(x$type), "")
    # the batch files too: a work may be in Zotero and not yet in library.json
    for (f in list.files("library/batches", pattern = "^batch-[0-9]+\\.yml$", full.names = TRUE)) {
      b <- tryCatch(read_yaml_utf8(f), error = function(err) NULL)
      dois <- c(dois, norm_doi(vapply(b$works %||% list(), function(w) txt(w$doi), "")))
    }
    list(n = length(e), updated = txt(lib$meta$updated),
         dois = unique(dois[nzchar(dois)]),
         keys = unique(paste(fold(titles), last_word(people), sep = "|")),
         book_titles = unique(fold(titles[types == "type:book"])))
  }

  # ---- one work of OpenAlex's list, as one row ----------------------------------

  oa_row <- function(w, kind, term) {
    loc <- w$primary_location %||% list(); src <- loc$source %||% list()
    people <- vapply(w$authorships %||% list(), function(a) txt(a$author$display_name %||% a$raw_author_name), "")
    people <- people[nzchar(people)]
    if (length(people)) people <- one_line(people)
    c(openalex_id = sub("^https?://openalex\\.org/", "", txt(w$id)),
      doi = norm_doi(txt(w$doi)),
      title = plain_title(txt(w$display_name %||% w$title)),
      year = txt(w$publication_year), date = txt(w$publication_date),
      kind = kind, type = txt(w$type), language = txt(w$language),
      cited_by_count = txt(w$cited_by_count), is_retracted = txt(w$is_retracted),
      journal = one_line(txt(src$display_name)), source_type = txt(src$type), issn_l = txt(src$issn_l),
      publisher = one_line(txt(src$host_organization_name)),
      is_core = txt(src$is_core), listed_in = paste(unlist(src$listed_in), collapse = ";"),
      raw_type = txt(loc$raw_type),
      first_author = if (length(people)) people[1] else "",
      authors = paste(utils::head(people, 10), collapse = "; "), n_authors = as.character(length(people)),
      volume = txt(w$biblio$volume), issue = txt(w$biblio$issue),
      first_page = txt(w$biblio$first_page), last_page = txt(w$biblio$last_page),
      is_oa = txt(w$open_access$is_oa), oa_status = txt(w$open_access$oa_status),
      indexed_in = paste(unlist(w$indexed_in), collapse = ";"),
      terms = term)
  }

  abstract_text <- function(inv) {
    if (!length(inv)) return("")
    pos <- unlist(inv, use.names = FALSE); words <- rep(names(inv), lengths(inv))
    one_line(paste(words[order(pos)], collapse = " "))
  }

  # ---- sorting out the list, by fixed rules --------------------------------------

  # a book review that says so
  REVIEW_RX  <- "(?i)\\bbook reviews?\\b|\\breviewed by\\b|\\breviewed work\\b"
  # a title that may be a book review
  REVIEW2_RX <- "(?i)^\\s*reviews? of\\b|^\\s*review\\s*[:.]|\\b(review|book) symposium\\b|\\bbooks? in review\\b|\\bbook notes?\\b"
  # a correction, an erratum, a retraction notice: the word, then a colon, a dash, "to", "for", or nothing
  NOTICE_RX  <- paste0("(?i)^\\s*(correction|corrigendum|corrigenda|erratum|errata|retraction|retraction notice|retracted|",
                       "retracted article|withdrawn|addendum|expression of concern|publisher.?s note|notice of retraction)",
                       "\\s*([:.\u2013\u2014-]|to\\b|for\\b|$)")
  # the traces of a book notice in a title: a press, a price, a page count
  TAIL_RX    <- paste0("(?i)university press|\\bisbn\\b|\\b(hardback|hardcover|paperback|cloth)\\b|[$\u00a3\u20ac]\\s?[0-9]|",
                       "\\b[0-9]{2,4}\\s?pp\\b|\\bpp\\.\\s?[0-9ivxl]")

  sort_out <- function(d, lib) {
    n <- nrow(d)
    status <- rep("", n)
    mark <- function(which, text) { which <- which & !nzchar(status); status[which] <<- text; invisible() }
    t_fold <- fold(d$title)
    cites <- suppressWarnings(as.integer(d$cited_by_count)); cites[is.na(cites)] <- 0L

    mark(!grepl("populis", d$title, ignore.case = TRUE), "left out: the title does not name populism")
    mark(!nzchar(d$doi), "left out: no DOI")
    mark(d$doi %in% lib$dois, "already in the Library")
    mark(nzchar(d$language) & d$language != "en", "left out: not in English, by OpenAlex")
    mark(d$is_retracted == "TRUE", "left out: retracted")
    mark(vapply(d$doi, function(x) any(startsWith(x, REPOSITORY_DOIS)), logical(1)), "left out: preprint or repository record")
    mark(grepl(NOTICE_RX, d$title, perl = TRUE), "left out: correction or notice")
    mark(d$kind == "article" & grepl(REVIEW_RX, d$title, perl = TRUE), "left out: book review")
    # the Library holds a work with this title and first author under another DOI (or without one)
    key <- paste(t_fold, last_word(d$first_author), sep = "|")
    mark(nzchar(d$first_author) & key %in% lib$keys, "set aside: the Library holds a work with this title and first author")
    mark(d$kind == "article" & grepl(REVIEW2_RX, d$title, perl = TRUE), "set aside: may be a book review, by its title")
    mark(d$kind == "article" & grepl(TAIL_RX, d$title, perl = TRUE), "set aside: the title looks like a notice of a book")
    # an article that carries the full title of a book (three words or more)
    books <- unique(c(lib$book_titles, t_fold[d$kind == "book"]))
    books <- books[lengths(strsplit(books, " ", fixed = TRUE)) >= 3]
    mark(d$kind == "article" & t_fold %in% books, "set aside: carries the title of a book (may be a review of it)")
    # three pages or fewer: often a review or a note
    p1 <- suppressWarnings(as.integer(d$first_page)); p2 <- suppressWarnings(as.integer(d$last_page))
    mark(d$kind == "article" & !is.na(p1) & !is.na(p2) & p2 >= p1 & (p2 - p1) <= 2,
         "set aside: three pages or fewer (may be a review or a note)")
    mark(!nzchar(d$first_author), "set aside: OpenAlex names no author")
    # the same title and first author twice: the more cited record stays
    open <- which(!nzchar(status))
    if (length(open)) {
      k <- paste(d$kind[open], key[open], sep = "|")
      ord <- order(-cites[open], d$openalex_id[open])
      later <- open[ord][duplicated(k[ord])]
      status[later] <- "set aside: same title and first author as a more cited record"
    }
    status[!nzchar(status)] <- "candidate"
    d$status <- status
    d$cited_by_count <- cites
    d
  }

  # ---- the DOI registry (Crossref) -----------------------------------------------

  crossref_record <- function(doi, email) {
    path <- paste(vapply(strsplit(doi, "/", fixed = TRUE)[[1]], utils::URLencode, "", reserved = TRUE), collapse = "/")
    r <- get_json(paste0(CROSSREF, "/works/", path), if (nzchar(email)) list(mailto = email) else NULL)
    if (r$status == 404L) return(list(answered = TRUE, found = FALSE))
    it <- if (is.list(r$body)) r$body$message else NULL
    if (r$status != 200L || !is.list(it)) return(list(answered = FALSE))
    people <- it$author %||% list()
    if (!length(people)) people <- it$editor %||% list()
    updated_by <- vapply(it[["updated-by"]] %||% list(), function(u) tolower(txt(u$type)), "")
    list(answered = TRUE, found = TRUE,
         title = plain_title(txt((it$title %||% list(""))[[1]])),
         subtitle = plain_title(txt((it$subtitle %||% list(""))[[1]])),
         year = suppressWarnings(as.integer(txt((it$issued[["date-parts"]] %||% list(list(NA)))[[1]][[1]]))),
         type = txt(it$type),
         container = plain_title(txt((it[["container-title"]] %||% list(""))[[1]])),
         publisher = one_line(txt(it$publisher)),
         families = vapply(people, function(p) one_line(txt(p$family %||% p$name)), ""),
         language = tolower(txt(it$language)),
         page = txt(it$page), volume = txt(it$volume), issue = txt(it$issue),
         issn = paste(unlist(it$ISSN), collapse = ";"),
         is_notice = length(it[["update-to"]] %||% list()) > 0,
         retracted = any(updated_by %in% c("retraction", "withdrawal", "removal")),
         abstract = clean_jats(txt(it$abstract)))
  }

  # Do the two catalogues describe the same work? Returns every reason why not.
  compare <- function(row, cr) {
    if (!isTRUE(cr$found)) return("the DOI is not registered at Crossref")
    why <- character()
    if (!same_title(row$title, cr$title, cr$subtitle)) why <- c(why, paste0("the registry has another title: ", short(cr$title, 70)))
    y <- suppressWarnings(as.integer(row$year))
    if (is.na(cr$year) || is.na(y)) why <- c(why, "a year is missing in one catalogue")
    else if (abs(cr$year - y) > 2) why <- c(why, paste0("the years lie more than two apart: registry ", cr$year, ", OpenAlex ", y))
    ok_types <- if (row$kind == "article") "journal-article" else c("book", "monograph", "edited-book")
    if (!(cr$type %in% ok_types)) why <- c(why, paste0("the registry calls it \"", cr$type, "\""))
    if (row$kind == "article") {
      j <- same_journal(row$journal, cr$container)
      if (is.na(j)) why <- c(why, "one catalogue names no journal")
      else if (!j) why <- c(why, paste0("the catalogues name different journals: registry \"", short(cr$container, 40), "\""))
    }
    a <- same_author(row$first_author, cr$families)
    if (is.na(a)) why <- c(why, "the registry names no author")
    else if (!a) why <- c(why, paste0("the registry names other people: ", short(paste(utils::head(cr$families, 3), collapse = ", "), 50)))
    if (nzchar(cr$language) && !startsWith(cr$language, "en")) why <- c(why, paste0("not in English, by the registry (", cr$language, ")"))
    if (!nzchar(cr$language) && !nzchar(row$language)) why <- c(why, "neither catalogue states the language")
    if (isTRUE(cr$is_notice)) why <- c(why, "the registry marks it as a correction or retraction notice")
    if (isTRUE(cr$retracted)) why <- c(why, "retracted, by the registry")
    why
  }

  # ---- the cache: everything fetched so far ------------------------------------

  cache <- new.env()
  cache_file <- function() file.path(DRAFTS, paste0("search-", SEARCH_ID, "-cache.rds"))
  load_cache <- function() {
    old <- if (file.exists(cache_file())) tryCatch(readRDS(cache_file()), error = function(e) NULL) else NULL
    for (n in names(old)) assign(n, old[[n]], envir = cache)
    for (n in c("lists", "counts", "views", "abstracts", "registry")) if (is.null(cache[[n]])) cache[[n]] <- list()
    if (is.null(cache$started)) cache$started <- format(Sys.time(), "%Y-%m-%d %H:%M")
    oa$before <- cache$spent %||% 0            # what earlier runs of this search have spent
  }
  save_cache <- function() {
    dir.create(DRAFTS, showWarnings = FALSE)
    cache$spent <- oa$before + oa$total
    tmp <- paste0(cache_file(), ".tmp")
    saveRDS(as.list(cache), tmp); file.rename(tmp, cache_file())
  }

  # ---- step 1: counts -----------------------------------------------------------

  one_filter <- function(term, kind, extra = "") paste0(cache$field, ":", term, ",", KINDS[[kind]], extra)

  count_one <- function(term, kind, key, sample = FALSE) {
    id <- paste(kind, term, sep = "|")
    if (!is.null(cache$counts[[id]]) && !sample) return(cache$counts[[id]])
    r <- oa_list(list(filter = one_filter(term, kind), per_page = if (sample) 50 else 1), "id,display_name", COST_SEARCH, key)
    if (r$status == 0L) pause_run("OpenAlex did not answer. Check the internet connection and run the line again.")
    if (r$status != 200L) return(structure(NA_integer_, why = why_refused(r)))
    n <- suppressWarnings(as.integer(r$body$meta$count %||% NA))
    if (is.na(n)) return(structure(NA_integer_, why = "the answer carries no count"))
    cache$counts[[id]] <- n
    if (sample) {
      titles <- vapply(r$body$results %||% list(), function(w) txt(w$display_name), "")
      attr(n, "share") <- if (length(titles)) mean(grepl("populis", titles, ignore.case = TRUE)) else NA_real_
      attr(n, "shown") <- length(titles)
    }
    n
  }

  # Which of OpenAlex's two title searches answers as it should? (Asked once.)
  choose_field <- function(key) {
    if (!is.null(cache$field)) return(invisible())
    problems <- character()
    for (f in c("title.search", "title.search.no_stem")) {
      cache$field <- f
      n <- count_one("populism", "article", key, sample = TRUE)
      cache$counts <- list()
      if (is.na(n)) { problems <- c(problems, paste0(f, ": refused (", attr(n, "why"), ")")); next }
      share <- attr(n, "share")
      if (n == 0 || is.na(share)) { problems <- c(problems, paste0(f, ": no works returned")); next }
      if (share < 0.9) {
        problems <- c(problems, paste0(f, ": only ", round(100 * share), "% of the first ", attr(n, "shown"),
                                       " titles name populism (", num(as.integer(n)), " works counted)"))
        next
      }
      cache$counts[["article|populism"]] <- as.integer(n)
      cache$terms <- if (f == "title.search") c(MAIN_TERMS, RARE_TERMS) else c(MAIN_TERMS, RARE_TERMS, PLURALS)
      return(invisible())
    }
    cache$field <- NULL
    halt("OpenAlex's search by title does not answer as its documentation says, so nothing was fetched. ",
         "Paste this message to Claude. Details: ", paste(problems, collapse = "; "), ".")
  }

  # Three views of the whole pool, for the report only (what the search leaves out).
  view_one <- function(name, filter, group, key) {
    if (!is.null(cache$views[[name]])) return(invisible())
    r <- tryCatch(oa_get(list(filter = filter, group_by = group), COST_SEARCH, key), pv_pause = function(e) NULL)
    if (is.null(r) || r$status != 200L) { cache$views[[name]] <- "not available"; return(invisible()) }
    g <- r$body$group_by %||% list()
    lab <- vapply(g, function(x) { k <- txt(x$key_display_name %||% x$key); if (nzchar(k)) k else "unknown" }, "")
    cnt <- suppressWarnings(as.integer(vapply(g, function(x) txt(x$count), "")))
    keep <- order(-cnt)[seq_len(min(8, length(cnt)))]
    cache$views[[name]] <- paste0(paste(lab[keep], num(cnt[keep]), collapse = ", "),
                                  " (all: ", num(suppressWarnings(as.integer(r$body$meta$count %||% NA))), ")")
  }

  # ---- step 2: the list ----------------------------------------------------------

  progress <- new.env(); progress$pages <- 0L; progress$rows <- 0L

  fetch_list <- function(term, kind, key, expected_in_all) {
    id <- paste(kind, term, sep = "|")
    st <- cache$lists[[id]] %||% list(done = FALSE, cursor = "*", rows = list(), pages = 0L)
    progress$rows <- progress$rows + length(st$rows)
    if (isTRUE(st$done)) return(invisible())
    known <- cache$counts_floor[[id]] %||% cache$counts[[id]]        # not known for the rarer forms: the first page tells
    if (identical(known, 0L)) { st$done <- TRUE; cache$lists[[id]] <- st; return(invisible()) }
    repeat {
      r <- oa_list(list(filter = one_filter(term, kind, cache$floor_filter %||% ""), per_page = 100, cursor = st$cursor),
                   LIST_FIELDS, COST_SEARCH, key)
      if (r$status != 200L || is.null(r$body)) {
        save_cache()
        if (r$status == 0L) pause_run("The connection to OpenAlex was lost. What was fetched is kept. Run the same line again: it goes on where it stopped.")
        halt("OpenAlex refused a page of the list (", why_refused(r), "). What was fetched is kept. Paste this message to Claude.")
      }
      res <- r$body$results %||% list()
      total <- suppressWarnings(as.integer(r$body$meta$count %||% NA))
      if (is.null(cache$rare_counts)) cache$rare_counts <- list()
      if (!(term %in% MAIN_TERMS) && !is.na(total)) cache$rare_counts[[id]] <- total
      st$rows <- c(st$rows, lapply(res, oa_row, kind = kind, term = term))
      st$pages <- st$pages + 1L
      progress$pages <- progress$pages + 1L; progress$rows <- progress$rows + length(res)
      nxt <- txt(r$body$meta$next_cursor)
      # the last page: nothing came, no pointer to a next page, or everything counted is here
      if (!length(res) || !nzchar(nxt) || (!is.na(total) && length(st$rows) >= total) || st$pages >= 3000L) st$done <- TRUE
      else st$cursor <- nxt
      cache$lists[[id]] <- st
      if (progress$pages %% 20L == 0L) {
        save_cache()
        say(sprintf("  %s works fetched (about %s expected)", num(progress$rows), num(expected_in_all)))
      }
      if (st$done) break
    }
    invisible()
  }

  # ---- the run --------------------------------------------------------------------

  THRESHOLDS <- c(1000, 500, 300, 200, 150, 100, 75, 50, 40, 30, 25, 20, 15, 10, 5, 1, 0)
  by_citations <- function(cites) vapply(THRESHOLDS, function(t) sum(cites >= t), 0L)
  table_row <- function(label, values) paste0("  ", formatC(label, width = -10), paste(formatC(num(values), width = 7), collapse = ""))
  year_groups <- function(y) {
    y <- suppressWarnings(as.integer(y))
    g <- ifelse(is.na(y), "no year", ifelse(y <= 1999, "to 1999", ifelse(y <= 2009, "2000-09", ifelse(y <= 2014, "2010-14", as.character(y)))))
    lev <- c("to 1999", "2000-09", "2010-14", as.character(2015:2035), "no year")
    factor(g, levels = lev[lev %in% unique(g)])
  }

  main <- function() {
    use_utf8()
    say(""); say("PopuliVerse Library: search for works on populism (version ", SCRIPT_VERSION, ")"); say("")
    if (!file.exists("_quarto.yml") || !file.exists("library/taxonomy.yml")) {
      halt("This is not the site folder. Open the project first (double-click populiverse.Rproj, ",
           "or in RStudio: File > Open Project), then run the line again.")
    }
    ensure_packages()
    dir.create(DRAFTS, showWarnings = FALSE)
    load_cache()
    on.exit(save_cache(), add = TRUE)

    lib <- read_library()
    say("  [ok] the Library as this folder knows it: ", num(lib$n), " works on the site, ", num(length(lib$dois)), " DOIs in all")
    set <- settings(); key <- set$key
    say("  [ok] OpenAlex accepts the key")
    al <- read_allowance(key)
    if (!is.null(al)) {
      oa$left <- al$left; oa$prepaid <- al$prepaid; oa$budget <- al$budget
      if (oa$prepaid > 0) oa$reserve <- 0.25       # a prepaid balance exists: stay well inside the free allowance
      say("  [ok] today's free allowance at OpenAlex: ", money(oa$left), " left",
          if (length(oa$budget) == 1 && !is.na(oa$budget)) paste0(" of ", money(oa$budget)) else "",
          "; the script never touches the last ", money(oa$reserve))
      if (oa$prepaid > 0) say("  [ok] the account holds a prepaid balance of ", money(oa$prepaid), ": the script never uses it")
    } else {
      say("  [--] OpenAlex does not tell what is left of today's free allowance: the script spends at most ",
          money(BLIND_CAP - RESERVE), " in this run")
    }
    say("  [ok] Crossref", if (nzchar(set$email)) " (with your email, for faster answers)" else " (without an email)")
    if (!is.null(cache$list_done_at)) say("  [ok] the list of this search was fetched on ", cache$list_done_at,
                                          ": it is not fetched again; the files and the report are written from it")

    # 1. counts
    say(""); say("1. Counts (titles that name populism, at OpenAlex today)")
    choose_field(key)
    terms <- cache$terms
    for (kind in names(KINDS)) for (term in MAIN_TERMS) {
      n <- count_one(term, kind, key)
      if (is.na(n)) halt("OpenAlex refused a count (", attr(n, "why"), "). Nothing was fetched. Paste this message to Claude.")
    }
    cnt <- function(kind, term) as.integer(cache$counts[[paste(kind, term, sep = "|")]] %||% 0L)
    line <- function(kind) paste0("populism ", num(cnt(kind, "populism")), " | populist ", num(cnt(kind, "populist")))
    say("  journal articles with a DOI: ", line("article"))
    say("  books with a DOI:            ", line("book"))
    say("  (a work that carries both words is counted under both; rarer forms such as \"neopopulism\" come with the list)")
    for (term in MAIN_TERMS) {
      view_one(paste0("kinds of work, ", term), paste0(cache$field, ":", term), "type", key)
      view_one(paste0("articles by kind of source, ", term), paste0(cache$field, ":", term, ",type:article|review,has_doi:true"),
               "primary_location.source.type", key)
      view_one(paste0("articles in journals by language, ", term), one_filter(term, "article"), "language", key)
    }
    save_cache()

    # what the list costs, and a floor of citations if today's allowance does not cover all of it
    main_ids <- as.vector(outer(names(KINDS), MAIN_TERMS, paste, sep = "|"))
    all_ids  <- as.vector(outer(names(KINDS), terms, paste, sep = "|"))
    requests_left <- function(counts) {
      big <- sum(vapply(main_ids, function(id) {
        st <- cache$lists[[id]] %||% list(done = FALSE, pages = 0L)
        if (isTRUE(st$done)) 0 else max(1, ceiling((counts[[id]] %||% 0L) / 100) - st$pages)
      }, 0))
      small <- sum(vapply(setdiff(all_ids, main_ids), function(id) !isTRUE(cache$lists[[id]]$done), logical(1)))
      big + small
    }
    spare <- 0.03                                  # for the abstracts, which cost a little too
    if (is.null(cache$floor)) {
      cache$floor <- 0L; cache$floor_filter <- ""
      need <- requests_left(cache$counts) * COST_SEARCH
      for (floor in c(1L, 2L, 5L, 10L, 20L, 50L)) {
        if (need <= available() - spare) break
        if (available() - spare < 0.15) break      # too little left today for any list: do not spend it on counting
        cf <- cache$counts
        for (id in main_ids) {
          kt <- strsplit(id, "|", fixed = TRUE)[[1]]
          r <- oa_list(list(filter = one_filter(kt[2], kt[1], paste0(",cited_by_count:>", floor - 1L)), per_page = 1), "id", COST_SEARCH, key)
          n <- if (r$status == 200L) suppressWarnings(as.integer(r$body$meta$count %||% NA)) else NA_integer_
          if (is.na(n)) halt("OpenAlex refused a count (", why_refused(r), "). Nothing was fetched. Paste this message to Claude.")
          cf[[id]] <- n
        }
        cache$floor <- floor; cache$floor_filter <- paste0(",cited_by_count:>", floor - 1L); cache$counts_floor <- cf
        need <- requests_left(cf) * COST_SEARCH
      }
      if (need > available() - spare) {
        cache$floor <- NULL; cache$floor_filter <- NULL; cache$counts_floor <- NULL
        pause_run("Today's free allowance at OpenAlex does not cover the list (it would cost about ", money(need),
                  "; ", money(max(0, available())), " can be used today). Nothing but the counts was fetched. ",
                  "Run the same line again tomorrow.")
      }
      save_cache()
    }
    counts_now <- cache$counts_floor %||% cache$counts
    expected_in_all <- sum(unlist(counts_now[main_ids]))
    to_fetch <- requests_left(counts_now)
    if (cache$floor > 0) say("  Today's allowance does not cover every work, so the list holds the works cited at least ",
                              cache$floor, " time(s): ", num(expected_in_all), " works. The counts above are complete.")
    if (to_fetch > 0) {
      say("")
      say("  To fetch the list: about ", num(to_fetch), " requests, about ", money(to_fetch * COST_SEARCH),
          " of today's free allowance (", money(max(0, available() + oa$reserve)), " left).")
      say("  Then the DOI registry is asked about the ", num(min(TOP, expected_in_all)), " most cited works: about ",
          round(min(TOP, expected_in_all) * (PAUSE + 0.4) / 60) + 1, " minutes. It all runs by itself.")
      answer <- if (interactive()) readline("Type yes and press Enter to fetch the list (anything else stops): ")
                else Sys.getenv("SEARCH_WORKS_CONFIRM")
      if (!identical(tolower(trimws(answer)), "yes")) {
        say(""); say("Stopped after the counts. Nothing else was fetched. Run the same line again to continue."); return(invisible())
      }
    }

    # 2. the list
    say(""); say("2. The list")
    for (kind in names(KINDS)) for (term in terms) fetch_list(term, kind, key, expected_in_all)
    if (is.null(cache$list_done_at)) cache$list_done_at <- format(Sys.time(), "%Y-%m-%d %H:%M")
    save_cache()
    rows <- unlist(lapply(all_ids, function(id) cache$lists[[id]]$rows), recursive = FALSE)
    if (!length(rows)) halt("OpenAlex returned no works at all. Paste this message to Claude.")
    d <- as.data.frame(do.call(rbind, rows), stringsAsFactors = FALSE)
    # a work found under two words is one work
    seen <- tapply(d$terms, d$openalex_id, function(x) paste(unique(x), collapse = ";"))
    d <- d[!duplicated(d$openalex_id), ]
    d$terms <- as.character(seen[d$openalex_id])
    d <- sort_out(d, lib)
    d <- d[order(-d$cited_by_count, d$openalex_id), ]
    rownames(d) <- NULL
    rare <- function(kind) sum(vapply(setdiff(terms, MAIN_TERMS), function(term) as.integer(cache$rare_counts[[paste(kind, term, sep = "|")]] %||% 0L), 0L))
    say("  [ok] ", num(nrow(d)), " different works (", num(sum(d$kind == "article")), " journal articles, ",
        num(sum(d$kind == "book")), " books); under the rarer forms: ", num(rare("article") + rare("book")))
    say("  [ok] sorted out by the rules: ", num(sum(d$status == "candidate")), " candidates, ",
        num(sum(d$status == "already in the Library")), " already in the Library, ",
        num(sum(startsWith(d$status, "set aside"))), " set aside, ", num(sum(startsWith(d$status, "left out"))), " left out")

    # 3. the records of the most cited
    open <- d[d$status == "candidate" | startsWith(d$status, "set aside"), ]
    top <- utils::head(open, TOP)
    if (!nrow(top)) halt("The list holds no work that could enter the Library. Paste this message and the lines above to Claude.")
    say(""); say("3. The records of the ", num(nrow(top)), " most cited works that are not yet in the Library")
    # 3a. abstracts from OpenAlex, fifty works per request
    need <- top$openalex_id[!(top$openalex_id %in% names(cache$abstracts))]
    for (chunk in split(need, ceiling(seq_along(need) / 50))) {
      r <- oa_list(list(filter = paste0("openalex:", paste(chunk, collapse = "|")), per_page = 50),
                   "id,abstract_inverted_index", COST_LIST, key)
      if (r$status == 0L) pause_run("The connection to OpenAlex was lost. What was fetched is kept. Run the same line again: it goes on where it stopped.")
      if (r$status != 200L) { say("  [--] OpenAlex refused the abstracts (", why_refused(r), "): the run goes on without them"); break }
      for (w in r$body$results %||% list()) cache$abstracts[[sub("^https?://openalex\\.org/", "", txt(w$id))]] <- abstract_text(w$abstract_inverted_index)
      for (id in setdiff(chunk, names(cache$abstracts))) cache$abstracts[[id]] <- ""
    }
    save_cache()
    say("  [ok] abstracts: OpenAlex has one for ", num(sum(nzchar(unlist(cache$abstracts[top$openalex_id])))), " of these works")
    # 3b. the DOI registry, one DOI at a time
    need <- top$doi[!(top$doi %in% names(cache$registry))]
    if (length(need)) {
      say("  Asking the DOI registry about ", num(length(need)), " DOIs. This runs by itself; leave RStudio open.")
      t0 <- Sys.time(); silent <- 0L
      for (i in seq_along(need)) {
        cr <- tryCatch(crossref_record(need[i], set$email), error = function(e) list(answered = FALSE))
        Sys.sleep(PAUSE)
        if (isTRUE(cr$answered)) { cache$registry[[need[i]]] <- cr; silent <- 0L } else silent <- silent + 1L
        if (silent >= 15L) {
          save_cache()
          pause_run("The DOI registry stopped answering. What was fetched is kept. Check the internet connection and run the same line again: it goes on where it stopped.")
        }
        if (i %% 100 == 0 || i == length(need)) {
          save_cache()
          spent <- as.numeric(difftime(Sys.time(), t0, units = "mins"))
          say(sprintf("  %5s of %s asked, about %.0f min left", num(i), num(length(need)), spent / i * (length(need) - i)))
        }
      }
    }
    no_answer <- sum(!(top$doi %in% names(cache$registry)))

    # the record of each of these works: what OpenAlex says, what the registry says, and whether they agree
    rec <- lapply(seq_len(nrow(top)), function(i) {
      row <- as.list(top[i, ]); cr <- cache$registry[[row$doi]]
      if (is.null(cr)) { why <- "the registry did not answer"; cr <- list(found = FALSE) } else why <- compare(row, cr)
      a_oa <- cache$abstracts[[row$openalex_id]] %||% ""; a_cr <- cr$abstract %||% ""
      # a whole abstract before one that is not whole; the publisher's own deposit before OpenAlex's; else the longer one
      from <- if (!nzchar(a_oa) && !nzchar(a_cr)) "" else if (whole_abstract(a_cr)) "Crossref" else if (whole_abstract(a_oa)) "OpenAlex"
              else if (nchar(a_cr) > nchar(a_oa)) "Crossref" else "OpenAlex"
      abstract <- if (from == "Crossref") a_cr else if (from == "OpenAlex") a_oa else ""
      families <- cr$families %||% character(); families <- families[nzchar(families)]
      people <- if (length(families) == 0) "" else if (length(families) == 1) families
                else if (length(families) == 2) paste(families, collapse = " and ")
                else paste0(paste(families[-length(families)], collapse = ", "), ", and ", families[length(families)])
      known_year <- if (isTRUE(cr$found) && !is.na(cr$year)) as.character(cr$year) else ""
      cite <- if (length(families) == 0) "" else paste0(if (length(families) <= 2) paste(families, collapse = " and ") else paste(families[1], "et al."),
                                                        " ", if (nzchar(known_year)) known_year else row$year)
      data.frame(
        ref_id = row$openalex_id, cite = cite,
        first_author = if (length(families)) families[1] else "",
        year = row$year, title = row$title, container = row$journal, kind_guess = row$kind,
        authors = people, reference = "", doi_printed = "",
        status = if (!length(why)) "found" else "not found",
        check = if (!length(why)) "confirmed" else paste0("set aside: ", paste(why, collapse = "; ")),
        list_status = row$status,
        doi = row$doi, found_by = "OpenAlex title search, checked at Crossref",
        title_found = if (isTRUE(cr$found)) one_line(paste0(cr$title, if (nzchar(cr$subtitle)) paste0(": ", cr$subtitle) else "")) else "",
        year_found = known_year,
        journal_or_publisher = if (isTRUE(cr$found)) (if (nzchar(cr$container)) cr$container else cr$publisher) else "",
        type = cr$type %||% "", source_type = row$source_type,
        open_access = row$is_oa, oa_status = row$oa_status,
        abstract_from = from, abstract_whole = if (nzchar(abstract)) as.character(whole_abstract(abstract)) else "",
        openalex_id = paste0("https://openalex.org/", row$openalex_id),
        language = if (nzchar(cr$language %||% "")) substr(cr$language, 1, 2) else row$language,
        language_openalex = row$language, language_registry = cr$language %||% "",
        cited_by_count = row$cited_by_count, is_core = row$is_core, listed_in = row$listed_in,
        publisher = cr$publisher %||% row$publisher, issn = cr$issn %||% row$issn_l,
        volume = cr$volume %||% row$volume, issue = cr$issue %||% row$issue, pages = cr$page %||% "",
        n_authors = row$n_authors, authors_openalex = row$authors,
        abstract = abstract, stringsAsFactors = FALSE)
    })
    rec <- do.call(rbind, rec)
    list_file <- file.path(DRAFTS, paste0("search-", SEARCH_ID, "-list.csv"))
    rec_file  <- file.path(DRAFTS, paste0("search-", SEARCH_ID, "-records.csv"))
    utils::write.csv(d, list_file, row.names = FALSE, na = "", fileEncoding = "UTF-8")
    utils::write.csv(rec, rec_file, row.names = FALSE, na = "", fileEncoding = "UTF-8")
    zip_file <- file.path(DRAFTS, paste0("search-", SEARCH_ID, "-upload.zip"))
    unlink(zip_file)
    here <- getwd(); setwd(DRAFTS)
    zipped <- tryCatch(suppressWarnings(utils::zip(basename(zip_file), c(basename(list_file), basename(rec_file)), flags = "-q9X")),
                       error = function(e) 1L)
    setwd(here)
    zipped <- identical(as.integer(zipped), 0L) && file.exists(zip_file)
    save_cache()
    left_now <- read_allowance(key)

    # ---- the report --------------------------------------------------------------
    ready <- rec[rec$check == "confirmed" & rec$list_status == "candidate", ]
    say("")
    say("----- REPORT: copy from this line to END OF REPORT and paste it to Claude -----")
    say("script ", SCRIPT_VERSION, " | search ", SEARCH_ID, " | list fetched ", cache$list_done_at, " | report written ", format(Sys.time(), "%Y-%m-%d %H:%M"),
        " | title search: ", cache$field, " | short form of records: ", cache$short_form %||% "all")
    say("OpenAlex allowance: spent in this run ", sprintf("$%.3f", oa$total), " | on this search in all ", sprintf("$%.3f", oa$before + oa$total),
        " | left today ", if (is.null(left_now)) "not told" else money(left_now$left),
        " | prepaid balance: ", if (is.null(left_now)) "not told" else if (left_now$prepaid > 0) paste0(money(left_now$prepaid), ", untouched") else "none")
    say("Library in this folder: ", num(lib$n), " works on the site (", lib$updated, "), ", num(length(lib$dois)), " DOIs")
    say("words asked: ", paste(terms, collapse = ", "))
    say("titles at OpenAlex, journal articles with a DOI: ", line("article"), " | rarer forms ", num(rare("article")))
    say("titles at OpenAlex, books with a DOI: ", line("book"), " | rarer forms ", num(rare("book")))
    for (v in names(cache$views)) say("  ", v, ": ", cache$views[[v]])
    say("list: ", num(nrow(d)), " different works (", num(sum(d$kind == "article")), " articles, ", num(sum(d$kind == "book")), " books)",
        " | citation floor: ", if (cache$floor > 0) paste0("at least ", cache$floor) else "none")
    tab <- sort(table(d$status), decreasing = TRUE)
    for (s in names(tab)) say(sprintf("  %7s  %s", num(as.integer(tab[[s]])), s))
    say("candidates by citations (OpenAlex's count today); each column: works cited at least so often")
    say(table_row("at least", THRESHOLDS))
    say(table_row("articles", by_citations(d$cited_by_count[d$status == "candidate" & d$kind == "article"])))
    say(table_row("books", by_citations(d$cited_by_count[d$status == "candidate" & d$kind == "book"])))
    say("records checked at the DOI registry: ", num(nrow(rec)), " (the most cited candidates and works set aside; down to ",
        min(rec$cited_by_count), " citations)",
        if (no_answer > 0) paste0(" | no answer for ", no_answer, ": run the line again to ask them once more") else "")
    say("  confirmed ", num(sum(rec$check == "confirmed")), " | set aside by the registry check ", num(sum(rec$check != "confirmed")),
        " | confirmed and a candidate in the list: ", num(nrow(ready)))
    reasons <- unlist(strsplit(sub("^set aside: ", "", rec$check[rec$check != "confirmed"]), "; ", fixed = TRUE))
    reasons <- ifelse(grepl("calls it", reasons, fixed = TRUE), reasons, sub("(: | \\().*$", "", reasons))
    rt <- sort(table(reasons), decreasing = TRUE)
    for (s in names(rt)) say(sprintf("  %7s  %s", num(as.integer(rt[[s]])), s))
    lists <- strsplit(ready$listed_in, ";", fixed = TRUE)
    say("  of the ", num(nrow(ready)), ": with an abstract ", num(sum(nzchar(ready$abstract))), " (whole ", num(sum(ready$abstract_whole == "TRUE")),
        ") | open access ", num(sum(ready$open_access == "TRUE")),
        " | articles in a journal on the CWTS core list ", num(sum(ready$kind_guess == "article" & ready$is_core == "TRUE")),
        ", on no journal list ", num(sum(ready$kind_guess == "article" & lengths(lists) == 0)),
        " | language not told by OpenAlex ", num(sum(!nzchar(ready$language_openalex))))
    say("confirmed candidates by citations")
    say(table_row("at least", THRESHOLDS))
    say(table_row("articles", by_citations(ready$cited_by_count[ready$kind_guess == "article"])))
    say(table_row("books", by_citations(ready$cited_by_count[ready$kind_guess == "book"])))
    target <- ceiling((lib$n + 1) / 1000) * 1000; missing <- target - lib$n
    at <- function(k) if (nrow(ready) >= k) paste0("no. ", num(k), " has ", ready$cited_by_count[k], " citations") else paste0("fewer than ", num(k), " are confirmed")
    say("to reach ", num(target), " the Library needs ", num(missing), " more works; the confirmed candidates in order of citations: ",
        at(missing), "; ", at(missing + 50), "; ", at(missing + 100))
    yg_all <- table(year_groups(ready$year)); yg_first <- table(factor(year_groups(utils::head(ready, missing + 50)$year), levels = names(yg_all)))
    say("confirmed candidates by year (all | the first ", num(min(nrow(ready), missing + 50)), "): ",
        paste0(names(yg_all), " ", as.integer(yg_all), "|", as.integer(yg_first), collapse = "; "))
    say("----- END OF REPORT -----")
    say("")
    if (zipped) {
      say("Upload this one file to Claude, and paste the report: ", zip_file, " (", round(file.size(zip_file) / 1e6, 1), " MB).")
      say("It holds the two result files, ", basename(list_file), " and ", basename(rec_file), ", which stay in the drafts folder too.")
    } else {
      say("The two result files are in the drafts folder: ", basename(list_file), " (", round(file.size(list_file) / 1e6, 1), " MB) and ",
          basename(rec_file), " (", round(file.size(rec_file) / 1e6, 1), " MB). They could not be packed into one zip file here: ",
          "tell Claude, and do not upload them as they are.")
    }
    invisible(TRUE)
  }

  tryCatch(
    main(),
    pv_pause = function(e) { say(""); say("PAUSED: ", conditionMessage(e)) },
    pv_stop  = function(e) { say(""); say("STOPPED: ", conditionMessage(e)) },
    error    = function(e) {
      say(""); say("STOPPED by an unexpected error: ", no_key(conditionMessage(e)))
      say("What was fetched so far is kept. Paste this message to Claude.")
    }
  )
  invisible(NULL)
})
