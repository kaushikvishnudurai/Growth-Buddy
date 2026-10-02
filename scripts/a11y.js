/* =====================================================================
   Growth Buddy — Global accessibility helpers
   A modal is anything carrying `aria-modal="true"` — dialog or alertdialog
   — and it closes when its outermost box is clicked. Most wrap that dialog
   in a `.gb-modal-overlay`; the celebration overlay is its own outermost
   box. Keying on the ARIA attribute rather than a class is what makes this
   central: a new overlay cannot opt out of a11y by forgetting a class name,
   which is how the celebration modal and the confirm dialog both ended up
   outside the focus trap carrying their own Escape handlers.
   Added once, centrally, with no changes at the modal call sites:
     • Escape closes the topmost modal (reusing its own close path)
     • Tab is trapped inside the open modal
     • focus moves into a modal when it opens and returns to the trigger
       when it closes
     • each form control is named from the .gb-field-label before it
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
const MODAL = '[aria-modal="true"]';

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

/* Forms here put a `div.gb-field-label` before the control and never tie the
   two, so a date or time input read as just "edit text". Name each control from
   its label once the dialog renders.
   ponytail: runs once per modal open; a field a dialog adds later stays unnamed —
   make gb-field-label a real <label for> at the call sites if that bites. */
function nameFields(root) {
  for (const lab of root.querySelectorAll('.gb-field-label')) {
    const next = lab.nextElementSibling;
    if (!next) continue;
    // A segmented picker (Paid from, Tag) is a radiogroup div: it takes the
    // label as its group name, the way a fieldset takes a legend.
    const ctl = next.matches('input, select, textarea, [role=radiogroup], [role=group]')
      ? next
      : next.querySelectorAll('input, select, textarea').length === 1
        ? next.querySelector('input, select, textarea')
        : null;
    if (ctl && !ctl.labels?.length && !ctl.hasAttribute('aria-label') && !ctl.hasAttribute('aria-labelledby')) {
      ctl.setAttribute('aria-label', lab.textContent.trim());
    }
  }
}

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
            nameFields(overlay);
            const target = overlay.querySelector('[autofocus]') || dialog;
            target?.focus?.();
          });
        }
      }
      for (const node of m.removedNodes) {
        if (overlayIn(node) && lastFocused && document.contains(lastFocused)) {
          const el = lastFocused;
          // Not while another modal is up: Quick add → Task opens the second
          // sheet before the first finishes animating out, and this used to pull
          // focus back to the header button behind the new one.
          requestAnimationFrame(() => topOverlay() || el.focus?.());
        }
      }
    }
  });
  observer.observe(document.body, { childList: true });
}
