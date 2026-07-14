/* =====================================================================
   Growth Buddy — Web Push client
   Enable/disable browser push. Fetches the VAPID public key from the server,
   asks the browser for permission, subscribes via the active service worker,
   and registers the subscription with the backend. Degrades quietly when push
   is unsupported or the server has no VAPID keys configured.
   ===================================================================== */

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission() {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Is this browser already subscribed? */
export async function pushSubscribed() {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    return !!(await reg.pushManager.getSubscription());
  } catch (_) {
    return false;
  }
}

/**
 * Turn push on. `api` is the app's fetch wrapper. Returns a status string:
 * 'ok' | 'unsupported' | 'unconfigured' | 'denied' | 'error'.
 */
export async function enablePush(api) {
  if (!pushSupported()) return 'unsupported';
  let info;
  try {
    info = await api('/api/push/public-key');
  } catch (_) {
    return 'error';
  }
  if (!info || !info.configured || !info.publicKey) return 'unconfigured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.publicKey),
      });
    }
    const json = sub.toJSON();
    await api('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys && json.keys.p256dh,
        auth: json.keys && json.keys.auth,
      }),
    });
    return 'ok';
  } catch (_) {
    return 'error';
  }
}

/** Turn push off: unsubscribe locally and tell the server to forget the endpoint. */
export async function disablePush(api) {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }).catch(() => {});
    }
  } catch (_) {
    /* ignore */
  }
}
