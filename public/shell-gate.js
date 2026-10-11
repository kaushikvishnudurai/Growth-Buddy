// index.html ships a static sign-in shell inside #root so the sign-in screen
// paints before the boot chunk. A signed-in load (gb.token cookie, written by
// cache-storage.js) or a deep link (#signup, #reset...) must never flash it, so
// this tags <html> before the body parses and index.html's one CSS rule hides
// it. A classic script in a file, not inline: the CSP is script-src 'self'.
// ponytail: a token held only in the Cache API (cookie cleared) still shows the
// shell until the app renders; read the Cache API here if that ever matters.
if (/(?:^|;\s*)gb\.token=/.test(document.cookie) || location.hash.length > 1) {
  document.documentElement.classList.add('gb-no-shell');
}
