/* =====================================================================
   Growth Buddy — Toast bridge
   The toast UI lives in app.js (it owns app state + render), but screen
   modules need to fire toasts from event handlers. app.js imports a real
   module → screens can't import back without a cycle, so this tiny
   late-bound registry breaks it: app.js calls registerToast() at boot,
   screens import { toast } and call it at runtime.
   ===================================================================== */

export const toast = {
  /** Replaced by app.js at boot. Until then, fail safe to the console. */
  error(err) {
    console.error('[toast:error]', err);
  },
  success() {
    /* no-op until registered */
  },
};

export function registerToast(impl) {
  Object.assign(toast, impl);
}
