#!/usr/bin/env python3
"""PopuliVerse Library: builds the working files of a batch from the records of the search.

A tool for Claude, run in Claude's own workspace on a copy of the repository. The editor never runs it.
It stands in the repository so that every chat builds a batch in the same way (master plan, sections 11 and 18).

usage:  python3 scripts/build_batch.py SITE RECORDS.csv NN YEAR_FROM YEAR_TO [DECISIONS.json [LIST.csv]]

  SITE            a copy of the repository
  RECORDS.csv     drafts/search-NN-records.csv, as scripts/search_works.R writes it on the editor's Mac
  NN              the number of the batch ("08")
  YEAR_FROM/TO    the years of publication that the batch takes (OpenAlex's year)
  DECISIONS.json  what Claude decided by reading, with a reason for each work:
                    {"W123...": {"as": "article" | "book review" | "book" | "no", "why": "...", "note": "..."}}
                  "note" (optional) becomes a note for the editor (todo:check-record).
                  "no_abstract" (optional, true): the abstract in the record belongs to another text
                  (a chapter of the volume, a thesis of the same title), or is not an abstract but the
                  opening lines of the piece, and is left out.
                  "published" (optional): the day of publication, where OpenAlex's day is that of another version.
                  A decision also counts for a work that enters by the rules (since batch 08): "no" holds it
                  back (a second DOI of a work that is in, a journal that only shares its name with a Scopus
                  journal, an abstract of a conference paper), and another kind changes its kind (a review of
                  a book that the rules took for an article). A decision with the kind that the rules gave
                  changes nothing but can carry "note", "no_abstract" or "published" (since batch 09).
                  A decision can also let in a work that waits: the second record of a piece, when it is
                  the better of the two (the publisher's DOI with the page range, since batch 09).
                  "doi_also" (optional): the DOI under which Zotero holds the record, when its lookup follows
                  the DOI of the batch to another record of the same work (seen in the group after a batch is in;
                  the tagging script then finds the work by that DOI).
                  "_also" (optional): works of an earlier batch that this batch is to tag again:
                    [{"cite": ..., "doi": ... or "", "title": ..., "year": ..., "tags": [...], "why": "..."}]
  LIST.csv        drafts/search-NN-list.csv (for OpenAlex's day of publication); by default next to RECORDS.csv

What enters: every work of the years asked whose verdict is "enters by the rules", unless DECISIONS.json holds it
back; every work for which neither catalogue states the language, when Scopus lists its journal with English only;
and every work "to read" that DECISIONS.json lets in. A work whose record the two catalogues do not fully confirm enters as "accepted" and gets
the note todo:check-record. A review of a book is written without its abstract (its tags come from the title alone).
Until batch 09 a work whose names the registry writes in capitals got todo:check-record; Zotero writes such
names in normal case when it fetches the record, so the note is no longer written.
A text that is the publisher's web page and not an abstract ("Search for other works by this author",
"You do not currently have access to this content"), and a text that is cut off with
spaced dots (". . ."), are left out for every work (since batch 09).

It writes drafts/batch-NN-found.csv (the input of scripts/code_works.R), library/batches/batch-NN-records.yml
(the reasons, in public) and drafts/batch-NN-waiting.csv (what waits, and why). Then: run scripts/code_works.R
in SITE, check the batch file, and cut the DOIs into files for the editor (drafts/batch-NN-dois/; 500 a file
since batch 08, one file for a batch of up to 1,000 works since batch 09)."""
import csv, json, re, sys, os, collections
csv.field_size_limit(10**9)
site, records, nn, y1, y2 = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
decisions = json.load(open(sys.argv[6], encoding='utf-8')) if len(sys.argv) > 6 else {}
LIST = sys.argv[7] if len(sys.argv) > 7 else os.path.join(os.path.dirname(records), 'search-01-list.csv')
dates = {r['openalex_id']: r['date'] for r in csv.DictReader(open(LIST, encoding='utf-8'))}
R = list(csv.DictReader(open(records, encoding='utf-8')))
W = [r for r in R if r['year'].isdigit() and y1 <= int(r['year']) <= y2]
ctrl = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]'); broken = re.compile(r'[\x80-\x9f]|\u00e2\u20ac|\u00c3[\u00a0-\u00bf]')
# the publisher's web page, taken by a catalogue for the abstract
page_text = re.compile(r'Search for other works by this author|You do not currently have access to this content|^\s*(?:Research Article|Journal Article|Book Review|Essay)\s*\|')
cut_off = re.compile(r'(?:\.\s){2}\.\s*$')        # a teaser that ends in ". . ."
final, wait = [], []
held = retyped = 0
for r in W:
    d = decisions.get(r['ref_id'])
    r['publication_date'] = (d or {}).get('published') or dates.get(r['ref_id'], '')
    # neither catalogue states the language: a piece in a journal that Scopus lists with English only is taken as English
    by_scopus = r['check'] == 'set aside: neither catalogue states the language' and r['scopus_languages'] == 'ENG' and r['piece'] in ('article', 'book review') \
                and r['list_status'] == 'candidate'
    by_rules = r['verdict'] == 'enters by the rules' or by_scopus
    # a work that enters by the rules and on which the reading says nothing, or nothing new
    if by_rules and (not d or d.get('as') == r['piece']):
        r['let_in'] = ''; r['by_scopus_language'] = 'yes' if by_scopus else ''; final.append(r)
        if d and d.get('note'): r['check_record'] = d['note']
        if d and d.get('no_abstract'): r['abstract'] = ''; r['abstract_whole'] = ''
        if d and d.get('doi_also'): r['doi_also'] = d['doi_also']
    elif d and d.get('as') in ('article', 'book review', 'book'):
        r['piece'] = d['as']; r['let_in'] = 'read' if r['check'] == 'confirmed' else 'accepted'; r['why'] = d['why']; final.append(r)
        if d.get('note'): r['check_record'] = d['note']
        if d.get('no_abstract'): r['abstract'] = ''; r['abstract_whole'] = ''
        if d.get('doi_also'): r['doi_also'] = d['doi_also']
        retyped += by_rules
    else: r['why'] = ((d or {}).get('why') + ' (read by Claude)') if d else r['verdict']; wait.append(r); held += by_rules
# (names that the registry writes in capitals: no note since batch 09, because Zotero writes them in normal case itself)
dois = collections.Counter(r['doi'] for r in final); assert not [k for k, v in dois.items() if v > 1], 'a DOI twice'
cols = ['ref_id', 'cite', 'first_author', 'year', 'title', 'container', 'kind_guess', 'piece', 'authors', 'reference', 'doi_printed', 'status', 'doi', 'doi_also', 'found_by', 'title_found',
        'year_found', 'journal_or_publisher', 'type', 'source_type', 'open_access', 'oa_status', 'abstract_from', 'abstract_whole', 'openalex_id', 'language', 'cited_by_count',
        'listed_in', 'scopus_title', 'scopus_languages', 'check', 'list_status', 'verdict', 'let_in', 'check_record', 'publication_date', 'abstract']
os.makedirs(site + '/drafts', exist_ok=True)
with open('%s/drafts/batch-%s-found.csv' % (site, nn), 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL); w.writeheader()
    for r in sorted(final, key=lambda r: (-int(r['year']), -int(r['cited_by_count'] or 0), r['ref_id'])):
        row = {c: (r.get(c, '') if c == 'title_found' else ctrl.sub('', r.get(c, ''))) for c in cols}
        if r['piece'] == 'book review' or broken.search(row['abstract']) or page_text.search(row['abstract']) or cut_off.search(row['abstract']): row['abstract'] = ''; row['abstract_whole'] = ''     # a review: tags from the title alone, no abstract written
        if r['let_in'] == 'accepted': row['status'] = 'not found'; row['doi'] = ''          # enters only through the records file
        else: row['status'] = 'found'
        if not row['language']: row['language'] = 'en'
        if row['kind_guess'] == 'review': row['kind_guess'] = 'article'                     # a piece in a journal, for the rules about kinds of record
        w.writerow(row)
q = lambda s: '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
with open('%s/library/batches/batch-%s-records.yml' % (site, nn), 'w', encoding='utf-8') as f:
    f.write('''# Batch %s: what was decided by reading, not by the rules alone.
# Source: search 01 of OpenAlex (scripts/search_works.R, third version of the rules): journal articles,
# reviews of books in journals, and books, in English, with a DOI, whose title names populism, published
# %d to %d. A piece in a journal counts when the journal is on the Scopus source list of August 2026
# for the year of the work. Each DOI is checked at the DOI registry (Crossref).
#
# read      Works that the script gave to Claude to read (a short piece whose kind the record does not
#           show, a title that the Library holds, a language to check) and that enter for the reason given;
#           and works that enter by the rules and whose kind the reading changed.
# accepted  Works on which the two catalogues do not fully agree and that enter for the reason given.
#           Each also gets the note "todo:check-record" in Zotero, for the editor's own pass.

''' % (nn, y1, y2))
    also = decisions.get('_also', [])
    if also:
        f.write('# Works of an earlier batch that this batch tags again: each with its full set of tags, and why.\nalso:\n')
        for a in also: f.write('  - {cite: %s, doi: %s, title: %s, year: %d, tags: [%s]%s}\n' % (q(a['cite']), q(a['doi']), q(a['title']), a['year'], ', '.join(q(t) for t in a['tags']),
                                                                                              (', why: ' + q(a['why'])) if a.get('why') else ''))
        f.write('\n')
    for name in ('read', 'accepted'):
        rows = [r for r in final if r['let_in'] == name]
        f.write('%s:%s\n' % (name, '' if rows else ' {}'))
        for r in rows: f.write('  %s: {doi: %s, why: %s}\n' % (r['ref_id'], q(r['doi']), q(r['why'])))
        f.write('\n')
with open('%s/drafts/batch-%s-waiting.csv' % (site, nn), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL); w.writerow(['openalex_id', 'doi', 'year', 'kind', 'first_author', 'title', 'journal_or_publisher', 'cited_by_count', 'why'])
    for r in sorted(wait, key=lambda r: (-int(r['year']), r['why'])): w.writerow([r['ref_id'], r['doi'], r['year'], r['kind_guess'], r['first_author'], r['title'], r['journal_or_publisher'] or r['container'], r['cited_by_count'], r['why']])
print('batch %s, published %d to %d: checked %d | enter %d (by the rules %d, read %d, accepted %d) | as: %s | wait %d' % (nn, y1, y2, len(W), len(final), sum(not r['let_in'] for r in final),
      sum(r['let_in'] == 'read' for r in final), sum(r['let_in'] == 'accepted' for r in final), dict(collections.Counter(r['piece'] for r in final)), len(wait)))
print('entered because Scopus lists the journal with English only:', sum(1 for r in final if r.get('by_scopus_language')))
print('enter by the rules, held back by reading:', held, '| kind changed by reading:', retyped)
print('still to read (no decision yet):', sum(1 for r in wait if r['verdict'].startswith('to read') and r['ref_id'] not in decisions))
