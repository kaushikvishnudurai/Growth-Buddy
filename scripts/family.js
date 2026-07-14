/* =====================================================================
   Growth Buddy — Family tab & AI South Indian meal planner

   Self-contained screen (like ScreenMentor): owns its own data + view
   state and repaints its own subtree, so the parent only has to pass an
   `api` object of thin fetch wrappers. See SCREENS.family in app.js.
   ===================================================================== */
import { h, Icon, CrashCard, confirmDialog } from './gb-kit.js';

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

const MEALS = [
  { key: 'breakfast', label: 'Breakfast', icon: 'sunrise' },
  { key: 'lunch', label: 'Lunch', icon: 'utensils' },
  { key: 'snack', label: 'Evening snack', icon: 'leaf' },
  { key: 'dinner', label: 'Dinner', icon: 'utensils-crossed' },
];

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

// Age-category → avatar accent + pluralised label for the summary strip.
const AGE_ACCENT = {
  Infant: 'infant',
  Child: 'child',
  Teenager: 'teen',
  Adult: 'adult',
  'Senior Citizen': 'senior',
};
const AGE_PLURAL = {
  Infant: 'Infants',
  Child: 'Children',
  Teenager: 'Teenagers',
  Adult: 'Adults',
  'Senior Citizen': 'Seniors',
  Unknown: 'Unknown',
};
function accentClass(cat) {
  const k = AGE_ACCENT[cat];
  return k ? ' gb-family-avatar--' + k : '';
}

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

function field(labelText, control, hint) {
  return h(
    'label',
    { class: 'gb-field' },
    h('span', { class: 'gb-field-label' }, labelText),
    control,
    hint ? h('span', { class: 'gb-field-hint' }, hint) : null
  );
}

function readImageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * ScreenFamily({ api })
 *   api: { getFamily, addMember, updateMember, updateProfile, removeMember,
 *          searchUsers, linkMember, scanGrocery, generateMealPlan, getMealPlan }
 */
function ScreenFamily({ api }) {
  const root = h('div', { class: 'gb-family gb-rise' });

  const model = {
    loading: true,
    error: '',
    family: null, // { familyId, ownerUserId, isOwner, members: [] }
    invites: [], // pending invitations addressed to the current user
    panel: null, // null | {type:'addChoose'} | {type:'add'} | {type:'edit',member} | {type:'profile',member} | {type:'link'}
    busy: false,
    // Meal planner
    ingredients: [], // [{ name, category, quantity, freshness }]
    selectedMemberIds: null, // null = everyone
    scanMsg: '',
    scanBusy: false,
    plan: null, // last MealPlanResponse { plan, groceryItems, source, createdAt }
    planBusy: false,
    planError: '',
    // Sectioned planner UI
    section: 'members', // members | plan | weekly | pantry | shopping | favourites
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
  };

  // ---- data ----

  function applyFamily(resp) {
    model.family = resp || null;
  }

  async function load() {
    model.loading = true;
    model.error = '';
    paint();
    try {
      // Prefetch every section so switching is instant and the nav can show
      // live count badges. Planner endpoints return empty when there's no family.
      const [fam, plan, invites, weekly, pantry, shop, favs] = await Promise.all([
        api.getFamily(),
        api.getMealPlan().catch(() => null),
        api.getInvites().catch(() => []),
        api.getWeekly().catch(() => null),
        api.listPantry().catch(() => []),
        api.listShopping().catch(() => ({ items: [], totalEstimatedCost: 0 })),
        api.listFavourites().catch(() => []),
      ]);
      applyFamily(fam);
      model.invites = invites || [];
      model.weekly = weekly || false;
      model.pantryItems = pantry || [];
      model.shoppingList = shop || { items: [], totalEstimatedCost: 0 };
      model.favourites = favs || [];
      if (plan) {
        model.plan = plan;
        if (Array.isArray(plan.groceryItems) && !model.ingredients.length) {
          model.ingredients = plan.groceryItems.map((g) => ({
            name: g.name,
            category: g.category || 'Other',
            quantity: g.quantity || '',
            freshness: g.freshness || '',
          }));
        }
      }
    } catch (err) {
      model.error = err.message || 'Could not load your family.';
    } finally {
      model.loading = false;
      paint();
    }
  }

  async function run(promise, onOk) {
    if (model.busy) return;
    model.busy = true;
    paint();
    try {
      const res = await promise;
      if (onOk) onOk(res);
    } catch (err) {
      window.alert(err.message || 'Something went wrong.');
    } finally {
      model.busy = false;
      paint();
    }
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
    const canRemove = isOwner && m.relationship !== 'self' && !m.isOwner;
    const metaBits = [];
    if (m.age != null) metaBits.push(m.age + ' yrs · ' + m.ageCategory);
    else metaBits.push(m.ageCategory || 'Age unknown');
    if (m.gender) metaBits.push(m.gender);
    const hw = [
      m.heightCm ? m.heightCm + ' cm' : null,
      m.weightKg ? m.weightKg + ' kg' : null,
    ].filter(Boolean);
    if (hw.length) metaBits.push(hw.join(', '));
    if (m.profile && m.profile.dietPreference) metaBits.push(m.profile.dietPreference);

    const actions = h(
      'div',
      { class: 'gb-family-card-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn',
          'aria-label': 'Edit food profile',
          title: 'Food profile',
          onclick: () => openPanel({ type: 'profile', member: m }),
        },
        Icon('utensils', { size: 17 })
      ),
      isOwner
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Edit member',
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
      canRemove
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn gb-iconbtn--danger',
              'aria-label': 'Remove member',
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
        h('div', { class: 'gb-family-avatar' + accentClass(m.ageCategory) }, initials(m.name)),
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

  // ---- panels (add / edit / profile / link) ----

  function openPanel(panel) {
    model.panel = panel;
    paint();
  }
  function closePanel() {
    model.panel = null;
    paint();
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

  function memberFormControls(member) {
    const initialRel = (member && member.relationship) || RELATIONSHIPS[0];
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
    const relSelect = h(
      'select',
      {
        class: 'gb-input',
        disabled: member && member.relationship === 'self',
        // Auto-fill gender from the relationship (still switchable afterwards).
        onchange: (e) => {
          const inferred = REL_GENDER[e.target.value];
          if (inferred) genderSelect.value = inferred;
        },
      },
      RELATIONSHIPS.map((r) => h('option', { value: r, selected: initialRel === r }, cap(r)))
    );
    const dobInput = h('input', {
      type: 'date',
      class: 'gb-input',
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
    return { nameInput, relSelect, dobInput, genderSelect, heightInput, weightInput };
  }

  function intOrNull(input) {
    const v = parseInt(input.value, 10);
    return Number.isFinite(v) ? v : null;
  }

  // A single entry point for adding someone, so the two paths (create a local
  // profile vs. invite an existing account) aren't two ambiguous "Add" buttons.
  function addChooserPanel() {
    const choice = (icon, title, desc, panel) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-family-add-choice',
          onclick: () => openPanel(panel),
        },
        h(
          'span',
          { class: 'gb-family-add-choice-icon' },
          Icon(icon, { size: 22, color: 'var(--brand)' })
        ),
        h(
          'span',
          { class: 'gb-family-add-choice-text' },
          h('span', { class: 'gb-family-add-choice-title' }, title),
          h('span', { class: 'gb-family-add-choice-desc' }, desc)
        ),
        Icon('chevron-right', { size: 18, color: 'var(--fg3)' })
      );
    return h(
      'div',
      { class: 'gb-family-panel' },
      panelHeader('Add a family member'),
      h('p', { class: 'gb-family-panel-sub' }, 'Choose how you’d like to add them.'),
      h(
        'div',
        { class: 'gb-family-add-choices' },
        choice(
          'user-plus',
          'Create a profile',
          'For a relative you cook for — no account needed.',
          { type: 'add' }
        ),
        choice(
          'users',
          'Invite a registered user',
          'Someone who already uses Growth Buddy. They’ll get an invite to accept.',
          { type: 'link', member: null }
        )
      )
    );
  }

  function addPanel() {
    const c = memberFormControls(null);
    const save = () => {
      const name = c.nameInput.value.trim();
      if (!name) {
        window.alert('Please enter a name.');
        return;
      }
      run(
        api.addMember({
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
      panelHeader('Add family member'),
      h(
        'p',
        { class: 'gb-family-panel-sub' },
        'Create a profile for a relative — no account needed.'
      ),
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
        { type: 'button', class: 'gb-btn gb-btn--primary', disabled: model.busy, onclick: save },
        'Add member'
      )
    );
  }

  function editPanel(member) {
    const c = memberFormControls(member);
    const save = () => {
      const name = c.nameInput.value.trim();
      if (!name) {
        window.alert('Please enter a name.');
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
        { type: 'button', class: 'gb-btn gb-btn--primary', disabled: model.busy, onclick: save },
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
        { type: 'button', class: 'gb-btn gb-btn--primary', disabled: model.busy, onclick: save },
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
      placeholder: 'Search by name, user ID, email or phone',
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
                    disabled: model.busy,
                    onclick: () =>
                      run(
                        api.linkMember({ userId: u.id, memberId: member ? member.id : null }),
                        (resp) => {
                          applyFamily(resp);
                          closePanel();
                          window.alert(
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

    async function doSearch() {
      const q = qInput.value.trim();
      if (!q) return;
      resultsEl.replaceChildren(h('p', { class: 'gb-family-empty-note' }, 'Searching…'));
      try {
        renderResults(await api.searchUsers(q));
      } catch (err) {
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

  // ---- meal planner ----

  function ingredientChips() {
    if (!model.ingredients.length) {
      return h(
        'p',
        { class: 'gb-family-empty-note' },
        'No ingredients yet. Scan a photo or add some.'
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

  function plannerSection() {
    const fam = model.family;
    const members = (fam && fam.members) || [];

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
          const dataUrl = await readImageDataUrl(file);
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
        }
      },
    });

    const manualInput = h('input', {
      type: 'text',
      class: 'gb-input',
      placeholder: 'Add an ingredient (e.g. Drumstick)',
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

    const memberSelector = h(
      'div',
      { class: 'gb-family-chips gb-family-member-select' },
      members.map((m) => {
        const sel = model.selectedMemberIds === null || model.selectedMemberIds.includes(m.id);
        return h(
          'button',
          {
            type: 'button',
            class: 'gb-family-chip gb-family-chip--toggle' + (sel ? ' is-on' : ''),
            onclick: () => {
              const ids =
                model.selectedMemberIds === null
                  ? members.map((x) => x.id)
                  : model.selectedMemberIds.slice();
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

    const generate = () => {
      model.planBusy = true;
      model.planError = '';
      paint();
      const memberIds =
        model.selectedMemberIds === null ? members.map((m) => m.id) : model.selectedMemberIds;
      api
        .generateMealPlan({ ingredients: model.ingredients, memberIds })
        .then((res) => {
          model.plan = res;
        })
        .catch((err) => {
          model.planError = err.message || 'Could not generate a meal plan.';
        })
        .finally(() => {
          model.planBusy = false;
          paint();
        });
    };

    const hasPlan = !!model.plan;
    return h(
      'section',
      { class: 'gb-family-planner' },
      h(
        'div',
        { class: 'gb-section-head' },
        h('h2', null, "Today's meal plan"),
        Icon('sparkles', { size: 18, color: 'var(--iris-500)' })
      ),
      h(
        'div',
        { class: 'gb-card gb-family-grocery' },
        h('h3', { class: 'gb-family-subhead' }, 'Available groceries'),
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
              class: 'gb-btn gb-btn--soft gb-btn--sm',
              'aria-label': 'Add ingredient',
              onclick: addManual,
            },
            Icon('plus', { size: 16 })
          )
        ),
        ingredientChips()
      ),
      members.length
        ? h(
            'div',
            { class: 'gb-card gb-family-planfor' },
            h('h3', { class: 'gb-family-subhead' }, 'Plan for'),
            memberSelector
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary gb-family-generate',
          disabled: model.planBusy || !members.length,
          onclick: generate,
        },
        Icon('sparkles', { size: 17, color: '#fff' }),
        model.planBusy ? 'Cooking up a plan…' : hasPlan ? 'Regenerate plan' : 'Generate meal plan'
      ),
      model.planError ? h('p', { class: 'gb-msg-error' }, model.planError) : null,
      hasPlan ? planActions() : null,
      hasPlan ? planView(model.plan) : null
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
          disabled: model.busy,
          onclick: () => {
            const name = window.prompt('Name this menu:', 'Family favourite');
            if (!name) return;
            run(api.saveFavourite({ name, planId }), () => {
              model.favourites = null; // force reload next time
              window.alert('Saved to your favourites.');
            });
          },
        },
        Icon('heart', { size: 15 }),
        'Save menu'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--sm',
          disabled: model.busy,
          onclick: () =>
            run(api.markCooked(planId), () =>
              window.alert('Noted — Buddy will favour these dishes next time.')
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
          disabled: model.busy,
          onclick: () =>
            run(api.generateShopping({ planId }), (res) => {
              model.shoppingList = res;
              switchSection('shopping');
            }),
        },
        Icon('list-checks', { size: 15 }),
        'Build shopping list'
      )
    );
  }

  function mealList(title, icon, items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return null;
    return h(
      'div',
      { class: 'gb-family-meal' },
      h(
        'div',
        { class: 'gb-family-meal-head' },
        Icon(icon, { size: 16, color: 'var(--leaf-600)' }),
        h('h4', null, title)
      ),
      h(
        'ul',
        { class: 'gb-family-meal-list' },
        list.map((d) => h('li', null, String(d)))
      )
    );
  }

  function chipRow(label, values, tone) {
    const list = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!list.length) return null;
    return h(
      'div',
      { class: 'gb-family-plan-aside' },
      h('h4', null, label),
      h(
        'div',
        { class: 'gb-family-chips' },
        list.map((v) =>
          h('span', { class: 'gb-family-chip gb-family-chip--' + (tone || 'soft') }, String(v))
        )
      )
    );
  }

  function planView(resp) {
    const plan = (resp && resp.plan) || {};
    const ns = plan.nutritionSummary || {};
    const isFallback = resp && resp.source === 'fallback';

    const nutritionCard = h(
      'div',
      { class: 'gb-card gb-family-nutrition' },
      h('h3', { class: 'gb-family-subhead' }, 'Nutrition summary'),
      h(
        'div',
        { class: 'gb-family-nutrition-grid' },
        nutriStat('Protein', ns.protein_g, 'g'),
        nutriStat('Fibre', ns.fibre_g, 'g'),
        nutriStat('Calories', ns.calories_kcal, 'kcal')
      ),
      ns.balancedFor
        ? h('p', { class: 'gb-family-card-meta' }, 'Balanced for: ' + ns.balancedFor)
        : null
    );

    return h(
      'div',
      { class: 'gb-family-plan' },
      isFallback
        ? h(
            'div',
            { class: 'gb-family-plan-banner' },
            Icon('circle-alert', { size: 15 }),
            h('span', null, 'AI was unavailable — showing a simple template.')
          )
        : null,
      h(
        'div',
        { class: 'gb-card gb-family-meals' },
        MEALS.map((m) => mealList(m.label, m.icon, plan[m.key]))
      ),
      nutritionCard,
      chipRow('Allergens avoided', plan.allergensAvoided, 'ok'),
      plan.suggestions && plan.suggestions.length
        ? h(
            'div',
            { class: 'gb-card gb-family-suggestions' },
            h('h3', { class: 'gb-family-subhead' }, 'AI suggestions'),
            h(
              'ul',
              { class: 'gb-family-meal-list' },
              plan.suggestions.map((s) => h('li', null, String(s)))
            )
          )
        : null,
      chipRow('Shopping suggestions', plan.purchaseRecommendations, 'soft')
    );
  }

  function nutriStat(label, value, unit) {
    const has = value != null && Number(value) > 0;
    return h(
      'div',
      { class: 'gb-family-stat' },
      h('div', { class: 'gb-family-stat-value' }, has ? value + ' ' + unit : '—'),
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
          counts[c] + ' ' + (counts[c] > 1 ? AGE_PLURAL[c] : c === 'Senior Citizen' ? 'Senior' : c)
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
            members.length + (members.length === 1 ? ' member' : ' members')
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
                onclick: () => openPanel({ type: 'addChoose' }),
              },
              Icon('plus', { size: 16 }),
              'Add member'
            )
          : null
      ),
      familySummary(),
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
              disabled: model.busy,
              onclick: leaveFamily,
            },
            Icon('log-out', { size: 16 }),
            'Leave family'
          )
        : null
    );
  }

  function invitesSection() {
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
                disabled: model.busy,
                onclick: () => run(api.declineInvite(inv.memberId), () => load()),
              },
              'Decline'
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--primary gb-btn--sm',
                disabled: model.busy,
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
          onclick: () => openPanel({ type: 'addChoose' }),
        },
        Icon('plus', { size: 17, color: '#fff' }),
        'Add your first member'
      )
    );
  }

  // ---- section navigation ----

  function switchSection(section) {
    model.section = section;
    paint();
    if (section === 'weekly' && model.weekly === null) {
      api
        .getWeekly()
        .then((w) => {
          model.weekly = w || false;
          paint();
        })
        .catch(() => {
          model.weekly = false;
          paint();
        });
    } else if (section === 'pantry' && model.pantryItems === null) {
      api
        .listPantry()
        .then((x) => {
          model.pantryItems = x || [];
          paint();
        })
        .catch(() => {
          model.pantryItems = [];
          paint();
        });
    } else if (section === 'shopping' && model.shoppingList === null) {
      api
        .listShopping()
        .then((x) => {
          model.shoppingList = x || { items: [], totalEstimatedCost: 0 };
          paint();
        })
        .catch(() => {
          model.shoppingList = { items: [], totalEstimatedCost: 0 };
          paint();
        });
    } else if (section === 'favourites' && model.favourites === null) {
      api
        .listFavourites()
        .then((x) => {
          model.favourites = x || [];
          paint();
        })
        .catch(() => {
          model.favourites = [];
          paint();
        });
    }
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
    if (id === 'members') {
      return (model.family && model.family.members && model.family.members.length) || 0;
    }
    return 0;
  }

  function sectionNav() {
    const items = [
      ['members', 'Members', 'users'],
      ['plan', 'Today', 'utensils'],
      ['weekly', 'Weekly', 'calendar-days'],
      ['pantry', 'Pantry', 'sprout'],
      ['shopping', 'Shopping', 'list-checks'],
      ['favourites', 'Saved', 'heart'],
    ];
    return h(
      'div',
      { class: 'gb-family-sectionnav' },
      items.map(([id, label, icon]) => {
        const n = sectionBadge(id);
        const danger = id === 'pantry' && n > 0;
        return h(
          'button',
          {
            type: 'button',
            class: 'gb-family-sectiontab' + (model.section === id ? ' is-active' : ''),
            onclick: () => switchSection(id),
          },
          Icon(icon, { size: 16 }),
          h('span', null, label),
          n > 0
            ? h('span', { class: 'gb-family-tab-badge' + (danger ? ' is-danger' : '') }, String(n))
            : null
        );
      })
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
      h(
        'div',
        { class: 'gb-section-head' },
        h('h2', null, 'Weekly meal planner'),
        Icon('calendar-days', { size: 18, color: 'var(--iris-500)' })
      ),
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
            class: 'gb-btn gb-btn--primary gb-family-generate',
            disabled: model.weeklyBusy || !members.length,
            onclick: generate,
          },
          Icon('sparkles', { size: 17, color: '#fff' }),
          model.weeklyBusy ? 'Planning your week…' : wk ? 'Regenerate week' : 'Generate weekly plan'
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
        days.map((d) => weekDayCard(d))
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

  function weekDayCard(d) {
    const line = (label, arr) => {
      const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
      if (!list.length) return null;
      return h(
        'div',
        { class: 'gb-family-weekday-meal' },
        h('span', { class: 'gb-family-weekday-meal-label' }, label),
        h('span', null, list.join(', '))
      );
    };
    return h(
      'div',
      { class: 'gb-card gb-family-weekday' },
      h('h4', { class: 'gb-family-weekday-label' }, d.label || 'Day ' + d.day),
      line('Breakfast', d.breakfast),
      line('Lunch', d.lunch),
      line('Snack', d.snack),
      line('Dinner', d.dinner)
    );
  }

  // ---- pantry ----

  function pantrySection() {
    const items = model.pantryItems || [];
    const nameI = h('input', {
      type: 'text',
      class: 'gb-input',
      'aria-label': 'Item name',
      placeholder: 'Item (e.g. Tomatoes)',
    });
    const catI = h(
      'select',
      { class: 'gb-input', 'aria-label': 'Category' },
      ['Vegetable', 'Fruit', 'Grain', 'Pulse', 'Dairy', 'Protein', 'Spice', 'Other'].map((c) =>
        h('option', { value: c, selected: c === 'Vegetable' }, c)
      )
    );
    const qtyI = h('input', {
      type: 'text',
      class: 'gb-input',
      'aria-label': 'Quantity',
      placeholder: 'Qty (e.g. 500 g)',
    });
    const expI = h('input', { type: 'date', class: 'gb-input', 'aria-label': 'Expiry date' });
    const leftI = h('input', { type: 'checkbox' });
    const add = () => {
      const name = nameI.value.trim();
      if (!name) return;
      run(
        api.addPantry({
          name,
          category: catI.value,
          quantity: qtyI.value.trim() || null,
          expiryDate: expI.value || null,
          leftover: leftI.checked,
        }),
        (item) => {
          model.pantryItems = [item].concat(model.pantryItems || []);
        }
      );
    };

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
          const dataUrl = await readImageDataUrl(file);
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
        }
      },
    });

    return h(
      'section',
      { class: 'gb-family-planner' },
      h(
        'div',
        { class: 'gb-section-head' },
        h('h2', null, 'Pantry'),
        Icon('sprout', { size: 18, color: 'var(--leaf-600)' })
      ),
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
          nameI,
          catI,
          qtyI,
          field('Expiry (optional)', expI),
          h('label', { class: 'gb-family-check' }, leftI, h('span', null, 'This is a leftover')),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--sm',
              disabled: model.busy,
              onclick: add,
            },
            Icon('plus', { size: 16 }),
            'Add item'
          )
        )
      ),
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
      badge = h('span', { class: 'gb-pill gb-pill--muted' }, 'Exp ' + it.expiryDate);
    const meta = [it.category, it.quantity].filter(Boolean).join(' · ');
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
        meta ? h('div', { class: 'gb-family-card-meta' }, meta) : null
      ),
      badge,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn gb-iconbtn--danger',
          'aria-label': 'Remove',
          disabled: model.busy,
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
      'aria-label': 'Item name',
      placeholder: 'Add to list (e.g. Onions)',
    });
    const qtyI = h('input', {
      type: 'text',
      class: 'gb-input',
      'aria-label': 'Quantity',
      placeholder: 'Qty',
    });
    const add = () => {
      const name = nameI.value.trim();
      if (!name) return;
      run(api.addShopping({ name, quantity: qtyI.value.trim() || null }), (res) => {
        model.shoppingList = res;
      });
    };
    return h(
      'section',
      { class: 'gb-family-planner' },
      h(
        'div',
        { class: 'gb-section-head' },
        h('h2', null, 'Shopping list'),
        Icon('list-checks', { size: 18, color: 'var(--iris-500)' })
      ),
      h(
        'div',
        { class: 'gb-card gb-family-grocery' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft',
            disabled: model.busy,
            onclick: () =>
              run(api.generateShopping({}), (res) => {
                model.shoppingList = res;
              }),
          },
          Icon('sparkles', { size: 16 }),
          'Build from latest plan'
        ),
        h(
          'div',
          { class: 'gb-family-manual-add' },
          nameI,
          qtyI,
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--sm',
              'aria-label': 'Add to list',
              disabled: model.busy,
              onclick: add,
            },
            Icon('plus', { size: 16 })
          )
        )
      ),
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

  function shopRow(it) {
    return h(
      'div',
      { class: 'gb-card gb-family-shop-item' + (it.checked ? ' is-checked' : '') },
      h('input', {
        type: 'checkbox',
        checked: it.checked,
        disabled: model.busy,
        onchange: () =>
          run(api.toggleShopping(it.id), (res) => {
            model.shoppingList = res;
          }),
      }),
      h(
        'div',
        { class: 'gb-family-shop-id' },
        h('div', { class: 'gb-family-card-name' }, it.name),
        it.quantity ? h('div', { class: 'gb-family-card-meta' }, it.quantity) : null
      ),
      it.estimatedCost != null
        ? h('span', { class: 'gb-family-shop-cost' }, '₹' + it.estimatedCost)
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn gb-iconbtn--danger',
          'aria-label': 'Remove',
          disabled: model.busy,
          onclick: () =>
            run(api.deleteShopping(it.id), (res) => {
              model.shoppingList = res;
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
      h(
        'div',
        { class: 'gb-section-head' },
        h('h2', null, 'Saved menus'),
        Icon('heart', { size: 18, color: 'var(--coral-500)' })
      ),
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
            'Saved ' + (f.createdAt ? String(f.createdAt).slice(0, 10) : '')
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
            class: 'gb-iconbtn gb-iconbtn--danger',
            'aria-label': 'Delete menu',
            disabled: model.busy,
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

  function paint() {
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
      if (p.type === 'addChoose') panelEl = addChooserPanel();
      else if (p.type === 'add') panelEl = addPanel();
      else if (p.type === 'edit') panelEl = editPanel(p.member);
      else if (p.type === 'profile') panelEl = profilePanel(p.member);
      else if (p.type === 'link') panelEl = linkPanel(p.member);
      root.replaceChildren(panelEl);
      return;
    }

    const hasFamily = model.family && model.family.familyId;
    if (!hasFamily) {
      root.replaceChildren(...[invitesSection(), emptyState()].filter(Boolean));
      return;
    }
    const children = [invitesSection(), sectionNav(), activeSection()].filter(Boolean);
    root.replaceChildren(...children);
  }

  load();
  return root;
}

export { ScreenFamily };
