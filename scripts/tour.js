/* =====================================================================
   Growth Buddy — the first-run tour
   A new account's walk through reminders before first-run setup: what the app
   is, a first reminder made for real, repeats, Done and Snooze on the card,
   then the permissions with the reason for each, asked only here and only on a
   tap. Lazy (app.js openTour), so it never joins the boot chunk. app.js hands
   in what it owns (adding a reminder, the push flow, prefs) and records
   `tourDone` when it closes, by any way out. Settings › Reminders replays it.
   ===================================================================== */

import { h, Icon, refreshIcons, openOverlay, segmented } from './gb-kit.js';
import { addDays } from './dates.js';
import { canRingLikeAlarm } from './native.js';
import { firstSlot } from './app-logic.js';
import { pushSupported, pushSubscribed } from './push.js';

/**
 * Open the tour. `ctx`: { todayKey, nowHHMM (the account's clock),
 * addReminder(key, text, time) -> created|null, enablePushFlow(msg) -> bool,
 * saveUiPrefs, snoozeMinutes(), minutesLabel(m), ringRow() (the Settings
 * switch, ring-row.js), replay, onClose() }.
 */
export function openTour(ctx) {
  const { sheet, close } = openOverlay({
    label: 'Welcome to Growth Buddy',
    className: 'gb-setup-modal gb-tour',
    onClose: ctx.onClose,
  });

  const steps = [welcomeStep, reminderStep, repeatStep, snoozeStep, alertsStep, doneStep];
  let at = 0;
  const stepLabel = h('div', { class: 'gb-setup-count' });
  const dots = h('div', { class: 'gb-setup-dots', 'aria-hidden': 'true' }, ...steps.map(() => h('span', { class: 'gb-setup-dot' })));
  const titleEl = h('div', { class: 'gb-modal-title', tabindex: '-1' });
  const subEl = h('div', { class: 'gb-modal-sub' });
  const bodyEl = h('div', { class: 'gb-modal-body' });
  const primaryBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--primary gb-tour-next' });
  const skipBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel' });
  sheet.append(
    h('div', { class: 'gb-modal-head' }, h('div', { class: 'gb-setup-top' }, stepLabel, dots), titleEl, subEl),
    bodyEl,
    primaryBtn,
    skipBtn
  );

  function next() {
    if (at >= steps.length - 1) return close();
    at += 1;
    show();
  }

  function show() {
    const s = steps[at]();
    stepLabel.textContent = 'Step ' + (at + 1) + ' of ' + steps.length;
    [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i <= at));
    titleEl.textContent = s.title;
    subEl.textContent = s.sub;
    bodyEl.replaceChildren(s.body);
    primaryBtn.textContent = s.primary;
    primaryBtn.disabled = false;
    // A step's own check answers false to stay put; it has said why itself.
    primaryBtn.onclick = async () => {
      primaryBtn.disabled = true;
      const ok = s.onPrimary ? await s.onPrimary() : true;
      primaryBtn.disabled = false;
      if (ok !== false) next();
    };
    // The last step has nothing to skip to; the whole tour is skippable before it.
    skipBtn.hidden = !s.skip;
    skipBtn.textContent = s.skip || '';
    skipBtn.onclick = s.skip === 'Skip the tour' ? close : next;
    refreshIcons();
    titleEl.focus({ preventScroll: true });
  }

  const badge = (icon) => h('div', { class: 'gb-setup-badge' }, Icon(icon, { size: 22, sw: 2.2 }));
  const point = (icon, text) => h('li', { class: 'gb-tour-point' }, Icon(icon, { size: 16, sw: 2.4 }), h('span', null, text));

  function welcomeStep() {
    return {
      title: 'Welcome to Growth Buddy',
      sub: 'Your day in one place. A minute to show you around.',
      body: h(
        'div',
        null,
        badge('sparkles'),
        h(
          'ul',
          { class: 'gb-tour-points' },
          point('bell', 'Reminders that ring on time, even with the app closed.'),
          point('repeat', 'Repeats for anything regular, from daily to once a year.'),
          point('list-checks', 'Habits, tasks and goals, all on Home.')
        )
      ),
      primary: 'Show me',
      skip: 'Skip the tour',
    };
  }

  function reminderStep() {
    const today = ctx.todayKey();
    const text = h('input', { id: 'gb-tour-text', class: 'gb-input', type: 'text', maxlength: '255', placeholder: 'Call Mum' });
    const slot = firstSlot(ctx.nowHHMM());
    const time = h('input', { id: 'gb-tour-time', class: 'gb-input', type: 'time', value: slot.time });
    const tomorrow = addDays(today, 1);
    let day = slot.tomorrow ? tomorrow : today;
    const dayPick = segmented(
      [
        { value: today, label: 'Today' },
        { value: tomorrow, label: 'Tomorrow' },
      ],
      day,
      (v) => (day = v)
    );
    const err = h('div', { class: 'gb-field-error', role: 'alert' });
    text.oninput = () => (err.textContent = '');
    return {
      title: 'Your first reminder',
      sub: 'Type what to remember and when. It is a real one: you will find it on Home and in Calendar.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('label', { class: 'gb-field-label', for: 'gb-tour-text' }, 'Remind me to'),
        text,
        h('div', { class: 'gb-field-label' }, 'Day'),
        dayPick.node,
        h('label', { class: 'gb-field-label', for: 'gb-tour-time' }, 'At'),
        time,
        err
      ),
      primary: 'Add reminder',
      onPrimary: async () => {
        err.textContent = '';
        if (!text.value.trim()) {
          err.textContent = 'Type what to remind you about, or skip this step.';
          text.focus();
          return false;
        }
        // addReminder says what went wrong (a time already past) in its own toast.
        return !!(await ctx.addReminder(day, text.value.trim(), time.value || null));
      },
      skip: 'Skip this step',
    };
  }

  function repeatStep() {
    const row = (rule, example) => h('li', { class: 'gb-tour-rule' }, h('b', null, rule), h('span', null, example));
    return {
      title: 'Repeats',
      sub: 'Set a repeat when you add or edit a reminder. Ticking one day off leaves the next one ringing.',
      body: h(
        'ul',
        { class: 'gb-tour-rules' },
        row('Every day', 'Take vitamins, 08:00'),
        row('Working days', 'Stand-up, 09:30'),
        row('Every 2 weeks on Fri', 'Pay the cleaner'),
        row('Every year', 'Anna’s birthday, 14 Feb')
      ),
      primary: 'Next',
      skip: 'Skip the tour',
    };
  }

  function snoozeStep() {
    const mins = ctx.minutesLabel(ctx.snoozeMinutes());
    return {
      title: 'Done and Snooze',
      sub: 'Every reminder rings with two buttons. You don’t need to open the app.',
      body: h(
        'div',
        null,
        h(
          'div',
          { class: 'gb-tour-card', 'aria-hidden': 'true' },
          h('div', { class: 'gb-tour-card-head' }, Icon('bell', { size: 14, sw: 2.4 }), 'Growth Buddy'),
          h('div', { class: 'gb-tour-card-title' }, 'Call Mum'),
          h('div', { class: 'gb-tour-card-acts' }, h('span', null, 'Done'), h('span', null, 'Snooze ' + mins))
        ),
        h(
          'ul',
          { class: 'gb-tour-points' },
          point('check', 'Done ticks off today’s; a repeat still rings next time.'),
          point('alarm-clock', 'Snooze rings again in ' + mins + '. Change the length in Settings › Reminders.')
        )
      ),
      primary: 'Next',
      skip: 'Skip the tour',
    };
  }

  function alertsStep() {
    const notify = h('div');
    const perm = (label, why, control) =>
      h('div', { class: 'gb-feature-row' }, h('div', { class: 'gb-feature-row-text' }, h('div', { class: 'gb-feature-row-label' }, label), h('div', { class: 'gb-feature-row-desc' }, why)), control);

    let seq = 0; // only the newest paint draws
    async function paintNotify() {
      const mine = ++seq;
      const on = await pushSubscribed().catch(() => false);
      if (mine !== seq) return;
      notify.replaceChildren(
        perm(
          'Notifications',
          'So a reminder reaches you with the app closed. Asked only when you tap.',
          on
            ? h('span', { class: 'gb-tour-on' }, Icon('check', { size: 14, sw: 2.6 }), 'On')
            : h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--secondary',
                  onclick: async () => {
                    ctx.saveUiPrefs({ pushAsked: true });
                    await ctx.enablePushFlow('Notifications on.');
                    paintNotify();
                  },
                },
                'Turn on'
              )
        )
      );
      refreshIcons();
    }
    const rows = [];
    if (pushSupported()) {
      rows.push(notify);
      paintNotify();
    }
    if (canRingLikeAlarm()) rows.push(ctx.ringRow());
    if (!rows.length) rows.push(h('p', { class: 'gb-setup-text' }, 'This browser can’t show notifications. Reminders still appear in the app and on WhatsApp.'));
    return {
      title: 'How reminders reach you',
      sub: 'Each one says why it is needed. You can change them later in Settings.',
      body: h('div', { class: 'gb-tour-perms' }, ...rows),
      primary: 'Next',
      skip: 'Not now',
    };
  }

  function doneStep() {
    return {
      title: 'You’re ready',
      sub: ctx.replay
        ? 'That’s the tour. It is in Settings › Reminders whenever you want it again.'
        : 'Next, pick what you want to work on, and we’ll set up a few habits for it.',
      body: badge('check'),
      primary: 'Let’s go',
    };
  }

  show();
  return close;
}
