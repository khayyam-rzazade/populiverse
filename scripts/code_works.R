# ---------------------------------------------------------------------------
# PopuliVerse Library: decide which looked-up works enter, and tag them from
# the words of their own title and abstract.
#
# HOW TO RUN IT (in RStudio, with the populiverse project open):
#
#     source("scripts/code_works.R")
#
# WHAT IT DOES, IN ORDER
#   1. Reads the newest result of the lookup or of the search (drafts/batch-NN-found.csv).
#      A batch can come from a list of references (scripts/find_works.R) or from the
#      search of OpenAlex (scripts/search_works.R); the file says which.
#   2. Scope: keeps a work only if "populis..." is in its title, or in its
#      abstract when there is one, and only journal articles and books.
#   3. Tags: gives a tag only when a phrase listed in library/phrases.yml or a
#      name listed in library/actors.yml is found in the title or the abstract.
#      The type comes from the catalogue record; "open access" from OpenAlex.
#   4. Writes library/batches/batch-NN.yml (the works and their tags) and
#      library/batches/batch-NN-evidence.csv (for every tag: the phrase found
#      and whether it was in the title or the abstract).
#
# Nothing is guessed: a work whose text names no approach, method or place
# gets no tag for it. The script changes nothing in Zotero and nothing on the site.
# ---------------------------------------------------------------------------

local({

  SCRIPT_VERSION <- "2026-10-02.3"
  `%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a
  say <- function(...) cat(..., "\n", sep = "")
  halt <- function(...) stop(structure(class = c("pv_stop", "error", "condition"),
                                       list(message = paste0(...), call = NULL)))
  read_yaml_utf8 <- function(path) yaml::yaml.load(paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n"))

  # ---- text preparation -----------------------------------------------------

  FROM <- "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u0101\u0103\u0105\u00e7\u0107\u010d\u010f\u0111\u00e8\u00e9\u00ea\u00eb\u0113\u0117\u0119\u011b\u011f\u00ec\u00ed\u00ee\u00ef\u012b\u0131\u0142\u00f1\u0144\u0148\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u0151\u0159\u015b\u015f\u0161\u0219\u0165\u021b\u00f9\u00fa\u00fb\u00fc\u016b\u016f\u0171\u00fd\u00ff\u017a\u017c\u017e\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c7\u0106\u010c\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u0130\u0141\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d8\u0158\u015a\u015e\u0160\u00d9\u00da\u00db\u00dc\u00dd\u017d"
  TO   <- "aaaaaaaaacccddeeeeeeeegiiiiiilnnnoooooooorsssstttuuuuuuuyyzzzAAAAAACCCEEEEIIIIILNOOOOOORSSSUUUUYZ"

  # Accents removed, every sign that is not a letter or a digit turned into a
  # space. Capital letters are kept; lower() is applied where case must not matter.
  plain <- function(x) {
    x <- gsub("<[^>]+>", " ", x %||% "")
    x <- chartr(FROM, TO, x)
    x <- gsub("\u00df", "ss", x, fixed = TRUE)
    x <- gsub("[^A-Za-z0-9]+", " ", x)
    paste0(" ", trimws(gsub("\\s+", " ", x)), " ")
  }

  # "thin cent*" -> the phrase as a pattern; a list of phrases -> one pattern
  # that finds any of them as whole words (longer phrases first).
  one_pattern <- function(phrase, keep_case = FALSE) {
    p <- trimws(gsub("\\s+", " ", gsub("[^A-Za-z0-9* ]+", " ", chartr(FROM, TO, phrase))))
    if (!keep_case) p <- tolower(p)
    gsub(" ", " +", gsub("*", "[A-Za-z0-9]*", p, fixed = TRUE))
  }
  compile <- function(phrases, keep_case = FALSE) {
    if (!length(phrases)) return(NULL)
    alt <- vapply(phrases, one_pattern, "", keep_case = keep_case)
    alt <- alt[order(-nchar(alt))]
    paste0("(?<![A-Za-z0-9])(?:", paste(alt, collapse = "|"), ")(?![A-Za-z0-9])")
  }
  # The wordings found in a text (as written there), for one compiled pattern.
  hits <- function(text, rx) {
    if (is.null(rx) || !nzchar(text)) return(character())
    m <- gregexpr(rx, text, perl = TRUE)[[1]]
    if (m[1] < 0) character() else trimws(regmatches(text, list(m))[[1]])
  }
  blank <- function(text, rx) if (is.null(rx)) text else gsub(rx, " ", text, perl = TRUE)

  sentences <- function(x) {
    s <- unlist(strsplit(x %||% "", "(?<=[.!?])\\s+", perl = TRUE))
    s[nzchar(trimws(s))]
  }

  # Everything that can be prepared once, before the works are read.
  prepare <- function(ph, ac, tax) {
    tagset <- function(group) lapply(group, function(def) list(rx = compile(def$phrases), not = compile(def$not)))
    countries <- lapply(names(tax$country_label), function(tag) {
      extra <- ac$countries[[tag]] %||% list()
      adj <- NULL
      if (length(extra$adjectives)) {
        adj <- paste0("(?<![A-Za-z0-9])(?:", paste(vapply(extra$adjectives, one_pattern, ""), collapse = "|"), ") +(?:",
                      paste(vapply(ac$after_adjective, one_pattern, ""), collapse = "|"), ")(?![A-Za-z0-9])")
      }
      list(tag = tag, names = compile(c(tax$country_label[[tag]], extra$names)),
           exact = compile(c(extra$exact, extra$actors), TRUE), adj = adj, needs = compile(extra$needs))
    })
    list(approach = tagset(ph$approach), topic = tagset(ph$topic), method = tagset(ph$method),
         study = compile(ph$study_words), review = compile(ph$review_titles), ignore = compile(ac$ignore),
         regions = lapply(ac$regions, compile), regions_exact = lapply(ac$regions_exact %||% list(), compile, keep_case = TRUE),
         countries = countries,
         any_place = compile(unlist(c(tax$country_label, lapply(ac$countries, function(x) c(x$names, x$adjectives))))),
         any_exact = compile(unlist(lapply(ac$countries, function(x) c(x$exact, x$actors))), TRUE))
  }

  # ---- one work ---------------------------------------------------------------

  code_one <- function(title, abstract, k, tax) {
    ev <- list()                                   # evidence: tag, where found, wording found
    add <- function(tag, where, found) for (f in unique(tolower(found))) ev[[length(ev) + 1]] <<- c(tag, where, f)
    t_case <- plain(title); a_case <- plain(abstract)
    t_low <- tolower(t_case); a_low <- tolower(a_case)
    tags <- character()

    # approach: one phrase, in the title or the abstract
    found <- list()
    for (tag in names(k$approach)) {
      def <- k$approach[[tag]]
      ft <- hits(blank(t_low, def$not), def$rx); fa <- hits(blank(a_low, def$not), def$rx)
      if (length(ft) + length(fa) > 0) found[[tag]] <- list(t = ft, a = fa)
    }
    specific <- setdiff(names(found), "approach:other")
    keep <- if (length(specific) >= 3) "approach:other" else if (length(specific)) specific else names(found)
    for (tag in keep) {
      src <- if (identical(tag, "approach:other") && length(specific) >= 3) specific else tag
      for (s in src) { add(tag, "title", found[[s]]$t); add(tag, "abstract", found[[s]]$a) }
    }
    tags <- c(tags, keep)

    # topic: one phrase in the title, or two in the abstract
    for (tag in names(k$topic)) {
      def <- k$topic[[tag]]
      ft <- hits(blank(t_low, def$not), def$rx); fa <- hits(blank(a_low, def$not), def$rx)
      if (length(ft) >= 1 || length(fa) >= 2) {
        tags <- c(tags, tag)
        if (length(ft) >= 1) add(tag, "title", ft)
        if (length(fa) >= 2) add(tag, "abstract", fa)
      }
    }

    # method: in the title, or in a sentence of the abstract that speaks about the study itself
    sent <- tolower(vapply(sentences(abstract), plain, "", USE.NAMES = FALSE))
    about <- if (length(sent)) sent[vapply(sent, function(s) length(hits(s, k$study)) > 0, logical(1))] else character()
    study_text <- paste(about, collapse = " ")
    if (length(hits(t_low, k$review))) study_text <- ""        # a review's abstract speaks of other studies' methods
    for (tag in names(k$method)) {
      def <- k$method[[tag]]
      ft <- hits(blank(t_low, def$not), def$rx); fa <- hits(blank(study_text, def$not), def$rx)
      if (length(ft) + length(fa) >= 1) { tags <- c(tags, tag); add(tag, "title", ft); add(tag, "abstract", fa) }
    }

    if ("method:mixed" %in% tags) {                 # mixed methods stands alone
      drop <- c("method:qualitative", "method:quantitative")
      tags <- setdiff(tags, drop); ev <- Filter(function(e) !(e[1] %in% drop), ev)
    }

    # place: regions and countries named in the text
    t_c <- blank(t_case, k$ignore); a_c <- blank(a_case, k$ignore)       # "ignore" phrases are lower case:
    t_l <- blank(t_low, k$ignore);  a_l <- blank(a_low, k$ignore)        # removed from the lower-case text,
    cut <- "(?i)(?<![a-z])(?:latin|north|south|central) american(?![a-z])"
    t_c <- gsub(cut, " ", t_c, perl = TRUE); a_c <- gsub(cut, " ", a_c, perl = TRUE)
    regions <- character(); global_words <- FALSE
    for (tag in names(k$regions)) {
      tl <- t_l; al <- a_l
      if (tag == "region:sub-saharan-africa") { rx <- "(?:north|south) africa[a-z]*"; tl <- gsub(rx, " ", tl, perl = TRUE); al <- gsub(rx, " ", al, perl = TRUE) }
      ft <- c(hits(tl, k$regions[[tag]]), hits(t_c, k$regions_exact[[tag]]))
      fa <- c(hits(al, k$regions[[tag]]), hits(a_c, k$regions_exact[[tag]]))
      if (length(ft) >= 1 || length(fa) >= 2) {
        if (tag == "region:global") global_words <- TRUE else regions <- c(regions, tag)
        if (length(ft) >= 1) add(tag, "title", ft)
        if (length(fa) >= 2) add(tag, "abstract", fa)
      }
    }
    countries <- character(); c_ev <- list()
    if (length(hits(paste(t_l, a_l), k$any_place)) || length(hits(paste(t_c, a_c), k$any_exact))) {
      for (cn in k$countries) {
        # a country whose name has another meaning: the name counts only next to one of its "needs" words
        name_counts <- is.null(cn$needs) || length(hits(paste(t_l, a_l), cn$needs)) > 0
        one <- function(low, case) {
          f4 <- hits(low, cn$adj)
          c(if (name_counts) hits(low, cn$names), hits(case, cn$exact), if (length(f4)) paste0(sub(" .*$", "", f4), " (+ political word)"))
        }
        ft <- one(t_l, t_c); fa <- one(a_l, a_c)
        if (length(ft) >= 1 || length(fa) >= 2) {
          countries <- c(countries, cn$tag)
          c_ev[[cn$tag]] <- list(t = if (length(ft) >= 1) ft else character(), a = if (length(fa) >= 2) fa else character())
        }
      }
    }
    from_countries <- unique(unname(tax$country_region[countries]))
    all_regions <- unique(c(regions, from_countries))
    if (length(countries) > 5) countries <- character()
    for (tag in countries) { add(tag, "title", c_ev[[tag]]$t); add(tag, "abstract", c_ev[[tag]]$a) }
    if (length(all_regions) >= 3 || (global_words && length(all_regions) == 0)) {
      ev <- Filter(function(e) !(startsWith(e[1], "region:") && e[1] != "region:global"), ev)
      if (length(all_regions) >= 3) ev[[length(ev) + 1]] <- c("region:global", "rule", paste0("three or more regions named: ", paste(sub("region:", "", all_regions), collapse = ", ")))
      region_tags <- "region:global"
    } else {
      ev <- Filter(function(e) e[1] != "region:global", ev)
      region_tags <- all_regions
      for (r in setdiff(from_countries, regions)) ev[[length(ev) + 1]] <- c(r, "rule", "from the country named")
    }
    tags <- c(tags, region_tags, countries)
    list(tags = tax$tags[tax$tags %in% tags], evidence = ev)
  }

  # ---- the run ----------------------------------------------------------------

  main <- function() {
    say(""); say("PopuliVerse Library: scope and tags from the text (version ", SCRIPT_VERSION, ")"); say("")
    if (!file.exists("_quarto.yml") || !file.exists("library/taxonomy.yml")) {
      halt("This is not the site folder. Open the project first, then run the line again.")
    }
    for (p in c("yaml")) if (!requireNamespace(p, quietly = TRUE)) halt("The R package ", p, " is missing.")
    files <- sort(list.files("drafts", pattern = "^batch-[0-9]+-found\\.csv$", full.names = TRUE))
    if (!length(files)) halt("No lookup result found (drafts/batch-NN-found.csv). Run scripts/find_works.R first.")
    input <- files[length(files)]
    nn <- sub("^batch-([0-9]+)-found\\.csv$", "\\1", basename(input))
    d <- utils::read.csv(input, stringsAsFactors = FALSE, encoding = "UTF-8", colClasses = "character", na.strings = character())
    # a batch that comes from the search of OpenAlex carries the result of the registry check
    from_search <- "check" %in% names(d)
    # an abstract counts only when it is whole (the search says so for each work)
    if ("abstract_whole" %in% names(d)) d$abstract[d$abstract_whole != "TRUE"] <- ""
    y <- read_yaml_utf8("library/taxonomy.yml")
    ph <- read_yaml_utf8("library/phrases.yml"); ac <- read_yaml_utf8("library/actors.yml")
    all_tags <- unlist(lapply(y$facets, function(f) vapply(f$tags, function(t) t$tag, "")), use.names = FALSE)
    ct <- y$facets$country$tags
    tax <- list(tags = all_tags,
                country_label = stats::setNames(lapply(ct, function(t) t$label), vapply(ct, function(t) t$tag, "")),
                country_region = stats::setNames(vapply(ct, function(t) t$region, ""), vapply(ct, function(t) t$tag, "")))
    listed <- c(names(ph$approach), names(ph$topic), names(ph$method), names(ac$regions), names(ac$countries))
    if (length(setdiff(listed, all_tags))) halt("These tags of the phrase lists are not in taxonomy.yml: ", paste(setdiff(listed, all_tags), collapse = ", "))
    say("  [ok] ", basename(input), ": ", nrow(d), " references")

    # what was decided by reading (optional file next to the batch): DOIs accepted by hand,
    # records for works without a DOI, and earlier records to remove
    rec_file <- paste0("library/batches/batch-", nn, "-records.yml")
    rec <- if (file.exists(rec_file)) read_yaml_utf8(rec_file) else list()
    # a work that a rule had set aside and that was let in by reading needs its reason in that file
    if (from_search && "let_in" %in% names(d)) {
      no_reason <- setdiff(d$ref_id[d$let_in == "read"], names(rec$read))
      if (length(no_reason)) halt("These works were let in by reading, but ", basename(rec_file), " gives no reason for them: ",
                                  paste(no_reason, collapse = ", "))
    }
    # a reference that is a book is never matched to a journal article (a review of the
    # book carries the same title), and the other way round
    wrong_kind <- d$status == "found" &
      ((d$kind_guess == "book" & d$type %in% c("journal-article", "article", "book-review", "reference-entry")) |
       (d$kind_guess == "article" & !(d$type %in% c("journal-article", "article"))))
    d$doi[wrong_kind] <- ""; d$status[wrong_kind] <- "not found"; d$type[wrong_kind] <- ""
    d$abstract[wrong_kind] <- ""; d$open_access[wrong_kind] <- ""; d$title_found[wrong_kind] <- ""
    d$journal_or_publisher[wrong_kind] <- ""
    # titles as printed in the source, where the reading of the list had cut them short,
    # and the titles of the records: both must be in place before the scope rule looks at them
    for (ref in names(rec$titles)) d$title[d$ref_id == ref] <- rec$titles[[ref]]
    for (ref in names(rec$records)) if (!is.null(rec$records[[ref]]$title)) d$title[d$ref_id == ref] <- rec$records[[ref]]$title
    # references left out by reading (a work cited twice under two titles, a chapter printed like an article)
    dropped <- d$ref_id %in% names(rec$drop)
    d <- d[!dropped, ]
    for (ref in names(rec$accepted)) {
      i <- which(d$ref_id == ref)
      if (length(i) == 1) { d$doi[i] <- rec$accepted[[ref]]$doi; d$status[i] <- "found"
                            d$type[i] <- if (d$kind_guess[i] == "book") "book" else "journal-article" }
    }

    # scope
    has <- function(x) grepl("populis", x, ignore.case = TRUE)
    in_title <- has(d$title) | has(d$title_found); in_abs <- has(d$abstract)
    article <- d$type %in% c("journal-article", "article")
    book <- d$type %in% c("book", "monograph", "edited-book") |
      (d$type == "book-chapter" & d$kind_guess == "book") | (d$status != "found" & d$kind_guess == "book")
    article <- article | (d$status != "found" & d$kind_guess == "article")
    doi_ok <- d$status == "found" & nzchar(d$doi) & d$type %in% c("journal-article", "article", "book", "monograph", "edited-book")
    d$doi[!doi_ok] <- ""
    # the Library is English only: a work whose catalogue record names another language stays out
    other_language <- if ("language" %in% names(d)) nzchar(d$language) & d$language != "en" else rep(FALSE, nrow(d))
    keep <- (in_title | in_abs) & (article | book) & !other_language
    s <- d[keep, ]
    s$kind <- ifelse(s$type %in% c("journal-article", "article") | (s$status != "found" & s$kind_guess == "article"), "article", "book")
    # (in a list of references the same work can be cited twice under one title; the search has
    # sorted out repeats itself, and two different works may carry one title, so only the DOI counts there)
    dup <- (nzchar(s$doi) & duplicated(tolower(s$doi))) |
      (!from_search & duplicated(paste(tolower(gsub("[^A-Za-z0-9]+", " ", s$title)), s$year)))
    s <- s[!dup, ]
    say("  [ok] in scope: ", nrow(s), " works (", sum(s$kind == "article"), " articles, ", sum(s$kind == "book"), " books); ",
        sum(nzchar(s$doi)), " with a DOI, ", sum(nzchar(s$abstract)), " with an abstract")
    say("       left out: ", sum(!(in_title | in_abs)), " do not name populism; ",
        sum((in_title | in_abs) & !(article | book)), " are neither journal article nor book; ",
        sum((in_title | in_abs) & (article | book) & other_language), " are not in English; ", sum(dup), " repeats")
    # works that an earlier batch already brought into the Library keep their tags
    earlier <- setdiff(list.files("library/batches", pattern = "^batch-[0-9]+\\.yml$", full.names = TRUE),
                       paste0("library/batches/batch-", nn, ".yml"))
    old_dois <- tolower(unlist(lapply(earlier, function(f) vapply(read_yaml_utf8(f)$works, function(w) w$doi %||% "", ""))))
    already <- nzchar(s$doi) & tolower(s$doi) %in% old_dois
    s <- s[!already, ]
    # works without a confirmed DOI: those with a record read from the source enter; the others wait
    has_record <- s$ref_id %in% names(rec$records)
    for (i in which(has_record)) {
      r1 <- rec$records[[s$ref_id[i]]]
      s$title[i] <- r1$title; s$title_found[i] <- ""
      s$kind[i] <- if (identical(r1$itemType, "book")) "book" else "article"
      s$journal_or_publisher[i] <- r1$publicationTitle %||% r1$publisher %||% ""
    }
    waiting <- s[!nzchar(s$doi) & !has_record, ]
    if (length(rec$drop)) say("       left out by reading: ", length(rec$drop), " (", paste(names(rec$drop), collapse = ", "), ")")
    utils::write.csv(waiting[, c("ref_id", "first_author", "year", "title", "container", "kind", "reference")],
                     paste0("drafts/batch-", nn, "-without-doi.csv"), row.names = FALSE, fileEncoding = "UTF-8")
    s <- s[nzchar(s$doi) | (s$ref_id %in% names(rec$records)), ]
    say("       already in the Library from an earlier batch: ", sum(already),
        "; without a DOI and without a record, left out: ", nrow(waiting))
    say("       with a DOI: ", sum(nzchar(s$doi)), "; without a DOI, entered from the source's own reference: ", sum(!nzchar(s$doi)),
        "; with a record kept ready in case Zotero cannot fetch the DOI: ", sum(nzchar(s$doi) & s$ref_id %in% names(rec$records)))
    say("  [ok] in this batch: ", nrow(s), " works")

    # tags
    k <- prepare(ph, ac, tax)
    works <- vector("list", nrow(s)); evidence <- list()
    for (i in seq_len(nrow(s))) {
      r <- s[i, ]
      # a registry title with broken characters (a slip of encoding in the record) is not used
      broken <- grepl("[\u0080-\u009f]|\u00e2\u20ac|\u00c3[\u00a0-\u00bf]", r$title_found, perl = TRUE)
      title <- if (nzchar(r$title_found) && !broken && nchar(r$title_found) >= nchar(r$title)) r$title_found else r$title
      # every kind of space becomes one plain space, whatever the computer's language settings are
      title <- trimws(gsub("[\\s\u00a0\u2000-\u200b\u202f\u3000]+", " ", gsub("<[^>]+>", "", title), perl = TRUE))
      title <- gsub("[\u0080-\u009f]", "", gsub("[[:cntrl:]]", "", title), perl = TRUE)
      # a review of a book (the search says so): the tags come from its title alone, because a text
      # that stands as its abstract is often the publisher's words about the book; and it has no method
      is_review <- from_search && "piece" %in% names(r) && identical(r$piece, "book review")
      res <- code_one(title, if (is_review) "" else r$abstract, k, tax)
      if (is_review) {
        res$evidence <- Filter(function(e) !startsWith(e[1], "method:"), res$evidence)
        res$tags <- res$tags[!startsWith(res$tags, "method:")]
      }
      # open access is taken from the catalogue only for a work with a DOI: without one the record cannot be checked twice
      tags <- c(res$tags, if (is_review) "type:book-review" else if (r$kind == "article") "type:article" else "type:book",
                if (identical(r$open_access, "TRUE") && nzchar(r$doi)) "oa:yes")
      if (!nzchar(r$doi) || r$ref_id %in% names(rec$accepted)) {
        tags <- c(tags, "todo:check-record")
        evidence[[length(evidence) + 1]] <- c(r$ref_id, "todo:check-record", "rule",
                                              if (nzchar(r$doi)) "DOI accepted by reading, not by the automatic rule" else "no DOI: record made from the source's reference")
      }
      if ("check_record" %in% names(r) && nzchar(r$check_record)) {
        tags <- c(tags, "todo:check-record")
        evidence[[length(evidence) + 1]] <- c(r$ref_id, "todo:check-record", "rule", r$check_record)
      }
      if (broken) {
        tags <- c(tags, "todo:check-record")
        evidence[[length(evidence) + 1]] <- c(r$ref_id, "todo:check-record", "rule",
                                              "the registry's title has broken characters: the title in Zotero is to be corrected by hand")
      }
      if (r$kind == "article" && tolower(trimws(r$journal_or_publisher)) %in% tolower(unlist(ph$outlets_to_check))) {
        tags <- c(tags, "todo:check-outlet")
        evidence[[length(evidence) + 1]] <- c(r$ref_id, "todo:check-outlet", "journal", r$journal_or_publisher)
      }
      # a journal on none of the journal lists that OpenAlex records: a note for the editor (search batches)
      # (not asked when the journal was checked against the Scopus list)
      if (from_search && r$kind == "article" && !nzchar(r$listed_in) && !("scopus_title" %in% names(r)) && !("todo:check-outlet" %in% tags)) {
        tags <- c(tags, "todo:check-outlet")
        evidence[[length(evidence) + 1]] <- c(r$ref_id, "todo:check-outlet", "journal",
                                              paste0(r$journal_or_publisher, " (on none of the journal lists that OpenAlex records)"))
      }
      cite <- paste0(r$first_author, if (grepl(" and ", r$authors) && !grepl(",.*,.*,", r$authors)) "" else "",
                     if (grepl(",.*, and |et al", r$authors)) " et al." else if (grepl(" and ", r$authors)) paste0(" and ", sub("^.* and (?:[A-Z][^ ]* )*", "", r$authors, perl = TRUE)) else "",
                     " ", r$year)
      # the search gives the short reference and the registry's year itself
      if (from_search && nzchar(r$cite)) cite <- r$cite
      works[[i]] <- list(cite = cite, doi = r$doi, title = title,
                         year = as.integer(if (from_search && nzchar(r$year_found)) r$year_found else r$year), kind = r$kind,
                         ref_id = r$ref_id, tags = all_tags[all_tags %in% tags],
                         doi_also = if ("doi_also" %in% names(r) && nzchar(r$doi_also)) r$doi_also else NULL,
                         published = if ("publication_date" %in% names(r) && nzchar(r$publication_date)) r$publication_date else NULL,
                         create = rec$records[[r$ref_id]])
      for (e in res$evidence) evidence[[length(evidence) + 1]] <- c(r$ref_id, e)
    }

    # works of an earlier batch whose tags a new rule changes, or that still wait for their tags: listed with their full set of tags
    for (x in rec$also %||% list()) {
      works[[length(works) + 1]] <- list(cite = x$cite, doi = x$doi %||% "", title = x$title, year = as.integer(x$year), kind = "",
                                         ref_id = "", tags = all_tags[all_tags %in% unlist(x$tags)], create = NULL)
    }

    # the batch file
    q <- function(x) paste0("\"", gsub("\"", "\\\\\"", gsub("\\\\", "\\\\\\\\", x)), "\"")
    out <- c(if (from_search) c(paste0("# Batch ", nn, ": works found by the search of OpenAlex (scripts/search_works.R), each DOI"),
                                "# checked at the DOI registry (Crossref); kept by the scope rule and")
             else paste0("# Batch ", nn, ": works taken from a list of references, kept by the scope rule and"),
             "# tagged from the words of their own title and abstract (scripts/code_works.R,",
             "# library/phrases.yml, library/actors.yml). The phrase behind every tag is in",
             paste0("# batch-", nn, "-evidence.csv. Written by the script; do not edit by hand."), "",
             paste0("batch: ", as.integer(nn)), paste0("date: \"", format(Sys.Date()), "\""),
             paste0("phrases_version: ", ph$version), "")
    if (!is.null(rec$note)) out <- c(out, paste0("note: ", q(rec$note)), "")
    if (length(rec$remove)) {
      out <- c(out, "# Records of the Library to be moved to the bin in Zotero by hand (the reason is given for each).", "remove:")
      for (x in rec$remove) out <- c(out, paste0("  - key: ", q(x$key)), paste0("    why: ", q(x$why)))
      out <- c(out, "")
    }
    if (length(rec$clear_abstract)) {
      out <- c(out, "# Abstracts written by an earlier batch that are not whole: to be taken out again.", "clear_abstract:")
      for (x in rec$clear_abstract) out <- c(out, paste0("  - doi: ", q(x$doi)), paste0("    why: ", q(x$why)))
      out <- c(out, "")
    }
    out <- c(out, "works:")
    for (w in works) {
      out <- c(out, paste0("  - cite: ", q(w$cite)), paste0("    doi: ", q(w$doi)),
               # the registry can hold one record under two DOIs: Zotero may store the other one
               if (!is.null(w$doi_also)) paste0("    doi_also: ", q(w$doi_also)), paste0("    title: ", q(w$title)),
               paste0("    year: ", w$year),
               # the day of publication as OpenAlex gives it (the Monitor lists the works published in the month of an issue)
               if (!is.null(w$published)) paste0("    published: ", q(w$published)),
               paste0("    ref: ", q(w$ref_id)), "    tags:", paste0("      - ", q(w$tags)))
      if (!is.null(w$create)) {
        block <- strsplit(yaml::as.yaml(list(create = w$create), indent.mapping.sequence = TRUE), "\n")[[1]]
        out <- c(out, paste0("    ", block[nzchar(block)]))
      }
      out <- c(out, "")
    }
    dir.create("library/batches", showWarnings = FALSE)
    con <- file(paste0("library/batches/batch-", nn, ".yml"), open = "wb"); writeLines(enc2utf8(out), con, useBytes = TRUE); close(con)
    evd <- as.data.frame(do.call(rbind, evidence), stringsAsFactors = FALSE); names(evd) <- c("ref", "tag", "found_in", "phrase")
    utils::write.csv(evd, paste0("library/batches/batch-", nn, "-evidence.csv"), row.names = FALSE, fileEncoding = "UTF-8")

    # the summary
    has_tag <- function(prefix) vapply(works, function(w) any(startsWith(w$tags, prefix)), logical(1))
    say(""); say("  works with at least one tag of each kind (of ", length(works), "):")
    for (p in c("approach:", "topic:", "region:", "country:", "method:", "oa:", "todo:")) say(sprintf("    %-9s %4d", sub(":", "", p), sum(has_tag(p))))
    say(""); say("  written: library/batches/batch-", nn, ".yml and batch-", nn, "-evidence.csv")
    invisible(TRUE)
  }

  tryCatch(main(),
           pv_stop = function(e) { say(""); say("STOPPED: ", conditionMessage(e)) },
           error = function(e) { say(""); say("STOPPED by an unexpected error: ", conditionMessage(e)); say("Paste this message to Claude.") })
  invisible(NULL)
})
