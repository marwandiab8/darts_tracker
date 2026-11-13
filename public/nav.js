// The navigation shared by every page: <nav class="dt-nav" data-page="tracker|bot|jdc|doubles|stats|cameras">.
// One look across the games, each one tap away (Board mode is a button on each game's page).
(function () {
  "use strict";
  const LINKS = [
    ["tracker", "./", "Tracker"],
    ["bot", "practice.html", "Bot game"],
    ["jdc", "challenge.html", "JDC Challenge"],
    ["doubles", "doubles.html", "Doubles"],
    ["stats", "stats.html", "Stats"],
    ["cameras", "camera.html", "Cameras"],
  ];
  function render(nav) {
    const here = nav.dataset.page || "";
    nav.setAttribute("aria-label", "Darts Tracker");
    nav.innerHTML = '<a class="dt-nav-brand" href="./" aria-label="Darts Tracker home"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/></svg></a>'
      + LINKS.map(([id, href, text]) => `<a href="${href}"${id === here ? ' aria-current="page"' : ""}>${text}</a>`).join("");
  }
  const go = () => document.querySelectorAll("nav.dt-nav").forEach(render);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
