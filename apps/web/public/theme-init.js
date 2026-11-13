// External (CSP-safe) bootstrap: applies stored UI prefs before first paint. Only non-sensitive prefs.
(function () {
  try {
    var d = document.documentElement;
    var theme = localStorage.getItem("ui.theme");
    if (theme === "light" || theme === "dark") d.setAttribute("data-theme", theme);
    var loc = localStorage.getItem("ui.locale");
    if (loc === "en") { d.lang = "en"; d.dir = "ltr"; }
  } catch (e) { /* storage unavailable: defaults apply */ }
})();
