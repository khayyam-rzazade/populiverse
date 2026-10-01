# ---------------------------------------------------------------------------
# PopuliVerse Library: find the DOI and the abstract of each reference.
#
# HOW TO RUN IT (in RStudio, with the populiverse project open):
#
#     source("scripts/find_works.R")
#
# WHAT IT DOES, IN ORDER
#   1. Reads the newest list of references in the drafts folder
#      (drafts/batch-NN-references.csv). The drafts folder is never published.
#   2. Asks the DOI registry (Crossref) for each reference. A DOI is accepted
#      only when the title, the year and the first author all agree with the
#      reference. If they do not, the reference gets no DOI. Nothing is guessed.
#      A book is never matched to a journal article (a review of the book
#      carries the same title), nor an article to a book or to a record in
#      another journal.
#   3. Asks OpenAlex, an open catalogue of research, for the abstract and for
#      whether the work is open access. This needs a free OpenAlex key, which
#      the script asks for once and keeps in your home folder (~/.Renviron).
#      Without a key it still runs, with fewer abstracts.
#   4. Writes drafts/batch-NN-found.csv and prints a short report.
#
# When nothing is accepted for a reference, the nearest candidate is written
# down as a note for checking ("near_..."). It is never used as the work's DOI.
#
# It starts with a trial of ten references and goes on only after you type yes.
# It can be stopped and started again: what was already found is kept.
# It never touches Zotero and never changes the site.
# ---------------------------------------------------------------------------

local({

  SCRIPT_VERSION <- "2026-10-01.3"
  MATCHING <- 2          # raised when the way of comparing changes: references not found before are asked again
  DRAFTS <- "drafts"
  TRIAL  <- 10

  # The two settings below exist for automated tests only.
  CROSSREF <- Sys.getenv("CROSSREF_API_BASE", "https://api.crossref.org")
  OPENALEX <- Sys.getenv("OPENALEX_API_BASE", "https://api.openalex.org")
  PAUSE    <- as.numeric(Sys.getenv("FIND_WORKS_PAUSE", "0.25"))
  WAIT     <- as.numeric(Sys.getenv("FIND_WORKS_WAIT", "1"))     # 0 in tests: no waiting between retries
  USER_AGENT <- "PopuliVerse find_works.R (github.com/khayyam-rzazade/populiverse)"

  `%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a
  say <- function(...) cat(..., "\n", sep = "")
  halt <- function(...) stop(structure(class = c("pv_stop", "error", "condition"),
                                       list(message = paste0(...), call = NULL)))
  short <- function(x, n = 60) { x <- x %||% ""; if (nchar(x) > n) paste0(substr(x, 1, n - 3), "...") else x }

  use_utf8 <- function() {
    if (!isTRUE(l10n_info()[["UTF-8"]])) {
      for (loc in c("C.UTF-8", "en_US.UTF-8", "UTF-8")) {
        if (nzchar(suppressWarnings(Sys.setlocale("LC_CTYPE", loc)))) break
      }
    }
  }

  ensure_packages <- function() {
    needed  <- c("httr", "jsonlite")
    missing <- needed[!vapply(needed, requireNamespace, logical(1), quietly = TRUE)]
    if (!length(missing)) return(invisible())
    if (!interactive()) halt("These R packages are missing: ", paste(missing, collapse = ", "), ".")
    say("Installing R packages this script needs (one time only): ", paste(missing, collapse = ", "))
    utils::install.packages(missing)
  }

  # ---- comparing a reference with what a catalogue returns ------------------

  # Lower case, accents removed, everything but letters and digits dropped.
  fold <- function(x) {
    x <- tolower(x %||% "")
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
    # "anti western" and "antiwestern": a list taken from a PDF loses hyphens at line ends
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

  # Is this candidate the same work as the reference? Title, year and first
  # author must all agree.
  same_work <- function(ref, cand) {
    t_ref <- fold(ref$title)
    # the part before a colon: catalogues often store a book without its subtitle
    main <- function(x) fold(sub("\\s*[:.?!]\\s.*$", "", x))
    m_ref <- main(ref$title); m_cand <- main(cand$title)
    title_ok <- close_enough(t_ref, fold(cand$title)) ||
      (nzchar(cand$subtitle %||% "") && close_enough(t_ref, fold(paste(cand$title, cand$subtitle)))) ||
      (nchar(m_ref) >= 8 && (identical(m_ref, fold(cand$title)) || identical(m_cand, t_ref) ||
                               identical(gsub(" ", "", m_ref), gsub(" ", "", fold(cand$title)))))
    year_ok <- !is.na(cand$year) && abs(as.integer(ref$year) - cand$year) <= 2
    fam <- gsub(" ", "", fold(ref$first_author))
    names <- gsub(" ", "", vapply(cand$families, fold, ""))
    author_ok <- nzchar(fam) && length(names) > 0 &&
      any(names == fam | (nchar(fam) >= 4 & grepl(fam, names, fixed = TRUE)) |
            (nchar(names) >= 4 & vapply(names, function(n) grepl(n, fam, fixed = TRUE), logical(1))))
    title_ok && year_ok && author_ok
  }

  # A reference to a book is never matched to a journal article, and the other
  # way round: a review of a book carries the book's title and names its author.
  kind_ok <- function(ref, type) {
    k <- ref$kind_guess %||% ""
    if (identical(k, "book") && type %in% c("journal-article", "article", "review", "book-review", "reference-entry")) return(FALSE)
    if (identical(k, "article") && type %in% c("book", "monograph", "edited-book", "book-chapter", "book-review", "reference-entry")) return(FALSE)
    TRUE
  }

  # An article is not matched to a record in another journal (for example a
  # preprint with the same title). Names are compared loosely, so that
  # "JCMS: Journal of Common Market Studies" still equals "Journal of Common
  # Market Studies": at least half of the words of the shorter name must agree.
  journal_ok <- function(ref, container) {
    if (!identical(ref$kind_guess %||% "", "article")) return(TRUE)
    words <- function(x) setdiff(strsplit(fold(x), " ", fixed = TRUE)[[1]], c("", "the", "of", "and", "for", "in", "a", "an"))
    r <- words(sub("\\s+[0-9(].*$", "", ref$container %||% "")); c <- words(container %||% "")
    if (!length(r) || !length(c)) return(TRUE)
    length(intersect(r, c)) / min(length(r), length(c)) >= 0.5
  }

  # ---- asking the two catalogues --------------------------------------------

  get_json <- function(url, query, what) {
    for (attempt in 1:3) {
      resp <- tryCatch(httr::GET(url, query = query, httr::user_agent(USER_AGENT), httr::timeout(45)),
                       error = function(e) NULL)
      if (is.null(resp)) { Sys.sleep(WAIT * 2 * attempt); next }
      code <- httr::status_code(resp)
      if (code == 404L) return(list(status = 404L, body = NULL))
      if (code %in% c(429L, 500L, 502L, 503L, 504L)) {
        wait <- suppressWarnings(as.numeric(httr::headers(resp)[["retry-after"]] %||% NA))
        Sys.sleep(WAIT * min(if (is.na(wait)) 3 * attempt else wait, 60)); next
      }
      if (code != 200L) return(list(status = code, body = NULL))
      body <- tryCatch(jsonlite::fromJSON(httr::content(resp, as = "text", encoding = "UTF-8"),
                                          simplifyVector = FALSE), error = function(e) NULL)
      return(list(status = 200L, body = body))
    }
    list(status = 0L, body = NULL)
  }

  crossref_candidates <- function(ref, email) {
    q <- list("query.bibliographic" = paste(ref$first_author, ref$year, ref$title, ref$container),
              rows = 3,
              select = "DOI,title,subtitle,author,editor,issued,container-title,publisher,type,abstract")
    if (nzchar(email)) q$mailto <- email
    r <- get_json(paste0(CROSSREF, "/works"), q)
    if (r$status == 400L) { q$select <- NULL; r <- get_json(paste0(CROSSREF, "/works"), q) }   # if the short form is refused, ask for the full record
    if (r$status != 200L) return(list(ok = FALSE, items = list()))
    items <- lapply(r$body$message$items %||% list(), function(it) {
      people <- it$author %||% it$editor %||% list()
      list(doi = it$DOI %||% "",
           title = (it$title %||% list(""))[[1]] %||% "",
           subtitle = (it$subtitle %||% list(""))[[1]] %||% "",
           year = suppressWarnings(as.integer((it$issued[["date-parts"]] %||% list(list(NA)))[[1]][[1]] %||% NA)),
           families = vapply(people, function(p) p$family %||% p$name %||% "", ""),
           container = (it[["container-title"]] %||% list(""))[[1]] %||% "",
           publisher = it$publisher %||% "",
           type = it$type %||% "",
           abstract = it$abstract %||% "")
    })
    list(ok = TRUE, items = items)
  }

  # Second try at Crossref: the title and the author asked as separate fields.
  crossref_by_fields <- function(ref, email) {
    q <- list("query.title" = ref$title, "query.author" = ref$first_author, rows = 5,
              select = "DOI,title,subtitle,author,editor,issued,container-title,publisher,type,abstract")
    if (nzchar(email)) q$mailto <- email
    r <- get_json(paste0(CROSSREF, "/works"), q)
    if (r$status == 400L) { q$select <- NULL; r <- get_json(paste0(CROSSREF, "/works"), q) }
    if (r$status != 200L) return(list(ok = FALSE, items = list()))
    items <- lapply(r$body$message$items %||% list(), function(it) {
      people <- it$author %||% it$editor %||% list()
      list(doi = it$DOI %||% "",
           title = (it$title %||% list(""))[[1]] %||% "",
           subtitle = (it$subtitle %||% list(""))[[1]] %||% "",
           year = suppressWarnings(as.integer((it$issued[["date-parts"]] %||% list(list(NA)))[[1]][[1]] %||% NA)),
           families = vapply(people, function(p) p$family %||% p$name %||% "", ""),
           container = (it[["container-title"]] %||% list(""))[[1]] %||% "",
           publisher = it$publisher %||% "", type = it$type %||% "", abstract = it$abstract %||% "")
    })
    list(ok = TRUE, items = items)
  }

  OA_FIELDS <- "id,doi,display_name,publication_year,type,authorships,primary_location,open_access,abstract_inverted_index"

  openalex_item <- function(w) {
    inv <- w$abstract_inverted_index
    abstract <- ""
    if (length(inv)) {
      pos <- unlist(inv, use.names = FALSE)
      words <- rep(names(inv), lengths(inv))
      abstract <- paste(words[order(pos)], collapse = " ")
    }
    src <- w$primary_location$source
    list(doi = sub("^https?://doi\\.org/", "", w$doi %||% ""),
         id = w$id %||% "",
         title = w$display_name %||% "", subtitle = "",
         year = suppressWarnings(as.integer(w$publication_year %||% NA)),
         families = vapply(w$authorships %||% list(), function(a) {
           n <- strsplit(trimws(a$author$display_name %||% ""), "\\s+")[[1]]
           if (length(n)) n[length(n)] else ""
         }, ""),
         container = src$display_name %||% "",
         source_type = src$type %||% "",
         type = w$type %||% "",
         is_oa = if (is.null(w$open_access$is_oa)) NA else isTRUE(w$open_access$is_oa),
         oa_status = w$open_access$oa_status %||% "",
         abstract = abstract)
  }

  openalex_by_doi <- function(doi, key) {
    r <- get_json(paste0(OPENALEX, "/works/doi:", doi), list(select = OA_FIELDS, api_key = key))
    if (r$status %in% c(400L, 403L)) r <- get_json(paste0(OPENALEX, "/works/doi:", doi), list(api_key = key))
    if (r$status == 200L && !is.null(r$body)) return(list(ok = TRUE, item = openalex_item(r$body)))
    list(ok = r$status == 404L, item = NULL, status = r$status)
  }

  openalex_by_title <- function(ref, key) {
    words <- gsub("[^\\p{L}\\p{N} ]+", " ", ref$title, perl = TRUE)
    y <- as.integer(ref$year)
    r <- get_json(paste0(OPENALEX, "/works"),
                  list(filter = paste0("title.search:", trimws(gsub("\\s+", " ", words)),
                                       ",publication_year:", y - 2, "-", y + 2),
                       "per-page" = 5, select = OA_FIELDS, api_key = key))
    if (r$status != 200L) return(list(ok = FALSE, items = list(), status = r$status))
    items <- lapply(r$body$results %||% list(), openalex_item)
    if (!any(vapply(items, function(c) same_work(ref, c), logical(1)))) {
      # second try: OpenAlex's free search, which forgives a word written differently
      r2 <- get_json(paste0(OPENALEX, "/works"),
                     list(search = trimws(gsub("\\s+", " ", words)), filter = paste0("publication_year:", y - 2, "-", y + 2),
                          "per-page" = 5, select = OA_FIELDS, api_key = key))
      if (r2$status == 200L) items <- c(items, lapply(r2$body$results %||% list(), openalex_item))
    }
    list(ok = TRUE, items = items)
  }

  clean_jats <- function(x) {
    x <- gsub("<jats:title>[^<]*</jats:title>", " ", x %||% "")
    trimws(gsub("\\s+", " ", gsub("<[^>]+>", " ", x)))
  }

  # ---- one reference ---------------------------------------------------------

  look_up <- function(ref, email, key) {
    out <- list(ref_id = ref$ref_id, status = "not found", doi = "", found_by = "", title_found = "",
                year_found = NA_integer_, journal_or_publisher = "", type = "", source_type = "",
                open_access = NA, oa_status = "", abstract = "", abstract_from = "", openalex_id = "",
                complete = TRUE, with_openalex = nzchar(key), matching = MATCHING,
                near_doi = "", near_title = "", near_year = NA_integer_, near_authors = "")
    cr <- crossref_candidates(ref, email)
    if (!cr$ok) out$complete <- FALSE
    hit <- NULL
    for (cand in cr$items) if (nzchar(cand$doi) && same_work(ref, cand) && kind_ok(ref, cand$type) && journal_ok(ref, cand$container)) { hit <- cand; break }
    seen <- cr$items
    if (is.null(hit) && cr$ok) {
      cr2 <- crossref_by_fields(ref, email)
      if (!cr2$ok) out$complete <- FALSE
      for (cand in cr2$items) if (nzchar(cand$doi) && same_work(ref, cand) && kind_ok(ref, cand$type) && journal_ok(ref, cand$container)) { hit <- cand; break }
      seen <- c(seen, cr2$items)
    }
    if (is.null(hit) && length(seen)) {
      # nothing accepted: keep the nearest candidate as a note only (it is NOT used as the work's DOI)
      t_ref <- fold(ref$title)
      d <- vapply(seen, function(c) as.numeric(utils::adist(t_ref, fold(c$title))) / max(nchar(t_ref), 1), 0)
      n <- seen[[which.min(d)]]
      out$near_doi <- n$doi; out$near_title <- n$title; out$near_year <- n$year
      out$near_authors <- paste(utils::head(n$families, 3), collapse = "; ")
    }
    if (!is.null(hit)) {
      out$status <- "found"; out$doi <- hit$doi; out$found_by <- "Crossref"
      out$title_found <- trimws(paste0(hit$title, if (nzchar(hit$subtitle)) paste0(": ", hit$subtitle) else ""))
      out$year_found <- hit$year
      out$journal_or_publisher <- if (nzchar(hit$container)) hit$container else hit$publisher
      out$type <- hit$type
      if (nzchar(hit$abstract)) { out$abstract <- clean_jats(hit$abstract); out$abstract_from <- "Crossref" }
    }
    if (nzchar(key)) {
      oa <- NULL
      if (nzchar(out$doi)) {
        r <- openalex_by_doi(out$doi, key)
        if (!r$ok) out$complete <- FALSE
        oa <- r$item
      } else {
        r <- openalex_by_title(ref, key)
        if (!r$ok) out$complete <- FALSE
        for (cand in r$items) if (same_work(ref, cand) && kind_ok(ref, cand$type) && journal_ok(ref, cand$container)) { oa <- cand; break }
        if (!is.null(oa)) {
          out$status <- "found"; out$doi <- oa$doi; out$found_by <- "OpenAlex"
          out$title_found <- oa$title; out$year_found <- oa$year
          out$journal_or_publisher <- oa$container; out$type <- oa$type
        }
      }
      if (!is.null(oa)) {
        out$openalex_id <- oa$id; out$source_type <- oa$source_type
        out$open_access <- oa$is_oa; out$oa_status <- oa$oa_status
        if (nzchar(oa$abstract) && nchar(oa$abstract) > nchar(out$abstract)) {
          out$abstract <- oa$abstract; out$abstract_from <- "OpenAlex"
        }
      }
    }
    out
  }

  # ---- the email and the OpenAlex key (kept in ~/.Renviron, never printed) ----

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

  # One small request shows whether OpenAlex accepts the key.
  openalex_accepts <- function(key) {
    r <- get_json(paste0(OPENALEX, "/works/doi:10.1017/S0260210519000184"), list(select = "id", api_key = key))
    if (r$status %in% c(200L, 404L)) "yes" else if (r$status == 0L) "no answer" else "no"
  }

  settings <- function() {
    email <- Sys.getenv("POPULIVERSE_EMAIL")
    if (!nzchar(email) && interactive()) {
      email <- ask("Your email address", "Your email address (Crossref asks for one, to answer faster; it is kept on this Mac only)", FALSE)
      if (grepl("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", email, perl = TRUE)) save_setting("POPULIVERSE_EMAIL", email) else email <- ""
    }
    key <- Sys.getenv("OPENALEX_API_KEY")
    if (!nzchar(key) && interactive()) {
      say("  No OpenAlex key on this Mac yet: a box asks for it now (leave it empty to go on without).")
      key <- ask("OpenAlex key", "Paste your OpenAlex key (free, from openalex.org, Settings, API key)", TRUE)
      if (!nzchar(key) || grepl("\\s", key)) key <- ""
    }
    if (nzchar(key)) {
      verdict <- openalex_accepts(key)
      if (verdict == "yes") {
        if (!identical(Sys.getenv("OPENALEX_API_KEY"), key)) save_setting("OPENALEX_API_KEY", key)
      } else if (verdict == "no") {
        halt("OpenAlex does not accept this key, or today's free allowance is used up. Nothing was looked up. ",
             "Check the key on openalex.org (Settings, API key) and run the line again; ",
             "to run without OpenAlex, remove the line OPENALEX_API_KEY from the file ~/.Renviron ",
             "and leave the box empty.")
      } else {
        halt("OpenAlex did not answer. Check the internet connection and run the line again.")
      }
    }
    list(email = email, key = key)
  }

  # ---- the run ---------------------------------------------------------------

  main <- function() {
    use_utf8()
    say(""); say("PopuliVerse Library: looking up references (version ", SCRIPT_VERSION, ")"); say("")
    if (!file.exists("_quarto.yml")) {
      halt("This is not the site folder. Open the project first (double-click populiverse.Rproj, ",
           "or in RStudio: File > Open Project), then run the line again.")
    }
    ensure_packages()
    files <- sort(list.files(DRAFTS, pattern = "^batch-[0-9]+-references\\.csv$", full.names = TRUE))
    if (!length(files)) halt("No list of references found (", DRAFTS, "/batch-NN-references.csv).")
    input <- files[length(files)]
    stem  <- sub("-references\\.csv$", "", input)
    refs  <- utils::read.csv(input, stringsAsFactors = FALSE, encoding = "UTF-8", colClasses = "character")
    need  <- c("ref_id", "first_author", "year", "title", "container")
    if (!all(need %in% names(refs))) halt(basename(input), " lacks one of these columns: ", paste(need, collapse = ", "))
    say("  [ok] ", basename(input), ": ", nrow(refs), " references")

    set <- settings()
    say("  [ok] Crossref", if (nzchar(set$email)) " (with your email, for faster answers)" else " (without an email)")
    say(if (nzchar(set$key)) "  [ok] OpenAlex key found: abstracts and open-access status will be fetched"
        else "  [--] no OpenAlex key: the run goes on with Crossref only (fewer abstracts)")

    cache_file <- paste0(stem, "-cache.rds")
    cache <- if (file.exists(cache_file)) readRDS(cache_file) else list()
    if (nzchar(set$key)) cache <- cache[!vapply(cache, function(r) isFALSE(r$with_openalex), logical(1))]
    again <- vapply(cache, function(r) !identical(r$status, "found") && (is.null(r$matching) || r$matching < MATCHING), logical(1))
    if (any(again)) {
      say("  [ok] ", sum(again), " references that were not found before are asked again (the comparison was improved)")
      cache <- cache[!again]
    }
    todo  <- refs$ref_id[!(refs$ref_id %in% names(cache))]
    if (length(cache)) say("  [ok] ", length(cache), " references were already looked up earlier; ", length(todo), " to go")

    do_one <- function(id) {
      ref <- as.list(refs[refs$ref_id == id, ][1, ])
      res <- tryCatch(look_up(ref, set$email, set$key), error = function(e) NULL)
      Sys.sleep(PAUSE)
      if (!is.null(res) && isTRUE(res$complete)) cache[[id]] <<- res
      res
    }

    # a trial of ten first
    first <- utils::head(todo, TRIAL)
    if (length(first) && length(cache) == 0) {   # (no trial when most of the list is already done)
      say(""); say("Trial with the first ", length(first), " references")
      silent <- 0
      for (id in first) {
        res <- do_one(id); ref <- refs[refs$ref_id == id, ][1, ]
        silent <- if (is.null(res) || !isTRUE(res$complete)) silent + 1 else 0
        if (silent >= 3 && length(cache) == 0) break       # nothing answers: do not keep trying
        say("  ", id, "  ", if (is.null(res)) "no answer      " else if (res$status == "found") "found          " else "not found      ",
            short(paste(ref$first_author, ref$year, ref$title), 62),
            if (!is.null(res) && nzchar(res$doi)) paste0("  ->  ", res$doi) else "")
      }
      saveRDS(cache, cache_file)
      got <- sum(vapply(cache, function(r) r$status == "found", logical(1)))
      if (length(cache) == 0) halt("None of the trial references got an answer. Check the internet connection; ",
                                   "if it works, paste this message to Claude.")
      say(""); say("  found ", got, " of ", length(first), " in the trial.")
      answer <- if (interactive()) readline("Type yes and press Enter to look up all the others (anything else stops): ")
                else Sys.getenv("FIND_WORKS_CONFIRM")
      if (!identical(tolower(trimws(answer)), "yes")) {
        say(""); say("Stopped after the trial. Run the same line again to continue."); return(invisible())
      }
      todo <- refs$ref_id[!(refs$ref_id %in% names(cache))]
    }

    if (length(todo)) {
      say(""); say("Looking up ", length(todo), " references. This runs by itself; leave RStudio open.")
      t0 <- Sys.time(); failed <- 0
      for (i in seq_along(todo)) {
        res <- do_one(todo[i])
        if (is.null(res) || !isTRUE(res$complete)) failed <- failed + 1
        if (i %% 25 == 0 || i == length(todo)) {
          saveRDS(cache, cache_file)
          spent <- as.numeric(difftime(Sys.time(), t0, units = "mins"))
          left  <- spent / i * (length(todo) - i)
          say(sprintf("  %4d of %d done, about %.0f min left", i, length(todo), left))
        }
        if (failed >= 40 && failed > i / 2) {
          saveRDS(cache, cache_file)
          halt("Too many references got no answer (", failed, "). The catalogues may be busy, or today's free ",
               "allowance at OpenAlex may be used up. What was found is kept; run the same line again later ",
               "(tomorrow, if it was the allowance).")
        }
      }
    }

    # the result file
    done <- cache[refs$ref_id[refs$ref_id %in% names(cache)]]
    col <- function(f, empty) vapply(done, function(r) { v <- r[[f]]; if (is.null(v) || length(v) == 0 || is.na(v)) empty else as.character(v) }, "")
    out <- data.frame(ref_id = col("ref_id", ""), status = col("status", ""), doi = col("doi", ""),
                      found_by = col("found_by", ""), title_found = col("title_found", ""),
                      year_found = col("year_found", ""), journal_or_publisher = col("journal_or_publisher", ""),
                      type = col("type", ""), source_type = col("source_type", ""),
                      open_access = col("open_access", ""), oa_status = col("oa_status", ""),
                      abstract_from = col("abstract_from", ""), openalex_id = col("openalex_id", ""),
                      near_doi = col("near_doi", ""), near_title = col("near_title", ""),
                      near_year = col("near_year", ""), near_authors = col("near_authors", ""),
                      abstract = col("abstract", ""), stringsAsFactors = FALSE)
    out <- merge(refs[, intersect(c("ref_id", "first_author", "year", "title", "container", "kind_guess",
                                    "chapters_citing", "authors", "reference"), names(refs))], out, by = "ref_id", all.x = TRUE)
    out$status[is.na(out$status)] <- "not looked up"
    out_file <- paste0(stem, "-found.csv")
    utils::write.csv(out, out_file, row.names = FALSE, na = "", fileEncoding = "UTF-8")

    n <- nrow(out); found <- sum(out$status == "found"); with_doi <- sum(nzchar(out$doi) & !is.na(out$doi))
    with_abs <- sum(nzchar(out$abstract) & !is.na(out$abstract))
    say("")
    say("----- REPORT: copy from this line to END OF REPORT and paste it to Claude -----")
    say("script ", SCRIPT_VERSION, " | ", basename(input), " | ", format(Sys.time(), "%Y-%m-%d %H:%M"),
        " | OpenAlex key: ", if (nzchar(set$key)) "yes" else "no")
    say("references ", n, " | found ", found, " | with a DOI ", with_doi, " | not found ", sum(out$status == "not found"),
        " | not looked up ", sum(out$status == "not looked up"))
    say("found by Crossref ", sum(out$found_by == "Crossref", na.rm = TRUE), " | by OpenAlex ", sum(out$found_by == "OpenAlex", na.rm = TRUE),
        " | with an abstract ", with_abs, " (OpenAlex ", sum(out$abstract_from == "OpenAlex", na.rm = TRUE),
        ", Crossref ", sum(out$abstract_from == "Crossref", na.rm = TRUE), ")",
        " | open access ", sum(out$open_access == "TRUE", na.rm = TRUE))
    tt <- sort(table(out$type[nzchar(out$type) & !is.na(out$type)]), decreasing = TRUE)
    say("types: ", paste(names(tt), tt, collapse = ", "))
    say("----- END OF REPORT -----")
    say("")
    say("The result is in ", out_file, ". Upload that file to Claude.")
    invisible(TRUE)
  }

  tryCatch(
    main(),
    pv_stop = function(e) { say(""); say("STOPPED: ", conditionMessage(e)) },
    error   = function(e) {
      say(""); say("STOPPED by an unexpected error: ", conditionMessage(e))
      say("What was found so far is kept. Paste this message to Claude.")
    }
  )
  invisible(NULL)
})
