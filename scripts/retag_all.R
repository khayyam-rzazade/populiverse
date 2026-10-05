# PopuliVerse Library: write all the batch files again with the phrase lists as they
# stand today (library/phrases.yml). Nothing is sent to Zotero and nothing on the site
# changes: this only rewrites library/batches/batch-NN.yml and batch-NN-evidence.csv.
#
#     source("scripts/retag_all.R")
#
# It runs scripts/code_works.R once per batch, oldest first, because a work that sits in
# two batches is kept by the batch that is written first. At the end it says how many
# works each batch holds and what the whole set adds up to, so you can check that no
# work has fallen out before anything is sent to Zotero.
#
# The batch to write is chosen by moving the others out of sight for a moment: the file
# is put back whatever happens, even if the run stops.

local({
  found <- sort(list.files("drafts", pattern = "^batch-[0-9]+-found\\.csv$"))
  if (!length(found)) stop("No drafts/batch-NN-found.csv to work from.")
  hold <- file.path("drafts", ".retag-hold"); dir.create(hold, showWarnings = FALSE)
  on.exit({ for (f in list.files(hold)) file.rename(file.path(hold, f), file.path("drafts", f))
            unlink(hold, recursive = TRUE) }, add = TRUE)

  cat("\nWriting", length(found), "batch files again, oldest first.\n")
  for (i in seq_along(found)) {
    others <- setdiff(found, found[i])
    for (f in others) if (file.exists(file.path("drafts", f))) file.rename(file.path("drafts", f), file.path(hold, f))
    cat("\n-------------------------------------------- ", found[i], "\n", sep = "")
    source("scripts/code_works.R")
    for (f in list.files(hold)) file.rename(file.path(hold, f), file.path("drafts", f))
  }

  cat("\n\n==================== WHAT WAS WRITTEN ====================\n")
  total <- 0
  for (f in sort(list.files("library/batches", pattern = "^batch-[0-9]+\\.yml$", full.names = TRUE))) {
    n <- sum(grepl("^  - cite:", readLines(f, warn = FALSE)))
    total <- total + n
    cat(sprintf("  %-28s %5d works\n", basename(f), n))
  }
  cat(sprintf("  %-28s %5d works\n", "TOTAL", total))
  cat("\nCompare that total with the number of works in the Library (8034 at the last sync).\n")
  cat("A work in no batch at all would keep its old tags, so the two should be close.\n")
  cat("Nothing has been sent to Zotero. Check the total, then run scripts/tag_library.R per batch.\n")
})
