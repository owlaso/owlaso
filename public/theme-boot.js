// Applies the saved theme before first paint so dark-mode users never see a light flash.
// Kept tiny and synchronous; app.js takes over once loaded.
(function () {
  var pref = null;
  try { pref = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
  var systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var dark = pref === 'dark' || (pref !== 'light' && systemDark);
  document.documentElement.classList.add(dark ? 'dark' : 'light');
})();
