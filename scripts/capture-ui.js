/* Settings > Money > Automatic capture: one row per source, the consent sheet
   each one opens before it is switched on, and the iPhone Shortcut's setup.
   Lazy (settings.js mounts it through lazyScreen) and it brings its own
   stylesheet. The reading itself is capture.js; the server is CaptureService.

   The consent sheet is Google Play's "prominent disclosure" for notification and
   SMS access, so it must stay in the app, show before Android's own prompt, say
   what is read and why, and need a tap: never skip it on the way to the switch.

   Signature: the specimen. A real-format bank message (or app notification) with
   the parts Growth Buddy keeps lit as marks, in order, and everything else left
   as plain text that stays where it is. It is the privacy card, so it shows on
   every setup screen. */
import '../styles/capture.css';
import { h, Icon, refreshIcons, setThinking } from './gb-kit.js';
import { isNative, capturePlugin, publicSiteUrl } from './native.js';
import { backfillSms, SMS_BACKFILL_DAYS } from './capture.js';

const SHORTCUT_LINK = (import.meta.env && import.meta.env.VITE_CAPTURE_SHORTCUT_URL) || '';

/* Where this page runs decides which sources it can offer. */
function platform() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (isNative() && cap && cap.getPlatform) return cap.getPlatform();
  if (typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent))
    return 'ios-web';
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent))
    return 'android-web';
  return 'web';
}

/* ------------------------------------------------------------------ */
/* The specimen                                                        */
/* ------------------------------------------------------------------ */

/* Each sample: what the message looks like (parts; a kept part is [text, field,
   what Money stores for it]). Anonymised, like the test cases. */
const SAMPLES = {
  sms: {
    shape: 'sms',
    from: 'AX-HDFCBK',
    parts: [
      'Sent ',
      ['Rs.250.00', 'amount', '\u20b9250.00'],
      '\nFrom HDFC Bank A/C *',
      ['1234', 'account', '\u2022\u20221234'],
      '\nTo ',
      ['SWIGGY', 'payee', 'Swiggy'],
      '\nOn ',
      ['20/10/26', 'day', '20 Oct'],
      '\nRef ',
      ['629312345678', 'ref', 'f3a9\u2026'],
      '\nNot You? Call 18002586161',
    ],
  },
  notif: {
    shape: 'notif',
    from: 'PhonePe',
    parts: [
      ['Paid ₹1,200', 'amount', '₹1,200.00'],
      ' to ',
      ['Shoppers Stop', 'payee', 'Shoppers Stop'],
      '\nFrom HDFC Bank ••',
      ['1234', 'account', '••1234'],
    ],
  },
};

const FIELD_LABEL = {
  amount: 'Amount',
  payee: 'Paid to',
  account: 'Last 4 digits of the account',
  day: 'Day',
  ref: 'Reference, kept only as a fingerprint',
};
const FIELD_ORDER = ['amount', 'payee', 'account', 'day', 'ref'];

export function Specimen(kind, { where = 'phone' } = {}) {
  const s = SAMPLES[kind] || SAMPLES.sms;
  let n = 0;
  const marks = {};
  const body = h(
    'p',
    { class: 'gb-cap-msg' },
    s.parts.map((p) => {
      if (typeof p === 'string') return p;
      const [text, field, stored] = p;
      marks[field] = stored;
      return h(
        'mark',
        { class: 'gb-cap-mark', style: { '--i': String(n++) }, 'data-field': field },
        text
      );
    })
  );
  const head =
    s.shape === 'sms'
      ? h(
          'div',
          { class: 'gb-cap-from' },
          h('span', { class: 'gb-cap-sender' }, s.from),
          h('span', null, 'Text message')
        )
      : h(
          'div',
          { class: 'gb-cap-from' },
          h('span', { class: 'gb-cap-app' }, s.from),
          h('span', null, 'Notification')
        );
  const kept = FIELD_ORDER.filter((f) => marks[f]).map((f) =>
    h(
      'div',
      { class: 'gb-cap-kept-row' },
      h('span', { class: 'gb-cap-kept-val' }, marks[f]),
      h('span', { class: 'gb-cap-kept-key' }, FIELD_LABEL[f])
    )
  );
  return h(
    'figure',
    { class: 'gb-cap-specimen is-' + s.shape },
    h('div', { class: 'gb-cap-bubble', 'aria-hidden': 'true' }, head, body),
    h(
      'figcaption',
      { class: 'gb-cap-caption' },
      h('span', null, 'Growth Buddy keeps only the lit parts, as an entry in Money:'),
      h('div', { class: 'gb-cap-kept' }, kept),
      h(
        'span',
        { class: 'gb-cap-rest' },
        where === 'server'
          ? 'Our server reads the message, keeps the lit parts and drops the rest at once. The message is never stored.'
          : 'The message itself is read on this phone and never leaves it.'
      )
    )
  );
}

/* ------------------------------------------------------------------ */
/* Sources                                                              */
/* ------------------------------------------------------------------ */

const SOURCES = {
  notif: {
    icon: 'bell-ring',
    name: 'Payment app alerts',
    lower: 'payment app alerts',
    blurb: 'Google Pay, PhonePe, Paytm, BHIM, CRED and your bank’s app',
    sample: 'notif',
    read: 'Payment notifications from Google Pay, PhonePe, Paytm, BHIM, CRED and the HDFC, ICICI, SBI, Axis and Kotak apps. Nothing from any other app, and nothing that isn’t a payment.',
    ask: 'Next, Android asks you to allow Notification access for Growth Buddy. That switch is Android’s; this one decides what Growth Buddy does with it.',
  },
  sms: {
    icon: 'message-square-text',
    name: 'Bank SMS',
    lower: 'bank SMS',
    blurb: 'Every debit and credit your bank texts you',
    sample: 'sms',
    read: 'Text messages from bank sender IDs (like AX-HDFCBK) that mention an amount. Messages from people are never opened.',
    ask:
      'Next, Android asks for permission to read SMS. The last ' +
      SMS_BACKFILL_DAYS +
      ' days of bank messages are read once, then new ones as they arrive.',
  },
  ios: {
    icon: 'smartphone',
    name: 'iPhone Shortcut',
    lower: 'the iPhone Shortcut',
    blurb: 'A Shortcut on your iPhone passes bank SMS on',
    sample: 'sms',
    where: 'server',
    read: 'Only the messages your Shortcut sends: the ones with the word you pick, like “debited”. iPhone lets no app read your messages by itself.',
    ask: 'Next you get a private key and three steps to set up in the Shortcuts app. It takes about three minutes.',
  },
};

const KEPT_LINE =
  'The amount, who it was paid to, the day, the last 4 digits of the account, and a fingerprint of the reference number, so the same payment arriving twice becomes one entry.';

function facts(src) {
  const s = SOURCES[src];
  const rows = [
    ['What is read', s.read],
    ['What is kept', KEPT_LINE],
    [
      s.where === 'server' ? 'What is never stored' : 'What never leaves this phone',
      s.where === 'server'
        ? 'The message. Our server reads it, keeps the details above and drops it.'
        : 'The message itself. It is read here and only the details above are sent.',
    ],
    [
      'Turning it off',
      'One switch, here. You can also delete everything it added. No bank login is involved at any point.',
    ],
  ];
  return h(
    'dl',
    { class: 'gb-cap-facts' },
    rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])
  );
}

/* The settings section. ctx: {api, openModal, toastSuccess, toastError, pushToast,
   relativeTime, reloadMoney, state}. */
export function CaptureSection(ctx, { heading = true } = {}) {
  const box = h(
    'section',
    heading ? { class: 'gb-cap', 'aria-labelledby': 'gb-cap-title' } : { class: 'gb-cap' }
  );
  const where = platform();
  let server = null;
  let device = null;

  async function load() {
    try {
      server = await ctx.api('/api/capture');
    } catch (_) {
      server = null;
    }
    const plugin = capturePlugin();
    try {
      device = plugin ? await plugin.status() : null;
    } catch (_) {
      device = null;
    }
    paint();
  }

  const isOn = (src) =>
    !!(server && server.sources && server.sources[src] && server.sources[src].enabled);
  const lastSeen = (src) =>
    server && server.sources && server.sources[src] && server.sources[src].lastSeenAt;

  /* What a row says under its name, and what its control is. */
  function rowState(src) {
    const android = where === 'android';
    if (src === 'notif' || src === 'sms') {
      if (!android) return { status: 'In the Android app' };
      if (src === 'sms' && !(device && device.smsAvailable))
        return { status: 'Coming in a later version of the Android app' };
      if (!device) return { status: 'Update the app to use this' };
    }
    const on = isOn(src);
    if (!on) return { status: SOURCES[src].blurb, toggle: true };
    if (src === 'notif' && !device.notifAccess)
      return { status: 'Waiting for Android’s Notification access', toggle: true, fix: 'Allow' };
    if (src === 'sms' && !device.smsGranted)
      return { status: 'Waiting for SMS permission', toggle: true, fix: 'Allow' };
    if (src === 'ios')
      return {
        status: lastSeenLine(src, 'Set up on your iPhone, then send yourself a test'),
        toggle: true,
        fix: 'Set up',
      };
    return { status: lastSeenLine(src, 'On. Nothing read yet'), toggle: true };
  }

  function lastSeenLine(src, none) {
    const at = lastSeen(src);
    return at ? 'On. Last payment ' + ctx.relativeTime(at) : none;
  }

  function sourceRow(src) {
    const s = SOURCES[src];
    const st = rowState(src);
    const on = isOn(src);
    const sw = st.toggle
      ? h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': s.name,
            class: 'gb-switch' + (on ? ' is-on' : ''),
            onclick: () => (on ? openTurnOff(src) : openConsent(src)),
          },
          h('span', { class: 'gb-switch-knob' })
        )
      : null;
    return h(
      'div',
      { class: 'gb-cap-row' + (st.toggle ? '' : ' is-unavailable') },
      h('span', { class: 'gb-cap-row-ic' }, Icon(s.icon, { size: 18 })),
      h(
        'div',
        { class: 'gb-cap-row-text' },
        h('div', { class: 'gb-cap-row-name' }, s.name),
        h('div', { class: 'gb-cap-row-status' + (st.fix ? ' is-waiting' : '') }, st.status),
        st.fix
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--ghost gb-btn--compact gb-cap-fix',
                onclick: () => fixSource(src),
              },
              st.fix
            )
          : null
      ),
      sw
    );
  }

  function shareRow() {
    const can = where === 'android' || where === 'android-web';
    return h(
      'div',
      { class: 'gb-cap-row' + (can ? '' : ' is-unavailable') },
      h('span', { class: 'gb-cap-row-ic' }, Icon('share-2', { size: 18 })),
      h(
        'div',
        { class: 'gb-cap-row-text' },
        h('div', { class: 'gb-cap-row-name' }, 'Share a message'),
        h(
          'div',
          { class: 'gb-cap-row-status' },
          can
            ? 'Long-press a bank SMS, tap Share, then Growth Buddy. Nothing to switch on.'
            : where === 'web'
              ? 'On an Android phone, from the app or the installed web app'
              : 'On Android. On an iPhone, use the Shortcut above'
        )
      )
    );
  }

  function paint() {
    const order =
      where === 'ios' || where === 'ios-web' ? ['ios', 'notif', 'sms'] : ['notif', 'sms', 'ios'];
    const rows = order.map(sourceRow);
    rows.splice(where === 'ios' || where === 'ios-web' ? 1 : 2, 0, shareRow());
    const rupees = !server || server.rupees !== false;
    box.replaceChildren(
      ...[
        heading
          ? h('h3', { class: 'gb-settings-sec-label', id: 'gb-cap-title' }, 'Automatic capture')
          : null,
        heading &&
          h(
            'p',
            { class: 'gb-cap-lede' },
            'Spends fill in from the messages your bank already sends you. No bank login, each source is off until you switch it on, and every entry stays editable.'
          ),
        rupees
          ? null
          : h(
              'p',
              { class: 'gb-cap-note' },
              'Automatic capture reads rupee amounts. Set Money’s currency to ₹ to use it.'
            ),
        h('div', { class: 'gb-cap-rows' + (rupees ? '' : ' is-off') }, rows),
      ].filter(Boolean)
    );
    refreshIcons();
  }

  /* ---------------- switching on ---------------- */

  function openConsent(src) {
    const s = SOURCES[src];
    ctx.openModal({
      title: 'Turn on ' + s.lower + '?',
      sub: s.ask,
      modalClass: 'gb-cap-sheet',
      body: h(
        'div',
        { class: 'gb-cap-consent' },
        Specimen(s.sample, { where: s.where }),
        facts(src)
      ),
      primary: 'Turn on',
      errorMessage: 'Could not turn it on.',
      onPrimary: async () => {
        const res = await ctx.api('/api/capture/' + src, {
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
        });
        server = res;
        const plugin = capturePlugin();
        if (plugin && (src === 'notif' || src === 'sms'))
          device = await plugin.setSources({ [src]: true });
        paint();
        if (src === 'ios') setTimeout(() => openShortcutSetup(res.token), 0);
        else setTimeout(() => fixSource(src), 0);
      },
    });
  }

  async function fixSource(src) {
    const plugin = capturePlugin();
    if (src === 'ios') return openShortcutSetup(null);
    if (!plugin) return;
    if (src === 'notif') {
      if (!device || !device.notifAccess) await plugin.openNotificationAccess();
      return; // back from Android's page: visibilitychange repaints
    }
    if (src === 'sms') {
      const ans = await plugin.requestSms();
      device = await plugin.status();
      paint();
      if (!ans || !ans.granted) {
        ctx.pushToast(
          'SMS permission is off, so nothing is read. You can allow it any time from here.',
          'info'
        );
        return;
      }
      ctx.pushToast(
        'Reading the last ' + SMS_BACKFILL_DAYS + ' days of bank messages…',
        'info',
        2500
      );
      try {
        const r = await backfillSms({ api: ctx.api, money: ctx.state.money });
        if (r && r.added) await ctx.reloadMoney();
        ctx.toastSuccess(
          r && r.added
            ? r.added +
                (r.added === 1 ? ' payment' : ' payments') +
                ' added from your bank messages' +
                (r.merged ? ', ' + r.merged + ' already in Money' : '') +
                '.'
            : 'Nothing new in your bank messages. New ones will fill in on their own.'
        );
      } catch (err) {
        ctx.toastError(err, 'Could not read your bank messages.');
      }
      load();
    }
  }

  /* ---------------- switching off ---------------- */

  function openTurnOff(src) {
    const s = SOURCES[src];
    ctx.openModal({
      title: 'Turn off ' + s.lower + '?',
      sub:
        'Nothing more is read. What it already added stays in Money' +
        (src === 'notif'
          ? '. Android’s Notification access stays on until you turn it off there.'
          : '.'),
      modalClass: 'gb-cap-sheet',
      body: null,
      primary: 'Turn off',
      errorMessage: 'Could not turn it off.',
      onPrimary: () => turnOff(src),
      danger: { label: 'Turn off and delete what it added', onClick: () => confirmDelete(src) },
    });
  }

  async function turnOff(src) {
    server = await ctx.api('/api/capture/' + src, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });
    const plugin = capturePlugin();
    if (plugin && (src === 'notif' || src === 'sms'))
      device = await plugin.setSources({ [src]: false });
    paint();
    if (src === 'notif' && plugin)
      ctx.pushToast('Turned off.', 'success', 6000, {
        label: 'Android settings',
        run: () => plugin.openNotificationAccess(),
      });
    else ctx.toastSuccess('Turned off.');
  }

  function confirmDelete(src) {
    ctx.openModal({
      title: 'Delete what ' + SOURCES[src].lower + ' added?',
      sub: 'Every entry it created goes from Money, and it stays off. Entries you typed yourself are kept, even ones it matched.',
      modalClass: 'gb-cap-sheet',
      body: null,
      primary: 'Delete them',
      destructive: true,
      errorMessage: 'Could not delete them.',
      onPrimary: async () => {
        await turnOff(src);
        const r = await ctx.api('/api/capture/' + src + '/rows', { method: 'DELETE' });
        await ctx.reloadMoney();
        ctx.toastSuccess(
          r.deleted
            ? r.deleted + (r.deleted === 1 ? ' entry deleted.' : ' entries deleted.')
            : 'It had added nothing.'
        );
      },
    });
  }

  /* ---------------- iPhone Shortcut ---------------- */

  function copyField(label, value, { secret = false } = {}) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-btn--compact',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(value);
            ctx.toastSuccess(label + ' copied.');
          } catch (_) {
            ctx.pushToast('Select it and copy it by hand.', 'info');
          }
        },
      },
      Icon('copy', { size: 15 }),
      'Copy'
    );
    return h(
      'div',
      { class: 'gb-cap-copy' },
      h('span', { class: 'gb-cap-copy-label' }, label),
      h('code', { class: 'gb-cap-copy-val' + (secret ? ' is-secret' : '') }, value),
      btn
    );
  }

  function openShortcutSetup(token) {
    const url = publicSiteUrl() + '/api/capture/ios/message';
    const steps = h(
      'ol',
      { class: 'gb-cap-steps' },
      SHORTCUT_LINK
        ? h(
            'li',
            null,
            h('strong', null, 'Add the Shortcut. '),
            'It opens in the Shortcuts app and asks for your key.',
            h(
              'a',
              {
                class: 'gb-btn gb-btn--primary gb-cap-get',
                href: SHORTCUT_LINK,
                target: '_blank',
                rel: 'noopener',
              },
              'Get “Send to Growth Buddy”'
            )
          )
        : h(
            'li',
            null,
            h('strong', null, 'Make the Shortcut. '),
            'In Shortcuts, tap +, add “Get Contents of URL”, and set: the URL below, Method POST, a header X-Capture-Token with your key, and Request Body JSON with one field ',
            h('code', null, 'text'),
            ' set to Shortcut Input.'
          ),
      h(
        'li',
        null,
        h('strong', null, 'Make the automation. '),
        'Automation, +, Message. Message Contains “debited”, then choose Run Immediately and run the Shortcut. Add a second one for “credited” if you want money in too.'
      ),
      h(
        'li',
        null,
        h('strong', null, 'Test it. '),
        'The next bank SMS shows up in Money. The row here says when the last one arrived.'
      )
    );
    const keyBlock = token
      ? h(
          'div',
          { class: 'gb-cap-keys' },
          copyField('Address', url),
          copyField('Your key', token, { secret: true }),
          h(
            'p',
            { class: 'gb-cap-note' },
            'This key is shown once. Anyone with it can add payments to your Money, so keep it in the Shortcut only.'
          )
        )
      : h(
          'div',
          { class: 'gb-cap-keys' },
          copyField('Address', url),
          h(
            'p',
            { class: 'gb-cap-note' },
            'Your key was shown when you switched this on. Lost it? Make a new one; the old one stops working at once.'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost',
              onclick: async (e) => {
                const done = setThinking(e.currentTarget, 'Making');
                try {
                  const r = await ctx.api('/api/capture/ios/token', { method: 'POST' });
                  closeSetup();
                  openShortcutSetup(r.token);
                } catch (err) {
                  ctx.toastError(err, 'Could not make a new key.');
                } finally {
                  done();
                }
              },
            },
            Icon('refresh-cw', { size: 15 }),
            'Make a new key'
          )
        );
    const closeSetup = ctx.openModal({
      title: 'Set up the iPhone Shortcut',
      sub: 'iPhone lets no app read your messages, so a Shortcut you own passes each bank SMS on.',
      modalClass: 'gb-cap-sheet',
      body: h('div', { class: 'gb-cap-setup' }, steps, keyBlock),
      dismiss: 'Done',
    });
  }

  // Back from Android's Notification access or SMS page: say what changed.
  const onVisible = () => {
    if (!box.isConnected) {
      document.removeEventListener('visibilitychange', onVisible);
      return;
    }
    if (!document.hidden) load();
  };
  document.addEventListener('visibilitychange', onVisible);

  if (heading) box.append(h('h3', { class: 'gb-settings-sec-label' }, 'Automatic capture'));
  load();
  return box;
}
