/* PopuliVerse: where a link opens.
 *
 * The rule, in plain words:
 *
 *   - A link that leaves populiverse.com opens in a new tab, so that the
 *     reader keeps PopuliVerse open behind it instead of being taken away.
 *   - A PDF opens in a new tab as well, even though it is our own file. Someone
 *     who opens an issue should still have the site to come back to.
 *   - Everything else is a page of this site, so it opens in the same tab, the
 *     way a website normally behaves.
 *
 * Quarto already does the first of these for links written inside a page, but
 * it never sees the menu and the footer, and it does not treat our own PDFs as
 * anything special. This file covers all of them in one place, so a link added
 * later needs no thought: put it anywhere, and it behaves by the rule above.
 *
 * The Library draws its list of works after the page has loaded. Those links
 * are not covered here, and do not need to be: library.js already opens every
 * one of them in a new tab, and checks the address first.
 */
(function () {
  "use strict";

  function decide(a) {
    var href = a.getAttribute("href");
    if (!href) return;

    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (e) {
      return;                                   // not an address we can read
    }

    // An email or telephone link is handed to another app, not opened as a
    // page. Giving it a tab of its own leaves an empty tab behind.
    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    if (url.host !== window.location.host) {    // leaves PopuliVerse
      a.target = "_blank";
      a.rel = "noopener noreferrer";            // the new tab cannot reach back
      return;
    }

    if (/\.pdf$/i.test(url.pathname)) {         // our own PDF
      a.target = "_blank";
      a.rel = "noopener";
    }

    // Anything else stays where it is: it is a page of this site.
  }

  function apply() {
    Array.prototype.forEach.call(document.querySelectorAll("a[href]"), decide);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
