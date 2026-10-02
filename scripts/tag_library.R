# ---------------------------------------------------------------------------
# PopuliVerse Library: write the tags of one batch into the Zotero group.
#
# HOW TO RUN (in RStudio, with the populiverse project open):
#
#     source("scripts/tag_library.R")
#
# WHAT IT DOES, IN ORDER
#   1. Reads the newest batch file in library/batches/ and the allowed tags in
#      library/taxonomy.yml, and checks the batch against the tagging rules.
#      A tag that is not in taxonomy.yml stops everything here, before Zotero
#      is contacted.
#   2. Asks Zotero which works are in the group and finds each work of the
#      batch by its DOI.
#   3. Shows what it would change. Nothing has been changed at this point.
#   4. Asks you to type yes. Only then does it write to Zotero.
#   5. Reads the group again, checks the result and prints a short report.
#
# After a run, each work in the batch carries exactly the tags listed in the
# batch file. Works that are not in the batch are never touched. Running the
# script twice is harmless: the second run finds nothing to change.
#
# If the lookup (scripts/find_works.R) found a whole abstract for a work whose
# abstract is empty in Zotero, the script fills it in with the same step. An
# abstract that is already in Zotero is never replaced.
# A batch of more than 30 works is reported in short: counts, the first five
# works, and every work that needs attention.
#
# A work that enters without a DOI is created in Zotero from the record written
# in the batch file (taken from the source's own reference list), with its tags.
# It is never matched to an item that already carries a DOI. The script never
# deletes anything: records to remove are named, and you move them to the bin.
#
# THE ZOTERO KEY
#   The script looks for the key in the private file ~/.Renviron in your home
#   folder, which is outside the site folder. If the key is not there, a small
#   box asks for it once and the script stores it in that file. The key is
#   never printed, never written into this project and never needed in chat.
# ---------------------------------------------------------------------------

local({

  SCRIPT_VERSION <- "2026-10-02.4"
  GROUP_ID       <- "6697881"   # PopuliVerse Library on zotero.org
  BATCH_FILE     <- NULL        # NULL = the newest file in library/batches/

  # The two settings below exist for automated tests only.
  API_BASE   <- Sys.getenv("ZOTERO_API_BASE", "https://api.zotero.org")
  USER_AGENT <- "PopuliVerse tag_library.R (github.com/khayyam-rzazade/populiverse)"

  # ---- small helpers -------------------------------------------------------

  `%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a

  say <- function(...) cat(..., "\n", sep = "")

  # Stop with a plain message (no R jargon).
  halt <- function(...) {
    stop(structure(class = c("pv_stop", "error", "condition"),
                   list(message = paste0(...), call = NULL)))
  }

  short <- function(x, n = 72) {
    x <- x %||% ""
    if (nchar(x) > n) paste0(substr(x, 1, n - 3), "...") else x
  }

  # Read a YAML file as UTF-8 whatever the computer's language settings are.
  read_yaml_utf8 <- function(path) {
    lines <- readLines(path, encoding = "UTF-8", warn = FALSE)
    yaml::yaml.load(paste(lines, collapse = "\n"))
  }

  norm_doi <- function(x) {
    x <- trimws(tolower(x %||% ""))
    sub("^(https?://(dx\\.)?doi\\.org/|doi:\\s*)", "", x)
  }

  norm_title <- function(x) {
    x <- tolower(x %||% "")
    trimws(gsub("[^\\p{L}\\p{N}]+", " ", x, perl = TRUE))
  }

  # ---- packages ------------------------------------------------------------

  ensure_packages <- function() {
    needed  <- c("httr", "jsonlite", "yaml")
    missing <- needed[!vapply(needed, requireNamespace, logical(1), quietly = TRUE)]
    if (length(missing)) {
      say("Installing R packages this script needs (one time only): ",
          paste(missing, collapse = ", "))
      utils::install.packages(missing)
      still <- missing[!vapply(missing, requireNamespace, logical(1), quietly = TRUE)]
      if (length(still)) {
        halt("These R packages could not be installed: ", paste(still, collapse = ", "),
             ". Paste this message to Claude.")
      }
    }
  }

  # ---- the vocabulary and the batch ----------------------------------------

  load_taxonomy <- function(path = "library/taxonomy.yml") {
    facets <- read_yaml_utf8(path)$facets
    all_tags <- unlist(lapply(facets, function(f) vapply(f$tags, function(t) t$tag, "")),
                       use.names = FALSE)
    ct <- facets$country$tags
    country_region <- stats::setNames(vapply(ct, function(t) t$region, ""),
                                      vapply(ct, function(t) t$tag, ""))
    tt <- facets$type$tags
    type_zotero <- stats::setNames(lapply(tt, function(t) unlist(t$zotero)),
                                   vapply(tt, function(t) t$tag, ""))
    list(tags = all_tags, country_region = country_region, type_zotero = type_zotero)
  }

  find_batch <- function() {
    if (!is.null(BATCH_FILE)) {
      if (!file.exists(BATCH_FILE)) halt("The batch file ", BATCH_FILE, " does not exist.")
      return(BATCH_FILE)
    }
    files <- sort(list.files("library/batches", pattern = "^batch-.*\\.yml$", full.names = TRUE))
    if (!length(files)) halt("No batch file found in library/batches/.")
    files[length(files)]
  }

  # Returns a list of problems in plain words; empty when the batch is fine.
  check_batch <- function(works, tax) {
    problems <- character()
    add <- function(name, text) problems <<- c(problems, paste0(name, ": ", text))
    dois <- character()
    for (i in seq_along(works)) {
      w    <- works[[i]]
      name <- w$cite %||% paste("work", i)
      tags <- as.character(unlist(w$tags))
      if (!nzchar(w$doi %||% "") && !nzchar(w$title %||% "")) add(name, "needs a doi or a title")
      if (!length(tags)) { add(name, "has no tags"); next }
      if (any(duplicated(tags))) add(name, paste("lists a tag twice:", paste(unique(tags[duplicated(tags)]), collapse = ", ")))
      unknown <- setdiff(tags, tax$tags)
      if (length(unknown)) add(name, paste("these tags are not in taxonomy.yml:", paste(unknown, collapse = ", ")))
      prefix <- sub(":.*$", "", tags)
      regions <- tags[prefix == "region"]
      if ("region:global" %in% regions && length(regions) > 1) add(name, "region:global cannot be combined with another region")
      if (length(setdiff(regions, "region:global")) > 2) add(name, "has more than two regions: use region:global instead")
      if (sum(prefix == "type") != 1) add(name, "needs exactly one type tag")
      countries <- intersect(tags[prefix == "country"], names(tax$country_region))
      if (length(countries) > 5) add(name, "has more than five country tags: use the region only")
      if (length(countries) && !("region:global" %in% regions)) {
        missing_regions <- setdiff(unique(unname(tax$country_region[countries])), regions)
        if (length(missing_regions)) add(name, paste("its countries need the region tag", paste(missing_regions, collapse = ", ")))
      }
      dois <- c(dois, norm_doi(w$doi))
    }
    dois <- dois[nzchar(dois)]
    if (any(duplicated(dois))) problems <- c(problems, paste("the same DOI is listed twice:", paste(unique(dois[duplicated(dois)]), collapse = ", ")))
    problems
  }

  # ---- talking to Zotero ---------------------------------------------------

  parse_json <- function(resp) {
    jsonlite::fromJSON(httr::content(resp, as = "text", encoding = "UTF-8"), simplifyVector = FALSE)
  }

  # One request to Zotero. Waits and retries when Zotero asks for it.
  # soft = TRUE returns NULL instead of stopping when Zotero cannot be reached.
  zot <- function(method, path, key = NULL, query = NULL, body = NULL, if_version = NULL, soft = FALSE) {
    # "Expect" is switched off because Zotero does not support that header.
    h <- c("Zotero-API-Version" = "3", "Expect" = "")
    if (!is.null(key)) h <- c(h, "Zotero-API-Key" = key)
    if (!is.null(if_version)) h <- c(h, "If-Unmodified-Since-Version" = as.character(if_version))
    args <- list(method, paste0(API_BASE, path), httr::add_headers(.headers = h),
                 httr::user_agent(USER_AGENT), httr::timeout(30))
    if (!is.null(query)) args$query <- query
    if (!is.null(body)) {
      args <- c(args, list(httr::content_type("application/json")))
      args$body   <- body
      args$encode <- "raw"
    }
    for (attempt in 1:5) {
      resp <- tryCatch(do.call(httr::VERB, args), error = function(e) NULL)
      if (is.null(resp)) {
        if (attempt < 3) { Sys.sleep(2); next }
        if (soft) return(NULL)
        halt("Could not reach Zotero. Check the internet connection, then run the line again.")
      }
      status <- httr::status_code(resp)
      hdr    <- httr::headers(resp)
      if (status %in% c(429L, 503L)) {
        wait <- suppressWarnings(as.numeric(hdr[["retry-after"]] %||% NA))
        if (is.na(wait)) wait <- 5 * attempt
        Sys.sleep(min(wait, 60))
        next
      }
      backoff <- suppressWarnings(as.numeric(hdr[["backoff"]] %||% NA))
      if (!is.na(backoff)) Sys.sleep(min(backoff, 30))
      return(resp)
    }
    if (soft) return(NULL)
    halt("Zotero is busy at the moment. Wait a few minutes and run the line again.")
  }

  # ---- the key -------------------------------------------------------------

  ask_for_key <- function() {
    if (!interactive()) halt("No usable Zotero key. Run the script from RStudio so that it can ask for the key.")
    prompt <- "Paste your Zotero key for the PopuliVerse Library. It is stored only on this Mac."
    key <- NULL
    if (requireNamespace("rstudioapi", quietly = TRUE) && rstudioapi::isAvailable()) {
      key <- rstudioapi::askForPassword(prompt)
    } else if (requireNamespace("askpass", quietly = TRUE)) {
      key <- askpass::askpass(prompt)
    } else {
      halt("Cannot open the box that asks for the key. Paste this message to Claude.")
    }
    key <- trimws(key %||% "")
    if (!nzchar(key)) halt("No key was entered. Nothing was changed.")
    if (nchar(key) < 10 || grepl("\\s", key)) {
      halt("That does not look like a Zotero key (a key is one string of letters and digits). ",
           "Nothing was stored. Run the line again and paste the key exactly.")
    }
    key
  }

  # Store the key in ~/.Renviron (home folder), replacing an older one.
  save_key <- function(key) {
    path <- path.expand("~/.Renviron")
    old  <- if (file.exists(path)) readLines(path, warn = FALSE) else character()
    old  <- old[!grepl("^\\s*ZOTERO_API_KEY\\s*=", old)]
    writeLines(c(old, paste0("ZOTERO_API_KEY=", key)), path)
    Sys.chmod(path, mode = "0600")
    Sys.setenv(ZOTERO_API_KEY = key)
    say("  [ok] key stored in ", path, " (your home folder, outside the site folder)")
  }

  # Ask Zotero what the key may do.
  check_key <- function(key) {
    resp   <- zot("GET", "/keys/current", key)
    status <- httr::status_code(resp)
    if (status %in% c(403L, 404L)) return(list(accepted = FALSE))
    if (status != 200L) halt("Zotero answered with code ", status, " when checking the key. Try again in a few minutes.")
    info <- parse_json(resp)
    perm <- info$access$groups[[GROUP_ID]] %||% info$access$groups[["all"]]
    list(accepted = TRUE,
         user  = info$username %||% "unknown",
         read  = isTRUE(perm$library),
         write = isTRUE(perm$write))
  }

  # Returns a key that Zotero accepts and that may write to the group.
  get_working_key <- function() {
    key   <- trimws(Sys.getenv("ZOTERO_API_KEY", ""))
    fresh <- FALSE
    if (!nzchar(key)) {
      say("  No Zotero key on this Mac yet: a box asks for it now.")
      key <- ask_for_key(); fresh <- TRUE
    }
    info <- check_key(key)
    if (!info$accepted && !fresh) {
      say("  The stored key is not accepted by Zotero any more: a box asks for a new one.")
      key <- ask_for_key(); fresh <- TRUE
      info <- check_key(key)
    }
    if (!info$accepted) {
      halt("Zotero does not accept this key. Nothing was stored and nothing was changed. ",
           "Check the key on zotero.org/settings/keys, then run the line again.")
    }
    if (!info$write) {
      halt("Zotero accepts the key, but the key may not write to the PopuliVerse Library. ",
           "On zotero.org/settings/keys, open the key and give the group PopuliVerse Library ",
           "the permission Read/Write. Then run the line again. Nothing was changed.")
    }
    say("  [ok] key accepted (Zotero user: ", info$user, "), it may write to the group")
    if (fresh) save_key(key)
    key
  }

  # ---- reading the group ---------------------------------------------------

  get_group_line <- function(key) {
    resp <- zot("GET", paste0("/groups/", GROUP_ID), key, soft = TRUE)
    if (is.null(resp) || httr::status_code(resp) != 200L) return("group settings: not available")
    d <- parse_json(resp)$data
    paste0("group: ", d$name %||% "?", " | type ", d$type %||% "?",
           " | reading: ", d$libraryReading %||% "?",
           " | editing: ", d$libraryEditing %||% "?",
           " | files: ", d$fileEditing %||% "?")
  }

  get_items <- function(key) {
    items <- list(); start <- 0
    repeat {
      resp <- zot("GET", paste0("/groups/", GROUP_ID, "/items/top"), key,
                  query = list(format = "json", limit = 100, start = start))
      status <- httr::status_code(resp)
      if (status != 200L) halt("Zotero answered with code ", status, " when reading the group. Nothing was changed.")
      page  <- parse_json(resp)
      items <- c(items, page)
      total <- suppressWarnings(as.integer(httr::headers(resp)[["total-results"]] %||% NA))
      start <- start + 100
      if (!length(page) || is.na(total) || start >= total) break
    }
    Filter(function(it) !((it$data$itemType %||% "") %in% c("note", "attachment", "annotation")), items)
  }

  # Where is the DOI of a Zotero item? Articles have a DOI field; books keep
  # the DOI as a line "DOI: ..." in the field Extra.
  item_doi <- function(it) {
    d <- it$data
    if (nzchar(d$DOI %||% "")) return(list(doi = norm_doi(d$DOI), where = "DOI field"))
    extra <- d$extra %||% ""
    m <- regmatches(extra, regexpr("(?im)^\\s*DOI:\\s*\\S+", extra, perl = TRUE))
    if (length(m)) return(list(doi = norm_doi(sub("(?i)^\\s*DOI:\\s*", "", m, perl = TRUE)), where = "Extra"))
    url <- d$url %||% ""
    if (grepl("doi\\.org/", url)) return(list(doi = norm_doi(sub("^.*doi\\.org/", "", url)), where = "URL field"))
    list(doi = "", where = "none")
  }

  item_tags <- function(it) vapply(it$data$tags %||% list(), function(t) t$tag %||% "", "")

  # Find each work of the batch among the items of the group.
  match_works <- function(works, items) {
    dois   <- vapply(items, function(it) item_doi(it)$doi, "")
    titles <- vapply(items, function(it) norm_title(it$data$title), "")
    lapply(works, function(w) {
      hit <- integer(); how <- "DOI"
      wd <- norm_doi(w$doi)
      if (nzchar(wd)) hit <- which(dois == wd)
      if (!length(hit) && nzchar(w$title %||% "")) {
        wt <- norm_title(w$title)
        same   <- titles == wt
        prefix <- nchar(titles) >= 15 & startsWith(paste0(wt, " "), paste0(titles, " "))
        hit <- which(same | prefix)
        # an item that carries a different DOI is a different work, whatever its title
        # (the same holds for a work that enters without a DOI: it is never matched to an item that has one)
        if ((nzchar(wd) || !is.null(w$create)) && length(hit)) hit <- hit[!nzchar(dois[hit])]
        if (!is.null(w$create) && length(hit)) hit <- hit[titles[hit] == wt]
        if (!is.null(w$year) && length(hit)) {
          years <- vapply(items[hit], function(it) grepl(as.character(w$year), it$data$date %||% "", fixed = TRUE), logical(1))
          if (any(years)) hit <- hit[years]
        }
        how <- "title"
      }
      if (!length(hit)) return(list(status = "not found"))
      if (length(hit) > 1) return(list(status = "duplicate", keys = vapply(items[hit], function(it) it$key, "")))
      list(status = "found", item = items[[hit]], how = how)
    })
  }

  # Is this a whole abstract? At least 250 characters, ending like a sentence, not cut off.
  whole_abstract <- function(a) {
    a <- trimws(gsub("\\s+", " ", a %||% ""))
    nchar(a) >= 250 & grepl("[.!?\"'\u201d\u2019)\\]]$", a, perl = TRUE) & !grepl("(\\.\\.\\.|\u2026)$", a, perl = TRUE)
  }

  # The abstracts found by scripts/find_works.R for this batch, by reference number.
  # Only whole abstracts are used: one that ends cut off is left out.
  load_abstracts <- function(batch_path) {
    f <- file.path("drafts", sub("\\.yml$", "-found.csv", basename(batch_path)))
    if (!file.exists(f)) return(list())
    d <- utils::read.csv(f, stringsAsFactors = FALSE, encoding = "UTF-8", colClasses = "character", na.strings = character())
    if (!all(c("ref_id", "abstract") %in% names(d))) return(list())
    a <- trimws(gsub("\\s+", " ", d$abstract))
    a <- sub("^(Abstract|ABSTRACT|Summary|SUMMARY)[:.]? +(?=[A-Z\u201c\u2018\"'(\\[])", "", a, perl = TRUE)
    ok <- whole_abstract(a)
    stats::setNames(as.list(a[ok]), d$ref_id[ok])
  }

  # What has to change for one work.
  plan_one <- function(w, it, tax, abstracts = list()) {
    current <- item_tags(it)
    target  <- as.character(unlist(w$tags))
    auto    <- vapply(it$data$tags %||% list(), function(t) isTRUE(as.integer(t$type %||% 0) == 1L), logical(1))
    remove  <- setdiff(current, target)
    type_tag <- target[startsWith(target, "type:")]
    expected <- tax$type_zotero[[type_tag]]
    list(add = setdiff(target, current),
         remove = remove,
         remove_auto = sum(current %in% remove & auto),
         new_title = if (isTRUE(w$fix_title) && !identical(it$data$title %||% "", w$title)) w$title else NULL,
         new_abstract = if (!nzchar(trimws(it$data$abstractNote %||% "")) && !is.null(w$ref) && !is.null(abstracts[[w$ref]])) abstracts[[w$ref]] else NULL,
         type_note = if (!is.null(expected) && !((it$data$itemType %||% "") %in% expected)) {
           paste0("note: tagged ", type_tag, " but Zotero has it as \"", it$data$itemType, "\"")
         } else NULL)
  }

  has_change <- function(p) length(p$add) > 0 || length(p$remove) > 0 || !is.null(p$new_title) || !is.null(p$new_abstract)

  # ---- the run -------------------------------------------------------------

  main <- function() {
    say("")
    say("PopuliVerse Library: tagging script (version ", SCRIPT_VERSION, ")")
    say("Trial run first. Nothing is changed until you type yes.")
    say("")

    if (!file.exists("_quarto.yml") || !file.exists("library/taxonomy.yml")) {
      halt("This is not the site folder. Open the project first (double-click populiverse.Rproj, ",
           "or in RStudio: File > Open Project), then run the line again.")
    }
    ensure_packages()

    # 1. the batch, checked against the vocabulary
    say("1. Checks before contacting Zotero")
    tax        <- load_taxonomy()
    batch_path <- find_batch()
    batch      <- read_yaml_utf8(batch_path)
    works      <- batch$works
    if (!length(works)) halt("The batch file ", batch_path, " lists no works.")
    problems <- check_batch(works, tax)
    if (length(problems)) {
      say("  The batch file ", batch_path, " breaks the tagging rules:")
      for (p in problems) say("   - ", p)
      halt("The batch file has to be corrected first. Zotero was not contacted and nothing was changed.")
    }
    say("  [ok] ", basename(batch_path), ": ", length(works), " works; ", length(tax$tags), " tags allowed by taxonomy.yml")
    say("  [ok] every tag is in taxonomy.yml, and every work follows the tagging rules")
    say("")

    # 2. Zotero: the key, the group, the items
    say("2. Zotero")
    key        <- get_working_key()
    group_line <- get_group_line(key)
    say("  [ok] ", group_line)
    items <- get_items(key)
    say("  [ok] ", length(items), " works in the group")
    if (!length(items)) {
      halt("The group is empty on zotero.org. If you have just added the works in the Zotero app, ",
           "click the sync button (the circular arrow), wait until it stops, and run the line again.")
    }
    say("")

    # 3. the plan
    abstracts <- load_abstracts(batch_path)
    matches <- match_works(works, items)
    plans   <- vector("list", length(works))
    big     <- length(works) > 30          # a large batch is reported in short
    say("3. What would change", if (big) " (a large batch: only the first five works and every problem are listed)" else "")
    shown <- 0; missing <- character(); to_create <- integer()
    for (i in seq_along(works)) {
      w <- works[[i]]; m <- matches[[i]]
      head <- paste0("  ", i, ". ", w$cite %||% "?", " - ", short(w$title, 60))
      if (m$status == "not found" && !is.null(w$create)) {
        to_create <- c(to_create, i)
        if (!big) { say(head); say("       no DOI: the record will be created in Zotero from the source's reference, with ", length(unlist(w$tags)), " tags") }
        next
      }
      if (m$status == "not found") {
        missing <- c(missing, w$doi %||% "")
        if (!big) { say(head); say("       NOT IN THE GROUP: add it in the Zotero app with the DOI ", w$doi %||% "(none)", ", sync, and run again") }
        next
      }
      if (m$status == "duplicate") {
        say(head); say("       IN THE GROUP MORE THAN ONCE (", paste(m$keys, collapse = ", "),
                       "): move the extra copy to the bin in the Zotero app, sync, and run again")
        next
      }
      p <- plan_one(w, m$item, tax, abstracts); plans[[i]] <- p
      if (big && shown >= 5 && is.null(p$type_note)) next
      shown <- shown + 1
      say(head)
      if (m$how == "title") say("       found by its title (Zotero did not keep the DOI)")
      if (!has_change(p)) say("       already right, nothing to change")
      if (length(p$add)) say("       add:    ", paste(p$add, collapse = "  "))
      if (length(p$remove)) {
        say("       remove: ", length(p$remove), " tag(s) that are not in the batch",
            if (p$remove_auto > 0) paste0(" (", p$remove_auto, " added automatically by the import)") else "",
            ": ", short(paste(p$remove, collapse = "; "), 90))
      }
      if (!is.null(p$new_title)) say("       title:  \"", short(m$item$data$title, 50), "\" becomes \"", short(p$new_title, 80), "\"")
      if (!is.null(p$new_abstract)) say("       abstract: empty in Zotero, filled with the one found by the lookup (", nchar(p$new_abstract), " characters)")
      if (!is.null(p$type_note)) say("       ", p$type_note)
    }
    if (big && length(missing)) {
      say("  NOT IN THE GROUP: ", length(missing), " works. Add them in the Zotero app with their DOI, sync, and run again.")
      say("  Their DOIs are in drafts/", sub("\\.yml$", "-missing-dois.txt", basename(batch_path)), " (one per line, ready to paste).")
      dir.create("drafts", showWarnings = FALSE)
      writeLines(missing[nzchar(missing)], file.path("drafts", sub("\\.yml$", "-missing-dois.txt", basename(batch_path))))
    }
    status     <- vapply(matches, function(m) m$status, "")
    to_change  <- which(vapply(plans, function(p) !is.null(p) && has_change(p), logical(1)))
    n_abs      <- sum(vapply(plans[to_change], function(p) !is.null(p$new_abstract), logical(1)))
    say("")
    say("  Summary: ", length(to_change), " to change (", n_abs, " of them also get their abstract), ",
        length(to_create), " to create (works without a DOI), ",
        sum(status == "found") - length(to_change), " already right, ",
        sum(status == "not found") - length(to_create), " not in the group, ",
        sum(status == "duplicate"), " in the group more than once.")
    # abstracts written by an earlier batch that are not whole: taken out again
    all_dois <- vapply(items, function(it) item_doi(it)$doi, "")
    to_clear <- list()
    for (x in batch$clear_abstract %||% list()) {
      i <- which(all_dois == norm_doi(x$doi))
      if (length(i) == 1 && nzchar(trimws(items[[i]]$data$abstractNote %||% "")) && !whole_abstract(items[[i]]$data$abstractNote)) {
        to_clear[[length(to_clear) + 1]] <- list(item = items[[i]], why = x$why)
      }
    }
    if (length(to_clear)) {
      say("")
      say("  ", length(to_clear), " abstract(s) written by an earlier batch are not whole and are taken out again:")
      for (x in to_clear) say("   - ", short(x$item$data$title, 60), ": ", x$why)
    }
    # records of an earlier batch that are to be removed by hand
    stale <- Filter(function(x) x$key %in% vapply(items, function(it) it$key, ""), batch$remove %||% list())
    if (length(stale)) {
      say("")
      say("  TO REMOVE BY HAND: ", length(stale), " record(s) in the group are not the works cited. In the Zotero app,")
      say("  move each to the bin (right-click, Move Item to Bin), then sync:")
      titles_now <- stats::setNames(vapply(items, function(it) it$data$title %||% "", ""), vapply(items, function(it) it$key, ""))
      for (x in stale) say("   - ", short(titles_now[[x$key]], 60), ": ", x$why)
    }
    say("")

    # 4. confirmation and writing
    written <- integer(); failed <- character()
    created <- 0
    cleared <- 0
    if (length(to_change) || length(to_create) || length(to_clear)) {
      answer <- if (interactive()) {
        readline("Type yes and press Enter to write these changes to Zotero (anything else stops): ")
      } else Sys.getenv("TAG_LIBRARY_CONFIRM", "")
      if (!identical(tolower(trimws(answer)), "yes")) {
        say(""); say("Stopped before writing. Nothing was changed in Zotero.")
        return(invisible(NULL))
      }
      say(""); say("4. Writing to Zotero")
      for (i in to_change) {
        w <- works[[i]]; it <- matches[[i]]$item; p <- plans[[i]]
        change <- list(tags = lapply(as.character(unlist(w$tags)), function(t) list(tag = t)))
        if (!is.null(p$new_title)) change$title <- p$new_title
        if (!is.null(p$new_abstract)) change$abstractNote <- p$new_abstract
        body <- jsonlite::toJSON(change, auto_unbox = TRUE)
        resp <- zot("PATCH", paste0("/groups/", GROUP_ID, "/items/", it$key), key,
                    body = enc2utf8(as.character(body)), if_version = it$version, soft = TRUE)
        code <- if (is.null(resp)) NA_integer_ else httr::status_code(resp)
        if (identical(code, 204L)) {
          written <- c(written, i)
          if (!big) say("  [ok] ", i, ". ", w$cite)
          else if (length(written) %% 50 == 0) say("  ", length(written), " of ", length(to_change), " written")
        } else {
          why <- if (is.na(code)) "no connection to Zotero"
                 else if (code == 412L) "the work was changed in Zotero in the meantime (sync the app and run again)"
                 else if (code == 403L) "the key may not write to the group"
                 else if (code == 409L) "the library is locked by Zotero for the moment (run again in a minute)"
                 else paste0("Zotero answered with code ", code)
          failed <- c(failed, paste0(i, ". ", w$cite, ": ", why))
          say("  [!!] ", i, ". ", w$cite, ": ", why)
        }
        Sys.sleep(0.25)   # a short pause between writes, to go easy on Zotero
      }
      # works without a DOI: created from the source's own reference, at most 25 per request
      for (chunk in split(to_create, ceiling(seq_along(to_create) / 25))) {
        objects <- lapply(chunk, function(i) {
          w <- works[[i]]
          ab <- if (!is.null(w$ref)) abstracts[[w$ref]] else NULL      # the abstract found by the lookup, if a whole one exists
          c(w$create, list(tags = lapply(as.character(unlist(w$tags)), function(t) list(tag = t)),
                           extra = batch$note %||% "Record made from a reference list; not yet checked against the publication."),
            if (!is.null(ab)) list(abstractNote = ab))
        })
        body <- jsonlite::toJSON(objects, auto_unbox = TRUE)
        resp <- zot("POST", paste0("/groups/", GROUP_ID, "/items"), key, body = enc2utf8(as.character(body)), soft = TRUE)
        code <- if (is.null(resp)) NA_integer_ else httr::status_code(resp)
        if (identical(code, 200L)) {
          res <- parse_json(resp)
          created <- created + length(res$successful %||% res$success %||% list())
          for (k in names(res$failed %||% list())) {
            w <- works[[chunk[as.integer(k) + 1]]]
            failed <- c(failed, paste0(w$cite, ": not created (", res$failed[[k]]$message %||% "no reason given", ")"))
            say("  [!!] ", w$cite, ": not created (", res$failed[[k]]$message %||% "no reason given", ")")
          }
        } else {
          why <- if (is.na(code)) "no connection to Zotero" else if (code == 403L) "the key may not write to the group" else paste0("Zotero answered with code ", code)
          failed <- c(failed, paste0(length(chunk), " records not created: ", why))
          say("  [!!] ", length(chunk), " records not created: ", why)
        }
        Sys.sleep(0.5)
      }
      if (length(to_create)) say("  ", created, " of ", length(to_create), " records created")
      for (x in to_clear) {
        resp <- zot("PATCH", paste0("/groups/", GROUP_ID, "/items/", x$item$key), key,
                    body = "{\"abstractNote\":\"\"}", if_version = x$item$version, soft = TRUE)
        if (!is.null(resp) && identical(httr::status_code(resp), 204L)) cleared <- cleared + 1
        else failed <- c(failed, paste0("abstract not taken out: ", short(x$item$data$title, 50)))
        Sys.sleep(0.25)
      }
      if (length(to_clear)) say("  ", cleared, " of ", length(to_clear), " abstracts that were not whole taken out")
      say("")
    } else {
      say("Nothing to write.")
      say("")
    }

    # 5. read again, check, report
    items_after   <- if (length(written) || created > 0) get_items(key) else items
    matches_after <- match_works(works, items_after)
    exact <- vapply(seq_along(works), function(i) {
      m <- matches_after[[i]]
      m$status == "found" && setequal(item_tags(m$item), as.character(unlist(works[[i]]$tags)))
    }, logical(1))
    say("5. Check after writing: ", sum(exact), " of ", length(works),
        " works now carry exactly the tags of the batch.")
    if (length(written) || created > 0) say("   In the Zotero app, click the sync button to see the changes.")
    say("")
    say("----- REPORT: copy from this line to END OF REPORT and paste it to Claude -----")
    say("script ", SCRIPT_VERSION, " | ", basename(batch_path), " | group ", GROUP_ID, " | ", format(Sys.time(), "%Y-%m-%d %H:%M"))
    say(group_line)
    say("in batch ", length(works), " | found ", sum(status == "found"),
        " | written ", length(written), " | created ", created, " | abstracts taken out ", cleared,
        " | still to remove by hand ", length(stale), " | failed ", length(failed),
        " | not in group ", sum(status == "not found"), " | duplicates ", sum(status == "duplicate"),
        " | exact after run ", sum(exact), " | works in group ", length(items_after))
    for (f in failed) say("failed: ", f)
    with_abs <- sum(vapply(matches_after, function(m) m$status == "found" && nzchar(trimws(m$item$data$abstractNote %||% "")), logical(1)))
    say("abstracts filled by this run ", if (length(written)) sum(vapply(plans[written], function(p) !is.null(p$new_abstract), logical(1))) else 0,
        " | works of the batch with an abstract now ", with_abs)
    # works whose kind in Zotero contradicts their type tag: the nightly sync holds these back
    odd <- Filter(Negate(is.null), lapply(seq_along(works), function(i) {
      p <- plans[[i]]
      if (!is.null(p) && !is.null(p$type_note)) paste0(i, " | ", works[[i]]$cite %||% "?", " | ", sub("^note: ", "", p$type_note)) else NULL
    }))
    say("kind in Zotero differs from the type tag: ", length(odd),
        if (length(odd)) " (the nightly sync holds these works back until the item type is corrected in the Zotero app)" else "")
    for (x in odd) say("type differs: ", x)
    listed <- 0
    for (i in seq_along(works)) {
      w <- works[[i]]; m <- matches_after[[i]]
      if (big && m$status == "found" && exact[i]) next
      listed <- listed + 1
      if (big && listed > 40) { say("(more works not in order; the list stops at 40)"); break }
      if (m$status != "found") { say(i, " | ", w$cite, " | ", toupper(m$status), " | ", w$doi %||% ""); next }
      d <- m$item$data
      say(i, " | ", w$cite, " | key ", m$item$key, " | ", d$itemType %||% "?",
          " | date ", d$date %||% "", " | DOI in ", item_doi(m$item)$where,
          " | abstract ", nchar(d$abstractNote %||% ""), " chars",
          " | creators ", length(d$creators %||% list()),
          " | tags ", length(d$tags %||% list()), if (exact[i]) " exact" else " NOT EXACT",
          " | ", short(d$title, 90))
    }
    in_batch <- vapply(matches_after[vapply(matches_after, function(m) m$status == "found", logical(1))],
                       function(m) m$item$key, "")
    others <- Filter(function(it) !(it$key %in% in_batch), items_after)
    if (length(others)) {
      say("other works in the group, not in this batch: ", length(others))
      for (it in utils::head(others, 10)) say("  - ", it$key, " | ", short(it$data$title, 90))
    }
    say("----- END OF REPORT -----")
    invisible(NULL)
  }

  tryCatch(
    main(),
    pv_stop = function(e) { say(""); say("STOPPED: ", conditionMessage(e)) },
    error   = function(e) {
      say(""); say("STOPPED by an unexpected error: ", conditionMessage(e))
      say("Nothing else was done. Paste this message to Claude.")
    }
  )
  invisible(NULL)
})
