// Light/dark theme switching for the 3psLCCA Core site.
// Dark is the default; an explicit choice is stored in localStorage and
// applied as data-theme on <html>, which assets/site.css keys off. With no
// stored choice, the OS preference (prefers-color-scheme) decides.
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) { /* storage blocked */ }
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;

  var osLight = window.matchMedia("(prefers-color-scheme: light)");

  function current() {
    if (root.dataset.theme) return root.dataset.theme;
    return osLight.matches ? "light" : "dark";
  }

  function paint(btn) {
    var next = current() === "light" ? "dark" : "light";
    btn.textContent = next === "dark" ? "🌙" : "☀️";
    btn.title = "Switch to " + next + " theme";
    btn.setAttribute("aria-label", btn.title);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    paint(btn);
    btn.addEventListener("click", function () {
      var next = current() === "light" ? "dark" : "light";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) { /* storage blocked */ }
      paint(btn);
    });
    if (osLight.addEventListener) osLight.addEventListener("change", function () { paint(btn); });
  });
})();
