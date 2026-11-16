#!/usr/bin/env python3
"""Two last touches to the built site, run by Quarto after every render.

1. sitemap.xml: the two newsletter pages, the Workspace's pages and the page
   for an address that does not exist (404.html) are taken out. The newsletter pages only make sense straight after someone signs up,
   and a search result that lands a stranger on "You're Subscribed" helps
   nobody. The Workspace's pages are personal. All of them also carry a noindex
   tag of their own, set in their .qmd files; this keeps them out of the list we
   hand Google in the first place.

2. robots.txt: Quarto writes only the line that points to the sitemap. Some
   crawlers expect a "User-agent" line before anything else and ignore a file
   without one, so the file is rewritten with that line in front.

3. library/library-cite.json: a small list of the Library, made from the
   Library's own file, so that typing "@" in Write can look a work up without
   fetching the whole Library. One line per work: its id, its short form, its
   year, the reference the Library holds, and its address. Nothing is written
   here that the Library does not already hold.

4. Every script and style sheet of the site's own gets a fingerprint of its
   content in its address: "keep.js" becomes "keep.js?v=1a2b3c4d5e". GitHub
   Pages keeps a file for ten minutes in a reader's browser and cannot be told
   otherwise, so a page could meet an old script for that long after a push.
   With the fingerprint, a changed file has a new address and is fetched fresh
   at once; an unchanged file keeps its address and stays in the browser (the
   live check before the trial, point 2a). Files of other sites are not
   touched, and neither is any address that already has a "?".

Nothing else in _site is touched. If a file is missing the script says so and
lets the build carry on: none of these changes is worth failing a deploy over.
"""

import hashlib
import json
import os
import re
import sys

OUT = os.environ.get("QUARTO_PROJECT_OUTPUT_DIR", "_site")

# Pages kept out of sitemap.xml, as they appear in the built site. The
# Workspace's pages are personal and closed until the trial; they also carry a
# noindex tag of their own.
HIDE = ("/404.html", "/newsletter/thanks.html", "/newsletter/confirmed.html",
        "/workspace/", "/workspace/index.html", "/workspace/notes.html",
        "/workspace/notebook.html", "/workspace/write.html", "/workspace/projects.html",
        "/workspace/tools.html", "/workspace/account.html", "/workspace/desk.html")

ROBOTS = """User-agent: *
Allow: /

Sitemap: https://populiverse.com/sitemap.xml
"""

# The "Workspace" link in the masthead, on a page of the Workspace that is not
# its front page. Quarto underlines a masthead word only on the exact page it
# points at, which is right for Monitor or Library, where the link means that
# section's front page and the other pages are separate things. The Workspace
# is one place a reader stays inside for a whole session, so the word is
# underlined on every page of it and the reader is never told they are
# somewhere else (Fable's re-check of the trial build, point 4e).
WS_LINK = re.compile(r'(<a\b[^>]*?\bclass=")nav-link(")([^>]*?\bhref="[^"]*workspace/index\.html")')


def trim_sitemap():
    path = os.path.join(OUT, "sitemap.xml")
    if not os.path.exists(path):
        print("finish_site: no sitemap.xml to tidy, skipping.")
        return
    with open(path, encoding="utf-8") as f:
        xml = f.read()

    kept, dropped = [], []
    # Each <url>…</url> block holds one page.
    for block in re.findall(r"<url>.*?</url>", xml, re.S):
        loc = re.search(r"<loc>(.*?)</loc>", block, re.S)
        address = loc.group(1).strip() if loc else ""
        (dropped if any(address.endswith(h) for h in HIDE) else kept).append(block)

    if not dropped:
        print("finish_site: sitemap.xml already holds none of the hidden pages.")
        return

    head = xml.split("<url>", 1)[0]
    tail = "</urlset>\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(head + "\n".join(kept) + "\n" + tail)
    print("finish_site: sitemap.xml now lists %d pages (%d hidden page(s) taken out)."
          % (len(kept), len(dropped)))


def write_robots():
    path = os.path.join(OUT, "robots.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(ROBOTS)
    print("finish_site: robots.txt written with a User-agent line.")


def write_library_cite():
    """The small list of the Library that the "@" in Write looks through."""
    source = os.path.join(OUT, "library", "library-list.json")
    if not os.path.exists(source):
        print("finish_site: no library-list.json, so no library-cite.json.")
        return
    with open(source, encoding="utf-8") as f:
        data = json.load(f)
    works = []
    for e in data.get("entries", []):
        works.append([e.get("id", ""), e.get("byline", "") or "", e.get("year", "") or "",
                      e.get("citation", "") or "", e.get("url", "") or ""])
    out = os.path.join(OUT, "library", "library-cite.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"works": works}, f, ensure_ascii=False, separators=(",", ":"))
    print("finish_site: library-cite.json written with %d works." % len(works))


# A <script src="..."> or a <link href="..."> of a file on this site, with no
# "?" or "#" in its address yet.
OWN_FILE = re.compile(
    r'(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?#:]+\.(?:js|css))(")', re.I)


def stamp_files():
    """Puts each own script's and style sheet's fingerprint in its address."""
    root = os.path.abspath(OUT)
    prints = {}
    missing = set()
    pages = stamped = 0

    def fingerprint(path):
        if path not in prints:
            with open(path, "rb") as f:
                prints[path] = hashlib.sha256(f.read()).hexdigest()[:10]
        return prints[path]

    for folder, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith(".html"):
                continue
            page = os.path.join(folder, name)
            with open(page, encoding="utf-8") as f:
                html = f.read()

            def stamp(m):
                nonlocal stamped
                address = m.group(2)
                if address.startswith("//"):
                    return m.group(0)
                if address.startswith("/"):
                    target = os.path.normpath(os.path.join(root, address.lstrip("/")))
                else:
                    target = os.path.normpath(os.path.join(folder, address))
                if not target.startswith(root + os.sep) or not os.path.isfile(target):
                    missing.add(address)
                    return m.group(0)
                stamped += 1
                return m.group(1) + address + "?v=" + fingerprint(target) + m.group(3)

            changed = OWN_FILE.sub(stamp, html)
            if changed != html:
                with open(page, "w", encoding="utf-8") as f:
                    f.write(changed)
                pages += 1
    print("finish_site: %d addresses in %d pages now carry the fingerprint of their file." % (stamped, pages))
    if missing:
        print("finish_site: not found, so left as they were: %s" % ", ".join(sorted(missing)))


def mark_workspace():
    """Underlines "Workspace" in the masthead on every page of the Workspace."""
    root = os.path.abspath(OUT)
    folder = os.path.join(root, "workspace")
    if not os.path.isdir(folder):
        print("finish_site: no workspace folder, so no masthead word to mark.")
        return
    pages = marked = 0
    for here, _dirs, files in os.walk(folder):
        for name in files:
            if not name.endswith(".html"):
                continue
            # Its own front page already has the word underlined, by Quarto.
            if os.path.join(here, name) == os.path.join(folder, "index.html"):
                continue
            page = os.path.join(here, name)
            with open(page, encoding="utf-8") as f:
                html = f.read()
            # A screen reader is told the same thing the underline shows. The
            # word is "true" and not "page", since the link leads to the front
            # page of the Workspace and the reader is on another page of it.
            changed, n = WS_LINK.subn(r'\1nav-link active\2 aria-current="true"\3', html)
            if n:
                with open(page, "w", encoding="utf-8") as f:
                    f.write(changed)
                pages += 1
                marked += n
    print("finish_site: \"Workspace\" marked as the page you are on %d times, in %d pages."
          % (marked, pages))


if __name__ == "__main__":
    if not os.path.isdir(OUT):
        print("finish_site: %s is not there, nothing to do." % OUT)
        sys.exit(0)
    trim_sitemap()
    write_robots()
    try:
        mark_workspace()
    except Exception as err:  # a build is not worth failing over this
        print("finish_site: the masthead word could not be marked (%s)." % err)
    try:
        write_library_cite()
    except Exception as err:  # a build is not worth failing over this
        print("finish_site: library-cite.json could not be written (%s)." % err)
    try:
        stamp_files()
    except Exception as err:  # a build is not worth failing over this
        print("finish_site: the fingerprints could not be added (%s)." % err)
