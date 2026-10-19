/* PopuliVerse: the visit counter.
 *
 * In plain words:
 *
 *   - When someone arrives, this script asks the counter (a small program the
 *     editor runs on Cloudflare) to add one to the total. The counter answers
 *     with the new total, which is that reader's visit number.
 *   - The number is kept in the reader's browser tab until the tab is closed.
 *     So a reader who clicks through ten pages is counted once, and sees the
 *     same number on every page. It is not a cookie and it is not sent anywhere.
 *   - On the About page there is a line that says "Yours is visit number ...".
 *     It stays hidden until the visit number reaches SHOW_FROM. To show it
 *     earlier or later, change that one number below.
 *   - If anything goes wrong (the counter is down, the browser blocks storage,
 *     the page is opened from a local preview) nothing happens and the page
 *     looks as it always does.
 *
 * What the counter stores is a single total and nothing else. See the Privacy page.
 */
(function () {
  "use strict";

  var API = "https://counter.populiverse.com";
  var KEY = "pv-visit";
  var SHOW_FROM = 1;

  // The browser tab's own memory. Some browsers refuse it. In that case the
  // visit is not counted at all, so a total is never inflated by page loads.
  function read() {
    try {
      var n = parseInt(window.sessionStorage.getItem(KEY), 10);
      return n > 0 ? n : null;
    } catch (e) {
      return null;
    }
  }

  function write(n) {
    try {
      window.sessionStorage.setItem(KEY, String(n));
      return window.sessionStorage.getItem(KEY) === String(n);
    } catch (e) {
      return false;
    }
  }

  function canStore() {
    try {
      window.sessionStorage.setItem("pv-test", "1");
      window.sessionStorage.removeItem("pv-test");
      return true;
    } catch (e) {
      return false;
    }
  }

  // The line on the About page (the other pages do not have one)
  function show(n) {
    var line = document.getElementById("pv-visit");
    if (!line || !n || n < SHOW_FROM) return;
    var number = line.querySelector(".pv-visit-number");
    if (number) number.textContent = n.toLocaleString("en-GB");
    line.hidden = false;
    line.classList.add("pv-visit-in");
  }

  function run() {
    var known = read();
    if (known) {
      show(known);
      return;
    }
    if (!canStore() || !window.fetch) return;

    window.fetch(API + "/hit", { method: "POST", mode: "cors", credentials: "omit" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (data && data.n > 0 && write(data.n)) show(data.n);
      })
      .catch(function () { /* the page is fine without it */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
