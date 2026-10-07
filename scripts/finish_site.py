#!/usr/bin/env python3
"""Two last touches to the built site, run by Quarto after every render.

1. sitemap.xml: the two newsletter pages are taken out. They only make sense
   straight after someone signs up, and a search result that lands a stranger on
   "You're Subscribed" helps nobody. Both pages also carry a noindex tag of their
   own, set in their .qmd files; this keeps them out of the list we hand Google
   in the first place.

2. robots.txt: Quarto writes only the line that points to the sitemap. Some
   crawlers expect a "User-agent" line before anything else and ignore a file
   without one, so the file is rewritten with that line in front.

Nothing else in _site is touched. If a file is missing the script says so and
lets the build carry on: neither change is worth failing a deploy over.
"""

import os
import re
import sys

OUT = os.environ.get("QUARTO_PROJECT_OUTPUT_DIR", "_site")

# Pages kept out of sitemap.xml, as they appear in the built site.
HIDE = ("/newsletter/thanks.html", "/newsletter/confirmed.html")

ROBOTS = """User-agent: *
Allow: /

Sitemap: https://populiverse.com/sitemap.xml
"""


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
        print("finish_site: sitemap.xml already holds no newsletter pages.")
        return

    head = xml.split("<url>", 1)[0]
    tail = "</urlset>\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(head + "\n".join(kept) + "\n" + tail)
    print("finish_site: sitemap.xml now lists %d pages (%d newsletter page(s) taken out)."
          % (len(kept), len(dropped)))


def write_robots():
    path = os.path.join(OUT, "robots.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(ROBOTS)
    print("finish_site: robots.txt written with a User-agent line.")


if __name__ == "__main__":
    if not os.path.isdir(OUT):
        print("finish_site: %s is not there, nothing to do." % OUT)
        sys.exit(0)
    trim_sitemap()
    write_robots()
