// Applies the saved theme before first paint so dark-mode users never see a light flash.
// Also restores the saved UI language on <html lang> before first paint; i18n.js/applyStatic
// translate the visible text once app.js loads. Kept tiny and synchronous.
(function () {
  var pref = null;
  try { pref = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
  var systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var dark = pref === 'dark' || (pref !== 'light' && systemDark);
  document.documentElement.classList.add(dark ? 'dark' : 'light');
  try {
    if (localStorage.getItem('owlaso_lang') === 'tr') document.documentElement.lang = 'tr';
  } catch (e) { /* storage unavailable */ }
})();
