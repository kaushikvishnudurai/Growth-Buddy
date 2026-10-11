// index.html ships a static copy of the first-visit sign-up card inside #root so
// it paints before the boot chunk. Any load that will not open on that card must
// never flash it: signed in (gb.token), a returning visitor (gb.session, which
// opens on Sign in), a code waiting to be entered (gb.authDraft) or a deep link
// (#reset...). This tags <html> before the body parses and index.html's one CSS
// rule hides the shell. A classic script in a file, not inline: the CSP is
// script-src 'self'.
// ponytail: a session held only in the Cache API (cookies cleared) still shows
// the shell until the app renders; read the Cache API here if that ever matters.
try {
  if (
    /(?:^|;\s*)gb\.(?:token|session)=/.test(document.cookie) ||
    location.hash.length > 1 ||
    sessionStorage.getItem('gb.authDraft')
  ) {
    document.documentElement.classList.add('gb-no-shell');
  }
} catch (_) {
  document.documentElement.classList.add('gb-no-shell');
}
