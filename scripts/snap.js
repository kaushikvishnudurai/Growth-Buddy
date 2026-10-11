/* One camera button that routes itself: take a photo, and it lands in Money
   (receipt), Food (plate) or the pantry (groceries).

   The sheet opens the moment the photo is taken with all three choices; the
   AI's guess (/api/photo/route, <= ROUTE_MS) only highlights one of them. No
   AI, a timeout or an unknown answer leaves none highlighted: the no-AI
   fallback is the same three-choice picker, one tap either way.

   ponytail: auto-routing without the confirm tap is skipped, because a misroute
   costs a second paid vision call. Add it once route accuracy is measured. */
import { h, Icon, openOverlay, refreshIcons } from './gb-kit.js';

export const KINDS = [
  {
    kind: 'receipt',
    icon: 'receipt',
    label: 'Receipt',
    sub: 'Read the items into Money',
    guess: 'Looks like a receipt',
  },
  {
    kind: 'plate',
    icon: 'utensils',
    label: 'Meal',
    sub: 'Estimate it and log it in Food',
    guess: 'Looks like a meal',
  },
  {
    kind: 'groceries',
    icon: 'sprout',
    label: 'Groceries',
    sub: 'Add what you see to the pantry',
    guess: 'Looks like groceries',
  },
];
const ROUTE_MS = 4000;

/** The server's guess, whitelisted: anything but the three kinds is "no guess". */
export function pickDefault(kind) {
  return KINDS.some((k) => k.kind === kind) ? kind : null;
}

/**
 * shrink(file) -> Promise<dataUrl>; api(path, init) -> Promise<json>;
 * routes: { receipt(file, shrunk), plate(file, shrunk), groceries(file, shrunk) },
 * where shrunk is the Promise of the shrunk data URL (shared, so it runs once).
 */
export function openSnap({ shrink, api, routes }) {
  const input = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    hidden: true,
  });
  const drop = () => input.remove();
  input.addEventListener('cancel', drop);
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    drop();
    if (file) pick(file);
  });
  document.body.appendChild(input);
  input.click();

  function pick(file) {
    const { sheet, close } = openOverlay({ label: 'Where should this photo go?' });
    const title = h('div', { class: 'gb-modal-title' }, 'Where should this go?');
    const sub = h('div', { class: 'gb-modal-sub' }, 'Reading the photo. Pick one any time.');
    const shrunk = shrink(file);
    const buttons = KINDS.map((k) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-modal-opt',
          onclick: () => {
            close();
            routes[k.kind](file, shrunk);
          },
        },
        h('span', { class: 'gb-modal-opt-ic' }, Icon(k.icon, { size: 18 })),
        h(
          'span',
          { class: 'gb-modal-opt-tx' },
          h('span', { class: 'gb-modal-opt-l' }, k.label),
          h('span', { class: 'gb-modal-opt-s' }, k.sub)
        )
      )
    );
    sheet.append(
      h('div', { class: 'gb-modal-head' }, title, sub),
      h('div', { class: 'gb-modal-opts' }, ...buttons),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
        'Cancel'
      )
    );
    refreshIcons();

    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ROUTE_MS));
    const guess = shrunk
      .then((imageDataUrl) =>
        api('/api/photo/route', { method: 'POST', body: JSON.stringify({ imageDataUrl }) })
      )
      .then((r) => pickDefault(r && r.kind));
    Promise.race([guess, timeout])
      .catch(() => null)
      .then((kind) => {
        if (!sheet.isConnected) return;
        const i = KINDS.findIndex((k) => k.kind === kind);
        if (i < 0) {
          sub.textContent = 'Pick where it goes.';
          return;
        }
        title.textContent = KINDS[i].guess;
        sub.textContent = 'Tap to confirm, or pick another.';
        buttons[i].classList.add('is-on');
        buttons[i].focus();
      });
  }
}
