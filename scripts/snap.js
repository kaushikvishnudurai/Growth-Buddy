/* One camera button that routes itself: take a photo, and it lands in Money
   (receipt), Food (plate) or the pantry (groceries).

   The sheet opens the moment the photo is taken with all three choices. One AI
   call (/api/photo/read) both guesses the kind and reads the photo as that
   kind: the guess highlights a choice, and tapping it opens that screen with
   the reading already done. A choice the AI didn't make reads the photo with
   its own reader (a second call). No AI or an unknown answer leaves none
   highlighted: the no-AI fallback is the same picker, one tap either way.

   ponytail: auto-routing without the confirm tap is skipped; a misroute still
   needs the user's eye. Add it once guess accuracy is measured. */
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
/** The server's guess, whitelisted: anything but the kinds offered is "no guess". */
export function pickDefault(kind, kinds = KINDS) {
  return kinds.some((k) => k.kind === kind) ? kind : null;
}

/** /api/photo/read's answer for `kind`, or null when it read the photo as something else (or not at all). */
export function readFor(kind, answer) {
  return (answer && answer.kind === kind && answer[kind]) || null;
}

/** The choices to offer: only kinds with a route (a feature switched off has none). */
export function kindsFor(routes) {
  return KINDS.filter((k) => routes && typeof routes[k.kind] === 'function');
}

/**
 * shrink(file) -> Promise<dataUrl>; read(dataUrl, kinds) -> Promise<{kind, [kind]: answer}>
 * (/api/photo/read); routes: { receipt, plate, groceries }, each (file, shrunk, done)
 * where shrunk is the Promise of the shrunk data URL (shared, so it runs once)
 * and done the Promise of that kind's reading, or null (then the route reads it
 * itself). A kind left out of routes is not offered. Call it straight from the
 * tap: the file picker needs the user's gesture, which an await before it would lose.
 */
export function openSnap({ shrink, read, routes }) {
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
    if (file) routePhoto(file, { shrink, read, routes });
  });
  document.body.appendChild(input);
  input.click();
}

/**
 * The "Where should this go?" sheet for a photo already in hand: the camera's
 * (openSnap) or one another app shared in (app.js handleSharedImage).
 */
export function routePhoto(file, { shrink, read, routes }) {
  const { sheet, close } = openOverlay({ label: 'Where should this photo go?' });
  const title = h('div', { class: 'gb-modal-title' }, 'Where should this go?');
  const sub = h('div', { class: 'gb-modal-sub' }, 'Reading the photo. Pick one any time.');
  const shrunk = shrink(file);
  const kinds = kindsFor(routes);
  // The one call: which kind, and that kind's reading. Started before any tap.
  const answer = shrunk.then((imageDataUrl) => read(imageDataUrl, kinds.map((k) => k.kind))).catch(() => null);
  const buttons = kinds.map((k) =>
    h(
      'button',
      {
        type: 'button',
        class: 'gb-modal-opt',
        onclick: () => {
          close();
          routes[k.kind](file, shrunk, answer.then((a) => readFor(k.kind, a)));
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

  answer
    .then((a) => pickDefault(a && a.kind, kinds))
    .then((kind) => {
      if (!sheet.isConnected) return;
      const i = kinds.findIndex((k) => k.kind === kind);
      if (i < 0) {
        sub.textContent = 'Pick where it goes.';
        return;
      }
      title.textContent = kinds[i].guess;
      sub.textContent = 'Tap to confirm, or pick another.';
      buttons[i].classList.add('is-on');
      buttons[i].focus();
    });
}
