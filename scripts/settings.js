/* =====================================================================
   Growth Buddy — Settings (the profile sheet and every pane in it)
   A lazy chunk: app.js's openProfileSettings() imports this on the first tap,
   so ~60 kB of minified code that only runs after a tap stays out of the boot
   chunk. The code was moved out of app.js intact; what it used from app.js
   arrives as one context object (app.js settingsContext()) and is bound to
   the same names below, so the bodies read exactly as they did there.
   Never import this statically from a boot module, or the split is undone.
   ===================================================================== */
import {
  h,
  NAV_CATALOG,
  resolveNavLayout,
  refreshIcons,
  Icon,
  openOverlay,
  shakeRefusal,
  formatTime,
  setTimeFormat,
  detectTimeFormat,
  setThinking,
  rovingGroup,
  focusSoon,
  visibleText,
} from './gb-kit.js';
import { BREAK_LENGTHS, MAX_BREAK_DAYS, breakState } from './break.js';
import { HOME_WIDGETS, resolveHomeLayout } from './dashboard.js';
import {
  snoozeLabel,
  describeRepeat,
  isPastSlot,
  setDefaultLead,
  getDefaultLead,
  LEAD_OPTIONS,
  leadLabel,
  minutesLabel,
  TAGS,
} from './calendar.js';
import { WORK_WEEKS, getWorkWeek, setWorkWeek, occursOn } from './recurrence.js';
import { disablePush, pushSubscribed, pushSupported, pushTestLocal } from './push.js';
import { CacheStorage } from './cache-storage.js';
import { latestSeq } from './app-logic.js';
import { localNotificationsAvailable, nativePlugin } from './native.js';
import { offerFile } from './save-file.js';
import {
  CUSTOM_MAX_BYTES,
  CUSTOM_MAX_COUNT,
  CUSTOM_MAX_MS,
  DEFAULT_CHIME,
  canRecordChime,
  chimeOptions,
  customChimes,
  customKey,
  playChime,
  previewChime,
  readCustomChime,
  recordCustomChime,
  stopChime,
} from './chime.js';

// Bound from app.js on every open (bind()), before any code below runs.
let PREMIUM_KEY,
  loadPremiumCss,
  applyPremium,
  TEXT_SCALE_KEY,
  applyTextScale,
  state,
  pushToast,
  toastError,
  toastSuccess,
  loadToken,
  saveSession,
  cacheMoney,
  rememberMoneyVersion,
  adoptServerMoney,
  persistMoney,
  saveMoney,
  saveUiPrefs,
  notifySound,
  readCustomChimes,
  storeCustomChimes,
  newSoundId,
  todayKey,
  syncUserSession,
  enablePushFlow,
  api,
  withPendingWater,
  invalidateWeek,
  pickedTheme,
  setThemeChoice,
  notifyMuted,
  keyOfDate,
  shortDay,
  reminderQuickAdd,
  uploadNewCustomSound,
  openIcsImportDialog,
  snoozeMinutes,
  cancelReminderSnooze,
  waterReminderPrefs,
  reSyncDeviceAlarms,
  deleteReminder,
  openModal,
  segmented,
  relativeTime,
  FEATURE_DEFS,
  featureOn,
  featureSwitchRow,
  lazyScreen,
  repaintOverlays,
  privacyLink,
  otpBoxes,
  logout,
  endSession,
  breakPrefs,
  breakUntilLabel,
  takeBreak,
  endBreakNow,
  render;
function bind(ctx) {
  ({
    PREMIUM_KEY,
    loadPremiumCss,
    applyPremium,
    TEXT_SCALE_KEY,
    applyTextScale,
    state,
    pushToast,
    toastError,
    toastSuccess,
    loadToken,
    saveSession,
    cacheMoney,
    rememberMoneyVersion,
    adoptServerMoney,
    persistMoney,
    saveMoney,
    saveUiPrefs,
    notifySound,
    readCustomChimes,
    storeCustomChimes,
    newSoundId,
    todayKey,
    syncUserSession,
    enablePushFlow,
    api,
    withPendingWater,
    invalidateWeek,
    pickedTheme,
    setThemeChoice,
    notifyMuted,
    keyOfDate,
    shortDay,
    reminderQuickAdd,
    uploadNewCustomSound,
    openIcsImportDialog,
    snoozeMinutes,
    cancelReminderSnooze,
    waterReminderPrefs,
    reSyncDeviceAlarms,
    deleteReminder,
    openModal,
    segmented,
    relativeTime,
    FEATURE_DEFS,
    featureOn,
    featureSwitchRow,
    lazyScreen,
    repaintOverlays,
    privacyLink,
    otpBoxes,
    logout,
    endSession,
    breakPrefs,
    breakUntilLabel,
    takeBreak,
    endBreakNow,
    render,
  } = ctx);
}

/** Entry point: app.js openProfileSettings(initialTab). */
export function openSettings(ctx, initialTab) {
  bind(ctx);
  openProfileSettings(initialTab);
}

/** Repaint the Settings reminder list if it is on screen; a no-op otherwise. */
export function repaintReminderSettings() {
  if (reminderSettingsPaint) reminderSettingsPaint();
}

function setTextScale(scale) {
  state.textScale = applyTextScale(scale);
  try {
    CacheStorage.setItem(TEXT_SCALE_KEY, state.textScale);
  } catch (_) {}
  saveUiPrefs({ textScale: state.textScale });
  render();
}

/* Always '12' or '24'. Read from ui_prefs so it travels with the account rather
   than living on one device. An account with nothing stored yet — or one still
   carrying the old 'auto' — answers with this device's format, and
   hydrateUiPrefs() writes that answer back so the next load reads it from the
   server like every other preference. */
function timeFormatPref() {
  const p = state.user && state.user.uiPrefs;
  return p && (p.timeFormat === '12' || p.timeFormat === '24') ? p.timeFormat : detectTimeFormat();
}

function togglePremium() {
  const apply = () => {
    state.premium = !state.premium;
    applyPremium(state.premium);
    try {
      CacheStorage.setItem(PREMIUM_KEY, state.premium ? '1' : '0');
    } catch (_) {}
    saveUiPrefs({ premium: state.premium });
    toastSuccess(state.premium ? 'Premium look on.' : 'Back to the classic look.');
    render();
  };
  // Every surface changes at once, so cut-to-black reads as a glitch. A view
  // transition cross-fades the old frame into the new one; browsers without it
  // just get the instant swap. ponytail: no library, no manual snapshotting.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const run = () => {
    if (document.startViewTransition && !reduce) document.startViewTransition(apply);
    else apply();
  };
  // Turning it on: fetch the skin first, so the transition's new frame has it.
  if (state.premium) run();
  else loadPremiumCss().then(run, () => toastError(null, 'Could not load the premium look.'));
}

async function saveProfileDetails(payload) {
  const updated = await api('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  syncUserSession(updated);
  // The tracker reads this same goal; refetch so Home shows it without a reload.
  const water = await api('/api/water').catch(() => null);
  if (water) state.water = withPendingWater(water);
  // Weight, fitness goal and both daily goals all feed the Summary's targets.
  invalidateWeek();
  toastSuccess('Changes saved.');
  render();
  return updated;
}

// Country dial codes for the phone-number picker. India first (default).
const COUNTRY_CODES = [
  { d: '91', flag: '🇮🇳', name: 'India' },
  { d: '1', flag: '🇺🇸', name: 'United States' },
  { d: '1', flag: '🇨🇦', name: 'Canada' },
  { d: '44', flag: '🇬🇧', name: 'United Kingdom' },
  { d: '971', flag: '🇦🇪', name: 'UAE' },
  { d: '65', flag: '🇸🇬', name: 'Singapore' },
  { d: '61', flag: '🇦🇺', name: 'Australia' },
  { d: '60', flag: '🇲🇾', name: 'Malaysia' },
  { d: '49', flag: '🇩🇪', name: 'Germany' },
  { d: '33', flag: '🇫🇷', name: 'France' },
  { d: '81', flag: '🇯🇵', name: 'Japan' },
  { d: '86', flag: '🇨🇳', name: 'China' },
  { d: '966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { d: '880', flag: '🇧🇩', name: 'Bangladesh' },
  { d: '94', flag: '🇱🇰', name: 'Sri Lanka' },
];

/** Split an E.164 string into (dial, local) by longest-prefix match. */
function splitDial(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits) {
    const byLen = COUNTRY_CODES.slice().sort((a, b) => b.d.length - a.d.length);
    const hit = byLen.find((co) => digits.startsWith(co.d) && digits.length > co.d.length);
    if (hit) {
      return { dial: hit.d, local: digits.slice(hit.d.length) };
    }
  }
  return { dial: '91', local: digits };
}

/**
 * Country code and last four digits; the middle masked. Enough to recognise
 * your own number, not enough for someone reading over your shoulder — the
 * settings panel is open on a screen far more often than it is edited.
 */
function maskPhone(number) {
  const { dial, local } = splitDial(number);
  if (local.length <= 4) {
    return '+' + dial + ' ' + local;
  }
  return '+' + dial + ' ' + '\u2022'.repeat(local.length - 4) + local.slice(-4);
}

/**
 * A country-code dropdown + local-number field. Users pick their country
 * so they can't forget the dial code (which previously produced broken
 * numbers like +6374044117). `getValue()` returns a full E.164 string.
 */
function CountryPhoneInput(prefill) {
  const { dial: dial0, local: local0 } = splitDial(prefill);
  let dial = dial0,
    local = local0;

  const sel = h('select', { class: 'gb-input gb-phone-cc', 'aria-label': 'Country code' });
  COUNTRY_CODES.forEach((co) => {
    const o = h('option', { value: co.d }, co.flag + ' ' + co.name + ' (+' + co.d + ')');
    // Select the first option matching the parsed dial code.
    if (co.d === dial && !sel.querySelector('option[selected]')) o.selected = true;
    sel.appendChild(o);
  });

  const numIn = h('input', {
    type: 'tel',
    class: 'gb-input gb-phone-num',
    inputmode: 'numeric',
    autocomplete: 'tel-national',
    placeholder: '98765 43210',
    maxlength: '15',
    value: local,
  });

  const el = h('div', { class: 'gb-phone-input' }, sel, numIn);
  return {
    el,
    focus: () => numIn.focus(),
    getValue: () => {
      const localDigits = (numIn.value || '').replace(/\D/g, '').replace(/^0+/, '');
      return localDigits ? '+' + sel.value + localDigits : '';
    },
  };
}

/* Segmented "slider": a track of segments with a brand thumb that glides to
   the active one, showing its pane. `slides` = [{ id, label, pane }]. Returns
   the bar element; panes are toggled by display. */
let segSliderCount = 0;

function buildSegSlider(slides, initialId) {
  const btnMap = {};
  const thumb = h('div', { class: 'gb-segnav-thumb' });
  thumb.style.width = 'calc((100% - 8px) / ' + slides.length + ')';
  let current = initialId;
  /* Tabs are sized by their labels (six equal ones cut "Reminders" to
     "Reminde" on a phone), so the thumb measures the tab it sits under. Until
     the bar is laid out there is nothing to measure, and the equal-share guess
     stands in; the observer below corrects it on first layout and on resize. */
  const move = (id) => {
    current = id;
    const btn = btnMap[id];
    if (btn && btn.offsetWidth) {
      thumb.style.width = btn.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + (btn.offsetLeft - 4) + 'px)';
      return;
    }
    thumb.style.transform = 'translateX(' + slides.findIndex((t) => t.id === id) * 100 + '%)';
  };
  const bar = h('div', { class: 'gb-segnav', role: 'tablist' }, thumb);
  const uid = 'gb-seg' + ++segSliderCount;
  slides.forEach(({ id, label, pane }) => {
    // Tab and pane name each other, as the tablist role promises.
    if (pane) {
      pane.id = uid + '-pane-' + id;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', uid + '-tab-' + id);
    }
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: uid + '-tab-' + id,
        'aria-controls': pane ? pane.id : null,
        'aria-selected': id === initialId ? 'true' : 'false',
        class: 'gb-segnav-btn' + (id === initialId ? ' is-active' : ''),
        onclick: () => {
          slides.forEach((t) => {
            if (t.pane) t.pane.style.display = 'none';
            btnMap[t.id].classList.remove('is-active');
            btnMap[t.id].setAttribute('aria-selected', 'false');
          });
          const cur = slides.find((t) => t.id === id);
          if (cur.pane) cur.pane.style.display = '';
          btn.classList.add('is-active');
          btn.setAttribute('aria-selected', 'true');
          // The bar scrolls sideways on a narrow phone: bring a half-hidden tab in.
          btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          move(id);
        },
      },
      label
    );
    btnMap[id] = btn;
    bar.appendChild(btn);
  });
  slides.forEach((t) => {
    if (t.pane) t.pane.style.display = t.id === initialId ? '' : 'none';
  });
  move(initialId);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => move(current)).observe(bar);
  return rovingGroup(bar);
}

/* ---- Settings panes that shape the app itself ----
   These used to be their own "Customise" modal, so the app had two settings
   doors and no way to guess which held what (dark mode behind one, notification
   prefs behind the other). Now they're just panes; `openProfileSettings` mounts
   them as the Display and Layout tabs of the single Settings modal. */
function customisePanes() {
  const u = state.user || {};

  // Features tab — on/off toggles, persisted instantly.
  const featuresPane = h(
    'div',
    { class: 'gb-settings-pane' },
    h(
      'div',
      { class: 'gb-field-hint' },
      'Turn parts of Growth Buddy on or off. Changes apply instantly.'
    ),
    ...FEATURE_DEFS.map(featureSwitchRow)
  );

  // Home tab — show/hide + reorder home-screen widgets. Saves automatically.
  let homeWorking = resolveHomeLayout(u.homeLayout || null);
  const homeListEl = h('div', { class: 'gb-home-cust-list' });
  const persistHome = () =>
    saveHomeLayout(homeWorking.map((x) => ({ id: x.id, enabled: x.enabled })));
  // The list re-renders on every move, which drops the focused button; put focus back on the
  // same arrow of the row that moved (or its other arrow once it hits the top or bottom).
  const refocusMove = (list, row, delta) => {
    const [up, down] = list.children[row]?.querySelectorAll('.gb-home-cust-move') || [];
    const want = delta < 0 ? up : down;
    (want && !want.disabled ? want : delta < 0 ? down : up)?.focus();
  };
  const renderHomeList = () => {
    homeListEl.replaceChildren();
    homeWorking.forEach((item, idx) => {
      const def = HOME_WIDGETS.find((w) => w.id === item.id) || { label: item.id, desc: '' };
      const featureOff = def.feature && !featureOn(def.feature);
      const sw = h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': item.enabled ? 'true' : 'false',
          'aria-label': def.label,
          class: 'gb-switch' + (item.enabled ? ' is-on' : ''),
        },
        h('span', { class: 'gb-switch-knob' })
      );
      sw.onclick = () => {
        item.enabled = !item.enabled;
        renderHomeList();
        persistHome();
      };
      const move = (delta, label, icon, disabled) => {
        const btn = h(
          'button',
          { type: 'button', class: 'gb-home-cust-move', 'aria-label': label, disabled },
          Icon(icon, { size: 16, sw: 2.4 })
        );
        if (!disabled) {
          btn.onclick = () => {
            const j = idx + delta;
            const tmp = homeWorking[j];
            homeWorking[j] = homeWorking[idx];
            homeWorking[idx] = tmp;
            renderHomeList();
            persistHome();
            refocusMove(homeListEl, j, delta);
          };
        }
        return btn;
      };
      homeListEl.appendChild(
        h(
          'div',
          { class: 'gb-home-cust-row' + (item.enabled ? '' : ' is-off') },
          h(
            'div',
            { class: 'gb-home-cust-moves' },
            move(-1, 'Move ' + def.label + ' up', 'chevron-up', idx === 0),
            move(1, 'Move ' + def.label + ' down', 'chevron-down', idx === homeWorking.length - 1)
          ),
          h(
            'div',
            { class: 'gb-home-cust-text' },
            h('div', { class: 'gb-home-cust-label' }, def.label),
            h(
              'div',
              { class: 'gb-home-cust-desc' },
              featureOff ? 'Turn on the ' + def.feature + ' feature to show this' : def.desc
            )
          ),
          sw
        )
      );
    });
    refreshIcons();
  };
  renderHomeList();
  const homePane = h(
    'div',
    { class: 'gb-settings-pane' },
    h(
      'div',
      { class: 'gb-field-hint' },
      'Pick your Home cards and reorder with the arrows. Saves as you go.'
    ),
    homeListEl
  );

  // Navigation tab — choose which destinations sit in the bottom bar vs
  // "More", and reorder them. Saves automatically. Mirrors the Home pane.
  const NAV_BAR_MAX = 5;
  let navWorking = resolveNavLayout((u && u.navLayout) || null);
  const navListEl = h('div', { class: 'gb-home-cust-list' });
  const persistNav = () => saveNavLayout(navWorking.map((x) => ({ id: x.id, primary: x.primary })));
  const renderNavList = () => {
    navListEl.replaceChildren();
    const barCount = navWorking.filter((x) => x.primary).length;
    navWorking.forEach((item, idx) => {
      const def = NAV_CATALOG.find((w) => w.id === item.id) || { label: item.id };
      const featureOff = def.feature && !featureOn(def.feature);
      const sw = h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': item.primary ? 'true' : 'false',
          'aria-label': 'Show ' + def.label + ' in the bar',
          class: 'gb-switch' + (item.primary ? ' is-on' : ''),
        },
        h('span', { class: 'gb-switch-knob' })
      );
      sw.onclick = () => {
        if (!item.primary && barCount >= NAV_BAR_MAX) {
          toastError(
            { message: 'The bar holds up to ' + NAV_BAR_MAX + '. Move one to More first.' },
            'Bar is full'
          );
          return;
        }
        item.primary = !item.primary;
        renderNavList();
        persistNav();
      };
      const move = (delta, label, icon, disabled) => {
        const btn = h(
          'button',
          { type: 'button', class: 'gb-home-cust-move', 'aria-label': label, disabled },
          Icon(icon, { size: 16, sw: 2.4 })
        );
        if (!disabled) {
          btn.onclick = () => {
            const j = idx + delta;
            const tmp = navWorking[j];
            navWorking[j] = navWorking[idx];
            navWorking[idx] = tmp;
            renderNavList();
            persistNav();
            refocusMove(navListEl, j, delta);
          };
        }
        return btn;
      };
      navListEl.appendChild(
        h(
          'div',
          { class: 'gb-home-cust-row' + (item.primary ? '' : ' is-off') },
          h(
            'div',
            { class: 'gb-home-cust-moves' },
            move(-1, 'Move ' + def.label + ' up', 'chevron-up', idx === 0),
            move(1, 'Move ' + def.label + ' down', 'chevron-down', idx === navWorking.length - 1)
          ),
          h(
            'div',
            { class: 'gb-home-cust-text' },
            h('div', { class: 'gb-home-cust-label' }, def.label),
            h(
              'div',
              { class: 'gb-home-cust-desc' },
              featureOff
                ? 'Turn on the ' + def.feature + ' feature to show this'
                : item.primary
                  ? 'In the bottom bar'
                  : 'In the More menu'
            )
          ),
          sw
        )
      );
    });
    refreshIcons();
  };
  renderNavList();
  const navPane = h(
    'div',
    { class: 'gb-settings-pane' },
    h(
      'div',
      { class: 'gb-field-hint' },
      'Pick up to ' +
        NAV_BAR_MAX +
        ' tabs for the bottom bar; the rest go under “More”. Saves as you go.'
    ),
    navListEl
  );

  // Money tab — tags, currency and prompts. Only when the feature is on.
  const moneyPane = featureOn('money')
    ? h(
        'div',
        { class: 'gb-settings-pane' },
        // money.js is a lazy chunk; the pane starts hidden, so it is usually in by the time it shows.
        lazyScreen(
          () => import('./money-screen.js'),
          (m) => m.MoneyCustomisePane(state.money, saveMoney)
        ),
        bankFeedSection()
      )
    : null;

  // Display tab — text size and theme. Text size scales every rem in the app.
  const displayPane = h(
    'div',
    { class: 'gb-settings-pane' },
    h('h3', { class: 'gb-settings-sec-label' }, 'Text size'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Makes everything bigger — words, buttons and rows. Pick whatever is easiest to read.'
    ),
    segmented(
      [
        { value: 'normal', label: 'Normal' },
        { value: 'large', label: 'Large' },
        { value: 'larger', label: 'Largest' },
      ],
      state.textScale,
      (v) => setTextScale(v)
    ).node,
    h(
      'div',
      { class: 'gb-textsize-sample' },
      h('div', { class: 'gb-textsize-sample-title' }, 'Sample'),
      h('div', { class: 'gb-textsize-sample-body' }, 'Drink a glass of water · 8:00 in the morning')
    ),
    h('h3', { class: 'gb-settings-sec-label' }, 'Time format'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'How every time in the app is written — reminders, due times, meal logs.'
    ),
    segmented(
      [
        { value: '12', label: '12-hour' },
        { value: '24', label: '24-hour' },
      ],
      timeFormatPref(),
      (v) => {
        setTimeFormat(v);
        saveUiPrefs({ timeFormat: v });
        render();
      }
    ).node,
    h('h3', { class: 'gb-settings-sec-label' }, 'Theme'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Light is easier to read in daylight. Dark is easier at night. System follows the phone.'
    ),
    // Nothing picked = following the phone, and that is shown as a choice so
    // it can be picked again after trying Light or Dark.
    segmented(
      [
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      pickedTheme() || (state.user && state.user.uiPrefs && state.user.uiPrefs.theme) || 'system',
      (v) => setThemeChoice(v)
    ).node,
    h('h3', { class: 'gb-settings-sec-label' }, 'Look'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Premium adds softer shadows, frosted glass and a bit more life to every tap.'
    ),
    segmented(
      [
        { value: 'classic', label: 'Classic' },
        { value: 'premium', label: 'Premium' },
      ],
      state.premium ? 'premium' : 'classic',
      (v) => {
        if ((v === 'premium') !== state.premium) togglePremium();
      }
    ).node
  );

  // Features, Home cards and the bottom bar were three separate tabs; they all
  // answer one question — what's in the app and where does it sit — so they're
  // one scrollable Layout pane with section headings instead.
  const layoutPane = h(
    'div',
    { class: 'gb-settings-pane', style: { display: 'none' } },
    h('h3', { class: 'gb-settings-sec-label' }, 'Features'),
    featuresPane,
    h('h3', { class: 'gb-settings-sec-label' }, 'Home cards'),
    homePane,
    h('h3', { class: 'gb-settings-sec-label' }, 'Bottom bar'),
    navPane,
    ...(moneyPane ? [h('h3', { class: 'gb-settings-sec-label' }, 'Money'), moneyPane] : [])
  );
  displayPane.style.display = 'none';

  return { displayPane, layoutPane };
}

/* ---- Delete account (destructive, password-confirmed) ---- */
/* "Download my data": GET /api/auth/export (every table the account owns, minus
   secrets) handed to the OS as growth-buddy-export.json through save-file.js:
   share sheet where the platform takes files, else a download, and in the app,
   where neither works yet, a toast that says so and offers the website. */
async function downloadMyData(btn) {
  const label = btn && btn.lastChild && btn.lastChild.nodeType === 3 ? btn.lastChild : null;
  const was = label ? label.textContent : '';
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Preparing…';
  try {
    const data = await api('/api/auth/export');
    const name = 'growth-buddy-export-' + todayKey() + '.json';
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    if ((await offerFile(blob, name, 'Growth Buddy data')) === 'saved') {
      pushToast('Your data is downloading.', 'success', 3000);
    }
  } catch (err) {
    toastError(err, 'Could not export your data.');
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = was;
  }
}

function downloadDataButton(extraClass = '') {
  const btn = h(
    'button',
    { type: 'button', class: ('gb-btn gb-btn--ghost gb-account-signout ' + extraClass).trim() },
    Icon('file', { size: 16 }),
    'Download my data'
  );
  btn.addEventListener('click', () => downloadMyData(btn));
  return btn;
}

function openDeleteAccount() {
  const { sheet, close } = openOverlay({ label: 'Delete account' });
  const pw = h('input', {
    type: 'password',
    class: 'gb-input',
    autocomplete: 'current-password',
    placeholder: 'Your password',
  });
  const confirmBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--danger' },
    'Delete my account'
  );
  confirmBtn.addEventListener('click', async () => {
    if (!pw.value) {
      pushToast('Enter your password to confirm.', 'error', 3000);
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      await api('/api/auth/delete-account', {
        method: 'POST',
        body: JSON.stringify({ password: pw.value }),
      });
      // Scheduled, not gone (AuthService.deleteAccount): every session was revoked
      // and the purge runs in 7 days; signing in before then offers to cancel.
      // Everything on this device goes the way a sign-out's does, then a reload.
      close();
      endSession('deleted');
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete my account';
      toastError(err, 'Could not delete your account.');
    }
  });
  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Delete your account?'),
      h(
        'div',
        { class: 'gb-modal-sub' },
        'You’ll be signed out on every device now, and in 7 days your habits, tasks, goals, logs ' +
          'and money data are erased for good. Changed your mind? Sign in before then and choose ' +
          '“Cancel deletion”. We’ll email you the date.'
      )
    ),
    h(
      'div',
      { class: 'gb-form' },
      // Offered before the destructive button, not after: once it is pressed
      // there is nothing left to export.
      h(
        'div',
        { class: 'gb-field-hint' },
        'Want a copy first? Download everything as a JSON file.'
      ),
      downloadDataButton(),
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'Confirm with your password'),
      pw,
      confirmBtn
    ),
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: () => close() },
      'Keep my account'
    )
  );
  refreshIcons();
  focusSoon(pw);
}

/* ---- Security modal: active sessions + change password ---- */
/* ---- Security section ----
   Signed-in devices + password change. Used to be its own modal reachable from
   a third "Security" item in the account menu; it's a section of Settings →
   Account now. Returns the nodes; the caller mounts them. */
/* A session's address in words where the raw one means nothing to a person:
   "0:0:0:0:0:0:0:1" is the machine itself, 192.168.x a home network. Real
   public addresses stay as they are. */
function ipLabel(ip) {
  const a = String(ip || '').trim().toLowerCase();
  if (!a) return 'unknown IP';
  if (/^(127\.|::1$|0:0:0:0:0:0:0:1$|::ffff:127\.)/.test(a)) return 'This computer';
  if (/^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)|^f[cd][0-9a-f]{2}:|^fe80:/.test(a)) return 'Local network';
  return ip;
}
function securitySection() {
  const sessionsWrap = h(
    'div',
    { class: 'gb-sec-sessions' },
    h('div', { class: 'gb-empty-sm' }, 'Loading…')
  );

  async function loadSessions() {
    try {
      const list = await api('/api/auth/sessions');
      if (!list.length) {
        sessionsWrap.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'No active sessions.'));
        return;
      }
      sessionsWrap.replaceChildren(
        ...list.map((s) =>
          h(
            'div',
            { class: 'gb-sec-row' },
            h(
              'div',
              { class: 'gb-sec-row-main' },
              h('div', { class: 'gb-sec-row-device' }, s.device || 'Unknown device'),
              h(
                'div',
                { class: 'gb-sec-row-meta' },
                ipLabel(s.ip) + ' · last used ' + relativeTime(s.lastUsedAt)
              )
            ),
            s.current
              ? h('span', { class: 'gb-sec-badge' }, 'This device')
              : h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--ghost gb-btn--compact',
                    onclick: async (e) => {
                      const btn = e.currentTarget;
                      if (btn.disabled) return;
                      btn.disabled = true;
                      btn.textContent = 'Signing out…';
                      try {
                        await api('/api/auth/sessions/' + encodeURIComponent(s.id), {
                          method: 'DELETE',
                        });
                        toastSuccess('Signed out that device.');
                        loadSessions();
                      } catch (err) {
                        // It stayed disabled after a failure, so a retry meant reopening Settings.
                        btn.disabled = false;
                        btn.textContent = 'Sign out';
                        toastError(err, 'Could not sign out that device.');
                      }
                    },
                  },
                  'Sign out'
                )
          )
        )
      );
    } catch (_) {
      sessionsWrap.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'Could not load sessions.'));
    }
  }

  const curPw = h('input', {
    type: 'password',
    class: 'gb-input',
    autocomplete: 'current-password',
  });
  const newPw = h('input', { type: 'password', class: 'gb-input', autocomplete: 'new-password' });
  const pwBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--primary' }, 'Update password');
  async function changePassword() {
    const currentPassword = curPw.value;
    const newPassword = newPw.value;
    if (!currentPassword || newPassword.length < 8) {
      pushToast('Enter your current password and a new one (8+ characters).', 'error', 3600);
      return;
    }
    pwBtn.disabled = true;
    pwBtn.textContent = 'Updating…';
    try {
      const resp = await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // Password change revoked all sessions and minted a fresh token — store it
      // so this device stays signed in.
      syncUserSession(resp);
      toastSuccess('Password updated. Other devices were signed out.');
      curPw.value = '';
      newPw.value = '';
      pwBtn.disabled = false;
      pwBtn.textContent = 'Update password';
      loadSessions();
    } catch (err) {
      pwBtn.disabled = false;
      pwBtn.textContent = 'Update password';
      toastError(err, 'Could not update password.');
    }
  }
  pwBtn.addEventListener('click', changePassword);

  loadSessions();
  return [
    h('h3', { class: 'gb-settings-sec-label' }, 'Signed-in devices'),
    h('div', { class: 'gb-field-hint' }, 'Sign out any device you no longer use.'),
    sessionsWrap,
    h('h3', { class: 'gb-settings-sec-label' }, 'Change password'),
    h(
      'div',
      { class: 'gb-form' },
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'Current password'),
      curPw,
      h('label', { class: 'gb-field-label gb-field-label--sub' }, 'New password (8+ characters)'),
      newPw,
      pwBtn
    ),
    ...accountSecuritySections(),
  ];
}

/* Copy text, toasting the result. The secret and the recovery codes are the
   two things here that are useless unless they leave the screen intact. */
function copyText(text, what) {
  const done = () => toastSuccess(what + ' copied.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(done, () => toastError(null, 'Could not copy — select it and copy by hand.'));
  } else {
    toastError(null, 'Could not copy — select it and copy by hand.');
  }
}

/* ---- Settings → Account: change email + two-step sign-in ----
   Both read GET /api/auth/security once: whether 2FA is on, recovery codes
   left, and an email change still waiting for its code. Each section repaints
   its own box; nothing here calls render(). */
function accountSecuritySections() {
  const emailBox = h('div', { class: 'gb-form' });
  const tfaBox = h('div', { class: 'gb-form' }, h('div', { class: 'gb-empty-sm' }, 'Loading…'));
  let status = { twoFactorEnabled: false, recoveryCodesLeft: 0, pendingEmail: null };

  const input = (attrs) => h('input', Object.assign({ class: 'gb-input' }, attrs));
  const label = (text) => h('label', { class: 'gb-field-label gb-field-label--sub' }, text);
  const hint = (text) => h('div', { class: 'gb-field-hint' }, text);
  const busy = async (btn, working, run) => {
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = working;
    try {
      return await run();
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  };

  /* Email: step 1 asks for the new address + password, step 2 for the code
     that went to it. The old address gets a notice once it moves. */
  function paintEmail(pending) {
    if (pending) {
      const code = input({
        type: 'text',
        inputmode: 'numeric',
        maxlength: 6,
        autocomplete: 'one-time-code',
        placeholder: '6-digit code',
      });
      const ok = h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary' },
        'Confirm new email'
      );
      ok.addEventListener('click', () =>
        busy(ok, 'Confirming…', async () => {
          const digits = code.value.replace(/\D/g, '');
          if (digits.length !== 6)
            return pushToast('Enter the 6-digit code from the email.', 'error', 3000);
          try {
            const user = await api('/api/auth/email/confirm', {
              method: 'POST',
              body: JSON.stringify({ code: digits }),
            });
            syncUserSession(user);
            toastSuccess('Email changed to ' + user.email + '.');
            paintEmail(null);
          } catch (err) {
            toastError(err, 'Could not confirm that code.');
          }
        })
      );
      emailBox.replaceChildren(
        hint('We sent a code to ' + pending + '. It works for 15 minutes.'),
        label('Code'),
        code,
        ok,
        h(
          'button',
          { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: () => paintEmail(null) },
          'Use a different email'
        )
      );
      setTimeout(() => code.focus(), 30);
      return;
    }
    const email = input({
      type: 'email',
      autocomplete: 'email',
      placeholder: 'new@example.com',
      maxlength: 254,
    });
    const pw = input({
      type: 'password',
      autocomplete: 'current-password',
      placeholder: 'Your password',
    });
    const send = h('button', { type: 'button', class: 'gb-btn gb-btn--primary' }, 'Send code');
    send.addEventListener('click', () =>
      busy(send, 'Sending…', async () => {
        const newEmail = email.value.trim();
        if (!newEmail || !email.checkValidity())
          return pushToast('Enter the new email address.', 'error', 3000);
        if (!pw.value) return pushToast('Enter your password to confirm.', 'error', 3000);
        try {
          await api('/api/auth/email/change', {
            method: 'POST',
            body: JSON.stringify({ newEmail, password: pw.value }),
          });
          paintEmail(newEmail.toLowerCase());
        } catch (err) {
          toastError(err, 'Could not start the email change.');
        }
      })
    );
    emailBox.replaceChildren(
      hint(
        'Signed in as ' +
          ((state.user && state.user.email) || '') +
          '. We’ll send a code to the new address first.'
      ),
      label('New email'),
      email,
      label('Password'),
      pw,
      send
    );
  }

  function paintTfaStatus() {
    if (!status.twoFactorEnabled) {
      const on = h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary' },
        'Set up two-step sign-in'
      );
      on.addEventListener('click', () =>
        busy(on, 'Starting…', async () => {
          try {
            paintTfaSetup(await api('/api/auth/2fa/setup', { method: 'POST' }));
          } catch (err) {
            toastError(err, 'Could not start setup.');
          }
        })
      );
      tfaBox.replaceChildren(
        hint(
          'Off. Turn it on and signing in also asks for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).'
        ),
        on
      );
      return;
    }
    const pw = input({
      type: 'password',
      autocomplete: 'current-password',
      placeholder: 'Your password',
    });
    const code = input({
      type: 'text',
      autocomplete: 'one-time-code',
      maxlength: 32,
      placeholder: 'Code from the app, or a recovery code',
    });
    const off = h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--danger' },
      'Turn off two-step sign-in'
    );
    off.addEventListener('click', () =>
      busy(off, 'Turning off…', async () => {
        if (!pw.value || !code.value.trim())
          return pushToast('Enter your password and a code.', 'error', 3000);
        try {
          await api('/api/auth/2fa/disable', {
            method: 'POST',
            body: JSON.stringify({ password: pw.value, code: code.value.trim() }),
          });
          status = Object.assign({}, status, { twoFactorEnabled: false, recoveryCodesLeft: 0 });
          toastSuccess('Two-step sign-in is off.');
          paintTfaStatus();
        } catch (err) {
          toastError(err, 'Could not turn it off.');
        }
      })
    );
    tfaBox.replaceChildren(
      hint(
        'On. ' +
          status.recoveryCodesLeft +
          ' of 8 recovery codes left — each works once if you lose your phone.'
      ),
      label('To turn it off, confirm with your password and a code'),
      pw,
      code,
      off
    );
  }

  /* The secret is shown here and nowhere else, ever — once 2FA is on the
     server refuses to hand it out again. No QR library, so it is text: the key
     to type into the app, and the otpauth link for apps that take one. */
  function paintTfaSetup(setup) {
    const grouped = setup.secret.replace(/(.{4})/g, '$1 ').trim();
    const code = input({
      type: 'text',
      inputmode: 'numeric',
      maxlength: 6,
      autocomplete: 'one-time-code',
      placeholder: '6-digit code',
    });
    const pw = input({
      type: 'password',
      autocomplete: 'current-password',
      placeholder: 'Your password',
    });
    const verify = h('button', { type: 'button', class: 'gb-btn gb-btn--primary' }, 'Turn on');
    verify.addEventListener('click', () =>
      busy(verify, 'Checking…', async () => {
        const digits = code.value.replace(/\D/g, '');
        if (digits.length !== 6)
          return pushToast('Enter the 6-digit code the app shows.', 'error', 3000);
        if (!pw.value) return pushToast('Enter your password to confirm.', 'error', 3000);
        try {
          // Turning it on signs out every other device (server side).
          const out = await api('/api/auth/2fa/verify', {
            method: 'POST',
            body: JSON.stringify({ password: pw.value, code: digits }),
          });
          status = Object.assign({}, status, {
            twoFactorEnabled: true,
            recoveryCodesLeft: out.recoveryCodes.length,
          });
          paintRecoveryCodes(out.recoveryCodes);
        } catch (err) {
          toastError(err, 'That code didn’t work.');
        }
      })
    );
    tfaBox.replaceChildren(
      hint(
        '1. In your authenticator app, add an account and choose “Enter a setup key”. Type this key (time-based):'
      ),
      h('code', { class: 'gb-tfa-secret' }, grouped),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost',
          onclick: () => copyText(setup.secret, 'Key'),
        },
        'Copy key'
      ),
      hint('Or, if your app accepts a setup link, use this one:'),
      h('code', { class: 'gb-tfa-secret gb-tfa-uri' }, setup.otpauthUri),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost',
          onclick: () => copyText(setup.otpauthUri, 'Link'),
        },
        'Copy link'
      ),
      label('2. Enter the 6-digit code the app now shows'),
      code,
      label('3. Confirm with your password'),
      pw,
      verify,
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: () => paintTfaStatus() },
        'Cancel'
      )
    );
  }

  function paintRecoveryCodes(codes) {
    tfaBox.replaceChildren(
      hint(
        'Two-step sign-in is on, and other devices were signed out. Save these recovery codes somewhere safe — each one signs you in once if you lose your phone. You won’t see them again.'
      ),
      h('code', { class: 'gb-tfa-secret gb-tfa-codes' }, codes.join('\n')),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost',
          onclick: () => copyText(codes.join('\n'), 'Recovery codes'),
        },
        'Copy codes'
      ),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary', onclick: () => paintTfaStatus() },
        'I’ve saved them'
      )
    );
  }

  paintEmail(null);
  api('/api/auth/security')
    .then((s) => {
      status = s || status;
      if (status.pendingEmail) paintEmail(status.pendingEmail);
      paintTfaStatus();
    })
    .catch(() =>
      tfaBox.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'Could not load two-step sign-in.'))
    );

  return [
    h('h3', { class: 'gb-settings-sec-label' }, 'Change email'),
    emailBox,
    h('h3', { class: 'gb-settings-sec-label' }, 'Two-step sign-in'),
    tfaBox,
  ];
}

/* A mentor can open their mentee's tasks and habit streaks; the mentee sees
   nothing back. This is the mentee's side of that: switch it off and the
   endpoint answers 403 instead. Unset means on, so nobody's existing
   connection quietly goes dark on the day this shipped. */
function shareProgressRow() {
  const isOn = () =>
    !(state.user && state.user.uiPrefs && state.user.uiPrefs.shareProgress === false);
  const sw = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': isOn() ? 'true' : 'false',
      'aria-label': 'Let my mentor see my progress',
      class: 'gb-switch' + (isOn() ? ' is-on' : ''),
    },
    h('span', { class: 'gb-switch-knob' })
  );
  sw.onclick = () => {
    const next = !isOn();
    sw.classList.toggle('is-on', next);
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
    saveUiPrefs({ shareProgress: next });
    toastSuccess(next ? 'Your mentor can see your progress.' : 'Your progress is private now.');
  };
  return h(
    'div',
    { class: 'gb-feature-row' },
    h(
      'div',
      { class: 'gb-feature-row-text' },
      h('div', { class: 'gb-feature-row-label' }, 'Let my mentor see my progress'),
      h(
        'div',
        { class: 'gb-feature-row-desc' },
        'Your tasks and habit streaks. People you mentor never see yours.'
      )
    ),
    sw
  );
}

/* Settings → Alerts: push per category, and how long read cards stay in the
   bell. Both live in ui_prefs because the server acts on them with no client
   around — PushService checks `notifyMute` before a web push
   (NotificationPrefs.isMuted) and the nightly sweep reads `notifyKeepReadDays`.
   A muted category still lands in the bell; on the phone, muting Habits also
   drops the habit alarms from the device queue (reSyncDeviceAlarms). */
const MUTE_CATEGORIES = [
  { id: 'people', label: 'People', desc: 'Your circle, mentorship and family.' },
  { id: 'money', label: 'Money', desc: 'Bills and spending nudges.' },
  { id: 'habits', label: 'Habits', desc: 'Habit reminders.' },
];

const KEEP_READ_DAYS = [7, 30, 90];

function notifyMuteRows() {
  return MUTE_CATEGORIES.map((c) => {
    const isOn = () => !notifyMuted(c.id);
    const sw = h(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': isOn() ? 'true' : 'false',
        'aria-label': 'Notifications about ' + c.label,
        class: 'gb-switch' + (isOn() ? ' is-on' : ''),
      },
      h('span', { class: 'gb-switch-knob' })
    );
    sw.onclick = () => {
      const next = !isOn();
      sw.classList.toggle('is-on', next);
      sw.setAttribute('aria-checked', next ? 'true' : 'false');
      const prev = (state.user && state.user.uiPrefs && state.user.uiPrefs.notifyMute) || {};
      saveUiPrefs({ notifyMute: Object.assign({}, prev, { [c.id]: !next }) });
      if (c.id === 'habits') reSyncDeviceAlarms();
      toastSuccess(
        next
          ? c.label + ' notifications are back on.'
          : c.label + ' muted — still listed in the bell.'
      );
    };
    return h(
      'div',
      { class: 'gb-feature-row' },
      h(
        'div',
        { class: 'gb-feature-row-text' },
        h('div', { class: 'gb-feature-row-label' }, c.label),
        h('div', { class: 'gb-feature-row-desc' }, c.desc)
      ),
      sw
    );
  });
}

function keepReadDays() {
  const v = Number(((state.user && state.user.uiPrefs) || {}).notifyKeepReadDays);
  return KEEP_READ_DAYS.includes(v) ? v : 30;
}

function keepReadPicker() {
  return segmented(
    KEEP_READ_DAYS.map((d) => ({ value: String(d), label: d + ' days' })),
    String(keepReadDays()),
    (v) => {
      saveUiPrefs({ notifyKeepReadDays: Number(v) });
      toastSuccess('Read notifications now stay ' + v + ' days.');
    }
  ).node;
}

/* ---- Settings modal (Profile / Alerts / Account) ---- */
/* ---- Settings → Reminders ----
   The two defaults every reminder follows unless it picks its own — how far
   ahead it rings, how long a snooze waits; both in ui_prefs, which the server
   reads too (ReminderPrefs) — and every reminder in one list, to add to or
   clear out without paging through the calendar a day at a time. */
const SNOOZE_OPTIONS = [5, 10, 15, 30, 60];

let reminderSettingsPaint = null;

/* The next day a reminder still rings on, today included while its time is
   ahead (an untimed one counts all day). A year out is far enough: past that
   it reads "No date ahead", which is what an ended series is. */
function nextOccurrence(rem) {
  const now = new Date();
  for (let i = 0; i < 370; i++) {
    const key = keyOfDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
    if (!occursOn(rem, key)) continue;
    if (i === 0 && rem.time && isPastSlot(key, rem.time)) continue;
    return key;
  }
  return null;
}

function reminderSettingsPane() {
  const pane = h('div', { class: 'gb-settings-pane', style: { display: 'none' } });

  // ---- Defaults ----
  const leadPicker = segmented(
    LEAD_OPTIONS.map((m) => ({ value: String(m), label: m ? minutesLabel(m) : 'On time' })),
    String(getDefaultLead()),
    (v) => {
      const lead = Number(v);
      setDefaultLead(lead);
      saveUiPrefs({ reminderLead: lead });
      reSyncDeviceAlarms();
      paintList();
      toastSuccess(
        lead
          ? 'Reminders now ring ' + minutesLabel(lead) + ' early.'
          : 'Reminders now ring on time.'
      );
    }
  );
  const snoozePicker = segmented(
    SNOOZE_OPTIONS.map((m) => ({ value: String(m), label: minutesLabel(m) })),
    String(snoozeMinutes()),
    (v) => {
      saveUiPrefs({ snoozeMinutes: Number(v) });
      repaintOverlays();
      toastSuccess('Snooze set to ' + minutesLabel(Number(v)) + '.');
    }
  );

  const addForm = reminderQuickAdd().node;

  // ---- The list ----
  const count = h('span', { class: 'gb-sound-count' });
  const list = h('div', { class: 'gb-remset-list', role: 'list' });
  let armed = null;
  let armTimer = null;

  function row(rem, next) {
    const tag = TAGS[rem.tag] || TAGS.other;
    const bits = [];
    bits.push(
      next
        ? shortDay(next) + (rem.time ? ', ' + formatTime(rem.time.slice(0, 5)) : '')
        : 'No date ahead'
    );
    if (rem.repeat && rem.repeat !== 'none') bits.push(describeRepeat(rem));
    if (rem.time) {
      bits.push(
        rem.notifyBefore === null || rem.notifyBefore === undefined
          ? leadLabel(getDefaultLead())
          : leadLabel(rem.notifyBefore)
      );
    }
    const snoozed = rem.snoozedUntil && new Date(rem.snoozedUntil).getTime() > Date.now();
    const isArmed = armed === rem.id;
    const del = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--icon gb-sound-remove' + (isArmed ? ' is-armed' : ''),
        'aria-label': isArmed ? 'Tap again to delete ' + rem.text : 'Delete ' + rem.text,
        onclick: async () => {
          if (armed !== rem.id) {
            armed = rem.id;
            clearTimeout(armTimer);
            armTimer = setTimeout(() => {
              armed = null;
              paintList();
            }, 3500);
            paintList();
            list.querySelector('[data-id="' + rem.id + '"] .gb-sound-remove')?.focus();
            return;
          }
          armed = null;
          clearTimeout(armTimer);
          // The whole series: this list shows reminders, not days. One day of a
          // series is still the calendar's to skip.
          await deleteReminder('all', rem.id, null);
        },
      },
      Icon('trash-2', { size: 15 }),
      isArmed ? (rem.repeat && rem.repeat !== 'none' ? 'Delete all' : 'Delete') : null
    );
    return h(
      'div',
      {
        class: 'gb-remset-row',
        role: 'listitem',
        dataset: { id: rem.id },
        style: { '--tag-color': tag.color },
      },
      h('span', { class: 'gb-rem-accent' }),
      h(
        'div',
        { class: 'gb-remset-main' },
        h('div', { class: 'gb-remset-text' }, rem.text),
        h('div', { class: 'gb-remset-meta' }, bits.join(' · ')),
        snoozed
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-remset-snoozed',
                'aria-label': 'Cancel the snooze on ' + rem.text,
                onclick: () => cancelReminderSnooze(rem.id),
              },
              Icon('alarm-clock', { size: 13 }),
              snoozeLabel(rem.snoozedUntil),
              Icon('x', { size: 12 })
            )
          : null
      ),
      del
    );
  }

  function paintList() {
    const all = (state.reminders || []).map((r) => ({ r, next: nextOccurrence(r) }));
    // Soonest first; the ones with nothing ahead sink to the bottom.
    all.sort((a, b) => {
      if (!a.next || !b.next) return a.next ? -1 : b.next ? 1 : 0;
      if (a.next !== b.next) return a.next < b.next ? -1 : 1;
      return String(a.r.time || '99').localeCompare(String(b.r.time || '99'));
    });
    count.textContent = all.length ? String(all.length) : '';
    list.replaceChildren(
      ...(all.length
        ? all.map((x) => row(x.r, x.next))
        : [h('div', { class: 'gb-sound-empty' }, 'No reminders yet. Add one above.')])
    );
    refreshIcons();
  }
  // Only while this pane is in the page: a closed Settings must not keep a
  // list being rebuilt behind it.
  reminderSettingsPaint = () => {
    if (!pane.isConnected) {
      reminderSettingsPaint = null;
      return;
    }
    paintList();
  };
  paintList();

  pane.append(
    h('h3', { class: 'gb-settings-sec-label' }, 'When to notify'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'How far ahead of its time a reminder rings — in the app, on your phone and on WhatsApp. A reminder can set its own when you add or edit it.'
    ),
    h('div', { class: 'gb-remset-picker' }, leadPicker.node),
    h('h3', { class: 'gb-settings-sec-label' }, 'Snooze'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'How long Snooze waits before it rings again. It’s on the reminder in the app, on its notification, and on WhatsApp — tap Snooze there, or reply SNOOZE (or “snooze 20”).'
    ),
    h('div', { class: 'gb-remset-picker gb-remset-picker--5' }, snoozePicker.node),
    h(
      'div',
      { class: 'gb-sounds-head', style: { marginTop: '22px' } },
      h('h3', { class: 'gb-settings-sec-label', style: { margin: 0 } }, 'Your reminders'),
      count
    ),
    addForm,
    list,
    h('h3', { class: 'gb-settings-sec-label' }, 'Other calendars'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Every reminder as a calendar file, repeats and alerts included, at your local times. A copy: changes here don’t follow it.'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost',
        onclick: (e) => exportRemindersIcs(e.currentTarget),
      },
      Icon('calendar-plus', { size: 16 }),
      'Export calendar (.ics)'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost',
        style: { marginTop: '8px' },
        onclick: () => openIcsImportDialog(),
      },
      Icon('upload', { size: 16 }),
      'Import .ics'
    )
  );
  return pane;
}

function openProfileSettings(initialTab) {
  const u = state.user || {};
  const now = new Date();

  // ---- Personal inputs ----
  const displayNameInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '120',
    placeholder: 'Your display name',
    autocomplete: 'nickname',
    value: u.displayName || '',
  });
  const fallbackDob = u.dob
    ? String(u.dob)
    : u.ageYears
      ? now.getFullYear() - Number(u.ageYears) + '-01-01'
      : '';
  const dobInput = h('input', {
    type: 'date',
    class: 'gb-input',
    autocomplete: 'bday',
    value: fallbackDob,
  });
  const heightInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '100',
    max: '250',
    placeholder: 'cm',
    value: u.heightCm || '',
  });
  const weightInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '25',
    max: '300',
    placeholder: 'kg',
    value: u.weightKg || '',
  });
  const GENDERS = ['', 'Male', 'Female', 'Non-binary', 'Prefer not to say'];
  const genderSel = h('select', { class: 'gb-input' });
  GENDERS.forEach((g) => {
    const o = h('option', { value: g }, g || 'Select gender…');
    if ((u.gender || '') === g) o.selected = true;
    genderSel.appendChild(o);
  });
  const timezoneInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '64',
    placeholder: 'e.g. Asia/Kolkata',
    value: u.timezone || '',
  });

  // ---- Diet & Goals inputs ----
  const fitnessGoalInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '100',
    placeholder: 'e.g. lose weight, build muscle, stay active',
    value: u.fitnessGoal || '',
  });
  const dietInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '64',
    placeholder: 'e.g. vegetarian, eggetarian, high-protein',
    value: u.dietPreference || '',
  });
  const foodGoalInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '800',
    max: '6000',
    placeholder: 'kcal',
    value: u.dailyFoodGoalKcal || '',
  });
  // What the tracker uses, which for an account with a pre-move tracker goal is
  // not yet this column. Clamped: an old tracker goal could be 250, and an
  // out-of-range value here would refuse the whole Settings save.
  const waterGoalShown = () => {
    const g = (state.water && state.water.goalMl) || (state.user || {}).dailyWaterGoalMl;
    return g ? String(Math.min(7000, Math.max(1000, g))) : '';
  };
  const waterGoalAtOpen = waterGoalShown();
  const timezoneAtOpen = timezoneInput.value;
  const waterGoalInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '1000',
    max: '7000',
    placeholder: 'ml',
    value: waterGoalAtOpen,
  });
  const allergicInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '255',
    placeholder: 'e.g. peanuts, lactose, gluten',
    value: u.allergicTo || '',
  });
  const favDishInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '120',
    placeholder: 'e.g. paneer butter masala',
    value: u.favouriteDish || '',
  });
  const aboutInput = h(
    'textarea',
    {
      class: 'gb-input gb-input--about',
      maxlength: '500',
      placeholder: 'Your routine, health priorities, dietary preferences…',
    },
    u.aboutMe || ''
  );
  // Parse a number input to an integer within [min,max], else null (so the
  // backend's validation never 400s on a blank / out-of-range field).
  const numOrNull = (raw, min, max) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
  };
  const ageFromDob = (raw) => {
    if (!raw) return null;
    const dob = new Date(raw + 'T00:00:00');
    if (Number.isNaN(dob.getTime())) return null;
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
    return age >= 10 && age <= 100 ? age : null;
  };
  const suggestBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--secondary gb-profile-suggest-btn',
      onclick: async () => {
        const done = setThinking(suggestBtn, 'Working out your targets');
        try {
          // Send what's currently on screen so unsaved edits (allergy, about…) are honoured.
          const s = await getNutritionSuggestion({
            ageYears: ageFromDob(dobInput.value),
            heightCm: numOrNull(heightInput.value, 100, 250),
            weightKg: numOrNull(weightInput.value, 25, 300),
            fitnessGoal: (fitnessGoalInput.value || '').trim() || null,
            dietPreference: (dietInput.value || '').trim() || null,
            aboutMe: (aboutInput.value || '').trim() || null,
            allergicTo: (allergicInput.value || '').trim() || null,
            favouriteDish: (favDishInput.value || '').trim() || null,
            dailyFoodGoalKcal: numOrNull(foodGoalInput.value, 800, 6000),
            dailyWaterGoalMl: numOrNull(waterGoalInput.value, 1000, 7000),
          });
          openModal({
            title: 'AI Nutrition Suggestion',
            modalClass: 'gb-modal--settings',
            body: h(
              'div',
              { class: 'gb-profile-suggest' },
              h(
                'div',
                { class: 'gb-profile-suggest-line' },
                'Water goal: ' + s.recommendedWaterMl + ' ml/day'
              ),
              h(
                'div',
                { class: 'gb-profile-suggest-line' },
                'Food goal: ' + s.recommendedFoodGoalKcal + ' kcal/day'
              ),
              h('div', { class: 'gb-profile-suggest-line' }, s.guidance || ''),
              h(
                'ul',
                { class: 'gb-profile-suggest-list' },
                (s.indianFoodSuggestions || []).map((item) => h('li', null, item))
              )
            ),
            primary: 'Use these goals',
            onPrimary: () => {
              if (s.recommendedWaterMl) waterGoalInput.value = String(s.recommendedWaterMl);
              if (s.recommendedFoodGoalKcal)
                foodGoalInput.value = String(s.recommendedFoodGoalKcal);
              toastSuccess('Suggested goals applied. Save to keep them.');
            },
          });
        } catch (err) {
          toastError(
            new Error(err && err.message ? err.message : 'Could not generate suggestion.'),
            'Suggestion error'
          );
        } finally {
          done();
        }
      },
    },
    'Get AI nutrition suggestion'
  );

  // ---- WhatsApp OTP section (self-contained) ----
  let waOtpPhone = u.whatsappNumber || '';
  let waStage = u.whatsappVerified && u.whatsappNumber ? 'verified' : 'idle';
  const waSectionBody = h('div', { class: 'gb-wa-otp-section' });

  function buildWaSection() {
    const cu = state.user || {};
    waSectionBody.replaceChildren();

    if (waStage === 'idle') {
      const phone = CountryPhoneInput(waOtpPhone || cu.whatsappNumber || '');
      const sendBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { marginTop: '10px' },
        },
        'Send verification code'
      );
      sendBtn.onclick = async () => {
        const raw = phone.getValue();
        if (!/^\+?[1-9]\d{7,14}$/.test(raw)) {
          phone.focus();
          toastError(
            new Error('Enter a valid phone number for the selected country.'),
            'Invalid number'
          );
          return;
        }
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
        try {
          await api('/api/auth/whatsapp/send-otp', {
            method: 'POST',
            body: JSON.stringify({ number: raw }),
          });
          waOtpPhone = raw;
          waStage = 'otp_sent';
          buildWaSection();
        } catch (err) {
          toastError(err, 'Could not send OTP');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send verification code';
        }
      };
      waSectionBody.appendChild(h('div', { class: 'gb-field-label' }, 'WhatsApp number'));
      waSectionBody.appendChild(
        h('div', { class: 'gb-field-hint' }, 'Pick your country, then enter the local number')
      );
      waSectionBody.appendChild(phone.el);
      waSectionBody.appendChild(sendBtn);
    } else if (waStage === 'otp_sent') {
      const otpIn = h('input', {
        type: 'text',
        class: 'gb-input',
        maxlength: '6',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
      });
      const otpField = otpBoxes(otpIn);
      otpIn.addEventListener('input', () => otpIn.classList.remove('is-invalid'));
      const verifyBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { flex: '1' },
        },
        'Verify'
      );
      verifyBtn.onclick = async () => {
        const otp = (otpIn.value || '').trim();
        if (!/^\d{6}$/.test(otp)) {
          otpIn.classList.add('is-invalid');
          otpIn.focus();
          shakeRefusal(otpField);
          toastError(new Error('Enter the 6-digit code from WhatsApp'), 'Invalid code');
          return;
        }
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying…';
        otpField.classList.add('is-busy');
        try {
          const updated = await api('/api/auth/whatsapp/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ number: waOtpPhone, otp }),
          });
          syncUserSession(updated);
          waStage = 'verified';
          buildWaSection();
          toastSuccess('WhatsApp number verified! Reminders are now active.');
        } catch (err) {
          otpField.classList.remove('is-busy');
          otpIn.classList.add('is-invalid');
          shakeRefusal(otpField);
          toastError(err, 'Verification failed');
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
        }
      };
      const resendBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost',
          style: { flex: '0 0 auto' },
        },
        'Resend'
      );
      resendBtn.onclick = async () => {
        resendBtn.disabled = true;
        resendBtn.textContent = 'Sending…';
        try {
          await api('/api/auth/whatsapp/send-otp', {
            method: 'POST',
            body: JSON.stringify({ number: waOtpPhone }),
          });
          toastSuccess('A new code was sent to ' + waOtpPhone);
        } catch (err) {
          toastError(err, 'Could not resend');
        } finally {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend';
        }
      };
      const changeBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-wa-change-link',
        },
        'Change number'
      );
      changeBtn.onclick = () => {
        waStage = 'idle';
        buildWaSection();
      };
      waSectionBody.appendChild(
        h(
          'div',
          { class: 'gb-wa-otp-sent-chip' },
          Icon('message-circle', { size: 14, color: 'var(--gb-wa-green)' }),
          'Code sent to ' + waOtpPhone
        )
      );
      waSectionBody.appendChild(
        h(
          'div',
          { class: 'gb-field-label', style: { marginTop: '14px' } },
          'Enter the 6-digit code'
        )
      );
      waSectionBody.appendChild(otpField);
      waSectionBody.appendChild(h('div', { class: 'gb-wa-otp-actions' }, verifyBtn, resendBtn));
      waSectionBody.appendChild(changeBtn);
      setTimeout(() => {
        if (otpIn.isConnected) otpIn.focus();
      }, 50);
    } else if (waStage === 'verified') {
      const verifiedChip = h(
        'div',
        { class: 'gb-wa-verified-chip' },
        Icon('check-circle-2', { size: 14, color: 'var(--gb-wa-green)' }),
        maskPhone(cu.whatsappNumber),
        h('span', { class: 'gb-wa-verified-label' }, 'Verified')
      );
      const changeBtn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-wa-change-link',
          style: { marginLeft: 'auto' },
        },
        'Change number'
      );
      changeBtn.onclick = () => {
        waStage = 'idle';
        buildWaSection();
      };

      let waEnabled = !!cu.whatsappEnabled;
      const tThumb = h('span', { class: 'gb-switch-knob' });
      const waToggle = h(
        'button',
        {
          type: 'button',
          class: 'gb-switch is-wa' + (waEnabled ? ' is-on' : ''),
          role: 'switch',
          'aria-checked': String(waEnabled),
          'aria-label': 'Enable WhatsApp reminders',
          onclick: async () => {
            // Two PUTs in flight raced, and the later answer could be the older value.
            if (waToggle.disabled) return;
            waToggle.disabled = true;
            waEnabled = !waEnabled;
            waToggle.classList.toggle('is-on', waEnabled);
            waToggle.setAttribute('aria-checked', String(waEnabled));
            try {
              const updated = await api('/api/auth/whatsapp', {
                method: 'PUT',
                body: JSON.stringify({ enabled: waEnabled }),
              });
              syncUserSession(updated);
              toastSuccess(
                waEnabled ? 'WhatsApp reminders enabled.' : 'WhatsApp reminders paused.'
              );
            } catch (err) {
              waEnabled = !waEnabled;
              waToggle.classList.toggle('is-on', waEnabled);
              waToggle.setAttribute('aria-checked', String(waEnabled));
              toastError(err, 'Could not update WhatsApp settings.');
            } finally {
              waToggle.disabled = false;
            }
          },
        },
        tThumb
      );

      waSectionBody.appendChild(h('div', { class: 'gb-wa-number-row' }, verifiedChip, changeBtn));
      waSectionBody.appendChild(
        h(
          'div',
          { class: 'gb-wa-toggle-row' },
          h(
            'div',
            null,
            h(
              'div',
              { class: 'gb-field-label', style: { marginBottom: '2px' } },
              'Enable WhatsApp reminders'
            ),
            h(
              'div',
              { class: 'gb-field-hint' },
              'Timed calendar reminders will be sent to your WhatsApp'
            )
          ),
          waToggle
        )
      );
    }

    refreshIcons();
  }
  buildWaSection();

  // ---- Avatar header ----
  const initials = (u.displayName || u.email || 'B')[0].toUpperCase();

  // ---- Tab panes ----
  const profilePane = h(
    'div',
    { class: 'gb-settings-pane' },
    h('h3', { class: 'gb-settings-sec-label' }, 'Personal'),
    h('div', { class: 'gb-field-label' }, 'Display name'),
    displayNameInput,
    h('div', { class: 'gb-field-label' }, 'Date of birth'),
    dobInput,
    h(
      'div',
      { class: 'gb-settings-2col' },
      h('div', null, h('div', { class: 'gb-field-label' }, 'Height (cm)'), heightInput),
      h('div', null, h('div', { class: 'gb-field-label' }, 'Weight (kg)'), weightInput)
    ),
    h('div', { class: 'gb-field-label' }, 'Gender'),
    genderSel,
    h('div', { class: 'gb-field-label' }, 'Timezone'),
    timezoneInput,
    h('div', { class: 'gb-field-hint' }, 'e.g. Asia/Kolkata or America/New_York'),
    h('h3', { class: 'gb-settings-sec-label' }, 'Diet & Goals'),
    h('div', { class: 'gb-field-label' }, 'Fitness goal'),
    fitnessGoalInput,
    h('div', { class: 'gb-field-label' }, 'Diet preference'),
    dietInput,
    h(
      'div',
      { class: 'gb-settings-2col' },
      h(
        'div',
        null,
        h('div', { class: 'gb-field-label' }, 'Daily food goal (kcal)'),
        foodGoalInput
      ),
      h('div', null, h('div', { class: 'gb-field-label' }, 'Daily water goal (ml)'), waterGoalInput)
    ),
    h('div', { class: 'gb-field-label' }, 'Allergic to'),
    allergicInput,
    h('div', { class: 'gb-field-label' }, 'Favourite dish'),
    favDishInput,
    h('div', { class: 'gb-field-label' }, 'About you'),
    aboutInput,
    suggestBtn
  );

  // ---- Progress digest controls ----
  const digestFreqSel = h(
    'select',
    { class: 'gb-input' },
    ['off', 'daily', 'weekly'].map((f) => {
      const label = f === 'off' ? 'Off' : f[0].toUpperCase() + f.slice(1);
      const o = h('option', { value: f }, label);
      if ((u.digestFrequency || 'off') === f) o.selected = true;
      return o;
    })
  );
  const digestHourSel = h('select', { class: 'gb-input' });
  for (let hr = 0; hr < 24; hr++) {
    // Through the shared formatter, like every other time on screen. This was
    // the last hand-rolled AM/PM left, and it sat four settings below the
    // 12/24 switch whose hint promises "how every time in the app is written".
    const o = h('option', { value: String(hr) }, formatTime(hr + ':00'));
    if ((u.digestHour != null ? u.digestHour : 8) === hr) o.selected = true;
    digestHourSel.appendChild(o);
  }
  // Saves on change, like the WhatsApp toggle above it and every other control
  // outside the Profile tab. A Save button here was the one thing in Settings
  // that made you press something twice, and "Done" doesn't commit it.
  const saveDigest = async () => {
    digestFreqSel.disabled = true;
    digestHourSel.disabled = true;
    try {
      await saveDigestPrefs(digestFreqSel.value, parseInt(digestHourSel.value, 10));
      toastSuccess('Digest preferences saved.');
    } catch (err) {
      toastError(err, 'Could not save digest preferences.');
    } finally {
      digestFreqSel.disabled = false;
      digestHourSel.disabled = false;
    }
  };
  digestFreqSel.onchange = saveDigest;
  digestHourSel.onchange = saveDigest;
  const digestSectionBody = h(
    'div',
    null,
    h('div', { class: 'gb-field-label' }, 'Frequency'),
    digestFreqSel,
    h('div', { class: 'gb-field-label' }, 'Send around'),
    digestHourSel,
    h(
      'div',
      { class: 'gb-field-hint', style: { marginTop: '6px' } },
      'Weekly digests arrive Mondays — by email, in-app and push.'
    )
  );

  // ---- Working week ----
  // Decides which days a "Mon-Fri" reminder actually fires on. It was hardcoded
  // Mon-Fri on both sides, which is simply wrong for Sun-Thu in the Gulf and for
  // the Mon-Sat offices plenty of people here work. Lives in ui_prefs rather than
  // its own column because prod runs ddl-auto: none.
  const workWeekSel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Working week' },
    Object.keys(WORK_WEEKS).map((key) => {
      const o = h('option', { value: key }, WORK_WEEKS[key].label);
      if (getWorkWeek() === key) o.selected = true;
      return o;
    })
  );
  workWeekSel.onchange = () => {
    setWorkWeek(workWeekSel.value);
    saveUiPrefs({ workWeek: workWeekSel.value });
    toastSuccess('Working week saved.');
    // Every "Mon-Fri" reminder now lands on different days, so anything already
    // painted from the old answer is stale.
    if (state.screen === 'calendar' || state.screen === 'home') render();
  };
  const workWeekBody = h(
    'div',
    null,
    workWeekSel,
    h(
      'div',
      { class: 'gb-field-hint', style: { marginTop: '6px' } },
      'Reminders set to repeat on working days follow this.'
    )
  );

  /* ---- Water nudge ----
     A drumbeat, not a calendar entry: every N minutes between two local times.
     The settings live in ui_prefs (prod runs ddl-auto: none, and this is a
     preference, not an entity); the alarms are queued on the device, because
     the server can only reach a Web Push subscription the app can't register. */
  const waterPrefs = waterReminderPrefs();
  const saveWater = (patch) => {
    Object.assign(waterPrefs, patch);
    saveUiPrefs({ water: Object.assign({}, waterPrefs) });
    reSyncDeviceAlarms();
  };
  const waterEverySel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Remind me every' },
    [30, 45, 60, 90, 120, 180, 240].map((mins) => {
      const label = mins < 60 ? mins + ' minutes' : mins / 60 + (mins === 60 ? ' hour' : ' hours');
      const o = h('option', { value: String(mins) }, 'Every ' + label);
      if (Number(waterPrefs.everyMins) === mins) o.selected = true;
      return o;
    })
  );
  // Two fields under one label: a11y.js can't name them, so each names itself.
  const waterFrom = h('input', {
    type: 'time',
    class: 'gb-input',
    'aria-label': 'Water reminders from',
    value: waterPrefs.from,
  });
  const waterTo = h('input', {
    type: 'time',
    class: 'gb-input',
    'aria-label': 'Water reminders until',
    value: waterPrefs.to,
  });
  const waterFields = h(
    'div',
    { style: { display: waterPrefs.on ? '' : 'none' } },
    h('div', { class: 'gb-field-label' }, 'How often'),
    waterEverySel,
    h('div', { class: 'gb-field-label' }, 'Between'),
    h(
      'div',
      { class: 'gb-quickadd-row', style: { gap: '8px' } },
      waterFrom,
      h('span', { class: 'gb-field-hint', style: { alignSelf: 'center' } }, 'and'),
      waterTo
    ),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginTop: '6px' } },
      'Queued on this device, so they arrive with the app closed. Nothing is sent outside these hours.'
    )
  );
  waterEverySel.onchange = () => saveWater({ everyMins: Number(waterEverySel.value) });
  // Only save a window that makes sense — a half-typed time in a native picker
  // fires change events, and `to <= from` would mean no nudges at all with
  // nothing on screen saying why.
  const saveWindow = () => {
    if (!waterFrom.value || !waterTo.value) return;
    if (waterTo.value <= waterFrom.value) {
      pushToast('The end time has to be after the start time.', 'error', 3200);
      waterFrom.value = waterPrefs.from;
      waterTo.value = waterPrefs.to;
      return;
    }
    saveWater({ from: waterFrom.value, to: waterTo.value });
  };
  waterFrom.onchange = saveWindow;
  waterTo.onchange = saveWindow;
  const waterSwitch = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': waterPrefs.on ? 'true' : 'false',
      'aria-label': 'Remind me to drink water',
      class: 'gb-switch' + (waterPrefs.on ? ' is-on' : ''),
    },
    h('span', { class: 'gb-switch-knob' })
  );
  waterSwitch.onclick = () => {
    const next = !waterPrefs.on;
    waterSwitch.classList.toggle('is-on', next);
    waterSwitch.setAttribute('aria-checked', next ? 'true' : 'false');
    waterFields.style.display = next ? '' : 'none';
    saveWater({ on: next });
    toastSuccess(next ? 'Water reminders on.' : 'Water reminders off.');
  };
  const waterSectionBody = h(
    'div',
    null,
    h(
      'div',
      { class: 'gb-feature-row' },
      h(
        'div',
        { class: 'gb-feature-row-text' },
        h('div', { class: 'gb-feature-row-label' }, 'Remind me to drink water'),
        h('div', { class: 'gb-feature-row-desc' }, 'A nudge through the day, on a rhythm you set.')
      ),
      waterSwitch
    ),
    waterFields
  );

  /* ---- Take a break (I-08): one tap for 3 / 7 / 14 days or a typed 1-14, one to end it. ---- */
  const breakSectionBody = h('div');
  const customDays = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '1',
    max: String(MAX_BREAK_DAYS),
    placeholder: 'Days',
    'aria-label': 'Break length in days',
    style: { width: '84px' },
  });
  const startCustomBreak = () => {
    const n = Number(customDays.value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_BREAK_DAYS) {
      toastError(null, 'Enter 1 to ' + MAX_BREAK_DAYS + ' days.');
      return Promise.resolve();
    }
    customDays.value = '';
    return takeBreak(n, false);
  };
  const paintBreak = () => {
    const st = breakState(breakPrefs(), todayKey());
    const btn = (label, onclick, primary) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--compact ' + (primary ? 'gb-btn--primary' : 'gb-btn--soft'),
          onclick: () => onclick().then(paintBreak),
        },
        label
      );
    breakSectionBody.replaceChildren(
      st && st.on
        ? h(
            'div',
            { class: 'gb-feature-row' },
            h(
              'div',
              { class: 'gb-feature-row-text' },
              h('div', { class: 'gb-feature-row-label' }, 'On a break until ' + breakUntilLabel(st.until)),
              h('div', { class: 'gb-feature-row-desc' }, 'Your streaks are held.')
            ),
            btn('End now', endBreakNow, false)
          )
        : h(
            'div',
            { class: 'gb-coach-chiprow', style: { marginTop: 0 } },
            ...BREAK_LENGTHS.map((n) => btn(n + ' days', () => takeBreak(n, false), false)),
            customDays,
            btn('Start', startCustomBreak, false)
          )
    );
  };
  paintBreak();

  /* ---- Quiet hours ----
     ui_prefs.quietStart / quietEnd, read by the server (ReminderPrefs.isQuiet:
     habit reminders, the digest) and by this device's alarm queue (push.js:
     habit reminders, the water nudge). A window may wrap midnight. */
  const qp = (u && u.uiPrefs) || {};
  let quietOn = !!(qp.quietStart && qp.quietEnd && qp.quietStart !== qp.quietEnd);
  const quietFrom = h('input', {
    type: 'time',
    class: 'gb-input',
    value: qp.quietStart || '22:00',
    'aria-label': 'Quiet from',
  });
  const quietTo = h('input', {
    type: 'time',
    class: 'gb-input',
    value: qp.quietEnd || '07:00',
    'aria-label': 'Quiet until',
  });
  const quietFields = h(
    'div',
    { style: { display: quietOn ? '' : 'none' } },
    h('div', { class: 'gb-field-label' }, 'From'),
    h(
      'div',
      { class: 'gb-quickadd-row', style: { gap: '8px' } },
      quietFrom,
      h('span', { class: 'gb-field-hint', style: { alignSelf: 'center' } }, 'until'),
      quietTo
    )
  );
  const saveQuiet = () => {
    if (quietOn && (!quietFrom.value || !quietTo.value)) return; // a half-typed time
    if (quietOn && quietFrom.value === quietTo.value) {
      pushToast('Pick two different times.', 'error', 3200);
      return;
    }
    saveUiPrefs(
      quietOn
        ? { quietStart: quietFrom.value, quietEnd: quietTo.value }
        : { quietStart: null, quietEnd: null }
    );
    reSyncDeviceAlarms();
  };
  quietFrom.onchange = saveQuiet;
  quietTo.onchange = saveQuiet;
  const quietSwitch = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': quietOn ? 'true' : 'false',
      'aria-label': 'Quiet hours',
      class: 'gb-switch' + (quietOn ? ' is-on' : ''),
    },
    h('span', { class: 'gb-switch-knob' })
  );
  quietSwitch.onclick = () => {
    quietOn = !quietOn;
    quietSwitch.classList.toggle('is-on', quietOn);
    quietSwitch.setAttribute('aria-checked', quietOn ? 'true' : 'false');
    quietFields.style.display = quietOn ? '' : 'none';
    saveQuiet();
    toastSuccess(quietOn ? 'Quiet hours on.' : 'Quiet hours off.');
  };
  const quietSectionBody = h(
    'div',
    null,
    h(
      'div',
      { class: 'gb-feature-row' },
      h(
        'div',
        { class: 'gb-feature-row-text' },
        h('div', { class: 'gb-feature-row-label' }, 'Quiet hours'),
        h(
          'div',
          { class: 'gb-feature-row-desc' },
          'Hold back nudges overnight, or whenever you set.'
        )
      ),
      quietSwitch
    ),
    quietFields
  );

  /* ---- Buddy's evening reflection ----
     ui_prefs.buddyReflection = "HH:MM" local, absent = off (the default). The
     server sends it (mentor/ReflectionScheduler: bell card + push, once a day,
     held by quiet hours); no AI call. Tapping it opens Buddy with the question. */
  let reflectOn = !!qp.buddyReflection;
  const reflectAt = h('input', {
    type: 'time',
    class: 'gb-input',
    value: qp.buddyReflection || '21:00',
    'aria-label': 'Evening reflection time',
  });
  const reflectFields = h(
    'div',
    { style: { display: reflectOn ? '' : 'none' } },
    h('div', { class: 'gb-field-label' }, 'At'),
    reflectAt
  );
  const saveReflect = () => {
    if (reflectOn && !reflectAt.value) return; // a half-typed time
    saveUiPrefs({ buddyReflection: reflectOn ? reflectAt.value : null });
  };
  reflectAt.onchange = saveReflect;
  const reflectSwitch = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': reflectOn ? 'true' : 'false',
      'aria-label': 'Evening reflection with Buddy',
      class: 'gb-switch' + (reflectOn ? ' is-on' : ''),
    },
    h('span', { class: 'gb-switch-knob' })
  );
  reflectSwitch.onclick = () => {
    reflectOn = !reflectOn;
    reflectSwitch.classList.toggle('is-on', reflectOn);
    reflectSwitch.setAttribute('aria-checked', reflectOn ? 'true' : 'false');
    reflectFields.style.display = reflectOn ? '' : 'none';
    saveReflect();
    toastSuccess(reflectOn ? 'Evening reflection on.' : 'Evening reflection off.');
  };
  const reflectSectionBody = h(
    'div',
    null,
    h(
      'div',
      { class: 'gb-feature-row' },
      h(
        'div',
        { class: 'gb-feature-row-text' },
        h('div', { class: 'gb-feature-row-label' }, 'Evening reflection'),
        h(
          'div',
          { class: 'gb-feature-row-desc' },
          'Once a day, Buddy asks how today went. Tap it to answer in a chat.'
        )
      ),
      reflectSwitch
    ),
    reflectFields
  );

  // ---- Push notifications ----
  const pushBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact' },
    'Enable push notifications'
  );
  const pushTestBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--ghost gb-btn--compact' },
    'Send test'
  );
  let pushOn = false;
  // In the app the switch is Android's, not ours: we can ask for permission but
  // never take it back, so the "off" button points at system settings instead.
  const native = localNotificationsAvailable();
  const syncPushUi = () => {
    pushBtn.textContent = pushOn
      ? native
        ? 'Notifications on — manage in system settings'
        : 'Turn off push notifications'
      : 'Enable notifications';
    pushBtn.disabled = pushOn && native;
    pushTestBtn.style.display = pushOn ? '' : 'none';
  };
  syncPushUi();
  if (pushSupported())
    pushSubscribed().then((on) => {
      pushOn = on;
      syncPushUi();
    });
  pushBtn.onclick = async () => {
    if (!pushSupported()) {
      pushToast('This browser doesn’t support push notifications.', 'error', 3600);
      return;
    }
    pushBtn.disabled = true;
    try {
      if (pushOn) {
        await disablePush(api);
        pushOn = false;
        toastSuccess('Push notifications turned off.');
      } else {
        pushOn = await enablePushFlow('Push notifications on. Try “Send test”.');
      }
    } finally {
      syncPushUi();
    }
  };
  pushTestBtn.onclick = async () => {
    try {
      if (native) {
        toastSuccess(
          (await pushTestLocal(notifySound()))
            ? 'Test notification sent.'
            : 'Could not post the notification.'
        );
        return;
      }
      const r = await api('/api/push/test', { method: 'POST' });
      toastSuccess(
        r.delivered > 0
          ? 'Test sent to ' + r.delivered + ' device' + (r.delivered > 1 ? 's' : '') + '.'
          : 'No devices registered yet.'
      );
    } catch (err) {
      toastError(err, 'Could not send a test notification.');
    }
  };
  const pushSectionBody = h(
    'div',
    { class: 'gb-quickadd-row', style: { flexWrap: 'wrap' } },
    pushBtn,
    pushTestBtn
  );

  // ---- Notification sound ----
  // The segmented control already wraps past six options (that's why the
  // recurrence picker uses it), so the chimes need no CSS of their own. The
  // user's own sounds join it, by name, once they are stored on this device.
  const soundPicker = h('div', { class: 'gb-sound-picker' });
  const paintSoundPicker = () => {
    // A file's name can be long; the segment wraps, but one 40-character pill
    // would push the row wide. The list below shows the full name.
    const opts = chimeOptions().map((c) => ({
      value: c.key,
      label: c.custom && c.label.length > 12 ? c.label.slice(0, 11).trimEnd() + '…' : c.label,
    }));
    // The pre-library 'custom' means the first one: light that up, not nothing.
    let current = notifySound();
    if (current === 'custom' && customChimes()[0]) current = customChimes()[0].key;
    soundPicker.replaceChildren(
      segmented(opts, current, (v) => {
        saveUiPrefs({ notifySound: v });
        // The sound rides on each queued notification, so already-queued ones
        // would keep the old one until something else rebuilt the queue.
        reSyncDeviceAlarms();
        playChime(v); // picking one is the preview — a separate play button is a click nobody needs
      }).node
    );
  };
  paintSoundPicker();

  // ---- Your own sounds: up to CUSTOM_MAX_COUNT, uploaded or recorded here ----
  const soundCount = h('span', { class: 'gb-sound-count' });
  const customSoundList = h('div', { class: 'gb-sound-list', role: 'list' });

  // Remove is two taps — the first arms it for a few seconds — because a
  // recording, once gone, can't be made again the same way. Inline rather than
  // a confirm dialog, which would stack a second modal over Settings.
  // One preview at a time. The row playing shows a Pause button and moving
  // bars in place of its icon until the sound ends, is stopped, or another
  // row's Play takes over.
  let playing = null; // { key, row, btn, name }
  const showPlaying = (p, on) => {
    p.row.classList.toggle('is-playing', on);
    p.btn.classList.toggle('is-on', on);
    p.btn.setAttribute('aria-pressed', String(on));
    p.btn.setAttribute('aria-label', (on ? 'Stop ' : 'Play ') + p.name);
    p.btn.replaceChildren(Icon(on ? 'pause' : 'play', { size: 17 }));
  };
  const togglePreview = async (c, row, btn) => {
    if (playing && playing.key === c.key) {
      stopChime();
      return;
    }
    const me = { key: c.key, row, btn, name: c.name };
    playing = me;
    showPlaying(me, true);
    await previewChime(c.key); // settles the previous preview first, which resets its row
    showPlaying(me, false);
    if (playing === me) playing = null;
  };

  const soundRow = (c) => {
    const inUse = notifySound() === c.key;
    // Stored since renames: a row from before it was kept falls back to the
    // name the recorder gives.
    const isRecording = c.source ? c.source === 'recording' : /^Recording \d+$/.test(c.name);
    let armed = null;
    const removeBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--icon gb-sound-remove',
        'aria-label': 'Remove ' + c.name,
        onclick: () => {
          if (armed) {
            clearTimeout(armed);
            removeCustomSound(c);
            return;
          }
          removeBtn.classList.add('is-armed');
          removeBtn.setAttribute('aria-label', 'Tap again to remove ' + c.name);
          removeBtn.replaceChildren(h('span', null, 'Remove?'));
          armed = setTimeout(() => {
            armed = null;
            removeBtn.classList.remove('is-armed');
            removeBtn.setAttribute('aria-label', 'Remove ' + c.name);
            removeBtn.replaceChildren(Icon('trash-2', { size: 17 }));
          }, 3000);
        },
      },
      Icon('trash-2', { size: 17 })
    );
    // Rename in place. The name itself is the control (a pencil beside it says
    // so) — a third icon button squeezed the name to a few letters on a phone.
    // Tapping it swaps in a field and moves Play/Remove aside; Enter or leaving
    // the field saves, Escape puts the old name back.
    const meta = h(
      'span',
      { class: 'gb-sound-meta' },
      (isRecording ? 'Voice recording' : 'Sound file') + (inUse ? ' · Default' : '')
    );
    const nameBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-sound-name',
        'aria-label': 'Rename ' + c.name,
        onclick: () => startRename(),
      },
      h(
        'span',
        { class: 'gb-sound-title' },
        h('span', { class: 'gb-sound-title-text' }, c.name),
        Icon('pencil', { size: 13, className: 'gb-sound-title-edit' })
      ),
      meta
    );
    const startRename = () => {
      const field = h('input', {
        type: 'text',
        class: 'gb-input gb-sound-rename',
        value: c.name,
        maxlength: '40',
        'aria-label': 'New name for ' + c.name,
        enterkeyhint: 'done',
      });
      const editor = h('span', { class: 'gb-sound-name' }, field);
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const next = field.value.replace(/\s+/g, ' ').trim();
        row.classList.remove('is-renaming');
        if (save && next && next !== c.name) {
          renameCustomSound(c, next);
          return;
        }
        editor.replaceWith(nameBtn);
        nameBtn.focus();
      };
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // Not up to the sheet: its submitOnEnter (gb-kit) would press Done and
          // close Settings along with the rename.
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === 'Escape') {
          // The Settings modal closes on Escape too; this one is only the field's.
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      });
      field.addEventListener('blur', () => finish(true));
      if (playing && playing.key === c.key) stopChime();
      nameBtn.replaceWith(editor);
      row.classList.add('is-renaming');
      field.focus();
      field.select();
    };
    const playBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--icon gb-sound-play',
        'aria-label': 'Play ' + c.name,
        'aria-pressed': 'false',
        onclick: () => togglePreview(c, row, playBtn),
      },
      Icon('play', { size: 17 })
    );
    const row = h(
      'div',
      { class: 'gb-sound-row' + (inUse ? ' is-default' : ''), role: 'listitem', 'data-key': c.key },
      h(
        'span',
        { class: 'gb-sound-chip' },
        // Wrapped: Icon() sets an inline display, which a stylesheet can't hide.
        h(
          'span',
          { class: 'gb-sound-chip-icon' },
          Icon(isRecording ? 'mic' : 'audio-lines', { size: 17 })
        ),
        h('span', { class: 'gb-sound-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))
      ),
      nameBtn,
      playBtn,
      removeBtn
    );
    return row;
  };

  const paintSounds = () => {
    // The rows are rebuilt, so a preview's button would be orphaned mid-play.
    if (playing) stopChime();
    paintSoundPicker();
    const list = customChimes();
    soundCount.textContent = list.length + ' of ' + CUSTOM_MAX_COUNT;
    customSoundList.replaceChildren(
      ...(list.length
        ? list.map(soundRow)
        : [
            h(
              'div',
              { class: 'gb-sound-empty' },
              'None yet. Add a short file or record your voice — up to ' +
                CUSTOM_MAX_COUNT +
                ', each up to five seconds.'
            ),
          ])
    );
    syncCustomRow();
  };

  // A new sound is this device's before anything touches the network: a dead
  // connection must not cost the user the pick they just made.
  async function addCustomSound(name, dataUrl, source) {
    const sound = {
      id: newSoundId(),
      name,
      source,
      dataUrl,
      updatedAt: new Date().toISOString(),
      synced: false,
    };
    storeCustomChimes(readCustomChimes().concat(sound));
    const key = customKey(sound.id);
    saveUiPrefs({ notifySound: key });
    reSyncDeviceAlarms();
    paintSounds();
    // Hear what was just added — through its row, so the row shows it playing.
    const newPlay = customSoundList.querySelector('[data-key="' + key + '"] .gb-sound-play');
    if (newPlay) newPlay.click();
    else playChime(key);
    const outcome = await uploadNewCustomSound(sound);
    if (outcome === 'refused') {
      paintSounds();
      return;
    }
    if (outcome === 'saved') {
      toastSuccess('Saved. “' + name + '” is your notification sound now.');
      return;
    }
    // It plays here regardless — so this says what hasn't happened yet
    // rather than a bare "saved" that quietly means "on one device".
    pushToast(
      'Saved on this device. Your others will pick it up next time you’re online.',
      'info',
      4600
    );
  }

  /* The name changes here first, so the list and every picker show it at once.
     A sound the server has never had just carries the new name up with its
     upload. Otherwise a PATCH — and if that fails the old name comes back,
     because the next sign-in would take the server's name anyway, and a rename
     that quietly undoes itself later is worse than one that says it didn't take. */
  async function renameCustomSound(c, name) {
    const rename = (to) =>
      storeCustomChimes(
        readCustomChimes().map((s) => (s.id === c.id ? Object.assign({}, s, { name: to }) : s))
      );
    const wasSynced = readCustomChimes().some((s) => s.id === c.id && s.synced);
    rename(name);
    paintSounds();
    // The rows were rebuilt; put focus back where the rename started.
    const again = customSoundList.querySelector(
      '[data-key="' + c.key + '"] [aria-label^="Rename"]'
    );
    if (again) again.focus();
    if (!wasSynced) return;
    try {
      await api('/api/notifications/custom-sounds/' + c.id, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
    } catch (err) {
      rename(c.name);
      paintSounds();
      toastError(err, 'Couldn’t rename it. Check your connection and try again.');
    }
  }

  async function removeCustomSound(c) {
    storeCustomChimes(readCustomChimes().filter((s) => s.id !== c.id));
    // A reminder or habit tone that named it now finds an unknown key and falls
    // back to the default on its own; only the default itself needs moving.
    const cur = notifySound();
    if (cur === c.key || (cur === 'custom' && !customChimes().length)) {
      saveUiPrefs({ notifySound: DEFAULT_CHIME });
    }
    reSyncDeviceAlarms();
    paintSounds();
    try {
      await api('/api/notifications/custom-sounds/' + c.id, { method: 'DELETE' });
    } catch (_) {
      // Gone from this device either way, but the account still has it —
      // and the next sign-in pulls it back down. Say so rather than let it
      // reappear looking like a bug.
      pushToast(
        'Removed here, but we couldn’t reach the server — it may come back when you next sign in.',
        'error',
        4600
      );
    }
  }

  // A plain file input, relabelled. `accept` filters the OS picker; the real
  // gate (type + size) is readCustomChime, because accept is a hint, not a rule.
  const soundFile = h('input', {
    type: 'file',
    accept: 'audio/*',
    class: 'gb-sound-file',
    style: { display: 'none' },
    onchange: async () => {
      const file = soundFile.files && soundFile.files[0];
      soundFile.value = ''; // so picking the same file twice still fires
      if (!file) return;
      let dataUrl;
      try {
        dataUrl = await readCustomChime(file);
      } catch (err) {
        pushToast(err.message || 'Could not use that file.', 'error', 4200);
        return;
      }
      const name =
        (file.name || '')
          .replace(/\.[^.]+$/, '')
          .trim()
          .slice(0, 40) || 'Your sound';
      addCustomSound(name, dataUrl, 'file');
    },
  });
  const soundPickBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--soft gb-btn--compact',
      onclick: () => soundFile.click(),
    },
    Icon('plus', { size: 17 }),
    h('span', null, 'Add a file')
  );

  // Record: Start opens a small panel with a live countdown and a bar; Stop
  // keeps it, Cancel throws it away, and it stops by itself at CUSTOM_MAX_MS —
  // the five seconds any custom sound is cut to on playback.
  let recording = null;
  const recBar = h('span', { class: 'gb-sound-rec-fill' });
  const recTime = h('span', { class: 'gb-sound-rec-time' }, '0:00');
  const recPanel = h(
    'div',
    { class: 'gb-sound-rec', role: 'status', 'aria-live': 'polite', style: { display: 'none' } },
    h(
      'div',
      { class: 'gb-sound-rec-head' },
      h('span', { class: 'gb-sound-rec-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'gb-sound-rec-label' }, 'Recording…'),
      recTime
    ),
    h('div', { class: 'gb-sound-rec-track', 'aria-hidden': 'true' }, recBar),
    h(
      'div',
      { class: 'gb-sound-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary gb-btn--compact',
          onclick: () => recording && recording.stop(),
        },
        'Stop & save'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact',
          onclick: () => recording && recording.cancel(),
        },
        'Cancel'
      )
    )
  );
  const soundRecordBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--soft gb-btn--compact',
      onclick: async () => {
        if (recording) return;
        soundRecordBtn.disabled = true;
        try {
          recording = await recordCustomChime();
        } catch (err) {
          soundRecordBtn.disabled = false;
          pushToast(err.message || 'Couldn’t start recording.', 'error', 4600);
          return;
        }
        soundRecordBtn.disabled = false;
        syncCustomRow();
        const started = Date.now();
        const tick = () => {
          const ms = Math.min(CUSTOM_MAX_MS, Date.now() - started);
          recTime.textContent = '0:0' + Math.floor(ms / 1000) + ' / 0:0' + CUSTOM_MAX_MS / 1000;
          recBar.style.width = (ms / CUSTOM_MAX_MS) * 100 + '%';
          // Settings closed mid-recording: let go of the microphone.
          if (!recPanel.isConnected && recording) recording.cancel();
        };
        tick();
        const timer = setInterval(tick, 100);
        let dataUrl = null;
        try {
          dataUrl = await recording.done;
        } catch (err) {
          pushToast(err.message || 'Couldn’t save that recording.', 'error', 4600);
        }
        clearInterval(timer);
        recording = null;
        syncCustomRow();
        if (dataUrl) {
          const used = new Set(customChimes().map((c) => c.name));
          let n = 1;
          while (used.has('Recording ' + n)) n++;
          addCustomSound('Recording ' + n, dataUrl, 'recording');
        }
      },
    },
    Icon('mic', { size: 17 }),
    h('span', null, 'Record voice')
  );
  const soundActions = h(
    'div',
    { class: 'gb-sound-actions' },
    soundPickBtn,
    soundRecordBtn,
    soundFile
  );
  const soundFullHint = h(
    'div',
    { class: 'gb-field-hint', style: { display: 'none' } },
    'That’s ' + CUSTOM_MAX_COUNT + ' of your own — remove one to add another.'
  );
  function syncCustomRow() {
    const full = customChimes().length >= CUSTOM_MAX_COUNT;
    recPanel.style.display = recording ? '' : 'none';
    soundActions.style.display = recording || full ? 'none' : '';
    soundRecordBtn.style.display = canRecordChime() ? '' : 'none';
    soundFullHint.style.display = full && !recording ? '' : 'none';
  }
  const customSoundRow = h(
    'div',
    { class: 'gb-sounds' },
    h('div', { class: 'gb-sounds-head' }, h('span', null, 'Your sounds'), soundCount),
    customSoundList,
    soundActions,
    recPanel,
    soundFullHint
  );
  paintSounds();

  const notifPane = h(
    'div',
    { class: 'gb-settings-pane', style: { display: 'none' } },
    h('h3', { class: 'gb-settings-sec-label' }, 'Push notifications'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Get reminders and nudges on this device, even when the app is closed.'
    ),
    pushSectionBody,
    h('h3', { class: 'gb-settings-sec-label' }, 'Water reminders'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Steady sips beat one big glass. Needs notifications turned on above.'
    ),
    waterSectionBody,
    h('h3', { class: 'gb-settings-sec-label' }, 'Take a break'),
    h(
      'div',
      { class: 'gb-field-hint', style: { marginBottom: '12px' } },
      'A rough week? Your habit streaks hold without using freezes, and habit reminders, the evening reflection and the digest go quiet. Reminders you set a time for still ring.'
    ),
    breakSectionBody,
    h('h3', { class: 'gb-settings-sec-label' }, 'Quiet hours'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'No habit reminders, water nudges or digest in this window, on any device or on WhatsApp. The digest waits until it ends. Reminders you set a time for still ring.'
    ),
    quietSectionBody,
    h('h3', { class: 'gb-settings-sec-label' }, 'Buddy'),
    reflectSectionBody,
    h('h3', { class: 'gb-settings-sec-label' }, 'Notification sound'),
    h(
      'div',
      { class: 'gb-field-hint' },
      localNotificationsAvailable()
        ? 'What a reminder sounds like, in the app and on your lock screen. Tap one to hear it.'
        : 'What a reminder sounds like inside the app. Tap one to hear it. Notifications that arrive while the app is closed use your phone’s own sound.'
    ),
    soundPicker,
    customSoundRow,
    h(
      'div',
      { class: 'gb-field-hint', style: { marginTop: '8px' } },
      'Keep up to ' +
        CUSTOM_MAX_COUNT +
        ' of your own — a file under ' +
        Math.round(CUSTOM_MAX_BYTES / 1024) +
        ' KB, or your voice recorded here. Each stops after five seconds, follows you to your other devices, and can be picked for a single reminder or habit too.' +
        // True everywhere: Android can only ring a file that ships with the app,
        // and a Web Push notification rings with the browser's own sound.
        ' Plays in the app only — the lock screen uses built-in tones.'
    ),
    h('h3', { class: 'gb-settings-sec-label' }, 'Notify me about'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Off means no push or phone notification for it. It still shows in the bell.'
    ),
    ...notifyMuteRows(),
    h('h3', { class: 'gb-settings-sec-label' }, 'Keep read notifications for'),
    h('div', { class: 'gb-field-hint' }, 'Unread ones go after 90 days whatever you pick.'),
    keepReadPicker(),
    h('h3', { class: 'gb-settings-sec-label' }, 'WhatsApp reminders'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Verify your number once — timed reminders then arrive on WhatsApp.'
    ),
    waSectionBody,
    h('h3', { class: 'gb-settings-sec-label' }, 'Progress digest'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Get a short recap of your score, tasks and habits to stay on track.'
    ),
    digestSectionBody,
    h('h3', { class: 'gb-settings-sec-label' }, 'Working week'),
    workWeekBody
  );

  // ---- Account pane ----
  const verifiedChip = h(
    'span',
    { class: 'gb-pill', style: { background: 'var(--success-soft)', color: 'var(--success-soft-fg)' } },
    u.emailVerified ? 'Verified' : 'Unverified'
  );
  const accountPane = h(
    'div',
    { class: 'gb-settings-pane', style: { display: 'none' } },
    h('h3', { class: 'gb-settings-sec-label' }, 'Account'),
    h(
      'div',
      { class: 'gb-account-row' },
      h('div', { class: 'gb-field-label' }, 'Email'),
      h(
        'div',
        { class: 'gb-account-value' },
        h('span', { class: 'gb-account-email' }, u.email || '—'),
        verifiedChip
      )
    ),
    h(
      'div',
      { class: 'gb-account-row' },
      h('div', { class: 'gb-field-label' }, 'Progress'),
      h(
        'div',
        { class: 'gb-account-value' },
        'Level ' + (u.level || 1) + ' · ' + (u.xpTotal || 0) + ' XP'
      )
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-account-signout',
        onclick: () => logout(),
      },
      Icon('log-out', { size: 16 }),
      'Sign out'
    ),
    h('h3', { class: 'gb-settings-sec-label' }, 'Privacy'),
    shareProgressRow(),
    h(
      'div',
      { class: 'gb-field-hint', style: { margin: '10px 0' } },
      'A copy of everything your account holds, as a JSON file.'
    ),
    downloadDataButton(),
    ...securitySection(),
    h('h3', { class: 'gb-settings-sec-label' }, 'Danger zone'),
    h(
      'div',
      { class: 'gb-field-hint' },
      'Delete your account and all your data. It happens 7 days after you ask, and signing in before then cancels it.'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-account-signout is-danger',
        onclick: () => openDeleteAccount(),
      },
      Icon('trash-2', { size: 16 }),
      'Delete account'
    ),
    h('h3', { class: 'gb-settings-sec-label' }, 'About'),
    // The real build (vite.config.js BUILD), the number support asks for.
    h(
      'div',
      { class: 'gb-field-hint' },
      'Growth Buddy · build ' + __GB_BUILD__,
      ' · ',
      privacyLink()
    )
  );

  // ---- Top-level segmented slider nav ----
  // One door for everything a person can change about the app. Display and
  // Layout came from the old Customise modal; Security folded into Account.
  const { displayPane, layoutPane } = customisePanes();
  const remindersPane = reminderSettingsPane();
  const tabDefs = [
    { id: 'profile', label: 'Profile', pane: profilePane },
    { id: 'display', label: 'Display', pane: displayPane },
    { id: 'notifications', label: 'Alerts', pane: notifPane },
    { id: 'reminders', label: 'Reminders', pane: remindersPane },
    { id: 'layout', label: 'Layout', pane: layoutPane },
    { id: 'account', label: 'Account', pane: accountPane },
  ];
  const activeTab = tabDefs.some((t) => t.id === initialTab) ? initialTab : 'profile';
  const tabBar = buildSegSlider(tabDefs, activeTab);

  const body = h(
    'div',
    { class: 'gb-settings-body' },
    h(
      'div',
      { class: 'gb-settings-profile-header' },
      h('div', { class: 'gb-settings-avatar-circle' }, initials),
      h(
        'div',
        { class: 'gb-settings-profile-info' },
        h('div', { class: 'gb-settings-profile-name' }, u.displayName || 'Buddy'),
        h('div', { class: 'gb-settings-profile-email' }, u.email || ''),
        h(
          'span',
          { class: 'gb-settings-level-badge' },
          'Level ' + (u.level || 1) + ' · ' + (u.xpTotal || 0) + ' XP'
        )
      )
    ),
    tabBar,
    // Panes must be mounted in tab order — buildSegSlider only toggles display.
    profilePane,
    displayPane,
    notifPane,
    remindersPane,
    layoutPane,
    accountPane
  );

  openModal({
    // "Done", not "Save changes": every tab but Profile saves the moment you
    // touch it, so a Save button that only commits the Profile fields would be
    // lying on the other four. It still saves them — it just doesn't claim to
    // be the reason anything else stuck.
    title: 'Settings',
    sub: null,
    body,
    primary: 'Done',
    modalClass: 'gb-modal--settings',
    onPrimary: async () => {
      // Every field Done checks lives on Profile, so a refusal brings that tab
      // up: from Display, the toast named a field that wasn't on screen. All
      // the problems are collected and told at once, not one per press.
      const problems = [];
      const bad = (msg, ref) => {
        problems.push({ msg, ref });
        return null;
      };
      const showProfile = (ref) => {
        if (profilePane.style.display === 'none') tabBar.querySelector('[role="tab"]').click();
        if (ref) ref.focus();
      };
      const parseDobToAge = (raw, ref) => {
        if (!raw) return null;
        const dob = new Date(raw + 'T00:00:00');
        if (Number.isNaN(dob.getTime())) return bad('Date of birth is invalid.', ref);
        let age = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
        if (age < 10 || age > 100) return bad('Age must be between 10 and 100.', ref);
        return age;
      };
      const parseRanged = (label, raw, min, max, ref) => {
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < min || n > max) {
          return bad(label + ' must be between ' + min + ' and ' + max + '.', ref);
        }
        return Math.round(n);
      };

      // The PUT replaces every field. Two of them change behind an open sheet (the
      // device's zone sync, the water card's goal): left untouched here, they
      // send what the account has now, not what it had when the sheet opened.
      // A null timezone is "keep yours" on the server.
      const timezoneEdited = timezoneInput.value !== timezoneAtOpen;
      const waterGoalRaw = waterGoalInput.value === waterGoalAtOpen ? waterGoalShown() : waterGoalInput.value;
      const profilePayload = {
        displayName: visibleText(displayNameInput.value) || null,
        timezone: (timezoneEdited && (timezoneInput.value || '').trim()) || null,
        dob: dobInput.value || null,
        ageYears: parseDobToAge(dobInput.value, dobInput),
        heightCm: parseRanged('Height', heightInput.value, 100, 250, heightInput),
        weightKg: parseRanged('Weight', weightInput.value, 25, 300, weightInput),
        gender: genderSel.value || '' || null,
        fitnessGoal: (fitnessGoalInput.value || '').trim() || null,
        dietPreference: (dietInput.value || '').trim() || null,
        allergicTo: (allergicInput.value || '').trim() || null,
        favouriteDish: (favDishInput.value || '').trim() || null,
        aboutMe: (aboutInput.value || '').trim() || null,
        dailyFoodGoalKcal: parseRanged(
          'Daily food goal',
          foodGoalInput.value,
          800,
          6000,
          foodGoalInput
        ),
        dailyWaterGoalMl: parseRanged(
          'Daily water goal',
          waterGoalRaw,
          1000,
          7000,
          waterGoalInput
        ),
      };
      if (problems.length) {
        showProfile(problems[0].ref);
        throw new Error(problems.map((p) => p.msg).join(' '));
      }

      // openModal already disables Done for the wait; say what it is waiting on.
      const doneBtn = body.closest('.gb-modal')?.querySelector(':scope > .gb-btn--primary');
      if (doneBtn) doneBtn.textContent = 'Saving…';
      try {
        await saveProfileDetails(profilePayload);
      } catch (err) {
        // The server's one check here is the timezone ("Unknown timezone: ...").
        showProfile(/timezone/i.test((err && err.message) || '') ? timezoneInput : null);
        throw err;
      } finally {
        if (doneBtn) doneBtn.textContent = 'Done';
      }
    },
  });
}

async function getNutritionSuggestion(form) {
  return api('/api/auth/nutrition-suggestion', {
    method: 'POST',
    body: JSON.stringify(form || {}),
  });
}

/* Every reminder as an .ics file (GET /api/reminders/export.ics), handed to the
   OS the way "Download my data" is (offerFile, save-file.js). */
async function exportRemindersIcs(btn) {
  if (btn) btn.disabled = true;
  try {
    let text = '';
    await api('/api/reminders/export.ics', {
      headers: { Accept: 'text/calendar' },
      raw: true,
      onResponse: async (res) => {
        text = await res.text();
      },
    });
    const name = 'growth-buddy-reminders.ics';
    const blob = new Blob([text], { type: 'text/calendar' });
    if ((await offerFile(blob, name, 'Growth Buddy reminders')) === 'saved') {
      pushToast(
        'Your calendar file is downloading. Open it in Google, Apple or Outlook Calendar.',
        'success',
        4000
      );
    }
  } catch (err) {
    toastError(err, 'Could not export your reminders.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---- Connect your bank (Account Aggregator via Setu; BankFeedService) ----
   Consent once on the user's AA, then debits and credits arrive in Money as
   ordinary, editable entries marked "Bank". The whole section stays empty when
   the server has no Setu credentials. */
function bankFeedSection() {
  const box = h('div', { class: 'gb-bank-feed' });
  const paint = (st) => {
    if (!st || !st.configured) {
      box.replaceChildren();
      return;
    }
    const rows = (st.consents || []).map((c) => {
      const accts = (c.accounts || []).map((a) => '\u2022\u2022' + a.mask).join(', ');
      const what =
        c.status === 'PENDING'
          ? 'Waiting for your approval'
          : /ACTIVE|APPROVED/.test(c.status)
            ? (accts || 'Connected') +
              (c.syncing
                ? ' \u00b7 Fetching\u2026'
                : c.lastSyncedAt
                  ? ' \u00b7 Synced ' + relativeTime(c.lastSyncedAt)
                  : '')
            : 'Ended (' + c.status.toLowerCase() + ')';
      return h(
        'div',
        { class: 'gb-bank-row' },
        h('span', { class: 'gb-money-cat-ic' }, Icon('landmark', { size: 15, sw: 2.2 })),
        h(
          'div',
          { class: 'gb-bank-copy' },
          h('strong', null, 'Bank feed'),
          h('span', null, what),
          c.error ? h('span', { class: 'gb-field-hint' }, c.error) : null
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--ghost gb-btn--compact',
            onclick: () =>
              openModal({
                title: 'Disconnect this bank?',
                sub: 'Nothing more is fetched. Entries already imported stay in Money.',
                body: null,
                primary: 'Disconnect',
                destructive: true,
                errorMessage: 'Could not disconnect.',
                onPrimary: async () => {
                  try {
                    await api('/api/money/bank/' + encodeURIComponent(c.id), { method: 'DELETE' });
                    toastSuccess('Bank disconnected.');
                  } finally {
                    load();
                  }
                },
              }),
          },
          'Disconnect'
        )
      );
    });
    const live = (st.consents || []).some((c) => /ACTIVE|APPROVED|PENDING/.test(c.status));
    box.replaceChildren(
      h('h3', { class: 'gb-settings-sec-label' }, 'Bank feed'),
      h(
        'div',
        { class: 'gb-field-hint' },
        'Approve once through an RBI Account Aggregator and your bank spends and income show up here on their own. Every entry stays editable.'
      ),
      ...rows,
      h(
        'div',
        { class: 'gb-bank-actions' },
        live
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--compact',
                onclick: async (e) => {
                  const done = setThinking(e.currentTarget, 'Syncing');
                  try {
                    const r = await api('/api/money/bank/sync', { method: 'POST' });
                    if (r.imported > 0) {
                      const theirs = await api('/api/money', { onResponse: rememberMoneyVersion });
                      adoptServerMoney(theirs);
                      cacheMoney();
                      persistMoney();
                      render();
                    }
                    toastSuccess(
                      r.imported > 0
                        ? r.imported + ' new from your bank.'
                        : r.pending > 0
                          ? 'Your bank is preparing the data. It will show up shortly.'
                          : 'Up to date.'
                    );
                  } catch (err) {
                    toastError(err, 'Could not sync right now.');
                  } finally {
                    done();
                  }
                  load();
                },
              },
              'Sync now'
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary gb-btn--compact',
            onclick: () => openConnectBank(load),
          },
          live ? 'Add another bank' : 'Connect your bank'
        )
      )
    );
    refreshIcons();
  };
  const load = () =>
    api('/api/money/bank')
      .then(paint)
      .catch(() => paint(null));
  load();
  return box;
}

function openConnectBank(onDone) {
  const phone = String((state.user && state.user.whatsappNumber) || '').replace(/^\+91/, '');
  const input = h('input', {
    type: 'tel',
    class: 'gb-input',
    inputmode: 'numeric',
    autocomplete: 'tel-national',
    maxlength: '14',
    value: /^\d{10}$/.test(phone) ? phone : '',
    placeholder: '10-digit mobile',
  });
  openModal({
    title: 'Connect your bank',
    sub: 'Your Account Aggregator asks you to pick accounts and approve. Only transactions are shared, read-only, and you can revoke it any time.',
    body: h(
      'div',
      null,
      h('label', { class: 'gb-field-label' }, 'Mobile number registered with your bank'),
      input
    ),
    primary: 'Continue',
    errorMessage: 'Could not start the connection.',
    onPrimary: async () => {
      const r = await api('/api/money/bank/connect', {
        method: 'POST',
        body: JSON.stringify({ mobile: input.value.trim() }),
      });
      const browser = nativePlugin('Browser');
      if (browser) await browser.open({ url: r.url });
      else window.open(r.url, '_blank', 'noopener');
      toastSuccess('Approve on the next screen. Entries start arriving once you do.');
      onDone();
    },
  });
}

/* Each reply below is the whole user as of that PUT: one landing after a newer
   tap's reply put the older layout back. Only the newest save's reply is adopted. */
const accountSaves = latestSeq();

/** Persist progress-digest preferences (frequency + send hour) to the account. */
async function saveDigestPrefs(frequency, hour) {
  const n = accountSaves.start('digest');
  const updated = await api('/api/auth/digest', {
    method: 'PUT',
    body: JSON.stringify({ frequency, hour }),
  });
  if (!accountSaves.isLatest('digest', n)) return;
  syncUserSession(updated);
  render();
}

/** Persist the ordered home-screen layout (which widgets show, in order). */
async function saveHomeLayout(layout) {
  // Optimistic local update so Home + the editor stay in sync immediately.
  state.user = Object.assign({}, state.user, { homeLayout: layout });
  saveSession(state.user, loadToken());
  render();
  try {
    const n = accountSaves.start('home');
    const updated = await api('/api/auth/home-layout', {
      method: 'PUT',
      body: JSON.stringify({ layout }),
    });
    if (accountSaves.isLatest('home', n)) syncUserSession(updated);
  } catch (err) {
    toastError(err, 'Could not save your home layout.');
  }
}

/** Persist the ordered bottom-nav layout (bar vs More + order). */
async function saveNavLayout(layout) {
  // Optimistic local update so the bar + editor stay in sync immediately.
  state.user = Object.assign({}, state.user, { navLayout: layout });
  saveSession(state.user, loadToken());
  render();
  try {
    const n = accountSaves.start('nav');
    const updated = await api('/api/auth/nav-layout', {
      method: 'PUT',
      body: JSON.stringify({ layout }),
    });
    if (accountSaves.isLatest('nav', n)) syncUserSession(updated);
  } catch (err) {
    toastError(err, 'Could not save your navigation layout.');
  }
}
