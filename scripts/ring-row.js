/* The "Ring like an alarm" switch (Android): Settings › Reminders and the tour
   both show this one. On, a reminder's tone plays on the alarm stream
   (RingService in the mobile repo), so a muted notification volume or an OEM
   sound policy can't swallow it. Under it, while on and Android 14+ has the
   lock-screen ring switched off, the one place that turns that back on. The
   permission is re-read when the page comes back from that system page. */

import { h } from './gb-kit.js';
import { fullScreenStatus, openFullScreenSettings } from './native.js';

/** `on()` reads the pref, `set(bool)` saves it (and re-arms the alarms). */
export function RingRow({ on, set }) {
  const sw = h(
    'button',
    { type: 'button', role: 'switch', 'aria-label': 'Ring reminders like an alarm', class: 'gb-switch' },
    h('span', { class: 'gb-switch-knob' })
  );
  const lock = h(
    'div',
    { class: 'gb-feature-row', hidden: true },
    h(
      'div',
      { class: 'gb-feature-row-text' },
      h('div', { class: 'gb-feature-row-label' }, 'Ring on the lock screen'),
      h('div', { class: 'gb-feature-row-desc' }, 'Shows the ringing reminder over the lock screen. Your phone keeps this switch in its own settings.')
    ),
    h('button', { type: 'button', class: 'gb-btn gb-btn--secondary', onclick: () => openFullScreenSettings() }, 'Open settings')
  );
  const node = h(
    'div',
    { class: 'gb-ring-row' },
    h(
      'div',
      { class: 'gb-feature-row' },
      h(
        'div',
        { class: 'gb-feature-row-text' },
        h('div', { class: 'gb-feature-row-label' }, 'Ring like an alarm'),
        h(
          'div',
          { class: 'gb-feature-row-desc' },
          'Plays the tone at alarm volume until you tap Done or Snooze, or for a minute, so it rings with notification sounds muted or the phone on silent. Off: a normal notification, which some phones keep quiet.'
        )
      ),
      sw
    ),
    lock
  );

  // Only the newest paint draws: two quick taps resolve their status checks in any order.
  let seq = 0;
  async function paint() {
    const mine = ++seq;
    const isOn = on();
    sw.classList.toggle('is-on', isOn);
    sw.setAttribute('aria-checked', isOn ? 'true' : 'false');
    const blocked = isOn && (await fullScreenStatus()) === 'blocked';
    if (mine === seq) lock.hidden = !blocked;
  }
  sw.onclick = () => {
    set(!on());
    paint();
  };
  const onVisible = () => {
    if (!node.isConnected) return document.removeEventListener('visibilitychange', onVisible);
    if (document.visibilityState === 'visible') paint();
  };
  document.addEventListener('visibilitychange', onVisible);
  paint();
  return node;
}
