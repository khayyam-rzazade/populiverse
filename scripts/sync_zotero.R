# ---------------------------------------------------------------------------
# PopuliVerse Library: copy the Zotero group into library/library.json.
#
# WHO RUNS IT
#   GitHub runs it every night (see .github/workflows/sync.yml).
#   You can also run it yourself in RStudio, with the populiverse project open:
#
#       source("scripts/sync_zotero.R")
#
# WHAT IT DOES, IN ORDER
#   1. Reads every work in the public Zotero group. No key is needed, and the
#      script never writes to Zotero.
#   2. Checks each work against library/taxonomy.yml and the tagging rules.
#   3. Writes library/library.json: one record for each work that passes
#      (formatted citation, abstract if Zotero has one, DOI, type, year,
#      journal or publisher, tags by group, BibTeX), plus a copy of the
#      vocabulary so that the file explains itself.
#   4. Prints a report.
#
# WHICH RULES
#   Every tag must be in taxonomy.yml; a work needs one type, at most two regions
#   (or region:global alone) and at most five countries; no work twice. A work
#   may stay untagged on approach, topic, region or method. The editor's notes
#   (tags that begin with "todo:") are accepted and never published.
#
# WHAT HAPPENS TO A WORK THAT BREAKS A RULE
#   It is held back: it does not go into library.json, and the report names it
#   and says why. All other works go through. A work that has no Library tag
#   yet is simply waiting; it is listed, but it is not an error.
#
# The file is rebuilt from scratch at every run, and two runs on the same
# group give exactly the same file. Never edit library.json by hand.
# ---------------------------------------------------------------------------

local({

  SCRIPT_VERSION <- "2026-10-01.2"
  GROUP_ID       <- "6697881"   # PopuliVerse Library on zotero.org
  GROUP_URL      <- "https://www.zotero.org/groups/6697881/populiverse_library"
  STYLE          <- "chicago-author-date"
  OUT            <- "library/library.json"

  # The setting below exists for automated tests only.
  API_BASE   <- Sys.getenv("ZOTERO_API_BASE", "https://api.zotero.org")
  USER_AGENT <- "PopuliVerse sync_zotero.R (github.com/khayyam-rzazade/populiverse)"

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

  # Text is handled as UTF-8 whatever the computer's language settings are.
  use_utf8 <- function() {
    if (!isTRUE(l10n_info()[["UTF-8"]])) {
      for (loc in c("C.UTF-8", "en_US.UTF-8", "UTF-8")) {
        ok <- suppressWarnings(Sys.setlocale("LC_CTYPE", loc))
        if (nzchar(ok)) break
      }
    }
  }

  read_yaml_utf8 <- function(path) {
    lines <- readLines(path, encoding = "UTF-8", warn = FALSE)
    yaml::yaml.load(paste(lines, collapse = "\n"))
  }

  norm_title <- function(x) {
    x <- tolower(x %||% "")
    trimws(gsub("[^\\p{L}\\p{N}]+", " ", x, perl = TRUE))
  }

  one_line <- function(x) trimws(gsub("\\s+", " ", x %||% "", perl = TRUE))

  # ---- packages ------------------------------------------------------------

  ensure_packages <- function() {
    needed  <- c("httr", "jsonlite", "yaml")
    missing <- needed[!vapply(needed, requireNamespace, logical(1), quietly = TRUE)]
    if (!length(missing)) return(invisible())
    if (!interactive()) halt("These R packages are missing: ", paste(missing, collapse = ", "), ".")
    say("Installing R packages this script needs (one time only): ", paste(missing, collapse = ", "))
    utils::install.packages(missing)
    still <- missing[!vapply(missing, requireNamespace, logical(1), quietly = TRUE)]
    if (length(still)) {
      halt("These R packages could not be installed: ", paste(still, collapse = ", "),
           ". Paste this message to Claude.")
    }
  }

  # ---- the vocabulary ------------------------------------------------------

  load_taxonomy <- function(path = "library/taxonomy.yml") {
    y      <- read_yaml_utf8(path)
    facets <- y$facets
    all_tags <- unlist(lapply(facets, function(f) vapply(f$tags, function(t) t$tag, "")),
                       use.names = FALSE)
    ct <- facets$country$tags
    country_region <- stats::setNames(vapply(ct, function(t) t$region, ""),
                                      vapply(ct, function(t) t$tag, ""))
    tt <- facets$type$tags
    type_zotero <- stats::setNames(lapply(tt, function(t) as.character(unlist(t$zotero))),
                                   vapply(tt, function(t) t$tag, ""))
    # Zotero item types that point to exactly one type tag
    # (a "report" can be a policy paper or a working paper, so it is left out).
    zot_types <- unique(unlist(type_zotero, use.names = FALSE))
    type_from_zotero <- list()
    for (z in zot_types) {
      hits <- names(type_zotero)[vapply(type_zotero, function(v) z %in% v, logical(1))]
      if (length(hits) == 1) type_from_zotero[[z]] <- hits
    }
    # A copy of the vocabulary for library.json (lists stay lists in the file).
    # (the editor's own notes, the "todo" tags, are not copied: they are never shown)
    copy <- lapply(Filter(function(f) !isTRUE(f$internal), facets), function(f) {
      list(label = f$label, about = f$about,
           tags = lapply(f$tags, function(t) {
             if (!is.null(t$zotero)) t$zotero <- as.list(as.character(unlist(t$zotero)))
             t
           }))
    })
    list(version = y$version, tags = all_tags, country_region = country_region,
         type_zotero = type_zotero, type_from_zotero = type_from_zotero, copy = copy)
  }

  # ---- reading the group ---------------------------------------------------

  # One request to Zotero. Waits and retries when Zotero asks for it.
  zot_get <- function(path, query = NULL) {
    # "Expect" is switched off because Zotero does not support that header.
    h <- c("Zotero-API-Version" = "3", "Expect" = "")
    args <- list(paste0(API_BASE, path), httr::add_headers(.headers = h),
                 httr::user_agent(USER_AGENT), httr::timeout(60))
    if (!is.null(query)) args$query <- query
    for (attempt in 1:5) {
      resp <- tryCatch(do.call(httr::GET, args), error = function(e) NULL)
      if (is.null(resp)) {
        if (attempt < 4) { Sys.sleep(3 * attempt); next }
        halt("Could not reach Zotero. The existing library.json is kept as it is.")
      }
      status <- httr::status_code(resp)
      hdr    <- httr::headers(resp)
      if (status %in% c(429L, 500L, 502L, 503L, 504L)) {
        wait <- suppressWarnings(as.numeric(hdr[["retry-after"]] %||% NA))
        if (is.na(wait)) wait <- 5 * attempt
        Sys.sleep(min(wait, 60))
        next
      }
      backoff <- suppressWarnings(as.numeric(hdr[["backoff"]] %||% NA))
      if (!is.na(backoff)) Sys.sleep(min(backoff, 30))
      if (status != 200L) {
        halt("Zotero answered with code ", status, " when reading the group. ",
             "The existing library.json is kept as it is.")
      }
      return(resp)
    }
    halt("Zotero is busy or not answering. The existing library.json is kept as it is.")
  }

  get_items <- function() {
    items <- list(); start <- 0
    repeat {
      resp <- zot_get(paste0("/groups/", GROUP_ID, "/items/top"),
                      query = list(format = "json", include = "data,bib,bibtex", style = STYLE,
                                   sort = "dateAdded", direction = "asc",
                                   limit = 100, start = start))
      page <- jsonlite::fromJSON(httr::content(resp, as = "text", encoding = "UTF-8"),
                                 simplifyVector = FALSE)
      items <- c(items, page)
      total <- suppressWarnings(as.integer(httr::headers(resp)[["total-results"]] %||% NA))
      start <- start + 100
      if (!length(page) || is.na(total) || start >= total) break
    }
    keep <- vapply(items, function(it) {
      !((it$data$itemType %||% "") %in% c("note", "attachment", "annotation"))
    }, logical(1))
    items <- items[keep]
    # the same work must not be read twice if the group changes while it is read
    items[!duplicated(vapply(items, function(it) it$key %||% "", ""))]
  }

  # ---- cleaning what Zotero returns ----------------------------------------

  strip_tags <- function(x) one_line(gsub("<[^>]*>", "", x %||% "", perl = TRUE))

  # Abstracts stay as published. Only two artefacts of the DOI import are
  # removed: a first line that just says "Abstract", and line breaks with
  # runs of spaces in the middle of sentences.
  clean_abstract <- function(x) {
    x <- x %||% ""
    x <- sub("^\\s*(Abstract|ABSTRACT|Summary|SUMMARY)\\s*[:.]?\\s*\\n", "", x, perl = TRUE)
    x <- sub("^\\s*(Abstract|ABSTRACT)\\s*[:.]\\s+", "", x, perl = TRUE)
    one_line(strip_tags(x))
  }

  # "&#x131;" and the like become the letters they stand for.
  decode_entities <- function(x) {
    m    <- gregexpr("&#[xX][0-9A-Fa-f]+;|&#[0-9]+;", x, perl = TRUE)
    ents <- regmatches(x, m)[[1]]
    if (!length(ents)) return(x)
    dec <- vapply(ents, function(e) {
      code <- if (grepl("^&#[xX]", e)) {
        strtoi(sub("^&#[xX]([0-9A-Fa-f]+);$", "\\1", e), 16L)
      } else {
        strtoi(sub("^&#([0-9]+);$", "\\1", e), 10L)
      }
      # the characters < > & " stay written as entities, so the text stays safe HTML
      if (is.na(code) || code < 32L || code %in% c(34L, 38L, 60L, 62L)) e else intToUtf8(code)
    }, "", USE.NAMES = FALSE)
    regmatches(x, m) <- list(dec)
    x
  }

  # The formatted reference from Zotero, as safe HTML: only italics, bold,
  # superscript and subscript survive; every other tag is removed.
  clean_citation <- function(bib) {
    x <- gsub("[\001\002]", "", bib %||% "", perl = TRUE)
    x <- sub("(?s)^.*?<div class=\"csl-entry\">", "", x, perl = TRUE)
    x <- sub("(?s)</div>\\s*</div>\\s*$", "", x, perl = TRUE)
    x <- gsub("(?i)<(/?)(i|b|sup|sub)>", "\001\\1\\2\002", x, perl = TRUE)
    x <- gsub("<[^>]*>", "", x, perl = TRUE)
    x <- gsub("<", "&lt;", x, fixed = TRUE)
    x <- gsub(">", "&gt;", x, fixed = TRUE)
    x <- gsub("\001(/?)([A-Za-z]+)\002", "<\\1\\L\\2>", x, perl = TRUE)
    one_line(decode_entities(x))
  }

  # Read one BibTeX record into its fields. Values may span several lines.
  parse_bibtex <- function(s) {
    s <- trimws(s %||% "")
    m <- regexec("^@([A-Za-z]+)\\s*\\{\\s*([^,\\s]*)\\s*,", s, perl = TRUE)
    r <- regmatches(s, m)[[1]]
    if (length(r) < 3) return(NULL)
    ch <- strsplit(substr(s, nchar(r[1]) + 1, nchar(s)), "")[[1]]
    n <- length(ch); i <- 1; fields <- list()
    is_space <- function(c) c %in% c(" ", "\t", "\n", "\r")
    repeat {
      while (i <= n && (is_space(ch[i]) || ch[i] == ",")) i <- i + 1
      if (i > n || ch[i] == "}") break
      j <- i
      while (j <= n && grepl("[A-Za-z0-9_-]", ch[j])) j <- j + 1
      if (j == i) return(NULL)
      name <- tolower(paste(ch[i:(j - 1)], collapse = ""))
      i <- j
      while (i <= n && is_space(ch[i])) i <- i + 1
      if (i > n || ch[i] != "=") return(NULL)
      i <- i + 1
      while (i <= n && is_space(ch[i])) i <- i + 1
      if (i > n) return(NULL)
      if (ch[i] == "{") {
        depth <- 0; j <- i
        repeat {
          if (j > n) return(NULL)
          if (ch[j] == "\\") { j <- j + 2; next }
          if (ch[j] == "{") depth <- depth + 1
          if (ch[j] == "}") { depth <- depth - 1; if (depth == 0) break }
          j <- j + 1
        }
        value <- paste(ch[i:j], collapse = "")
        i <- j + 1
      } else {
        j <- i
        while (j <= n && !(ch[j] %in% c(",", "\n", "}"))) j <- j + 1
        value <- trimws(paste(ch[i:(j - 1)], collapse = ""))
        i <- j
      }
      fields[[name]] <- value
    }
    list(type = tolower(r[2]), key = r[3], fields = fields)
  }

  # The BibTeX offered on the site: Zotero's own record, kept to the fields a
  # reader needs. The abstract, the Library's tags and Zotero's housekeeping
  # fields are left out; the web address is kept only when there is no DOI.
  BIBTEX_FIELDS <- c("author", "editor", "title", "booktitle", "journal", "year", "volume",
                     "number", "pages", "edition", "series", "publisher", "address",
                     "institution", "school", "type", "isbn", "issn", "doi", "url")

  clean_bibtex <- function(s) {
    p <- parse_bibtex(s)
    if (is.null(p) || !length(p$fields)) return("")
    f <- p$fields[intersect(BIBTEX_FIELDS, names(p$fields))]
    if (!is.null(f$doi)) f$url <- NULL
    if (!length(f)) return("")
    values <- vapply(f, function(v) one_line(v), "")
    paste0("@", p$type, "{", p$key, ",\n",
           paste0("  ", names(f), " = ", values, collapse = ",\n"), "\n}")
  }

  # The DOI as published (capital letters kept), without any "https://doi.org/".
  item_doi <- function(d) {
    bare <- function(x) sub("(?i)^(https?://(dx\\.)?doi\\.org/|doi:\\s*)", "", trimws(x), perl = TRUE)
    if (nzchar(d$DOI %||% "")) return(bare(d$DOI))
    extra <- d$extra %||% ""
    m <- regmatches(extra, regexpr("(?im)^\\s*DOI:\\s*\\S+", extra, perl = TRUE))
    if (length(m)) return(bare(m))
    ""
  }

  person <- function(cr) {
    if (nzchar(cr$name %||% "")) return(list(family = one_line(cr$name), given = ""))
    list(family = one_line(cr$lastName), given = one_line(cr$firstName))
  }

  # ---- one work: its record, or the reasons why it is held back -------------

  build <- function(it, tax) {
    d    <- it$data
    tags <- it$data$tags %||% list()
    # tags added automatically by an import are not the Library's tags: ignored
    manual <- vapply(tags, function(t) !isTRUE(suppressWarnings(as.integer(t$type %||% 0)) == 1L), logical(1))
    mine   <- unique(trimws(vapply(tags[manual], function(t) t$tag %||% "", "")))
    mine   <- mine[nzchar(mine)]
    lib     <- tax$tags[tax$tags %in% mine]        # in the order of taxonomy.yml
    unknown <- setdiff(mine, tax$tags)

    title  <- strip_tags(d$title)
    parsed <- it$meta$parsedDate %||% ""
    year   <- suppressWarnings(as.integer(substr(parsed, 1, 4)))
    if (is.na(year)) {
      m <- regmatches(d$date %||% "", regexpr("(1[5-9]|20)[0-9]{2}", d$date %||% ""))
      year <- if (length(m)) as.integer(m) else NA_integer_
    }
    byline <- one_line(it$meta$creatorSummary %||% "")
    label  <- one_line(paste(if (nzchar(byline)) byline else short(title, 40), if (is.na(year)) "" else year))
    base   <- list(key = it$key, label = label, title = title)

    if (!length(lib) && !length(unknown)) return(c(base, list(status = "waiting")))

    problems <- character(); notes <- character()
    if (length(unknown)) {
      problems <- c(problems, paste0("tags that are not in taxonomy.yml: ", paste(unknown, collapse = ", ")))
    }
    prefix <- sub(":.*$", "", lib)
    of <- function(p) lib[prefix == p]
    approach <- of("approach"); topic <- of("topic"); region <- of("region")
    country  <- of("country");  method <- of("method"); type <- of("type")

    # (rules of 2026-10-01: a work may stay untagged on any axis; only its type is required)

    if (length(country) > 5) problems <- c(problems, "has more than five country tags (use the region only)")
    if ("region:global" %in% region) {
      if (length(region) > 1) problems <- c(problems, "region:global cannot be combined with another region")
    } else {
      from_countries <- unique(unname(tax$country_region[country]))
      add <- setdiff(from_countries, region)
      if (length(add)) {
        region <- tax$tags[tax$tags %in% c(region, add)]
        notes  <- c(notes, paste0("region filled in from the country tags: ", paste(add, collapse = ", ")))
      }
      if (length(region) > 2) problems <- c(problems, "has more than two regions (use region:global instead)")
    }

    item_type <- d$itemType %||% ""
    if (!length(type)) {
      guess <- tax$type_from_zotero[[item_type]]
      if (!is.null(guess)) {
        type  <- guess
        notes <- c(notes, paste0("type filled in from the kind of record in Zotero: ", guess))
      } else {
        problems <- c(problems, "needs a type tag")
      }
    } else if (length(type) > 1) {
      problems <- c(problems, paste0("has more than one type tag: ", paste(type, collapse = ", ")))
    } else {
      expected <- tax$type_zotero[[type]]
      if (length(expected) && !(item_type %in% expected)) {
        problems <- c(problems, paste0("is tagged ", type, " but Zotero has it as \"", item_type, "\""))
      }
    }

    if (!nzchar(title)) problems <- c(problems, "has no title")
    if (is.na(year))    problems <- c(problems, "has no publication year")

    creators <- d$creators %||% list()
    authors  <- lapply(Filter(function(cr) identical(cr$creatorType, "author"), creators), person)
    editors  <- lapply(Filter(function(cr) identical(cr$creatorType, "editor"), creators), person)
    if (!length(authors) && !length(editors)) notes <- c(notes, "has no author and no editor")

    container <- one_line(d$publicationTitle %||% d$bookTitle %||% "")
    publisher <- one_line(d$publisher %||% d$institution %||% d$repository %||% "")
    pages     <- one_line(d$pages %||% "")
    if (item_type == "journalArticle" && nzchar(pages) && !grepl("[-\u2013]", pages)) {
      notes <- c(notes, paste0("the pages field holds one page only: \"", pages, "\""))
    }
    if (grepl("[a-z]{3,}[A-Z][a-z]{2,}", publisher)) {
      notes <- c(notes, paste0("the publisher looks glued together: \"", publisher, "\""))
    }
    letters_only <- gsub("[^A-Za-z]", "", title)
    if (nchar(letters_only) >= 12 && identical(letters_only, toupper(letters_only))) {
      notes <- c(notes, "the title is written in capitals")
    }

    doi      <- item_doi(d)
    abstract <- clean_abstract(d$abstractNote)
    bibtex   <- clean_bibtex(it$bibtex)
    if (!nzchar(bibtex)) notes <- c(notes, "no BibTeX could be prepared for this work")
    sort_key <- tolower(paste(
      if (length(authors)) authors[[1]]$family else if (length(editors)) editors[[1]]$family else title,
      if (is.na(year)) "" else year, title, it$key))

    entry <- list(
      id        = it$key,
      type      = if (length(type) == 1) type else "",
      title     = title,
      authors   = authors,
      editors   = editors,
      byline    = byline,
      year      = if (is.na(year)) NULL else year,
      date      = parsed,
      container = container,
      publisher = publisher,
      volume    = one_line(d$volume %||% ""),
      issue     = one_line(d$issue %||% ""),
      pages     = pages,
      doi       = doi,
      url       = if (nzchar(doi)) paste0("https://doi.org/", doi) else one_line(d$url %||% ""),
      zotero    = it$links$alternate$href %||% "",
      abstract  = abstract,
      citation  = clean_citation(it$bib),
      bibtex    = bibtex,
      approach  = as.list(approach),
      topic     = as.list(topic),
      region    = as.list(region),
      country   = as.list(country),
      method    = as.list(method),
      oa        = "oa:yes" %in% lib,
      added     = d$dateAdded %||% ""
    )
    c(base, list(status = if (length(problems)) "held" else "ok",
                 problems = problems, notes = notes, entry = entry,
                 sort_key = sort_key, doi = tolower(doi),
                 same = paste(norm_title(title), if (is.na(year)) "" else year),
                 added = d$dateAdded %||% "", modified = d$dateModified %||% ""))
  }

  # One entry per work: of two records for the same work, the one added first
  # stays and the other is held back.
  hold_duplicates <- function(res) {
    ok <- which(vapply(res, function(r) r$status == "ok", logical(1)))
    ok <- ok[order(vapply(res[ok], function(r) r$added, ""), vapply(res[ok], function(r) r$key, ""))]
    seen_doi <- list(); seen_same <- list()
    for (i in ok) {
      r <- res[[i]]
      first <- NULL; why <- ""
      if (nzchar(r$doi) && !is.null(seen_doi[[r$doi]])) {
        first <- seen_doi[[r$doi]]; why <- "has the same DOI as "
      } else if (!nzchar(r$doi) && !is.null(seen_same[[r$same]])) {
        first <- seen_same[[r$same]]; why <- "has the same title and year as "
      }
      if (!is.null(first)) {
        res[[i]]$status   <- "held"
        res[[i]]$problems <- c(r$problems, paste0(why, res[[first]]$label, " (", res[[first]]$key,
                                                  "), which is already in the Library"))
        next
      }
      if (nzchar(r$doi)) seen_doi[[r$doi]] <- i
      seen_same[[r$same]] <- i
    }
    res
  }

  # ---- the run -------------------------------------------------------------

  main <- function() {
    use_utf8()
    say("")
    say("PopuliVerse Library: sync (version ", SCRIPT_VERSION, ")")
    say("")
    if (!file.exists("_quarto.yml") || !file.exists("library/taxonomy.yml")) {
      halt("This is not the site folder. Open the project first (double-click populiverse.Rproj, ",
           "or in RStudio: File > Open Project), then run the line again.")
    }
    ensure_packages()
    tax <- load_taxonomy()
    say("  [ok] ", length(tax$tags), " tags allowed by taxonomy.yml (version ", tax$version, ")")

    items <- get_items()
    say("  [ok] ", length(items), " works read from the Zotero group")

    res <- hold_duplicates(lapply(items, build, tax = tax))
    status  <- vapply(res, function(r) r$status, "")
    ok      <- res[status == "ok"]
    held    <- res[status == "held"]
    waiting <- res[status == "waiting"]
    ok      <- ok[order(vapply(ok, function(r) r$sort_key, ""))]
    noted   <- Filter(function(r) length(r$notes) > 0, ok)

    # never replace a filled file by an empty or half-empty one because of a hiccup
    old_n <- 0L; old_text <- ""
    if (file.exists(OUT)) {
      old_text <- sub("\\s+$", "", paste(readLines(OUT, encoding = "UTF-8", warn = FALSE), collapse = "\n"), perl = TRUE)
      old <- tryCatch(jsonlite::fromJSON(old_text, simplifyVector = FALSE), error = function(e) NULL)
      old_n <- length(old$entries)
    }
    allow_shrink <- identical(Sys.getenv("SYNC_ALLOW_SHRINK"), "1")
    if (!allow_shrink && old_n > 0 && length(items) == 0) {
      halt("Zotero returned no works at all, but library.json holds ", old_n,
           ". The existing file is kept as it is.")
    }
    if (!allow_shrink && old_n >= 10 && length(ok) < old_n / 2) {
      halt("Only ", length(ok), " works would be published, against ", old_n, " in the existing ",
           "library.json. That looks like a mistake, so the existing file is kept as it is. ",
           "(If it is intended, tell Claude.)")
    }

    entries  <- lapply(ok, function(r) r$entry)
    modified <- vapply(ok, function(r) r$modified, "")
    with_abs <- sum(vapply(entries, function(e) nzchar(e$abstract), logical(1)))
    out <- list(
      meta = list(
        title            = "PopuliVerse Library",
        source           = GROUP_URL,
        group            = as.integer(GROUP_ID),
        citation_style   = STYLE,
        taxonomy_version = tax$version,
        count            = length(entries),
        updated          = if (length(modified)) max(modified) else ""
      ),
      taxonomy = tax$copy,
      entries  = entries
    )
    json <- enc2utf8(as.character(jsonlite::toJSON(out, auto_unbox = TRUE, pretty = 2,
                                                   null = "null", na = "null", digits = NA)))
    json <- sub("\\s+$", "", json, perl = TRUE)
    changed <- !identical(json, old_text)
    if (changed) {
      con <- file(OUT, open = "wb")
      writeLines(json, con, useBytes = TRUE)
      close(con)
    }

    say("  [ok] ", length(entries), " published in ", OUT, " (", with_abs, " with an abstract)",
        if (changed) "" else " - no change since the last run")
    say("")
    say("  held back: ", length(held), " | waiting for tags: ", length(waiting),
        " | notes: ", length(noted))

    md <- c("### PopuliVerse Library sync", "",
            paste0("Read from Zotero: **", length(items), "**. Published: **", length(entries),
                   "**. Held back: **", length(held), "**. Waiting for tags: **", length(waiting), "**."), "")
    if (length(held)) {
      say(""); say("HELD BACK (not on the site until corrected in Zotero)")
      md <- c(md, "**Held back (not on the site until corrected in Zotero)**", "")
      for (r in held) {
        line <- paste0(r$key, " ", r$label, " (", short(r$title, 50), "): ", paste(r$problems, collapse = "; "))
        say("  - ", line); md <- c(md, paste0("- ", line))
      }
      md <- c(md, "")
    }
    if (length(waiting)) {
      say(""); say("WAITING (no Library tag yet; not an error)")
      md <- c(md, "**Waiting (no Library tag yet; not an error)**", "")
      for (r in waiting) {
        line <- paste0(r$key, " ", r$label, " - ", short(r$title, 70))
        say("  - ", line); md <- c(md, paste0("- ", line))
      }
      md <- c(md, "")
    }
    if (length(noted)) {
      say(""); say("NOTES (published; worth a look in Zotero when you have a moment)")
      md <- c(md, "**Notes (published; worth a look in Zotero)**", "")
      for (r in noted) {
        line <- paste0(r$key, " ", r$label, ": ", paste(r$notes, collapse = "; "))
        say("  - ", line); md <- c(md, paste0("- ", line))
      }
      md <- c(md, "")
    }
    say("")
    if (interactive() && changed) {
      say("library.json has changed. To publish it now, commit and push in GitHub Desktop;")
      say("otherwise the nightly job on GitHub will do the same on its own.")
      say("")
    }

    # for the job on GitHub: numbers for the next steps, and a readable summary
    gh_out <- Sys.getenv("GITHUB_OUTPUT")
    if (nzchar(gh_out)) {
      cat(paste0("published=", length(entries), "\n", "held=", length(held), "\n",
                 "waiting=", length(waiting), "\n", "changed=", tolower(as.character(changed)), "\n"),
          file = gh_out, append = TRUE)
    }
    gh_sum <- Sys.getenv("GITHUB_STEP_SUMMARY")
    if (nzchar(gh_sum)) cat(paste(md, collapse = "\n"), "\n", file = gh_sum, append = TRUE)
    invisible(TRUE)
  }

  finished <- tryCatch(
    main(),
    pv_stop = function(e) { say(""); say("STOPPED: ", conditionMessage(e)); FALSE },
    error   = function(e) {
      say(""); say("STOPPED by an unexpected error: ", conditionMessage(e))
      say("Paste this message to Claude.")
      FALSE
    }
  )
  # On GitHub a stop must be visible as a failed run; in RStudio nothing is closed.
  if (!interactive() && !isTRUE(finished)) quit(save = "no", status = 2)
  invisible(NULL)
})
