# =============================================================================
# PopuliVerse: make the PDF of the issue in preparation
#
# HOW TO USE IT
#   Open this file in RStudio (with the populiverse project open) and click
#   "Source". Nothing else is needed. Run it again after every change to the
#   text of the issue.
#
# WHAT IT DOES
#   1. It finds the issue in preparation: the folder in "monitor" whose name
#      ends in "-draft" (for example monitor/2026-1-draft).
#   2. It makes the PDF from the issue's text (index.qmd) and puts it into
#      that folder, as populiverse-monitor-2026-1.pdf.
#   3. It notes on which page of the PDF every part of the text stands
#      (pages.json). The web page shows these page numbers in its margin.
#      If the folder holds the list of the month's new research
#      (populiverse-monitor-2026-1-new-research.csv), it counts the works in it
#      and checks that the Library has them.
#   4. It builds the issue's web page once, so that you can look at both.
#   5. It prints a short report.
#   6. If the header of the issue has a date and a DOI, it asks whether to
#      publish. On "yes" it takes the ending "-draft" away from the folder's
#      name. Only then can GitHub see the issue.
#
# WHAT IT NEVER DOES
#   It never touches an issue that is already published (a folder without
#   "-draft"): a published PDF is frozen. It sends nothing anywhere: you
#   upload the PDF to Zenodo and you push to GitHub yourself.
# =============================================================================

local({

  QUARTO_VERSION <- "1.9.38"   # the version this site is pinned to
  MAX_PAGES <- 15              # the rules: an issue has 15 pages at most
  ITEM_WORDS <- c(120, 150)    # the rules: a full item has 120 to 150 words

  say <- function(...) cat(..., "\n", sep = "")
  stop_plain <- function(...) {
    say("")
    say("STOPPED: ", ...)
    say("")
    stop("see the message above", call. = FALSE)
  }

  # ---------------------------------------------------------------- the folder
  root <- getwd()
  if (!file.exists(file.path(root, "_quarto.yml"))) {
    home <- path.expand("~/populiverse")
    if (file.exists(file.path(home, "_quarto.yml"))) {
      root <- home
    } else {
      stop_plain("I cannot find the site's folder. Open the populiverse project in RStudio ",
                 "(File > Open Project), then click Source again.")
    }
  }
  old_wd <- setwd(root)
  on.exit(setwd(old_wd), add = TRUE)

  # ---------------------------------------------------------------- Quarto
  candidates <- unique(c(
    Sys.getenv("QUARTO_PATH"), Sys.which("quarto"),
    "/usr/local/bin/quarto", "/opt/homebrew/bin/quarto",
    "/Applications/quarto/bin/quarto", "/opt/quarto/bin/quarto"
  ))
  candidates <- candidates[nzchar(candidates) & file.exists(candidates)]
  quarto <- ""
  found <- character(0)
  for (q in candidates) {
    v <- tryCatch(suppressWarnings(system2(q, "--version", stdout = TRUE, stderr = FALSE)),
                  error = function(e) character(0))
    v <- if (length(v)) trimws(v[1]) else ""
    found <- c(found, paste0(q, " (version ", v, ")"))
    if (identical(v, QUARTO_VERSION)) { quarto <- q; break }
  }
  if (!nzchar(quarto)) {
    stop_plain("I need Quarto ", QUARTO_VERSION, " and did not find it. ",
               if (length(found)) paste0("Found: ", paste(found, collapse = "; "), ".") else "Found no Quarto at all.")
  }

  run <- function(args) {
    out <- suppressWarnings(system2(quarto, args, stdout = TRUE, stderr = TRUE))
    status <- attr(out, "status")
    list(out = as.character(out), ok = is.null(status) || identical(as.integer(status), 0L))
  }

  # ---------------------------------------------------------------- the issue
  drafts <- Sys.glob(file.path("monitor", "*-draft"))
  drafts <- drafts[dir.exists(drafts)]
  if (length(drafts) == 0) {
    say("")
    say("No issue is in preparation: there is no folder in \"monitor\" whose name ends in \"-draft\".")
    say("A published issue is frozen, so there is nothing to do.")
    say("")
    return(invisible(NULL))
  }
  if (length(drafts) > 1) {
    stop_plain("More than one issue is in preparation: ", paste(drafts, collapse = ", "),
               ". Keep one folder with \"-draft\" at a time.")
  }
  folder <- drafts[1]
  source_file <- file.path(folder, "index.qmd")
  if (!file.exists(source_file)) stop_plain("There is no index.qmd in ", folder, ".")

  # ---- the header of the issue: the lines between the first two lines of dashes
  lines <- readLines(source_file, encoding = "UTF-8", warn = FALSE)
  dashes <- which(grepl("^---\\s*$", lines))
  if (length(dashes) < 2 || dashes[1] != 1) {
    stop_plain("The header of ", source_file, " is damaged: it must start with a line of three dashes ",
               "and end with another one.")
  }
  header <- lines[(dashes[1] + 1):(dashes[2] - 1)]
  body <- lines[(dashes[2] + 1):length(lines)]
  field <- function(name) {
    hit <- grep(paste0("^", name, ":"), header, value = TRUE)
    if (length(hit) == 0) return("")
    value <- sub(paste0("^", name, ":\\s*"), "", hit[1])
    if (grepl("^\"", value)) {
      value <- sub("^\"([^\"]*)\".*$", "\\1", value)      # what stands between the quotation marks
    } else {
      value <- sub("\\s+#.*$", "", value)                  # without a note after it
    }
    trimws(value)
  }
  number <- field("issue")
  month <- field("subtitle")
  date <- field("date")
  doi <- sub("^https?://doi\\.org/", "", field("doi"))
  if (!grepl("^[0-9]{4}/[0-9]+$", number)) {
    stop_plain("The line \"issue:\" in the header must look like \"2026/1\". It says: \"", number, "\".")
  }
  slug <- sub("/", "-", number, fixed = TRUE)
  if (basename(folder) != paste0(slug, "-draft")) {
    stop_plain("The folder is called ", basename(folder), ", but the header says issue ", number,
               ". The folder must be called ", slug, "-draft.")
  }
  if (nzchar(date) && !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", date)) {
    stop_plain("The line \"date:\" must look like \"2026-10-05\" (year-month-day). It says: \"", date, "\".")
  }
  if (nzchar(doi) && !grepl("^10\\.[0-9]{4,9}/\\S+$", doi)) {
    stop_plain("The line \"doi:\" must look like \"10.5281/zenodo.1234567\". It says: \"", doi, "\".")
  }
  pdf_name <- paste0("populiverse-monitor-", slug, ".pdf")
  pdf_file <- file.path(folder, pdf_name)
  map_file <- file.path(folder, "pages.json")
  list_name <- paste0("populiverse-monitor-", slug, "-new-research.csv")
  list_file <- file.path(folder, list_name)

  say("")
  say("PopuliVerse Monitor ", number, " (", month, ")")
  say("----------------------------------------------------------------")

  # ---------------------------------------------------------------- 1. the PDF
  build <- file.path("drafts", "build", slug)
  dir.create(build, recursive = TRUE, showWarnings = FALSE)
  typ_file <- file.path(build, "issue.typ")
  new_pdf <- file.path(build, pdf_name)
  fonts <- file.path("_templates", "fonts")

  step <- run(c("pandoc", shQuote(source_file), "-f", "markdown", "-t", "typst",
                "--lua-filter", "verse.lua",
                "--lua-filter", shQuote(file.path("_templates", "issue.lua")),
                "--template", shQuote(file.path("_templates", "issue.typ")),
                "-o", shQuote(typ_file)))
  if (!step$ok || !file.exists(typ_file)) {
    say(paste(step$out, collapse = "\n"))
    stop_plain("The text could not be read. The message above says where. ",
               "Often it is a damaged header: a missing quotation mark or colon.")
  }

  typst <- c("--font-path", shQuote(fonts), "--ignore-system-fonts")
  step <- run(c("typst", "compile", typst, shQuote(typ_file), shQuote(new_pdf)))
  if (!step$ok || !file.exists(new_pdf)) {
    say(paste(step$out, collapse = "\n"))
    stop_plain("The PDF could not be made. Please paste the message above to Claude.")
  }

  # ---------------------------------------------------------------- 2. the page numbers
  step <- run(c("typst", "query", typst, shQuote(typ_file), shQuote("<pvmap>"), "--field", "value", "--one"))
  map <- grep("^\\{\"pages\":", step$out, value = TRUE)
  if (!step$ok || length(map) != 1) {
    say(paste(step$out, collapse = "\n"))
    stop_plain("The page numbers could not be read from the PDF. Please paste the message above to Claude.")
  }
  pages <- as.integer(sub("^\\{\"pages\":([0-9]+).*$", "\\1", map))

  # both files go into the issue's folder together, so they always match
  file.copy(new_pdf, pdf_file, overwrite = TRUE)
  writeLines(map, map_file, useBytes = TRUE)

  # ---------------------------------------------------------------- 3. the web page
  step <- run(c("render", shQuote(source_file), "--quiet"))
  web_ok <- step$ok
  web_file <- file.path("_site", folder, "index.html")
  stale <- any(grepl("the text has changed since the PDF was made", step$out, fixed = TRUE))

  # ---------------------------------------------------------------- 4. the report
  count_words <- function(x) {
    x <- gsub("\\[([^]]*)\\]\\([^)]*\\)", "\\1", x)        # a link counts as its words
    sum(lengths(strsplit(trimws(x), "\\s+")))
  }
  starts <- grep("^#### ", body)
  short_or_long <- character(0)
  for (s in starts) {
    rest <- body[(s + 1):length(body)]
    stop_at <- which(grepl("^(\\*Actors?:\\*|\\*Sources?:\\*|\\*Research on this:\\*|#|\\*\\*Also this month\\*\\*)", rest))
    text <- if (length(stop_at)) rest[seq_len(stop_at[1] - 1)] else rest
    text <- text[nzchar(trimws(text))]
    n <- if (length(text)) count_words(paste(text, collapse = " ")) else 0L
    if (n < ITEM_WORDS[1] || n > ITEM_WORDS[2]) {
      short_or_long <- c(short_or_long, paste0("   ", n, " words: ", sub("^#### ", "", body[s])))
    }
  }

  # ---- the list of the month's new research, if the issue has one
  list_n <- NA
  list_in_library <- NA
  if (file.exists(list_file)) {
    works <- tryCatch(utils::read.csv(list_file, stringsAsFactors = FALSE, check.names = FALSE,
                                      encoding = "UTF-8", colClasses = "character"),
                      error = function(e) NULL)
    if (is.null(works) || !("doi" %in% names(works))) {
      stop_plain("I cannot read ", list_file, ". It must be a table with a column called doi. Please tell Claude.")
    }
    list_n <- nrow(works)
    library_file <- file.path("library", "library.json")
    if (file.exists(library_file)) {
      held <- tolower(paste(readLines(library_file, encoding = "UTF-8", warn = FALSE), collapse = "\n"))
      list_in_library <- sum(vapply(tolower(trimws(works$doi)),
                                    function(d) grepl(paste0("\"", d, "\""), held, fixed = TRUE), logical(1)))
    }
  }

  say("PDF:        ", pdf_file, " (", pages, " pages)")
  say("Web page:   ", if (web_ok) web_file else "could not be built (see below)")
  say("Published:  ", if (nzchar(date)) date else "no date yet")
  say("DOI:        ", if (nzchar(doi)) doi else "no DOI yet")
  say("Full items: ", length(starts))
  if (!is.na(list_n)) say("New research: ", list_n, " works in the list (", list_name, ")")
  if (pages > MAX_PAGES) {
    say("")
    say("NOTE: the PDF has ", pages, " pages. The rules say ", MAX_PAGES, " at most.")
  }
  if (length(short_or_long)) {
    say("")
    say("NOTE: the rules say ", ITEM_WORDS[1], " to ", ITEM_WORDS[2], " words for a full item. Outside that:")
    say(paste(short_or_long, collapse = "\n"))
  }
  if (!is.na(list_n) && !is.na(list_in_library) && list_in_library < list_n) {
    say("")
    say("NOTE: the Library on this computer holds ", list_in_library, " of the ", list_n, " works in the list of new research.")
    say("      The text says that the Library holds them all. Wait until the Library has taken them in,")
    say("      click \"Pull origin\" in GitHub Desktop, and run this script again before you publish.")
  }
  if (!web_ok) {
    say("")
    say(paste(step$out, collapse = "\n"))
    say("NOTE: the web page could not be built. The PDF is made. Please paste the message above to Claude.")
  } else if (stale) {
    say("")
    say("NOTE: the web page and the PDF do not agree on the text. Please tell Claude.")
  }

  if (interactive() && Sys.info()[["sysname"]] == "Darwin") {
    try(system2("open", shQuote(pdf_file)), silent = TRUE)
    if (web_ok && file.exists(web_file)) try(system2("open", shQuote(web_file)), silent = TRUE)
  }

  # ---------------------------------------------------------------- 5. publication day
  say("")
  if (!nzchar(date) || !nzchar(doi)) {
    say("This is a draft: the PDF and the web page say so. GitHub cannot see the folder.")
    say("On publication day, fill in what is still empty in the header (\"date:\", \"doi:\") and run this script again.")
    say("")
    return(invisible(NULL))
  }

  answer <- Sys.getenv("PV_PUBLISH", unset = NA)
  if (is.na(answer)) {
    if (!interactive()) {
      say("The issue has a date and a DOI. Run the script in RStudio to publish it.")
      say("")
      return(invisible(NULL))
    }
    say("The issue has a date and a DOI. If you have read the PDF and it is final:")
    answer <- readline("Publish it? Type yes and press Enter (anything else: not yet): ")
  }
  if (!identical(tolower(trimws(answer)), "yes")) {
    say("Not published. Nothing has left this computer.")
    say("")
    return(invisible(NULL))
  }

  target <- file.path("monitor", slug)
  if (file.exists(target)) {
    stop_plain("There is already a folder ", target, ". A published issue is frozen. Please tell Claude.")
  }
  if (!file.rename(folder, target)) {
    stop_plain("I could not rename ", folder, " to ", target, ". Close any file of the issue that is open and run again.")
  }
  unlink(file.path("_site", folder), recursive = TRUE)
  run(c("render", shQuote(file.path(target, "index.qmd")), "--quiet"))

  say("")
  say("Done: the folder is now ", target, ". From here on this PDF is frozen.")
  say("")
  say("What is left, in this order:")
  say("  1. Zenodo: upload ", file.path(target, pdf_name), " to the record that holds the DOI",
      if (!is.na(list_n)) paste0(", and with it the list ", file.path(target, list_name)) else "", ". Then publish the record.")
  say("  2. GitHub Desktop: commit and push. The issue is live a few minutes later.")
  say("  3. Check ", "https://populiverse.com/monitor/", slug, "/ and the DOI link.")
  say("")
  invisible(NULL)
})
