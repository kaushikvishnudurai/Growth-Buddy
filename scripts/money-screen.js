/* The Money screen with its stylesheet. Every lazy import of Money goes
   through here, so money.css (58 kB) leaves the render-blocking boot CSS and
   loads with the chunk; Vite waits for it before the import resolves, so the
   screen never paints unstyled. money.js itself stays CSS-free because the
   node tests import it. */
import '../styles/money.css';
export * from './money.js';
