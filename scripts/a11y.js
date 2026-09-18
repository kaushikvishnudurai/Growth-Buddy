/* =====================================================================
   Growth Buddy — Global accessibility helpers
   A modal is anything carrying `role="dialog" aria-modal="true"`, and it
   closes when its outermost box is clicked. Most wrap that dialog in a
   `.gb-modal-overlay`; the celebration overlay is its own outermost box.
   Keying on the ARIA role rather than the class is what makes this
   central: a new overlay cannot opt out of a11y by forgetting a class
   name — which is exactly how the celebration modal lost its focus trap.
   Added once, centrally, with no changes at the modal call sites:
     • Escape closes the topmost modal (reusing its own close path)
     • Tab is trapped inside the open modal
     • focus moves into a modal when it opens and returns to the trigger
       when it closes
   A MutationObserver picks up modals as they're added/removed from <body>.
   ===================================================================== */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/* The element that owns the close: the `.gb-modal-overlay` around the dialog
   when there is one, otherwise the dialog itself. Deduped, because the overlay
   shape puts role="dialog" on the inner sheet and both map to one overlay. */
const MODAL = '[role="dialog"][aria-modal="true"]';

function overlayOf(dialog) {
  return dialog.closest('.gb-modal-overlay') || dialog;
}

function openOverlays() {
  const out = [];
  for (const d of document.querySelectorAll(MODAL)) {
    const o = overlayOf(d);
    if (!out.includes(o)) out.push(o);
  }
  return out;
}

/* A node added to <body> that is, or contains, a modal. */
function overlayIn(node) {
  if (node.nodeType !== 1) return null;
  if (node.matches?.('.gb-modal-overlay')) return node;
  const d = node.matches?.(MODAL) ? node : node.querySelector?.(MODAL);
  return d ? overlayOf(d) : null;
}

function topOverlay() {
  const all = openOverlays();
  return all.length ? all[all.length - 1] : null;
}

// Reuse each modal's own close path: it closes when the overlay element is the
// click target, so a synthetic click on the overlay triggers exactly that.
function requestClose(overlay) {
  overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

let lastFocused = null;

export function initA11y() {
  // Remember the last focus outside any modal so we can restore it on close.
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target;
      if (t && t.closest && !t.closest('.gb-modal-overlay, ' + MODAL)) lastFocused = t;
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    const overlay = topOverlay();
    if (!overlay) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose(overlay);
      return;
    }

    if (e.key === 'Tab') {
      const items = focusable(overlay);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !overlay.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        const overlay = overlayIn(node);
        if (overlay) {
          // Move focus into the dialog once it has rendered. A modal that sets
          // its own focus (e.g. an input) runs later and wins — no conflict.
          requestAnimationFrame(() => {
            const dialog = overlay.querySelector('.gb-modal') || overlay;
            if (dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
            const target = overlay.querySelector('[autofocus]') || dialog;
            target?.focus?.();
          });
        }
      }
      for (const node of m.removedNodes) {
        if (overlayIn(node) && lastFocused && document.contains(lastFocused)) {
          const el = lastFocused;
          requestAnimationFrame(() => el.focus?.());
        }
      }
    }
  });
  observer.observe(document.body, { childList: true });
}
