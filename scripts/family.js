/* =====================================================================
   Growth Buddy — Family tab & AI South Indian meal planner

   Self-contained screen (like ScreenMentor): owns its own data + view
   state and repaints its own subtree, so the parent only has to pass an
   `api` object of thin fetch wrappers. See SCREENS.family in app.js.
   ===================================================================== */
import {
  h,
  Icon,
  CrashCard,
  confirmDialog,
  openModal,
  fieldRefusal,
  thinkingLabel,
  trackOverlay,
} from './gb-kit.js';
import { toast } from './toast.js';
import { shrinkPhoto } from './notes.js';
import { isNative } from './native.js';

const RELATIONSHIPS = [
  'mother',
  'father',
  'brother',
  'sister',
  'grandfather',
  'grandmother',
  'spouse',
  'child',
  'other',
];

const DIETS = ['Vegetarian', 'Non-Vegetarian', 'Eggetarian', 'Vegan'];

// Default gender inferred from a relationship (still switchable in the form).
const REL_GENDER = {
  mother: 'Female',
  sister: 'Female',
  grandmother: 'Female',
  father: 'Male',
  brother: 'Male',
  grandfather: 'Male',
};

/* What people call their relatives, as typed into Name, to the relationship it
   names: "Amma" fills Mother. Lower-cased whole words; first match wins. */
const NAME_REL = {
  mother: ['amma', 'mom', 'mum', 'mummy', 'mother', 'maa', 'ammi'],
  father: ['appa', 'dad', 'daddy', 'papa', 'father', 'abba', 'pappa'],
  grandmother: ['paati', 'patti', 'ammamma', 'achamma', 'grandma', 'granny', 'nani', 'dadi', 'ammachi'],
  grandfather: ['thatha', 'tatha', 'appappa', 'grandpa', 'nana', 'dada', 'appachan'],
  brother: ['anna', 'thambi', 'bro', 'brother', 'bhai', 'bhaiya', 'chetta'],
  sister: ['akka', 'thangai', 'thangachi', 'sis', 'sister', 'didi', 'chechi'],
  spouse: ['wife', 'husband', 'spouse', 'hubby', 'wifey'],
  child: ['son', 'daughter', 'kid', 'baby', 'magan', 'magal', 'kutty', 'beta', 'beti'],
};
function relFromName(name) {
  const words = String(name || '').toLowerCase().split(/[^a-z]+/);
  for (const rel in NAME_REL) if (NAME_REL[rel].some((w) => words.includes(w))) return rel;
  return null;
}

const MEALS = [
  { key: 'breakfast', label: 'Breakfast', icon: 'sunrise' },
  { key: 'lunch', label: 'Lunch', icon: 'utensils' },
  { key: 'snack', label: 'Evening snack', icon: 'leaf' },
  { key: 'dinner', label: 'Dinner', icon: 'utensils-crossed' },
];

/* A pantry item's category from its name ("Toor dal" -> Pulse), so the form
   stops filing everything as a Vegetable. First match wins; none -> null. */
const CATEGORY_WORDS = [
  ['Pulse', /\b(dal|dhal|lentils?|gram|chana|rajma|moong|urad|toor|masoor|chickpeas?)\b/],
  ['Dairy', /\b(curd|milk|paneer|ghee|butter|cheese|yog(h)?urt|cream|buttermilk)\b/],
  [
    'Grain',
    /\b(rice|atta|flour|wheat|rava|sooji|semolina|ragi|oats|millet|poha|bread|maida|vermicelli)\b/,
  ],
  ['Protein', /\b(eggs?|chicken|mutton|fish|prawns?|meat|tofu|soya)\b/],
  [
    'Spice',
    /\b(salt|chill?i(es)? powder|turmeric|masala|cumin|jeera|mustard|pepper|cardamom|cloves?|cinnamon|hing|asafoetida)\b/,
  ],
  [
    'Fruit',
    /\b(apples?|bananas?|mangoe?s?|oranges?|grapes?|papaya|guava|pomegranate|lemons?|watermelon|pineapple)\b/,
  ],
];
function pantryCategory(name) {
  const n = String(name || '').toLowerCase();
  const hit = CATEGORY_WORDS.find(([, re]) => re.test(n));
  return hit ? hit[0] : null;
}

function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function cap(s) {
  s = String(s || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Pluralised age labels for the summary strip. There was an AGE_ACCENT map here
// too, colouring each avatar by age band — but the band is already written on
// every card ("19 yrs · Adult · Male"), so the colour repeated it, and a family
// of four adults just got four identical pink circles competing with the orange
// everything else on the screen uses.
const AGE_PLURAL = {
  Infant: 'Infants',
  Child: 'Children',
  Teenager: 'Teenagers',
  Adult: 'Adults',
  'Senior Citizen': 'Seniors',
  Unknown: 'without a birth date',
};
/** Comma-separated string <-> trimmed list. */
function toList(str) {
  return String(str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
function fromList(list) {
  return Array.isArray(list) ? list.join(', ') : '';
}

/** "2026-10-11" (a LocalDate) -> "Sun, 11 Oct", read as a local day, not UTC midnight. */
/* A multi-day plan's day by its date ("Mon 12 Oct"): day 1 is the local day the
   plan was made, as the planner writes it. "Day N" only when there is no date. */
function planDayLabel(wk, index) {
  const made = wk && wk.createdAt ? new Date(wk.createdAt) : null;
  if (!made || isNaN(made)) return 'Day ' + (index + 1);
  made.setDate(made.getDate() + index);
  return fmtDay(made.toLocaleDateString('en-CA')) || 'Day ' + (index + 1);
}

function fmtDay(iso) {
  const [y, m, d] = String(iso || '')
    .slice(0, 10)
    .split('-')
    .map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Enter in any of `inputs` runs `fn`, as a form's submit would. */
function onEnter(fn, ...inputs) {
  inputs.forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        fn();
      }
    })
  );
}

/* The next time a `YYYY-MM-DD` birthday comes round, today included. A 29 Feb
   one lands on the 28th in a common year: the yearly rule then keeps the 28th. */
function nextBirthday(dob) {
  const [, m, d] = dob.split('-').map(Number);
  const now = new Date();
  const today = now.toLocaleDateString('en-CA');
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
    const day = Math.min(d, new Date(y, m, 0).getDate());
    const key = y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    if (key >= today) return key;
  }
}

/* A small "at what time?" dialog; `onTime('HH:MM')` does the saving. */
function askReminderTime(title, sub, onTime) {
  const timeI = h('input', {
    type: 'time',
    class: 'gb-input',
    value: '09:00',
    'aria-label': 'Time',
  });
  openModal({
    title,
    sub,
    body: field('Remind at', timeI),
    primary: 'Set reminder',
    errorMessage: 'Could not set that reminder.',
    onPrimary: () => {
      if (!timeI.value) throw fieldRefusal(timeI, 'Pick a time.');
      return onTime(timeI.value);
    },
  });
}

function field(labelText, control, hint) {
  return h(
    'label',
    { class: 'gb-field' },
    h('span', { class: 'gb-field-label' }, labelText),
    control,
    hint ? h('span', { class: 'gb-field-hint' }, hint) : null
  );
}

/**
 * ScreenFamily({ api, open })
 *   open: 'add' (Add member form) | 'plan' (Meals today) | null, from Home's
 *         Family meals pack and card; applied once, when the first load lands.
 *   api: { getFamily, startSolo, addMember, updateMember, updateProfile, removeMember,
 *          searchUsers, linkMember, scanGrocery, generateMealPlan, getMealPlan }
 */
function ScreenFamily({ api, open }) {
  const root = h('div', { class: 'gb-family gb-rise' });

  const model = {
    loading: true,
    error: '',
    family: null, // { familyId, ownerUserId, isOwner, members: [] }
    invites: [], // pending invitations addressed to the current user
    panel: null, // null | {type:'add'} | {type:'edit',member} | {type:'profile',member} | {type:'link'}
    // Meal planner
    ingredients: [], // [{ name, category, quantity, freshness }]
    selectedMemberIds: null, // null = everyone
    planDiet: null, // the Food row's pick while nobody planned for has a diet (DIETS[0] shown)
    scanMsg: '',
    scanBusy: false,
    plan: null, // last MealPlanResponse { plan, groceryItems, source, createdAt }
    planBusy: false,
    planError: '',
    // Sectioned planner UI
    section: 'members', // members | chores | plan | weekly | pantry | shopping | favourites
    weekly: null, // last MultiDayPlanResponse
    weeklyBusy: false,
    weeklyError: '',
    weeklyOpts: { days: 7, occasion: 'normal', usePantry: true },
    pantryItems: null, // null = not loaded yet
    pantryScanBusy: false,
    pantryScanMsg: '',
    shoppingList: null, // { items, totalEstimatedCost }
    shoppingBusy: false,
    favourites: null,
    openFavouriteId: null,
    sectionErrors: {}, // section key -> message, when that section's fetch failed
    chores: null, // [ChoreResponse], open first
    choreDraft: { title: '', assigneeMemberId: null, dueDate: '', repeat: 'none' },
    planHistory: null, // last 8 MealPlanResponse, newest first (current included)
    recipes: null, // [RecipeResponse]
  };

  // ---- data ----

  function applyFamily(resp) {
    model.family = resp || null;
  }

  function applyPlan(plan) {
    if (!plan) return;
    model.plan = plan;
    if (Array.isArray(plan.groceryItems) && !model.ingredients.length) {
      // The expired pantry items went in as "do not use" (see generate); they
      // come back in the plan's groceries and are not something to cook with.
      model.ingredients = plan.groceryItems.filter((g) => g.freshness !== 'expired').map((g) => ({
        name: g.name,
        category: g.category || 'Other',
        quantity: g.quantity || '',
        freshness: g.freshness || '',
      }));
    }
  }

  /* One loader per section. Each section's failure is its own: it used to be
     swallowed into an empty list, so a failed shopping fetch read as "List is
     empty" — and building a new list on top of that duplicated the real one. */
  const SECTION_LOADERS = {
    plan: () => api.getMealPlan().then(applyPlan),
    invites: () =>
      api.getInvites().then((r) => {
        model.invites = r || [];
      }),
    weekly: () =>
      api.getWeekly().then((w) => {
        model.weekly = w || false;
      }),
    pantry: () =>
      api.listPantry().then((r) => {
        model.pantryItems = r || [];
      }),
    shopping: () =>
      api.listShopping().then((r) => {
        model.shoppingList = overlayPending(r || { items: [], totalEstimatedCost: 0 });
      }),
    favourites: () =>
      api.listFavourites().then((r) => {
        model.favourites = r || [];
      }),
    chores: () =>
      api.listChores().then((r) => {
        model.chores = overlayChoreTicks(r || []);
      }),
    history: () =>
      api.planHistory().then((r) => {
        model.planHistory = r || [];
      }),
    recipes: () =>
      api.listRecipes().then((r) => {
        model.recipes = r || [];
      }),
  };
  const SECTION_EMPTY = {
    chores: () => (model.chores = []),
    history: () => (model.planHistory = []),
    recipes: () => (model.recipes = []),
    invites: () => (model.invites = []),
    weekly: () => (model.weekly = false),
    pantry: () => (model.pantryItems = []),
    shopping: () => (model.shoppingList = { items: [], totalEstimatedCost: 0 }),
    favourites: () => (model.favourites = []),
  };

  function loadSection(key) {
    return SECTION_LOADERS[key]()
      .then(() => {
        delete model.sectionErrors[key];
      })
      .catch((err) => {
        model.sectionErrors[key] = (err && err.message) || 'Could not load this.';
        if (SECTION_EMPTY[key]) SECTION_EMPTY[key]();
      });
  }

  function retrySection(key) {
    delete model.sectionErrors[key];
    paint();
    loadSection(key).then(paint);
  }

  /* The banner a section shows instead of pretending to be empty. */
  function sectionError(key, what) {
    const msg = model.sectionErrors[key];
    if (!msg) return null;
    return h(
      'div',
      { class: 'gb-card gb-family-section-error', role: 'alert' },
      Icon('circle-alert', { size: 16, color: 'var(--coral-600)' }),
      h('span', null, 'Could not load ' + what + '.'),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-btn--sm',
          onclick: () => retrySection(key),
        },
        'Try again'
      )
    );
  }

  async function load() {
    model.loading = true;
    model.error = '';
    model.sectionErrors = {};
    paint();
    try {
      // Prefetch every section so switching is instant and the nav can show
      // live count badges. Planner endpoints return empty when there's no family.
      const [fam] = await Promise.all([
        api.getFamily(),
        ...Object.keys(SECTION_LOADERS).map(loadSection),
      ]);
      applyFamily(fam);
    } catch (err) {
      model.error = err.message || 'Could not load your family.';
    } finally {
      model.loading = false;
      const o = open;
      open = null;
      if (o === 'plan' && model.family && model.family.familyId) model.section = 'plan';
      if (o === 'add' && !model.error) openPanel({ type: 'add' });
      else paint();
    }
  }

  /* ---- live: another member changed something ----
     app.js turns the server's `family_changed` frame into `gb:family-changed`.
     Refetch just that slice. Never repaint over an open panel or a field being
     typed in — the change waits for the panel to close / the field to blur. */
  let deferredPaint = false;
  function typingHere() {
    const a = document.activeElement;
    return (
      !!a &&
      root.contains(a) &&
      (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox'))
    );
  }
  function paintSoon() {
    if (model.loading) return;
    if (model.panel || typingHere()) {
      deferredPaint = true;
      return;
    }
    paint();
  }
  root.addEventListener('focusout', () => {
    if (deferredPaint) setTimeout(paintSoon, 0);
  });
  let wasMounted = false;
  function onFamilyChanged(e) {
    if (!root.isConnected) {
      if (wasMounted) window.removeEventListener('gb:family-changed', onFamilyChanged);
      return;
    }
    wasMounted = true;
    const section = (e && e.detail && e.detail.section) || 'members';
    if (section === 'members') {
      Promise.all([api.getFamily(), loadSection('invites')])
        .then(([fam]) => {
          applyFamily(fam);
          paintSoon();
        })
        .catch(() => {});
    } else if (SECTION_LOADERS[section]) {
      // A new / reused plan is also a new history row.
      Promise.all([loadSection(section), section === 'plan' ? loadSection('history') : null]).then(
        paintSoon
      );
    }
  }
  window.addEventListener('gb:family-changed', onFamilyChanged);
  requestAnimationFrame(() => {
    if (root.isConnected) wasMounted = true;
  });

  // Runs one save. Only the pressed button is disabled while it runs, and
  // nothing is repainted until it resolves: a repaint before the save rebuilt
  // the form (wiping what was typed), and a failure now leaves the screen
  // exactly as it was. The button is read off window.event because every
  // caller runs inside its click handler; after an await (a confirm) it is
  // gone, and the dialog already guarded the double tap.
  // A disabled button fires no click, so that is the double-tap guard too.
  async function run(promise, onOk) {
    const ev = window.event;
    const t = ev && ev.currentTarget;
    const btn = t instanceof HTMLButtonElement || t instanceof HTMLInputElement ? t : null;
    if (btn) btn.disabled = true;
    let res;
    try {
      res = await promise;
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        if (btn.type === 'checkbox') btn.checked = !btn.checked; // the toggle didn't happen
      }
      toast.error(err, 'Something went wrong.');
      return;
    }
    // One repaint: onOk may already have done it (closePanel, load).
    const before = paints;
    if (onOk) onOk(res);
    if (paints === before) paint();
  }

  // ---- member cards ----

  function statusPill(m) {
    if (m.status === 'mapped') {
      return h('span', { class: 'gb-pill gb-pill--ok' }, 'Account linked');
    }
    if (m.status === 'invited') {
      return h('span', { class: 'gb-pill gb-pill--soft' }, 'Invite pending');
    }
    return h('span', { class: 'gb-pill gb-pill--muted' }, 'Not linked yet');
  }

  function memberCard(m) {
    const isOwner = model.family && model.family.isOwner;
    // The server lets the owner edit anyone and a member edit themselves
    // (requireManageOrSelf). The profile button used to show on everyone's card,
    // so a member could fill in a relative's form and only then be refused.
    const canEdit = isOwner || m.isSelf;
    const canRemove = isOwner && m.relationship !== 'self' && !m.isOwner;
    const metaBits = [];
    // No-break spaces keep a number with its unit ("60 / kg" split across lines).
    if (m.age != null) metaBits.push(m.age + '\u00a0yrs · ' + m.ageCategory);
    else metaBits.push('Age not set');
    if (m.gender) metaBits.push(m.gender);
    const hw = [
      m.heightCm ? m.heightCm + '\u00a0cm' : null,
      m.weightKg ? m.weightKg + '\u00a0kg' : null,
    ].filter(Boolean);
    if (hw.length) metaBits.push(hw.join(', '));
    if (m.profile && m.profile.dietPreference) metaBits.push(m.profile.dietPreference);

    const actions = h(
      'div',
      { class: 'gb-family-card-actions' },
      m.dob && !m.isSelf
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Remind me of ' + m.name + "'s birthday",
              title: 'Birthday reminder',
              onclick: () => {
                const day = nextBirthday(m.dob);
                askReminderTime(m.name + "'s birthday", 'Every year, from ' + fmtDay(day), (time) =>
                  api
                    .addReminder({
                      text: m.name + "'s birthday",
                      date: day,
                      time,
                      tag: 'personal',
                      repeat: 'yearly',
                    })
                    .then(() => toast.success('Birthday reminder set for ' + fmtDay(day) + '.'))
                );
              },
            },
            Icon('calendar-heart', { size: 16 })
          )
        : null,
      canEdit
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Edit ' + m.name + '’s food profile',
              title: 'Food profile',
              onclick: () => openPanel({ type: 'profile', member: m }),
            },
            Icon('utensils', { size: 17 })
          )
        : null,
      canEdit
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Edit ' + m.name,
              title: 'Edit',
              onclick: () => openPanel({ type: 'edit', member: m }),
            },
            Icon('pencil', { size: 16 })
          )
        : null,
      m.status === 'unmapped' && isOwner
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Link to an account',
              title: 'Link to an account',
              onclick: () => openPanel({ type: 'link', member: m }),
            },
            Icon('user-plus', { size: 16 })
          )
        : null,
      // Hand the family on — the only way an owner can then leave it.
      isOwner && m.status === 'mapped' && m.linkedUserId && !m.isSelf
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Make ' + m.name + ' the owner',
              title: 'Make owner',
              onclick: () => transferOwner(m),
            },
            Icon('star', { size: 16 })
          )
        : null,
      canRemove
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn gb-iconbtn--danger',
              'aria-label': 'Remove ' + m.name,
              title: 'Remove',
              onclick: () => removeMember(m),
            },
            Icon('trash-2', { size: 16 })
          )
        : null
    );

    const allergyTags = (m.profile && m.profile.allergies) || [];
    return h(
      'div',
      { class: 'gb-card gb-family-card' },
      h(
        'div',
        { class: 'gb-family-card-head' },
        h('div', { class: 'gb-family-avatar' }, initials(m.name)),
        h(
          'div',
          { class: 'gb-family-card-id' },
          h(
            'div',
            { class: 'gb-family-card-name' },
            m.name,
            m.isSelf ? h('span', { class: 'gb-pill gb-pill--soft' }, 'You') : null
          ),
          h('div', { class: 'gb-family-card-rel' }, cap(m.relationship)),
          h('div', { class: 'gb-family-card-meta' }, metaBits.join(' · '))
        ),
        statusPill(m)
      ),
      allergyTags.length
        ? h(
            'div',
            { class: 'gb-family-card-tags' },
            Icon('circle-alert', { size: 13, color: 'var(--coral-600)' }),
            h('span', null, 'Allergic: ' + allergyTags.join(', '))
          )
        : null,
      actions
    );
  }

  async function removeMember(m) {
    const ok = await confirmDialog({
      title: 'Remove ' + m.name + ' from your family?',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      danger: true,
    });
    if (!ok) return;
    run(api.removeMember(m.id), applyFamily);
  }

  async function transferOwner(m) {
    const ok = await confirmDialog({
      title: 'Make ' + m.name + ' the owner?',
      message:
        "They'll manage members and invites. You stay in the family, and can leave it afterwards.",
      confirmLabel: 'Make owner',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    run(api.transferOwnership(m.id), (res) => {
      applyFamily(res);
      toast.success(m.name + ' now owns the family.');
    });
  }

  // ---- panels (add / edit / profile / link) ----

  // The steps replace the page in place, so the button that was pressed is
  // gone and focus fell to the top of the document. Land it on the new step's
  // heading instead, and back on the page's first heading when one closes.
  function focusHeading() {
    const el = root.querySelector('h2, h1');
    if (!el) return;
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: false });
  }
  // Closing a panel returns to where the user was in the list, not the top:
  // remember the scroll offset on the way in and put it back on the way out.
  let listScroll = 0;
  // Back (Android's, the browser's) closes the panel rather than the Family
  // screen: the panel joins gb-kit's sheet stack while it is up. One entry
  // for the chooser -> form pair, as for any stacked sheets.
  let untrackPanel = null;
  function openPanel(panel) {
    const scroller = root.closest('.gb-scroll');
    if (!model.panel && scroller) listScroll = scroller.scrollTop;
    if (!untrackPanel) untrackPanel = trackOverlay({ close: closePanel });
    model.panel = panel;
    paint();
    focusHeading();
  }
  function closePanel() {
    if (untrackPanel) untrackPanel();
    untrackPanel = null;
    model.panel = null;
    paint();
    const el = root.querySelector('h2, h1');
    if (el) {
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
    const scroller = root.closest('.gb-scroll');
    if (scroller) scroller.scrollTop = listScroll;
  }

  function panelHeader(title) {
    return h(
      'div',
      { class: 'gb-family-panel-head' },
      h(
        'button',
        { type: 'button', class: 'gb-iconbtn', 'aria-label': 'Back', onclick: closePanel },
        Icon('chevron-left', { size: 20 })
      ),
      h('h2', { class: 'gb-family-panel-title' }, title)
    );
  }

  // A new member starts with no relationship and no gender: the form used to
  // open on Mother / Female, so "Anu, Child" saved as a girl nobody said she was.
  function memberFormControls(member) {
    const initialRel = (member && member.relationship) || '';
    const initialGender = (member && member.gender) || REL_GENDER[initialRel] || '';

    const nameInput = h('input', {
      type: 'text',
      class: 'gb-input',
      value: (member && member.name) || '',
      placeholder: 'e.g. Amma',
      maxlength: 120,
    });
    const genderSelect = h(
      'select',
      { class: 'gb-input' },
      ['', 'Female', 'Male', 'Other'].map((g) =>
        h('option', { value: g, selected: initialGender === g }, g || 'Prefer not to say')
      )
    );
    // Gender follows the relationship until it is picked by hand: Mother fills
    // Female, and Child after it clears it again instead of keeping Female.
    let genderPicked = !!(member && member.gender);
    genderSelect.addEventListener('change', () => (genderPicked = true));
    const syncGender = () => {
      if (!genderPicked) genderSelect.value = REL_GENDER[relSelect.value] || '';
    };
    const relSelect = h(
      'select',
      {
        class: 'gb-input',
        disabled: member && member.relationship === 'self',
        onchange: () => syncGender(),
      },
      member ? null : h('option', { value: '', selected: true }, 'Choose'),
      RELATIONSHIPS.map((r) => h('option', { value: r, selected: initialRel === r }, cap(r)))
    );
    const dobInput = h('input', {
      type: 'date',
      class: 'gb-input',
      // en-CA is YYYY-MM-DD in local time; the server refuses a future date too.
      max: new Date().toLocaleDateString('en-CA'),
      value: (member && member.dob) || '',
    });
    const heightInput = h('input', {
      type: 'number',
      class: 'gb-input',
      min: 30,
      max: 250,
      value: member && member.heightCm != null ? member.heightCm : '',
      placeholder: 'Height (cm)',
    });
    const weightInput = h('input', {
      type: 'number',
      class: 'gb-input',
      min: 2,
      max: 400,
      value: member && member.weightKg != null ? member.weightKg : '',
      placeholder: 'Weight (kg)',
    });
    return { nameInput, relSelect, dobInput, genderSelect, heightInput, weightInput, syncGender };
  }

  function intOrNull(input) {
    const v = parseInt(input.value, 10);
    return Number.isFinite(v) ? v : null;
  }

  // One form: a profile is what most people add, so it opens on that; the
  // invite path is one link away. The name fills the relationship while the
  // select is untouched ("Amma" -> Mother, and her gender with it).
  function addPanel() {
    const c = memberFormControls(null);
    let relPicked = false;
    c.relSelect.addEventListener('change', () => (relPicked = true));
    c.nameInput.addEventListener('input', () => {
      const rel = !relPicked && relFromName(c.nameInput.value);
      if (!rel || c.relSelect.value === rel) return;
      c.relSelect.value = rel;
      c.syncGender();
    });
    const save = (again) => {
      const name = c.nameInput.value.trim();
      if (!name) {
        toast.error(null, 'Please enter a name.');
        c.nameInput.focus();
        return;
      }
      // People search goes by name, never email (UserRepository), so an
      // address here would only become a profile called "a@b.com".
      if (name.includes('@')) {
        toast.error(null, 'To invite someone, use Invite them instead and search their name.');
        c.nameInput.focus();
        return;
      }
      // `max` only stops the picker; a typed year still gets through.
      if (c.dobInput.value && c.dobInput.value > c.dobInput.max) {
        toast.error(null, 'Date of birth cannot be in the future.');
        c.dobInput.focus();
        return;
      }
      run(
        api.addMember({
          name,
          relationship: c.relSelect.value || null, // not chosen: the server saves Other
          dob: c.dobInput.value || null,
          gender: c.genderSelect.value || null,
          heightCm: intOrNull(c.heightInput),
          weightKg: intOrNull(c.weightInput),
        }),
        (resp) => {
          applyFamily(resp);
          if (!again) return closePanel();
          toast.success('Added ' + name + '.');
          openPanel({ type: 'add' }); // a fresh form for the next one
          const next = root.querySelector('.gb-family-panel input');
          if (next) next.focus();
        }
      );
    };
    return h(
      'div',
      { class: 'gb-family-panel' },
      panelHeader('Add family member'),
      h(
        'p',
        { class: 'gb-family-panel-sub' },
        'A profile for someone you cook for, no account needed. ',
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--ghost gb-btn--sm',
            onclick: () => openPanel({ type: 'link', member: null }),
          },
          'On Growth Buddy already? Invite them'
        )
      ),
      field('Name', c.nameInput),
      field('Relationship', c.relSelect),
      field('Date of birth (optional)', c.dobInput),
      field('Gender (optional)', c.genderSelect),
      h(
        'div',
        { class: 'gb-family-form-row' },
        field('Height (cm)', c.heightInput),
        field('Weight (kg)', c.weightInput)
      ),
      h('button', { type: 'button', class: 'gb-btn gb-btn--primary', onclick: () => save(false) }, 'Add member'),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: () => save(true) },
        'Save and add another'
      )
    );
  }

  function editPanel(member) {
    const c = memberFormControls(member);
    const save = () => {
      const name = c.nameInput.value.trim();
      if (!name) {
        toast.error(null, 'Please enter a name.');
        c.nameInput.focus();
        return;
      }
      // `max` only stops the picker; a typed year still gets through.
      if (c.dobInput.value && c.dobInput.value > c.dobInput.max) {
        toast.error(null, 'Date of birth cannot be in the future.');
        c.dobInput.focus();
        return;
      }
      run(
        api.updateMember(member.id, {
          name,
          relationship: c.relSelect.value,
          dob: c.dobInput.value || null,
          gender: c.genderSelect.value || null,
          heightCm: intOrNull(c.heightInput),
          weightKg: intOrNull(c.weightInput),
        }),
        (resp) => {
          applyFamily(resp);
          closePanel();
        }
      );
    };
    return h(
      'div',
      { class: 'gb-family-panel' },
      panelHeader('Edit ' + member.name),
      field('Name', c.nameInput),
      field('Relationship', c.relSelect),
      field('Date of birth', c.dobInput),
      field('Gender', c.genderSelect),
      h(
        'div',
        { class: 'gb-family-form-row' },
        field('Height (cm)', c.heightInput),
        field('Weight (kg)', c.weightInput)
      ),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary', onclick: save },
        'Save changes'
      )
    );
  }

  function profilePanel(member) {
    const p = member.profile || {};
    const dishes = h('input', {
      type: 'text',
      class: 'gb-input',
      value: fromList(p.favouriteDishes),
      placeholder: 'Idli, Dosa, Fish curry',
    });
    const ings = h('input', {
      type: 'text',
      class: 'gb-input',
      value: fromList(p.favouriteIngredients),
      placeholder: 'Coconut, Paneer, Drumstick',
    });
    const diet = h(
      'select',
      { class: 'gb-input' },
      ['']
        .concat(DIETS)
        .map((d) =>
          h('option', { value: d, selected: (p.dietPreference || '') === d }, d || 'No preference')
        )
    );
    const allergies = h('input', {
      type: 'text',
      class: 'gb-input',
      value: fromList(p.allergies),
      placeholder: 'Peanuts, Milk, Seafood',
    });
    const avoid = h('input', {
      type: 'text',
      class: 'gb-input',
      value: fromList(p.ingredientsToAvoid),
      placeholder: 'Sugar, Maida, Deep-fried',
    });
    const medical = h('input', {
      type: 'text',
      class: 'gb-input',
      value: fromList(p.medicalConditions),
      placeholder: 'Diabetes, Hypertension',
    });
    const save = () => {
      run(
        api.updateProfile(member.id, {
          favouriteDishes: toList(dishes.value),
          favouriteIngredients: toList(ings.value),
          dietPreference: diet.value || null,
          allergies: toList(allergies.value),
          ingredientsToAvoid: toList(avoid.value),
          medicalConditions: toList(medical.value),
        }),
        (resp) => {
          applyFamily(resp);
          closePanel();
        }
      );
    };
    return h(
      'div',
      { class: 'gb-family-panel' },
      panelHeader(member.name + "'s food profile"),
      h(
        'p',
        { class: 'gb-family-panel-sub' },
        'The AI meal planner uses this to keep meals safe and tasty.'
      ),
      field('Favourite dishes', dishes),
      field('Favourite ingredients', ings),
      field('Dietary preference', diet),
      field('Food allergies', allergies),
      field('Ingredients to avoid', avoid),
      field('Medical conditions (optional)', medical),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary', onclick: save },
        'Save profile'
      )
    );
  }

  function linkPanel(member) {
    // member may be null (add a brand-new linked member) or an unmapped slot.
    const qInput = h('input', {
      type: 'text',
      class: 'gb-input',
      'aria-label': 'Search people',
      placeholder: 'Search by name or user ID',
    });
    const resultsEl = h('div', { class: 'gb-family-search-results' });

    function renderResults(list) {
      resultsEl.replaceChildren();
      if (!list || !list.length) {
        resultsEl.appendChild(h('p', { class: 'gb-family-empty-note' }, 'No matching accounts.'));
        return;
      }
      list.forEach((u) => {
        resultsEl.appendChild(
          h(
            'div',
            { class: 'gb-card gb-family-result' },
            h('div', { class: 'gb-family-avatar gb-family-avatar--sm' }, initials(u.displayName)),
            h(
              'div',
              { class: 'gb-family-result-id' },
              h('div', { class: 'gb-family-card-name' }, u.displayName),
              h('div', { class: 'gb-family-card-meta' }, u.email || u.id)
            ),
            u.alreadyInFamily
              ? h('span', { class: 'gb-pill gb-pill--muted' }, 'In family')
              : h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--soft gb-btn--sm',
                    onclick: () =>
                      run(
                        api.linkMember({ userId: u.id, memberId: member ? member.id : null }),
                        (resp) => {
                          applyFamily(resp);
                          closePanel();
                          toast.success(
                            'Invitation sent — ' + u.displayName + ' needs to accept it.'
                          );
                        }
                      ),
                  },
                  'Invite'
                )
          )
        );
      });
    }

    let searchSeq = 0; // an answer for an earlier Enter is dropped, not painted over a later one
    async function doSearch() {
      const q = qInput.value.trim();
      if (!q) return;
      const mine = ++searchSeq;
      resultsEl.replaceChildren(h('p', { class: 'gb-family-empty-note' }, 'Searching…'));
      try {
        const found = await api.searchUsers(q);
        if (mine === searchSeq) renderResults(found);
      } catch (err) {
        if (mine !== searchSeq) return;
        resultsEl.replaceChildren(
          h('p', { class: 'gb-msg-error' }, err.message || 'Search failed.')
        );
      }
    }

    qInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    return h(
      'div',
      { class: 'gb-family-panel' },
      panelHeader(member ? 'Link ' + member.name + ' to an account' : 'Add a registered member'),
      h(
        'p',
        { class: 'gb-family-panel-sub' },
        member
          ? 'They get an invite; once they accept, this profile and its history carry over.'
          : 'Search for someone who already uses Growth Buddy. They get an invite to accept.'
      ),
      h(
        'div',
        { class: 'gb-family-search-bar' },
        qInput,
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary gb-btn--sm',
            'aria-label': 'Search',
            onclick: doSearch,
          },
          Icon('search', { size: 16, color: 'var(--fg-on-brand)' })
        )
      ),
      resultsEl
    );
  }

  /* ---- recipe per dish ----
     The family's own ingredients + steps for a dish, keyed by its name. Build
     shopping list reads the ingredient lines before its built-in guesses. */
  const RECIPE_MAX = 4000;
  function recipePanel(dish) {
    const r = recipeFor(dish);
    const ingI = h('textarea', {
      class: 'gb-input gb-family-recipe-text',
      rows: 6,
      placeholder: 'One per line, e.g.\nToor dal: 200 g\nTamarind: lemon-sized ball',
    });
    ingI.value = (r && r.ingredients) || '';
    const stepsI = h('textarea', {
      class: 'gb-input gb-family-recipe-text',
      rows: 8,
      placeholder: '1. Pressure-cook the dal…',
    });
    stepsI.value = (r && r.steps) || '';
    const minI = h('input', {
      type: 'number',
      class: 'gb-input',
      min: 0,
      max: 1440,
      inputmode: 'numeric',
      placeholder: 'e.g. 40',
      value: r && r.cookMinutes != null ? r.cookMinutes : '',
    });
    const count = h('span', { class: 'gb-family-recipe-count' });
    const recount = () => {
      const n = ingI.value.trim().length + stepsI.value.trim().length;
      count.textContent = n + ' / ' + RECIPE_MAX;
      count.classList.toggle('is-over', n > RECIPE_MAX);
    };
    ingI.addEventListener('input', recount);
    stepsI.addEventListener('input', recount);
    recount();
    const save = () => {
      if (ingI.value.trim().length + stepsI.value.trim().length > RECIPE_MAX) {
        toast.error(null, 'A recipe can be at most ' + RECIPE_MAX + ' characters.');
        return;
      }
      run(
        api.saveRecipe({
          dish,
          ingredients: ingI.value.trim() || null,
          steps: stepsI.value.trim() || null,
          cookMinutes: intOrNull(minI),
        }),
        (saved) => {
          const k = dishKey(dish);
          const rest = (model.recipes || []).filter((x) => dishKey(x.dish) !== k);
          model.recipes = saved ? rest.concat(saved) : rest;
          toast.success(saved ? 'Recipe saved.' : 'Recipe removed.');
          closePanel();
        }
      );
    };
    return h(
      'div',
      { class: 'gb-family-panel' },
      panelHeader(dish),
      h(
        'p',
        { class: 'gb-family-panel-sub' },
        'Your family’s way of making it. “Build shopping list” uses these ingredients for this dish.'
      ),
      field('Cook time (minutes)', minI),
      field('Ingredients', ingI),
      field('Steps', stepsI, count),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary', onclick: save },
        r ? 'Save recipe' : 'Add recipe'
      )
    );
  }

  // ---- meal planner ----

  function ingredientChips() {
    if (!model.ingredients.length) {
      // The server adds the pantry to every plan (FamilyService.appendAvailableLines),
      // so with a stocked pantry there is nothing to type: say what it will use.
      const stock = (model.pantryItems || []).filter((p) => !p.expired).map((p) => p.name);
      return h(
        'p',
        { class: 'gb-family-empty-note' },
        stock.length
          ? 'Planning from your pantry: ' +
              stock.slice(0, 6).join(', ') +
              (stock.length > 6 ? ' and ' + (stock.length - 6) + ' more' : '') +
              '. Add anything else you have.'
          : 'No ingredients yet. Scan a photo or add some.'
      );
    }
    return h(
      'div',
      { class: 'gb-family-chips' },
      model.ingredients.map((g, i) =>
        h(
          'span',
          { class: 'gb-family-chip' },
          g.quantity ? g.name + ' (' + g.quantity + ')' : g.name,
          h(
            'button',
            {
              type: 'button',
              class: 'gb-family-chip-x',
              'aria-label': 'Remove ' + g.name,
              onclick: () => {
                model.ingredients.splice(i, 1);
                paint();
              },
            },
            Icon('x', { size: 12 })
          )
        )
      )
    );
  }

  /* Expired pantry items are kept out of the chips (the plan is told not to use
     them), so say so instead of letting them vanish. */
  function expiredNote() {
    // Same pick as generate(): one added back by hand is the user's call.
    const have = new Set(model.ingredients.map((g) => g.name.toLowerCase()));
    const names = (model.pantryItems || [])
      .filter((p) => p.expired && p.name && !have.has(p.name.toLowerCase()))
      .map((p) => p.name + ' (expired)');
    return names.length ? h('p', { class: 'gb-family-empty-note' }, 'Not using: ' + names.join(', ')) : null;
  }

  /* The Generate button the user pressed is rebuilt by every paint, so focus
     fell to <body> while the plan cooked and again when it arrived. */
  function focusPlanHead() {
    const head = root.querySelector('#gb-family-plan-head');
    // Only when focus has nowhere to be: never pull it out of a field.
    const lost = !document.activeElement || document.activeElement === document.body;
    if (head && lost) head.focus({ preventScroll: true });
  }

  function plannerSection() {
    const fam = model.family;
    const members = (fam && fam.members) || [];
    // The pantry is what's in the house: seed Available groceries from it once,
    // leaving out anything expired (that goes to the planner as "do not use").
    const pantry = model.pantryItems;
    if (pantry && !model.pantrySeeded) {
      model.pantrySeeded = true;
      const seen = new Set(model.ingredients.map((g) => g.name.toLowerCase()));
      pantry.forEach((p) => {
        if (p.expired || !p.name || seen.has(p.name.toLowerCase())) return;
        seen.add(p.name.toLowerCase());
        model.ingredients.push({
          name: p.name,
          category: p.category || 'Other',
          quantity: p.quantity || '',
          freshness: '',
        });
      });
    }

    const photoInput = h('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      style: { display: 'none' },
      onchange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        model.scanBusy = true;
        model.scanMsg = 'Scanning photo…';
        paint();
        try {
          // Downscaled to 1280px JPEG first: a phone photo is 4-12 MB raw.
          const dataUrl = await shrinkPhoto(file);
          const res = await api.scanGrocery(dataUrl);
          const items = (res && res.items) || [];
          // Merge, skipping duplicates by lowercase name.
          const seen = new Set(model.ingredients.map((g) => g.name.toLowerCase()));
          items.forEach((it) => {
            if (it.name && !seen.has(it.name.toLowerCase())) {
              model.ingredients.push({
                name: it.name,
                category: it.category || 'Other',
                quantity: it.quantity || '',
                freshness: it.freshness || '',
              });
              seen.add(it.name.toLowerCase());
            }
          });
          model.scanMsg =
            (res && res.message) || (items.length ? 'Added items.' : 'No items found.');
        } catch (err) {
          model.scanMsg = err.message || 'Could not scan the photo.';
        } finally {
          model.scanBusy = false;
          paint();
          // paint() rebuilds the tree, and a live region born full is skipped.
          toast.announce(model.scanMsg);
        }
      },
    });

    const manualInput = h('input', {
      type: 'text',
      class: 'gb-input',
      'aria-label': 'Add an ingredient',
      placeholder: 'e.g. Drumstick',
    });
    const addManual = () => {
      const name = manualInput.value.trim();
      if (!name) return;
      if (!model.ingredients.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        model.ingredients.push({ name, category: 'Other', quantity: '', freshness: '' });
      }
      manualInput.value = '';
      paint();
      manualInput.focus();
    };
    manualInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addManual();
      }
    });

    // Ids of members still here: a removed member's id must not count as a pick.
    const picked =
      model.selectedMemberIds === null
        ? members.map((m) => m.id)
        : members.filter((m) => model.selectedMemberIds.includes(m.id)).map((m) => m.id);
    const memberSelector = h(
      'div',
      { class: 'gb-family-chips gb-family-member-select', role: 'group', 'aria-label': 'Plan for' },
      members.map((m) => {
        const sel = picked.includes(m.id);
        return h(
          'button',
          {
            type: 'button',
            class: 'gb-family-chip gb-family-chip--toggle' + (sel ? ' is-on' : ''),
            'aria-pressed': String(sel),
            onclick: () => {
              const ids = picked.slice();
              const at = ids.indexOf(m.id);
              if (at >= 0) ids.splice(at, 1);
              else ids.push(m.id);
              model.selectedMemberIds = ids;
              paint();
            },
          },
          m.name
        );
      })
    );

    // Diet, asked once: while nobody being planned for has one, the planner
    // assumed vegetarian and said so only in fine print under the plan. Now the
    // assumption is a visible default, saved to their food profiles on Generate,
    // after which the row is gone.
    const noDiet = members.filter((m) => picked.includes(m.id) && !(m.profile && m.profile.dietPreference));
    const askDiet = !!(fam && fam.isOwner) && picked.length > 0 && noDiet.length === picked.length;
    const dietSelect = askDiet
      ? h(
          'select',
          {
            class: 'gb-input',
            'aria-label': 'Food preference',
            onchange: (e) => (model.planDiet = e.currentTarget.value),
          },
          DIETS.map((d) => h('option', { value: d, selected: (model.planDiet || DIETS[0]) === d }, d))
        )
      : null;

    const generate = () => {
      model.planBusy = true;
      model.planError = '';
      paint();
      focusPlanHead();
      const memberIds = picked;
      const diet = askDiet ? model.planDiet || DIETS[0] : null;
      const dietSaved = diet
        ? Promise.all(
            noDiet.map((m) => api.updateProfile(m.id, { ...(m.profile || {}), dietPreference: diet }))
          ).then((all) => all.length && applyFamily(all[all.length - 1]))
        : Promise.resolve();
      // The server adds the whole pantry, expired items included, and takes no
      // avoid list; the quantity is the free text it does print, so say it there.
      const have = new Set(model.ingredients.map((g) => g.name.toLowerCase()));
      const expired = (model.pantryItems || [])
        .filter((p) => p.expired && p.name && !have.has(p.name.toLowerCase()))
        .map((p) => ({
          name: p.name,
          category: p.category || 'Other',
          quantity: 'EXPIRED, do not use',
          freshness: 'expired',
        }));
      dietSaved
        .then(() => api.generateMealPlan({ ingredients: model.ingredients.concat(expired), memberIds }))
        .then((res) => {
          model.plan = res;
          toast.announce(
            res && res.source === 'fallback'
              ? 'Meal plan ready. AI was unavailable, so this is a simple template.'
              : 'Meal plan ready.'
          );
          // The plan it replaced is now history.
          loadSection('history').then(paintSoon);
        })
        .catch((err) => {
          model.planError = err.message || 'Could not generate a meal plan.';
        })
        .finally(() => {
          model.planBusy = false;
          paint();
          focusPlanHead();
        });
    };

    const hasPlan = !!model.plan;
    // One card for everything a new plan is made from. It sits under the plan
    // when there is one: the plan is what someone opens Today to read, and it
    // used to start below the fold, under a form.
    const builder = h(
      'div',
      { class: 'gb-card gb-family-builder' },
      hasPlan ? h('h3', { class: 'gb-family-builder-title' }, 'Plan again with') : null,
      h('h4', { class: 'gb-family-subhead' }, 'Available groceries'),
      h(
        'div',
        { class: 'gb-family-grocery-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft',
            disabled: model.scanBusy,
            onclick: () => photoInput.click(),
          },
          Icon('camera', { size: 16 }),
          model.scanBusy ? 'Scanning…' : 'Scan groceries'
        ),
        photoInput
      ),
      model.scanMsg ? h('p', { class: 'gb-family-scan-msg' }, model.scanMsg) : null,
      h(
        'div',
        { class: 'gb-family-manual-add' },
        manualInput,
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft gb-btn--sm gb-family-add-btn',
            'aria-label': 'Add ingredient',
            onclick: addManual,
          },
          Icon('plus', { size: 16 })
        )
      ),
      ingredientChips(),
      expiredNote(),
      members.length
        ? h(
            'div',
            { class: 'gb-family-builder-group' },
            h('h4', { class: 'gb-family-subhead' }, 'Plan for'),
            memberSelector,
            // The server reads an empty pick as "everyone", so none picked
            // planned for the whole family behind a row of unlit chips.
            picked.length
              ? null
              : h('p', { class: 'gb-family-empty-note' }, 'Pick at least one person to plan for.')
          )
        : null,
      askDiet
        ? h(
            'div',
            { class: 'gb-family-builder-group' },
            h('h4', { class: 'gb-family-subhead' }, 'Food'),
            dietSelect,
            h('p', { class: 'gb-field-hint' }, 'Saved to everyone’s food profile. Change it per person later.')
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class:
            'gb-btn gb-btn--primary gb-family-generate' + (model.planBusy ? ' is-thinking' : ''),
          disabled: model.planBusy || !picked.length,
          onclick: generate,
        },
        model.planBusy
          ? thinkingLabel('Cooking up a plan')
          : [
              Icon('sparkles', { size: 17, color: '#fff' }),
              hasPlan ? 'Make a new plan' : 'Make a meal plan',
            ]
      ),
      model.planError ? h('p', { class: 'gb-msg-error', role: 'alert' }, model.planError) : null
    );
    return h(
      'section',
      { class: 'gb-family-planner' },
      h(
        'div',
        { class: 'gb-section-head' },
        h('h2', { id: 'gb-family-plan-head', tabindex: '-1' }, "Today's meal plan"),
        hasPlan && model.plan.createdAt
          ? h('span', { class: 'gb-family-head-meta' }, fmtDay(planDay(model.plan.createdAt)))
          : null
      ),
      hasPlan ? planView(model.plan, planActions()) : null,
      builder,
      pastPlans()
    );
  }

  /* The local day a plan was made on, as YYYY-MM-DD for fmtDay. */
  function planDay(createdAt) {
    return new Date(createdAt).toLocaleDateString('en-CA');
  }

  /* ---- plan history ----
     Every Generate already wrote a new row; these are the older ones. "Use
     again" copies one forward on the server, so the history keeps its place. */
  function planDishes(plan) {
    const p = plan || {};
    return MEALS.flatMap((m) => (Array.isArray(p[m.key]) ? p[m.key] : [])).filter(Boolean);
  }
  function pastPlans() {
    const currentId = model.plan && model.plan.planId;
    const past = (model.planHistory || []).filter((p) => p.planId !== currentId);
    if (!past.length) return null;
    return h(
      'div',
      { class: 'gb-card gb-family-history' },
      h(
        'h3',
        { class: 'gb-family-subhead' },
        Icon('history', { size: 16, color: 'var(--fg3)' }),
        'Past plans'
      ),
      h(
        'ul',
        { class: 'gb-family-history-list' },
        past.map((p) => {
          const dishes = planDishes(p.plan);
          const when = p.createdAt
            ? new Date(p.createdAt).toLocaleString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })
            : ''; // with the time: two plans on one day read as the same row
          return h(
            'li',
            { class: 'gb-family-history-row' },
            h(
              'div',
              { class: 'gb-family-shop-id' },
              h('div', { class: 'gb-family-card-name' }, when),
              h(
                'div',
                { class: 'gb-family-card-meta' },
                dishes.slice(0, 4).join(', ') + (dishes.length > 4 ? ', …' : '')
              )
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--sm',
                onclick: () =>
                  run(api.reusePlan(p.planId), (res) => {
                    model.plan = res;
                    toast.success('Back on the menu.');
                    loadSection('history').then(paintSoon);
                  }),
              },
              Icon('rotate-ccw', { size: 14 }),
              'Use again'
            )
          );
        })
      )
    );
  }

  function planActions() {
    const planId = model.plan && model.plan.planId;
    if (!planId) return null;
    return h(
      'div',
      { class: 'gb-family-plan-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--sm',
          onclick: () => saveMenu(planId),
        },
        Icon('heart', { size: 15 }),
        'Save menu'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--sm',
          onclick: () =>
            run(api.markCooked(planId), () =>
              toast.success('Noted — Buddy will favour these dishes next time.')
            ),
        },
        Icon('check', { size: 15 }),
        'We cooked this'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--sm',
          onclick: () =>
            run(api.generateShopping({ planId }), (res) => {
              model.shoppingList = res;
              delete model.sectionErrors.shopping;
              if (res && res.message) toast.success(res.message);
              switchSection('shopping');
            }),
        },
        Icon('list-checks', { size: 15 }),
        'Build shopping list'
      )
    );
  }

  /* Named in the app's own dialog: window.prompt is unthemed browser chrome,
     captioned with the origin, and a system alert in the Capacitor WebView. */
  function saveMenu(planId) {
    const input = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: 120,
      value: 'Family favourite',
      'aria-label': 'Menu name',
    });
    openModal({
      title: 'Name this menu',
      body: input,
      primary: 'Save menu',
      errorMessage: 'Could not save the menu.',
      onPrimary: async () => {
        const name = input.value.trim();
        if (!name) throw Object.assign(new Error('Give the menu a name.'), { field: input });
        await api.saveFavourite({ name, planId });
        toast.success('Saved to your favourites.');
        loadSection('favourites').then(paintSoon);
      },
    });
    setTimeout(() => input.select(), 60);
  }

  /* Same key as the server's shoppingKey: "Sambar " and "sambar" share a recipe. */
  function dishKey(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }
  function recipeFor(dish) {
    const k = dishKey(dish);
    return (model.recipes || []).find((r) => dishKey(r.dish) === k) || null;
  }

  /* "Who cooks this?" — a member per meal, kept on the plan JSON (`cooks`). */
  // Children are not offered as cooks; one already assigned stays listed.
  const isKid = (m) =>
    m.ageCategory === 'Infant' || m.ageCategory === 'Child' || (m.relationship === 'child' && m.age == null);
  function cookPicker(mealLabel, currentId, onPick) {
    const members = ((model.family && model.family.members) || []).filter(
      (m) => m.id === currentId || !isKid(m)
    );
    if (!members.length) return null;
    const known = members.some((m) => m.id === currentId);
    return h(
      'label',
      { class: 'gb-family-cook' },
      h(
        'select',
        {
          class: 'gb-family-cook-select',
          'aria-label': 'Who cooks ' + mealLabel.toLowerCase(),
          onchange: (e) => onPick(e.currentTarget.value || null),
        },
        h('option', { value: '', selected: !known }, 'Who cooks?'),
        members.map((m) => h('option', { value: m.id, selected: m.id === currentId }, m.name))
      )
    );
  }

  function dishItem(d, live) {
    const name = String(d);
    if (!live) return h('li', null, name);
    const r = recipeFor(name);
    return h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-family-dish' + (r ? ' has-recipe' : ''),
          title: r ? 'View recipe' : 'Add a recipe',
          onclick: () => openPanel({ type: 'recipe', dish: name }),
        },
        h('span', null, name),
        r && r.cookMinutes
          ? h('span', { class: 'gb-family-dish-time' }, r.cookMinutes + ' min')
          : null,
        Icon('book-open', { size: 13, color: r ? 'var(--brand)' : 'var(--fg3)' })
      )
    );
  }

  /* One stop on the day rail: the node, the meal, who cooks it, its dishes. */
  function mealStop(meal, items, opts) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return null;
    const live = !!(opts && opts.live);
    return h(
      'li',
      { class: 'gb-family-stop' },
      h(
        'span',
        { class: 'gb-family-stop-node', 'aria-hidden': 'true' },
        Icon(meal.icon, { size: 16 })
      ),
      h(
        'div',
        { class: 'gb-family-stop-body' },
        h(
          'div',
          { class: 'gb-family-meal-head' },
          h('h3', null, meal.label),
          live ? cookPicker(meal.label, opts.cookId, opts.onCook) : null
        ),
        h(
          'ul',
          { class: 'gb-family-meal-list' },
          list.map((d) => dishItem(d, live))
        )
      )
    );
  }

  function assignCook(meal, memberId) {
    const planId = model.plan && model.plan.planId;
    if (!planId) return;
    run(api.assignCook(planId, { meal, memberId }), (res) => {
      if (res) model.plan = res;
    });
  }

  const asList = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);

  function planView(resp, actions) {
    const plan = (resp && resp.plan) || {};
    const ns = plan.nutritionSummary || {};
    const isFallback = resp && resp.source === 'fallback';
    // Cooks and recipes only on the live plan, not on a saved favourite's copy.
    const live = !!(resp && resp.planId && model.plan && resp.planId === model.plan.planId);
    const cooks = plan.cooks || {};
    const avoided = asList(plan.allergensAvoided);
    const tips = asList(plan.suggestions);
    const buys = asList(plan.purchaseRecommendations);
    const hasStats = [ns.protein_g, ns.fibre_g, ns.calories_kcal].some((v) => Number(v) > 0);

    return h(
      'div',
      { class: 'gb-family-plan' },
      isFallback
        ? h(
            'div',
            { class: 'gb-family-plan-banner' },
            Icon('circle-alert', { size: 15 }),
            h('span', null, 'AI was unavailable, so this is a simple template.')
          )
        : null,
      // The day in order, breakfast to dinner, on one line: the order is real.
      h(
        'ol',
        { class: 'gb-card gb-family-rail', 'aria-label': 'Meals, in order' },
        MEALS.map((m) =>
          mealStop(m, plan[m.key], {
            live,
            cookId: cooks[m.key] || null,
            onCook: (id) => assignCook(m.key, id),
          })
        )
      ),
      actions || null,
      hasStats || ns.balancedFor || avoided.length
        ? h(
            'div',
            { class: 'gb-card gb-family-nutrition' },
            hasStats
              ? h(
                  'div',
                  { class: 'gb-family-nutrition-grid' },
                  nutriStat('Protein', ns.protein_g, 'g'),
                  nutriStat('Fibre', ns.fibre_g, 'g'),
                  nutriStat('Calories', ns.calories_kcal, 'kcal')
                )
              : null,
            ns.balancedFor
              ? h(
                  'p',
                  { class: 'gb-family-balanced' },
                  'Balanced for ' +
                    String(ns.balancedFor).toLowerCase() +
                    '. A rough AI estimate for the whole menu, not worked out per person.'
                )
              : null,
            avoided.length
              ? h(
                  'ul',
                  { class: 'gb-family-safe-list', 'aria-label': 'Allergens avoided' },
                  avoided.map((a) =>
                    h('li', null, Icon('shield-check', { size: 15, color: 'var(--success)' }), a)
                  )
                )
              : null
          )
        : null,
      // Buddy's notes run to a dozen sentences; folded, they stop burying the
      // plan's own actions under them.
      tips.length || buys.length
        ? h(
            'details',
            { class: 'gb-card gb-family-notes' },
            h(
              'summary',
              null,
              h('span', null, 'Notes from Buddy'),
              h('span', { class: 'gb-family-count' }, String(tips.length + buys.length)),
              Icon('chevron-down', { size: 16, className: 'gb-family-notes-caret' })
            ),
            tips.length
              ? h(
                  'ul',
                  { class: 'gb-family-note-list' },
                  tips.map((t) => h('li', null, t))
                )
              : null,
            buys.length ? h('h3', { class: 'gb-family-subhead' }, 'Worth buying') : null,
            buys.length
              ? h(
                  'ul',
                  { class: 'gb-family-note-list' },
                  buys.map((t) => h('li', null, t))
                )
              : null
          )
        : null
    );
  }

  function nutriStat(label, value, unit) {
    const has = value != null && Number(value) > 0;
    return h(
      'div',
      { class: 'gb-family-stat' },
      h(
        'div',
        { class: 'gb-family-stat-value' },
        has
          ? [String(Math.round(Number(value))), h('span', { class: 'gb-family-stat-unit' }, unit)]
          : '—'
      ),
      h('div', { class: 'gb-family-stat-label' }, label)
    );
  }

  // ---- top-level paint ----

  function familySummary() {
    const fam = model.family;
    const members = (fam && fam.members) || [];
    const counts = {};
    members.forEach((m) => {
      const c = m.ageCategory || 'Unknown';
      counts[c] = (counts[c] || 0) + 1;
    });
    const order = ['Infant', 'Child', 'Teenager', 'Adult', 'Senior Citizen', 'Unknown'];
    const chips = order
      .filter((c) => counts[c])
      .map((c) =>
        h(
          'span',
          { class: 'gb-family-chip gb-family-chip--soft' },
          counts[c] +
            ' ' +
            (counts[c] > 1 || c === 'Unknown'
              ? AGE_PLURAL[c]
              : c === 'Senior Citizen'
                ? 'Senior'
                : c)
        )
      );
    return h(
      'div',
      { class: 'gb-card gb-family-summary' },
      h(
        'div',
        { class: 'gb-family-summary-top' },
        h(
          'div',
          { class: 'gb-family-avatar gb-family-avatar--sm' },
          Icon('users', { size: 18, color: '#fff' })
        ),
        h(
          'div',
          { class: 'gb-family-summary-id' },
          h(
            'div',
            { class: 'gb-family-summary-count' },
            h('span', { class: 'gb-family-count-lg' }, String(members.length)),
            members.length === 1 ? ' member' : ' members'
          ),
          h(
            'div',
            { class: 'gb-family-card-meta' },
            fam.isOwner ? 'You manage this family' : 'Shared with you'
          )
        )
      ),
      chips.length ? h('div', { class: 'gb-family-chips' }, chips) : null
    );
  }

  async function leaveFamily() {
    const ok = await confirmDialog({
      title: 'Leave this family?',
      message: "You'll lose access to its profiles and meal plans.",
      confirmLabel: 'Leave family',
      cancelLabel: 'Stay',
      danger: true,
    });
    if (!ok) return;
    run(api.leaveFamily(), () => load());
  }

  /* The step the empty state promised, once there is someone to cook for and
     no plan yet: adding the first member used to leave the user on Members,
     with the meal plan behind a tab called "Today". */
  function nextStepCard(members) {
    const others = members.filter((m) => !m.isSelf);
    if (model.plan || !others.length || !(model.family && model.family.isOwner)) return null;
    const parts = others
      .slice(0, 2)
      .map((m) => m.name)
      .concat(others.length > 2 ? [others.length - 2 + ' more'] : [], members.some((m) => m.isSelf) ? ['you'] : []);
    const who = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0];
    return h(
      'div',
      { class: 'gb-card gb-family-builder gb-family-next' },
      h('h3', { class: 'gb-family-builder-title' }, 'Next: today’s meals'),
      h('p', { class: 'gb-family-card-meta' }, 'Breakfast to dinner for ' + who + '.'),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary', onclick: () => switchSection('plan') },
        Icon('utensils', { size: 17, color: '#fff' }),
        'Plan today’s meals'
      )
    );
  }

  function membersSection() {
    const fam = model.family;
    const members = (fam && fam.members) || [];
    return h(
      'section',
      { class: 'gb-family-members' },
      h(
        'div',
        { class: 'gb-section-head' },
        h('h2', null, 'Family members'),
        fam && fam.isOwner
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--sm',
                onclick: () => openPanel({ type: 'add' }),
              },
              Icon('plus', { size: 16 }),
              'Add member'
            )
          : null
      ),
      familySummary(),
      nextStepCard(members),
      h(
        'div',
        { class: 'gb-family-card-grid' },
        members.map((m) => memberCard(m))
      ),
      fam && !fam.isOwner
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost gb-family-leave-btn',
              onclick: leaveFamily,
            },
            Icon('log-out', { size: 16 }),
            'Leave family'
          )
        : null
    );
  }

  function invitesSection() {
    if (model.sectionErrors.invites) return sectionError('invites', 'your family invites');
    if (!model.invites.length) return null;
    return h(
      'section',
      { class: 'gb-family-invites' },
      model.invites.map((inv) =>
        h(
          'div',
          { class: 'gb-card gb-family-invite' },
          h(
            'div',
            { class: 'gb-family-invite-text' },
            Icon('user-plus', { size: 18, color: 'var(--brand)' }),
            h(
              'div',
              null,
              h('div', { class: 'gb-family-card-name' }, inv.ownerName + ' invited you'),
              h(
                'div',
                { class: 'gb-family-card-meta' },
                'Join their family' +
                  (inv.invitedAs && inv.invitedAs !== 'other' ? ' as ' + cap(inv.invitedAs) : '')
              )
            )
          ),
          h(
            'div',
            { class: 'gb-family-invite-actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--ghost gb-btn--sm',
                onclick: () => run(api.declineInvite(inv.memberId), () => load()),
              },
              'Decline'
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--primary gb-btn--sm',
                onclick: () => run(api.acceptInvite(inv.memberId), () => load()),
              },
              'Accept'
            )
          )
        )
      )
    );
  }

  function emptyState() {
    return h(
      'div',
      { class: 'gb-placeholder gb-rise gb-family-empty' },
      h(
        'div',
        { class: 'gb-family-empty-icon' },
        Icon('users', { size: 30, color: 'var(--brand)' })
      ),
      h('h2', null, 'Build your family'),
      h(
        'p',
        null,
        'Add the people you cook for, then get balanced South Indian meal plans for everyone.'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { marginTop: '16px', maxWidth: '280px' },
          onclick: () => openPanel({ type: 'add' }),
        },
        Icon('plus', { size: 17, color: '#fff' }),
        'Add your first member'
      ),
      // A household of one, your row copied from Profile: straight to the planner.
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft',
          style: { marginTop: '10px', maxWidth: '280px' },
          onclick: () =>
            run(api.startSolo(), (fam) => {
              applyFamily(fam);
              switchSection('plan');
            }),
        },
        Icon('utensils', { size: 17 }),
        'Plan meals for just me'
      )
    );
  }

  // ---- section navigation ----

  /* Every section is prefetched by load(); one that was dropped since (null)
     reloads through loadSection, so a failure shows its banner. A second set of
     loaders here used to turn a failed fetch into an empty list. */
  const SECTION_DATA = {
    weekly: () => model.weekly,
    pantry: () => model.pantryItems,
    shopping: () => model.shoppingList,
    favourites: () => model.favourites,
  };
  function switchSection(section) {
    model.section = section;
    paint();
    if (SECTION_DATA[section] && SECTION_DATA[section]() === null) loadSection(section).then(paint);
  }

  function sectionBadge(id) {
    if (id === 'pantry') {
      const n = (model.pantryItems || []).filter((p) => p.expired || p.expiringSoon).length;
      return n > 0 ? n : 0;
    }
    if (id === 'shopping') {
      const items = (model.shoppingList && model.shoppingList.items) || [];
      return items.filter((i) => !i.checked).length;
    }
    if (id === 'chores') {
      return (model.chores || []).filter((c) => !c.done).length;
    }
    if (id === 'members') {
      return (model.family && model.family.members && model.family.members.length) || 0;
    }
    return 0;
  }

  function sectionNav() {
    const items = [
      ['members', 'Members', 'users'],
      ['chores', 'Chores', 'list-todo'],
      ['plan', 'Meals today', 'utensils'],
      ['weekly', 'Weekly', 'calendar-days'],
      ['pantry', 'Pantry', 'sprout'],
      ['shopping', 'Shopping', 'list-checks'],
      ['favourites', 'Saved', 'heart'],
    ];
    // Two elements on purpose: the outer one is the sticky opaque backdrop, the
    // inner one scrolls and carries the fade mask. A mask applied to the sticky
    // element would fade its own background too, letting the page show through.
    return h(
      'div',
      { class: 'gb-family-sectionnav' },
      h(
        'div',
        { class: 'gb-family-sectionnav-strip' },
        items.map(([id, label, icon]) => {
          const n = sectionBadge(id);
          const danger = id === 'pantry' && n > 0;
          return h(
            'button',
            {
              type: 'button',
              class: 'gb-family-sectiontab' + (model.section === id ? ' is-active' : ''),
              'aria-current': model.section === id ? 'true' : null,
              onclick: () => switchSection(id),
            },
            Icon(icon, { size: 16 }),
            h('span', null, label),
            n > 0
              ? h(
                  'span',
                  { class: 'gb-family-tab-badge' + (danger ? ' is-danger' : '') },
                  String(n)
                )
              : null
          );
        })
      )
    );
  }

  function activeSection() {
    switch (model.section) {
      case 'plan':
        return plannerSection();
      case 'weekly':
        return weeklySection();
      case 'pantry':
        return pantrySection();
      case 'shopping':
        return shoppingSection();
      case 'favourites':
        return favouritesSection();
      case 'chores':
        return choresSection();
      case 'members':
      default:
        return membersSection();
    }
  }

  // ---- weekly / monthly + occasions ----

  function weeklySection() {
    const opts = model.weeklyOpts;
    const members = (model.family && model.family.members) || [];

    const daysSel = h(
      'select',
      {
        class: 'gb-input',
        onchange: (e) => {
          opts.days = parseInt(e.target.value, 10);
        },
      },
      [
        [7, 'This week (7 days)'],
        [14, 'Two weeks (14 days)'],
      ].map(([v, l]) => h('option', { value: v, selected: opts.days === v }, l))
    );
    const occSel = h(
      'select',
      {
        class: 'gb-input',
        onchange: (e) => {
          opts.occasion = e.target.value;
        },
      },
      [
        ['normal', 'Everyday'],
        ['festival', 'Festival special'],
        ['fasting', 'Fasting / Vratham'],
      ].map(([v, l]) => h('option', { value: v, selected: opts.occasion === v }, l))
    );
    const pantryChk = h('input', {
      type: 'checkbox',
      checked: opts.usePantry,
      onchange: (e) => {
        opts.usePantry = e.target.checked;
      },
    });

    const generate = () => {
      model.weeklyBusy = true;
      model.weeklyError = '';
      paint();
      api
        .generateWeekly({
          days: opts.days,
          occasion: opts.occasion,
          usePantry: opts.usePantry,
          memberIds: null,
        })
        .then((r) => {
          model.weekly = r;
        })
        .catch((err) => {
          model.weeklyError = err.message || 'Could not generate the plan.';
        })
        .finally(() => {
          model.weeklyBusy = false;
          paint();
        });
    };

    const wk = model.weekly && model.weekly.plan ? model.weekly : null;
    return h(
      'section',
      { class: 'gb-family-planner' },
      h('div', { class: 'gb-section-head' }, h('h2', null, 'Weekly meal planner')),
      h(
        'div',
        { class: 'gb-card gb-family-grocery' },
        field('Plan length', daysSel),
        field('Menu type', occSel),
        h(
          'label',
          { class: 'gb-family-check' },
          pantryChk,
          h('span', null, 'Use what I already have in the pantry')
        ),
        h(
          'button',
          {
            type: 'button',
            class:
              'gb-btn gb-btn--primary gb-family-generate' +
              (model.weeklyBusy ? ' is-thinking' : ''),
            disabled: model.weeklyBusy || !members.length,
            onclick: generate,
          },
          model.weeklyBusy
            ? thinkingLabel('Planning your week')
            : [
                Icon('sparkles', { size: 17, color: '#fff' }),
                wk ? 'Regenerate week' : 'Generate weekly plan',
              ]
        )
      ),
      model.weeklyError ? h('p', { class: 'gb-msg-error' }, model.weeklyError) : null,
      wk ? weeklyView(wk) : null
    );
  }

  function weeklyView(wk) {
    const days = (wk.plan && wk.plan.days) || [];
    const suggestions = (wk.plan && wk.plan.suggestions) || [];
    return h(
      'div',
      { class: 'gb-family-plan' },
      wk.source === 'fallback'
        ? h(
            'div',
            { class: 'gb-family-plan-banner' },
            Icon('circle-alert', { size: 15 }),
            h('span', null, 'AI was unavailable — showing a simple rotating template.')
          )
        : null,
      wk.occasion && wk.occasion !== 'normal'
        ? h('span', { class: 'gb-pill gb-pill--soft' }, cap(wk.occasion) + ' menu')
        : null,
      h(
        'div',
        { class: 'gb-family-week-grid' },
        days.map((d, i) => weekDayCard(d, i, wk))
      ),
      suggestions.length
        ? h(
            'div',
            { class: 'gb-card gb-family-suggestions' },
            h('h3', { class: 'gb-family-subhead' }, 'Tips'),
            h(
              'ul',
              { class: 'gb-family-meal-list' },
              suggestions.map((s) => h('li', null, String(s)))
            )
          )
        : null
    );
  }

  function weekDayCard(d, index, wk) {
    const cooks = d.cooks || {};
    // The server addresses a day by its position (1-based), not by d.day,
    // which the AI may leave out or number oddly.
    const pick = (meal, memberId) =>
      wk && wk.planId
        ? run(api.assignWeeklyCook(wk.planId, { meal, memberId, day: index + 1 }), (res) => {
            if (res) model.weekly = res;
          })
        : null;
    const line = (label, key, arr) => {
      const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
      if (!list.length) return null;
      return h(
        'div',
        { class: 'gb-family-weekday-meal' },
        h('span', { class: 'gb-family-weekday-meal-label' }, label),
        h('span', { class: 'gb-family-weekday-meal-dishes' }, list.join(', ')),
        cookPicker(label, cooks[key] || null, (id) => pick(key, id))
      );
    };
    return h(
      'div',
      { class: 'gb-card gb-family-weekday' },
      h('h3', { class: 'gb-family-weekday-label' }, d.label || planDayLabel(wk, index)),
      line('Breakfast', 'breakfast', d.breakfast),
      line('Lunch', 'lunch', d.lunch),
      line('Snack', 'snack', d.snack),
      line('Dinner', 'dinner', d.dinner)
    );
  }

  // ---- pantry ----

  function pantrySection() {
    const items = model.pantryItems || [];
    const nameI = h('input', {
      type: 'text',
      class: 'gb-input',
      id: 'gb-pantry-name',
      placeholder: 'e.g. Tomatoes',
      // The category follows the name until the user picks one themselves.
      oninput: () => {
        if (!catI.dataset.picked) catI.value = pantryCategory(nameI.value) || 'Vegetable';
      },
    });
    const catI = h(
      'select',
      { class: 'gb-input', onchange: () => (catI.dataset.picked = '1') },
      ['Vegetable', 'Fruit', 'Grain', 'Pulse', 'Dairy', 'Protein', 'Spice', 'Other'].map((c) =>
        h('option', { value: c, selected: c === 'Vegetable' }, c)
      )
    );
    const qtyI = h('input', {
      type: 'text',
      class: 'gb-input',
      placeholder: 'e.g. 500 g',
    });
    const expI = h('input', { type: 'date', class: 'gb-input' });
    const leftI = h('input', { type: 'checkbox' });
    const lowI = h('input', { type: 'checkbox' });
    const add = () => {
      const name = nameI.value.trim();
      if (!name) {
        toast.error(null, 'Type the item first.');
        nameI.focus();
        return;
      }
      run(
        api.addPantry({
          name,
          category: catI.value,
          quantity: qtyI.value.trim() || null,
          expiryDate: expI.value || null,
          leftover: leftI.checked,
          low: lowI.checked,
        }),
        (item) => {
          model.pantryItems = [item].concat(model.pantryItems || []);
          // The repaint rebuilds the form; the next item starts where this one did.
          setTimeout(() => {
            const next = document.getElementById('gb-pantry-name');
            if (next) next.focus();
          }, 0);
        }
      );
    };

    onEnter(add, nameI, qtyI);

    const scanInput = h('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      style: { display: 'none' },
      onchange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        model.pantryScanBusy = true;
        model.pantryScanMsg = 'Scanning…';
        paint();
        try {
          // Downscaled to 1280px JPEG first: a phone photo is 4-12 MB raw.
          const dataUrl = await shrinkPhoto(file);
          const res = await api.scanPantry(dataUrl);
          if (res && res.added && res.added.length) {
            model.pantryItems = res.added.concat(model.pantryItems || []);
          }
          model.pantryScanMsg = (res && res.message) || '';
        } catch (err) {
          model.pantryScanMsg = err.message || 'Could not scan the photo.';
        } finally {
          model.pantryScanBusy = false;
          paint();
          if (model.pantryScanMsg) toast.announce(model.pantryScanMsg);
        }
      },
    });

    return h(
      'section',
      { class: 'gb-family-planner' },
      h('div', { class: 'gb-section-head' }, h('h2', null, 'Pantry')),
      h(
        'div',
        { class: 'gb-card gb-family-grocery' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft',
            disabled: model.pantryScanBusy,
            onclick: () => scanInput.click(),
          },
          Icon('camera', { size: 16 }),
          model.pantryScanBusy ? 'Scanning…' : 'Scan groceries'
        ),
        scanInput,
        model.pantryScanMsg ? h('p', { class: 'gb-family-scan-msg' }, model.pantryScanMsg) : null,
        h(
          'div',
          { class: 'gb-family-pantry-form' },
          h('div', { class: 'gb-family-form-row' }, field('Item', nameI), field('Quantity', qtyI)),
          h(
            'div',
            { class: 'gb-family-form-row' },
            field('Category', catI),
            field('Expires', expI)
          ),
          h(
            'div',
            { class: 'gb-family-checks' },
            h('label', { class: 'gb-family-check' }, leftI, h('span', null, 'Leftover')),
            h('label', { class: 'gb-family-check' }, lowI, h('span', null, 'Running low'))
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-family-add-item',
              onclick: add,
            },
            Icon('plus', { size: 16 }),
            'Add item'
          )
        )
      ),
      items.length ? restockButton('Add low & expiring items to the list') : null,
      items.length
        ? h(
            'div',
            { class: 'gb-family-pantry-list' },
            items.map((it) => pantryRow(it))
          )
        : h(
            'p',
            { class: 'gb-family-empty-note' },
            'Your pantry is empty. Scan groceries or add items.'
          )
    );
  }

  /* Low + expiring within 2 days → the shopping list, deduped on the server. */
  function restockButton(label) {
    return h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--soft gb-family-restock',
        onclick: () =>
          run(api.shoppingFromPantry(), (res) => {
            model.shoppingList = overlayPending(res);
            delete model.sectionErrors.shopping;
            if (res && res.message) toast.success(res.message);
          }),
      },
      Icon('shopping-bag', { size: 15 }),
      label
    );
  }

  function pantryRow(it) {
    let badge = null;
    if (it.expired) badge = h('span', { class: 'gb-pill gb-pill--danger' }, 'Expired');
    else if (it.expiringSoon)
      badge = h(
        'span',
        { class: 'gb-pill gb-pill--warn' },
        it.daysToExpiry <= 0 ? 'Today' : 'In ' + it.daysToExpiry + 'd'
      );
    else if (it.expiryDate)
      badge = h('span', { class: 'gb-pill gb-pill--muted' }, 'Exp ' + fmtDay(it.expiryDate));
    // Each part stays whole: "Vegetable ·" over "500 g" read as two items.
    const metaParts = [it.category, it.quantity].filter(Boolean);
    const meta = metaParts.length
      ? metaParts.flatMap((m, i) => [i ? ' · ' : '', h('span', { class: 'gb-family-meta-part' }, m)])
      : null;
    return h(
      'div',
      { class: 'gb-card gb-family-pantry-item' },
      h(
        'div',
        { class: 'gb-family-pantry-id' },
        h(
          'div',
          { class: 'gb-family-card-name' },
          it.name,
          it.leftover ? h('span', { class: 'gb-pill gb-pill--soft' }, 'Leftover') : null
        ),
        meta ? h('div', { class: 'gb-family-card-meta' }, ...meta) : null
      ),
      badge,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-family-chip gb-family-chip--toggle gb-family-low' + (it.low ? ' is-on' : ''),
          'aria-pressed': String(!!it.low),
          'aria-label': it.name + ' running low',
          title: it.low ? 'Marked as running low' : 'Mark as running low',
          onclick: () =>
            run(
              api.updatePantry(it.id, {
                name: it.name,
                category: it.category,
                quantity: it.quantity || null,
                expiryDate: it.expiryDate || null,
                leftover: !!it.leftover,
                low: !it.low,
              }),
              (saved) => {
                model.pantryItems = (model.pantryItems || []).map((x) =>
                  x.id === it.id ? saved : x
                );
              }
            ),
        },
        'Low'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn gb-iconbtn--danger',
          'aria-label': 'Remove ' + it.name,
          onclick: () =>
            run(api.deletePantry(it.id), () => {
              model.pantryItems = (model.pantryItems || []).filter((x) => x.id !== it.id);
            }),
        },
        Icon('trash-2', { size: 16 })
      )
    );
  }

  // ---- shopping list ----

  function shoppingSection() {
    const list = model.shoppingList || { items: [], totalEstimatedCost: 0 };
    const nameI = h('input', {
      type: 'text',
      class: 'gb-input',
      placeholder: 'e.g. Onions',
    });
    const qtyI = h('input', {
      type: 'text',
      class: 'gb-input',
      'aria-label': 'Quantity',
      placeholder: 'Qty',
    });
    const add = () => {
      const name = nameI.value.trim();
      if (!name) {
        toast.error(null, 'Type the item first.');
        nameI.focus();
        return;
      }
      run(api.addShopping({ name, quantity: qtyI.value.trim() || null }), (res) => {
        model.shoppingList = res;
      });
    };
    onEnter(add, nameI, qtyI);
    return h(
      'section',
      { class: 'gb-family-planner' },
      h('div', { class: 'gb-section-head' }, h('h2', null, 'Shopping list')),
      h(
        'div',
        { class: 'gb-card gb-family-grocery' },
        h(
          'div',
          { class: 'gb-family-shop-builds', role: 'group', 'aria-label': 'Fill the list' },
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft',
              onclick: () =>
                run(api.generateShopping({}), (res) => {
                  model.shoppingList = res;
                  delete model.sectionErrors.shopping;
                  // Says "Added 6 items" or why nothing was — it used to come
                  // back unchanged without a word when there was nothing new.
                  if (res && res.message) toast.success(res.message);
                }),
            },
            Icon('sparkles', { size: 16 }),
            "From today's plan"
          ),
          restockButton('From the pantry')
        ),
        field(
          'Add an item',
          h(
            'div',
            { class: 'gb-family-manual-add' },
            nameI,
            qtyI,
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--sm gb-family-add-btn',
                'aria-label': 'Add to list',
                onclick: add,
              },
              Icon('plus', { size: 16 })
            )
          )
        )
      ),
      list.items.length ? shopTools(list) : null,
      list.items.length ? shopPrintout(list) : null,
      list.items.length
        ? h(
            'div',
            { class: 'gb-family-shop-list' },
            list.items.map((it) => shopRow(it))
          )
        : h(
            'p',
            { class: 'gb-family-empty-note' },
            'List is empty. Build one from a plan or add items.'
          ),
      // '₹', not the Money currency: the server's estimates are INR by contract
      // (FamilyService's prompt), so another symbol would mislabel them.
      list.totalEstimatedCost > 0
        ? h(
            'div',
            { class: 'gb-card gb-family-shop-total' },
            h('span', null, 'Estimated total (unchecked)'),
            h('strong', null, '₹' + list.totalEstimatedCost)
          )
        : null
    );
  }

  /* ---- share / print ----
     Plain text, still-to-buy lines only. The share sheet where there is one
     (phones), the clipboard otherwise. */
  function shoppingText(list) {
    const open = list.items.filter((i) => !i.checked);
    const lines = open.map((i) => '• ' + i.name + (i.quantity ? ' — ' + i.quantity : ''));
    return ['Shopping list', ...lines].join('\n');
  }
  async function shareShopping(list) {
    const text = shoppingText(list);
    if (!list.items.some((i) => !i.checked)) {
      toast.success('Everything is ticked off. Nothing to share.');
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Shopping list', text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // the user closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Shopping list copied.');
    } catch (err) {
      toast.error(err, 'Could not copy the list.');
    }
  }
  /* Print only the printout: the body class scopes the @media print rules
     (styles/app.css), so printing any other screen is unaffected. */
  function printShopping() {
    const cls = 'gb-print-shopping';
    document.body.classList.add(cls);
    const done = () => {
      document.body.classList.remove(cls);
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1000); // afterprint never fires in some WebViews
  }
  function shopTools(list) {
    const left = list.items.filter((i) => !i.checked).length;
    return h(
      'div',
      { class: 'gb-family-shop-tools' },
      h(
        'span',
        { class: 'gb-family-shop-left' },
        left ? left + ' to buy' : 'All bought'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--sm',
          onclick: () => shareShopping(list),
        },
        Icon('share-2', { size: 15 }),
        'Share'
      ),
      // The Android WebView's window.print() is a no-op unless the activity wires
      // up PrintManager, which MainActivity doesn't: Copy and Share cover it there.
      isNative()
        ? null
        : h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--sm', onclick: printShopping },
            Icon('printer', { size: 15 }),
            'Print'
          )
    );
  }
  function shopPrintout(list) {
    const open = list.items.filter((i) => !i.checked);
    return h(
      'div',
      { class: 'gb-family-shop-printout', 'aria-hidden': 'true' },
      h('h1', null, 'Shopping list'),
      h(
        'ul',
        null,
        open.map((i) =>
          h(
            'li',
            null,
            h('span', { class: 'gb-family-shop-printout-box' }),
            i.name,
            i.quantity
              ? h('span', { class: 'gb-family-shop-printout-qty' }, ' — ' + i.quantity)
              : null
          )
        )
      )
    );
  }

  function shopRow(it) {
    return h(
      'div',
      { class: 'gb-card gb-family-shop-item' + (it.checked ? ' is-checked' : '') },
      h(
        'label',
        { class: 'gb-family-shop-check' },
        h('input', {
          type: 'checkbox',
          checked: it.checked,
          onchange: (e) => tickShopping(it, e.currentTarget.checked),
        }),
        h(
          'div',
          { class: 'gb-family-shop-id' },
          h('div', { class: 'gb-family-card-name' }, it.name),
          it.quantity ? h('div', { class: 'gb-family-card-meta' }, it.quantity) : null
        )
      ),
      it.estimatedCost > 0
        ? h('span', { class: 'gb-family-shop-cost' }, '₹' + it.estimatedCost)
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn gb-iconbtn--danger',
          'aria-label': 'Remove',
          onclick: () =>
            run(api.deleteShopping(it.id), (res) => {
              model.shoppingList = res;
              // One tap removed it for good; now it can come back.
              toast.action('Removed ' + it.name + '.', 'Undo', () => restoreShopping(it));
            }),
        },
        Icon('trash-2', { size: 15 })
      )
    );
  }

  /* Ticks paint at once and roll back if the save fails — a tick used to wait
     a full round trip, which in a shop on mobile data is a long time. A later
     response must not undo a tick still in flight, so the wanted state of each
     pending item is laid back over whatever list comes back. */
  const pendingTicks = new Map(); // item id -> wanted checked
  function overlayPending(list) {
    if (!list || !list.items) return list;
    list.items.forEach((x) => {
      if (pendingTicks.has(x.id)) x.checked = pendingTicks.get(x.id);
    });
    return list;
  }
  function tickShopping(it, want) {
    const prev = it.checked;
    it.checked = want;
    pendingTicks.set(it.id, want);
    paint();
    const left = model.shoppingList ? model.shoppingList.items.filter((i) => !i.checked).length : 0;
    toast.announce(left ? left + ' to buy' : 'All bought');
    api
      .toggleShopping(it.id, want)
      .then((res) => {
        if (pendingTicks.get(it.id) === want) pendingTicks.delete(it.id);
        model.shoppingList = overlayPending(res);
        paintSoon();
      })
      .catch((err) => {
        if (pendingTicks.get(it.id) === want) pendingTicks.delete(it.id);
        const row = model.shoppingList && model.shoppingList.items.find((x) => x.id === it.id);
        if (row) row.checked = prev;
        paintSoon();
        toast.error(err, 'Could not update that item.');
      });
  }

  function restoreShopping(it) {
    api
      .addShopping({
        name: it.name,
        quantity: it.quantity || null,
        estimatedCost: it.estimatedCost,
      })
      .then((res) => {
        const back = res && res.items && res.items.find((x) => x.name === it.name && !x.checked);
        if (it.checked && back) return api.toggleShopping(back.id, true);
        return res;
      })
      .then((res) => {
        model.shoppingList = overlayPending(res);
        paintSoon();
      })
      .catch((err) => toast.error(err, 'Could not restore that item.'));
  }

  // ---- chores ----

  const REPEAT_LABEL = { none: 'Once', daily: 'Daily', weekly: 'Weekly' };

  /* Ticks paint at once, as the shopping tick does; the wanted state of each
     in-flight tick is laid back over any list that lands meanwhile. */
  const pendingChoreTicks = new Map(); // chore id -> wanted done
  function overlayChoreTicks(list) {
    (list || []).forEach((c) => {
      if (pendingChoreTicks.has(c.id)) c.done = pendingChoreTicks.get(c.id);
    });
    return list;
  }
  function tickChore(c, want) {
    const prev = c.done;
    c.done = want;
    pendingChoreTicks.set(c.id, want);
    paint();
    api
      .toggleChore(c.id, want)
      .then((res) => {
        if (pendingChoreTicks.get(c.id) === want) pendingChoreTicks.delete(c.id);
        model.chores = overlayChoreTicks(res || []);
        paintSoon();
      })
      .catch((err) => {
        if (pendingChoreTicks.get(c.id) === want) pendingChoreTicks.delete(c.id);
        const row = (model.chores || []).find((x) => x.id === c.id);
        if (row) row.done = prev;
        paintSoon();
        toast.error(err, 'Could not update that chore.');
      });
  }

  function choreBody(c) {
    return {
      title: c.title,
      assigneeMemberId: c.assigneeMemberId || null,
      dueDate: c.dueDate || null,
      repeat: c.repeat || 'none',
    };
  }

  /* Anyone + one chip per member. The picked one is the draft's assignee. */
  function assigneeChips(selectedId, onPick) {
    const members = (model.family && model.family.members) || [];
    const chip = (id, label) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-family-chip gb-family-chip--toggle' + (selectedId === id ? ' is-on' : ''),
          'aria-pressed': String(selectedId === id),
          onclick: () => onPick(id),
        },
        label
      );
    return h(
      'div',
      {
        class: 'gb-family-chips gb-family-member-select',
        role: 'group',
        'aria-label': 'Assign to',
      },
      chip(null, 'Anyone'),
      members.map((m) => chip(m.id, m.isSelf ? 'Me' : m.name))
    );
  }

  function choresSection() {
    const list = model.chores || [];
    const draft = model.choreDraft;
    const titleI = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: 120,
      placeholder: 'e.g. Take out the bins',
      value: draft.title,
      oninput: (e) => (draft.title = e.currentTarget.value),
    });
    const dueI = h('input', {
      type: 'date',
      class: 'gb-input',
      'aria-label': 'Due date',
      value: draft.dueDate,
      onchange: (e) => (draft.dueDate = e.currentTarget.value),
    });
    const repeatI = h(
      'select',
      {
        class: 'gb-input',
        'aria-label': 'Repeat',
        onchange: (e) => (draft.repeat = e.currentTarget.value),
      },
      Object.keys(REPEAT_LABEL).map((k) =>
        h('option', { value: k, selected: draft.repeat === k }, REPEAT_LABEL[k])
      )
    );
    const add = () => {
      const title = titleI.value.trim();
      if (!title) {
        titleI.focus();
        return;
      }
      run(
        api.addChore({
          title,
          assigneeMemberId: draft.assigneeMemberId,
          dueDate: dueI.value || null,
          repeat: repeatI.value,
        }),
        (res) => {
          model.chores = overlayChoreTicks(res || []);
          model.choreDraft = { title: '', assigneeMemberId: null, dueDate: '', repeat: 'none' };
        }
      );
    };
    titleI.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
    return h(
      'section',
      { class: 'gb-family-planner' },
      h('div', { class: 'gb-section-head' }, h('h2', null, 'Chores')),
      h(
        'div',
        { class: 'gb-card gb-family-grocery' },
        field('New chore', titleI),
        h('h3', { class: 'gb-family-subhead' }, 'Assign to'),
        assigneeChips(draft.assigneeMemberId, (id) => {
          draft.assigneeMemberId = id;
          paint();
        }),
        h('div', { class: 'gb-family-chore-form' }, field('Due', dueI), field('Repeat', repeatI)),
        h(
          'button',
          { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--sm', onclick: add },
          Icon('plus', { size: 16 }),
          'Add chore'
        )
      ),
      list.length
        ? h(
            'div',
            { class: 'gb-family-shop-list' },
            list.map((c) => choreRow(c))
          )
        : h(
            'p',
            { class: 'gb-family-empty-note' },
            'No chores yet. Add one and give it to someone.'
          )
    );
  }

  function choreRow(c) {
    const members = (model.family && model.family.members) || [];
    const today = new Date().toLocaleDateString('en-CA');
    const overdue = !c.done && c.dueDate && c.dueDate < today;
    const meta = [
      c.dueDate ? (c.dueDate === today ? 'Today' : 'Due ' + fmtDay(c.dueDate)) : null,
      c.repeat && c.repeat !== 'none' ? REPEAT_LABEL[c.repeat] : null,
    ].filter(Boolean);
    const reassign = h(
      'select',
      {
        class: 'gb-family-chip gb-family-chore-assignee' + (c.assigneeMemberId ? ' is-set' : ''),
        'aria-label': 'Assign ' + c.title,
        onchange: (e) => {
          const sel = e.currentTarget;
          run(
            api
              .updateChore(c.id, Object.assign(choreBody(c), { assigneeMemberId: sel.value || null }))
              .catch((err) => {
                sel.value = c.assigneeMemberId || ''; // not handed over: show who still has it
                throw err;
              }),
            (res) => {
              model.chores = overlayChoreTicks(res || []);
            }
          );
        },
      },
      h('option', { value: '', selected: !c.assigneeMemberId }, 'Anyone'),
      members.map((m) =>
        h(
          'option',
          { value: m.id, selected: m.id === c.assigneeMemberId },
          m.isSelf ? 'Me' : m.name
        )
      )
    );
    return h(
      'div',
      { class: 'gb-card gb-family-shop-item' + (c.done ? ' is-checked' : '') },
      h(
        'label',
        { class: 'gb-family-shop-check' },
        h('input', {
          type: 'checkbox',
          checked: c.done,
          onchange: (e) => tickChore(c, e.currentTarget.checked),
        }),
        h(
          'div',
          { class: 'gb-family-shop-id' },
          h('div', { class: 'gb-family-card-name' }, c.title),
          meta.length
            ? h(
                'div',
                { class: 'gb-family-card-meta' + (overdue ? ' is-overdue' : '') },
                c.repeat && c.repeat !== 'none' ? Icon('repeat', { size: 12 }) : null,
                meta.join(' · ')
              )
            : null
        )
      ),
      reassign,
      c.done
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Set a reminder for ' + c.title,
              title: 'Remind',
              onclick: () =>
                askReminderTime(
                  'Remind about this chore',
                  c.assigneeName ? c.title + ' · for ' + c.assigneeName : c.title,
                  (time) =>
                    api
                      .remindChore(c.id, time)
                      .then((res) =>
                        toast.success(
                          res && res.sentTo
                            ? 'Reminder sent to ' + res.sentTo + '.'
                            : 'Reminder added to your calendar.'
                        )
                      )
                ),
            },
            Icon('bell-plus', { size: 15 })
          ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn gb-iconbtn--danger',
          'aria-label': 'Remove ' + c.title,
          onclick: () =>
            run(api.deleteChore(c.id), (res) => {
              model.chores = overlayChoreTicks(res || []);
              toast.action('Removed ' + c.title + '.', 'Undo', () =>
                api
                  .addChore(choreBody(c))
                  .then((back) => {
                    model.chores = overlayChoreTicks(back || []);
                    paintSoon();
                  })
                  .catch((err) => toast.error(err, 'Could not restore that chore.'))
              );
            }),
        },
        Icon('trash-2', { size: 15 })
      )
    );
  }

  // ---- favourites ----

  function favouritesSection() {
    const favs = model.favourites || [];
    return h(
      'section',
      { class: 'gb-family-planner' },
      h('div', { class: 'gb-section-head' }, h('h2', null, 'Saved menus')),
      favs.length
        ? h(
            'div',
            { class: 'gb-family-fav-list' },
            favs.map((f) => favCard(f))
          )
        : h(
            'p',
            { class: 'gb-family-empty-note' },
            'No saved menus yet. Generate a plan and tap “Save menu”.'
          )
    );
  }

  function favCard(f) {
    const open = model.openFavouriteId === f.id;
    return h(
      'div',
      { class: 'gb-card gb-family-fav' },
      h(
        'div',
        { class: 'gb-family-fav-head' },
        h(
          'div',
          { class: 'gb-family-fav-id' },
          h(
            'div',
            { class: 'gb-family-card-name' },
            f.name,
            f.occasion && f.occasion !== 'normal'
              ? h('span', { class: 'gb-pill gb-pill--soft' }, cap(f.occasion))
              : null
          ),
          h(
            'div',
            { class: 'gb-family-card-meta' },
            'Saved ' +
              (f.createdAt
                ? new Date(f.createdAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : '')
          )
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft gb-btn--sm',
            onclick: () => {
              model.openFavouriteId = open ? null : f.id;
              paint();
            },
          },
          open ? 'Hide' : 'View'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft gb-btn--sm',
            title: "Make this today's plan",
            onclick: () =>
              run(api.useFavourite(f.id), (res) => {
                model.plan = res;
                toast.success('On the menu for today.');
                loadSection('history').then(paintSoon);
                switchSection('plan');
              }),
          },
          'Use today'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-iconbtn gb-iconbtn--danger',
            'aria-label': 'Delete menu',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Delete “' + f.name + '”?',
                confirmLabel: 'Delete',
                cancelLabel: 'Keep',
                danger: true,
              });
              if (!ok) return;
              run(api.deleteFavourite(f.id), () => {
                model.favourites = (model.favourites || []).filter((x) => x.id !== f.id);
              });
            },
          },
          Icon('trash-2', { size: 15 })
        )
      ),
      open ? planView({ plan: f.plan, source: 'ai' }) : null
    );
  }

  function skeleton() {
    const bar = (w) => h('div', { class: 'gb-skel-line', style: { width: w } });
    const card = () =>
      h(
        'div',
        { class: 'gb-card gb-skel-card' },
        h('div', { class: 'gb-skel-avatar' }),
        h('div', { class: 'gb-skel-lines' }, bar('60%'), bar('40%'))
      );
    return h('div', { class: 'gb-family gb-family-skeleton' }, card(), card(), card());
  }

  let paints = 0;
  function paint() {
    paints++;
    deferredPaint = false;
    if (model.loading) {
      root.replaceChildren(skeleton());
      return;
    }
    if (model.error) {
      root.replaceChildren(CrashCard(load));
      return;
    }
    if (model.panel) {
      const p = model.panel;
      let panelEl;
      if (p.type === 'add') panelEl = addPanel();
      else if (p.type === 'edit') panelEl = editPanel(p.member);
      else if (p.type === 'profile') panelEl = profilePanel(p.member);
      else if (p.type === 'link') panelEl = linkPanel(p.member);
      else if (p.type === 'recipe') panelEl = recipePanel(p.dish);
      root.replaceChildren(panelEl);
      return;
    }

    const hasFamily = model.family && model.family.familyId;
    if (!hasFamily) {
      root.replaceChildren(...[invitesSection(), emptyState()].filter(Boolean));
      return;
    }
    const SECTION_WHAT = {
      plan: "today's plan",
      weekly: 'the weekly plan',
      pantry: 'your pantry',
      shopping: 'the shopping list',
      favourites: 'your saved menus',
      chores: 'the chores',
    };
    const children = [
      invitesSection(),
      sectionNav(),
      SECTION_WHAT[model.section] ? sectionError(model.section, SECTION_WHAT[model.section]) : null,
      activeSection(),
    ].filter(Boolean);
    root.replaceChildren(...children);
  }

  load();
  return root;
}

export { ScreenFamily };
