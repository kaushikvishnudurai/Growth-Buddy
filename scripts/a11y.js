/* =====================================================================
   Growth Buddy — Global accessibility helpers
   Every modal in the app uses the same shape: a `.gb-modal-overlay`
   wrapping a `.gb-modal[role="dialog"]`, closing when the overlay itself
   is clicked. That uniformity lets us add keyboard a11y once, centrally,
   with no changes at the individual modal call sites:
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

function openOverlays() {
  return Array.from(document.querySelectorAll('.gb-modal-overlay'));
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
      if (t && t.closest && !t.closest('.gb-modal-overlay')) lastFocused = t;
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
        if (node.nodeType === 1 && node.classList?.contains('gb-modal-overlay')) {
          // Move focus into the dialog once it has rendered. A modal that sets
          // its own focus (e.g. an input) runs later and wins — no conflict.
          requestAnimationFrame(() => {
            const dialog = node.querySelector('.gb-modal') || node;
            if (dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
            const target = node.querySelector('[autofocus]') || dialog;
            target?.focus?.();
          });
        }
      }
      for (const node of m.removedNodes) {
        if (node.nodeType === 1 && node.classList?.contains('gb-modal-overlay')) {
          if (lastFocused && document.contains(lastFocused)) {
            const el = lastFocused;
            requestAnimationFrame(() => el.focus?.());
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true });
}
