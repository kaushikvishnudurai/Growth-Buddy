// sockjs-client (CommonJS) references the Node `global`, which doesn't exist in
// the browser. Loaded as a classic script before the module entry. A file rather
// than an inline <script> so the Content-Security-Policy can be script-src 'self'
// (SecurityHeadersFilter) without a hash that breaks whenever this line changes.
window.global = window.global || window;
