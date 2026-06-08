/* =====================================================================
   Growth Buddy — App shell: state, routing, render
   ===================================================================== */
(function () {
  'use strict';

  const {
    h, AppHeader, BottomNav, ScreenDashboard, ScreenCalendar,
    ScreenMentor, ScreenCircle, ScreenFood, ScreenGoals, TimerWidget,
    refreshIcons, Icon, IconChip, Check, DOMAIN,
  } = window.GB;
  let homeTimerWidget = null;

  const API_BASE = localStorage.getItem('gb.apiBase') || 'http://localhost:8080';
  const SESSION_KEY = 'gb.session';
  const TOKEN_KEY = 'gb.token';
  const WELLNESS_KEY_PREFIX = 'gb.wellness.';

  /* ---- Format today's date as "Wednesday, June 3" ---- */
  function todayLabel() {
    try {
      return new Date().toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric',
      });
    } catch (_) {
      return 'Today';
    }
  }

  /* ---- Build a 'YYYY-MM-DD' key from y / m(0-11) / d ---- */
  function dateKey(y, m, d) {
    const pad = n => (n < 10 ? '0' + n : String(n));
    return y + '-' + pad(m + 1) + '-' + pad(d);
  }

  /* ---- App state ---- */
  const THEME_KEY = 'gb.theme';
  function loadTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch (_) { return 'light'; }
  }
  const _now = new Date();
  const state = {
    theme: loadTheme(),
    screen: 'home',
    loading: false,
    error: '',
    user: loadSession(),
    tasks: [],
    habits: [],
    goals: [],
    gratitude: [],
    wellness: loadWellness(),
    water: null,
    food: null,
    quote: null,
    score: 0,
    // Auth flow: 'signin' | 'signup' | 'verify' | 'forgot' | 'reset'
    authMode: 'signin',
    authEmail: '',
    authNotice: '',
    // Calendar / reminders
    calYear: _now.getFullYear(),
    calMonth: _now.getMonth(),
    selectedDate: dateKey(_now.getFullYear(), _now.getMonth(), _now.getDate()),
    // Flat list so recurring reminders can surface on many days.
    // { id, date:'YYYY-MM-DD', time, text, tag, repeat }
    reminders: [],
    // Cached food summaries by day key ('YYYY-MM-DD').
    calendarFoodByDate: {},
    // Per-day fetch errors for food summary panel.
    calendarFoodErrorByDate: {},
    // Day key currently being loaded for calendar panel food details.
    calendarFoodLoadingFor: '',
    // Bell-notification feed.
    notifications: [],
    notifOpen: false,
    profileOpen: false,
    toasts: [],
  };
  let stomp = null;
  let toastSeq = 0;

  function dismissToast(id) {
    state.toasts = state.toasts.filter(t => t.id !== id);
    render();
  }

  function pushToast(message, kind, durationMs) {
    const text = message || 'Something went wrong.';
    const toast = {
      id: ++toastSeq,
      message: text,
      kind: kind || 'error',
    };
    state.toasts = [...state.toasts.filter(t => t.message !== text), toast].slice(-4);
    render();
    const duration = typeof durationMs === 'number' ? durationMs : 2800;
    setTimeout(() => dismissToast(toast.id), duration);
  }

  function toastError(err, fallback) {
    pushToast((err && err.message) || fallback || 'Something went wrong.', 'error');
  }

  function toastSuccess(message) {
    pushToast(message, 'success', 1800);
  }

  window.GB.toastSuccess = toastSuccess;
  window.GB.toastError = toastError;

  function getHomeTimerWidget() {
    if (!TimerWidget) {
      return null;
    }
    if (!homeTimerWidget) {
      homeTimerWidget = TimerWidget();
    }
    return homeTimerWidget;
  }

  function score() {
    if (state.score > 0) {
      return state.score;
    }
    let sum = 0, parts = 0;
    if (state.tasks.length) {
      sum += state.tasks.filter(t => t.done).length / state.tasks.length;
      parts++;
    }
    if (state.habits.length) {
      sum += state.habits.filter(h => h.doneToday).length / state.habits.length;
      parts++;
    }
    return parts === 0 ? 0 : Math.round((sum / parts) * 100);
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function loadToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; }
  }

  function saveSession(user, token) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }

  function emptyWellness() {
    return { sleepByDate: {}, moodByDate: {}, photoHistory: [] };
  }

  function wellnessStorageKey(user) {
    const u = user || loadSession() || {};
    const id = u.id || u.email || u.displayName || 'guest';
    return WELLNESS_KEY_PREFIX + String(id);
  }

  function loadWellness() {
    try {
      const raw = localStorage.getItem(wellnessStorageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return Object.assign(emptyWellness(), parsed || {});
    } catch (_) {
      return emptyWellness();
    }
  }

  function persistWellness() {
    try {
      localStorage.setItem(wellnessStorageKey(state.user), JSON.stringify(state.wellness || emptyWellness()));
    } catch (_) { /* silent */ }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }

  function syncUserSession(userPatch) {
    const token = loadToken();
    state.user = Object.assign({}, state.user || {}, userPatch || {});
    if (token) {
      state.user.token = token;
    }
    saveSession(state.user, token);
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    const token = loadToken();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    if (opts.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      // Token went stale (revoked, expired, server restarted with empty DB,
      // etc.) — wipe local state and bounce to the sign-in screen.
      handleAuthExpired();
      throw new Error('Your session expired. Please sign in again.');
    }
    if (!res.ok) {
      let msg = 'Request failed (' + res.status + ')';
      try {
        const err = await res.json();
        msg = err.message || msg;
      } catch (_) {
        // ignored
      }
      throw new Error(msg);
    }
    if (res.status === 204) {
      return null;
    }
    return res.json();
  }

  function handleAuthExpired() {
    disconnectWebSocket();
    clearSession();
    state.user = null;
    state.tasks = []; state.habits = []; state.goals = []; state.gratitude = []; state.reminders = [];
    state.goals = [];
    state.wellness = emptyWellness();
    state.water = null;
    state.food = null;
    state.calendarFoodByDate = {};
    state.calendarFoodErrorByDate = {};
    state.calendarFoodLoadingFor = '';
    state.notifications = []; state.quote = null; state.score = 0;
    state.authMode = 'signin';
    state.authNotice = 'Your session ended. Sign in again.';
    state.profileOpen = false; state.notifOpen = false;
    state.toasts = [];
    state.screen = 'home';
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    render();
  }

  function formatTaskTime(task) {
    const isOverdue = !task.done && task.dueAt && (new Date(task.dueAt).getTime() < Date.now());
    const suffix = task.completionCount > 0
      ? (' - done ' + task.completionCount + 'x')
      : '';
    if (task.dueAt) {
      try {
        const dt = new Date(task.dueAt);
        const base = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          + ' · '
          + dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return (isOverdue ? 'Overdue - ' : '') + base + suffix;
      } catch (_) {
        return (isOverdue ? 'Overdue' : 'Scheduled') + suffix;
      }
    }
    return (task.done ? 'Completed' : 'No due time') + suffix;
  }

  function mapTask(task) {
    return {
      id: task.id,
      title: task.title,
      time: formatTaskTime(task),
      priority: (!task.done && task.dueAt && (new Date(task.dueAt).getTime() < Date.now()))
        ? 'High'
        : (task.priority || 'Medium'),
      done: !!task.done,
      dueAt: task.dueAt || null,
      doneAt: task.doneAt || null,
      completionCount: task.completionCount || 0,
    };
  }

  function cacheFoodSummary(summary) {
    if (!summary || !summary.date) {
      return;
    }
    state.calendarFoodByDate[summary.date] = summary;
    delete state.calendarFoodErrorByDate[summary.date];
  }

  async function loadCalendarFoodForDate(dayKey, options) {
    const opts = options || {};
    if (!state.user || !dayKey || (state.calendarFoodByDate[dayKey] && !opts.force)) {
      return;
    }
    delete state.calendarFoodErrorByDate[dayKey];
    state.calendarFoodLoadingFor = dayKey;
    rerenderCalendarSideIfActive();
    rerenderHomeMiniCalendarIfActive();
    try {
      const summary = await api('/api/food?date=' + encodeURIComponent(dayKey));
      cacheFoodSummary(summary);
    } catch (err) {
      state.calendarFoodErrorByDate[dayKey] = err && err.message
        ? err.message
        : 'Could not load food entries for this day.';
    } finally {
      if (state.calendarFoodLoadingFor === dayKey) {
        state.calendarFoodLoadingFor = '';
      }
      rerenderCalendarSideIfActive();
      rerenderHomeMiniCalendarIfActive();
    }
  }

  /**
   * Replace only the right-hand calendar side panel in place. The form
   * DOM is module-cached inside calendar.js, so the user's in-progress
   * reminder text / tag / repeat survives. Falls back to a full render
   * if we can't find the panel in the DOM (different screen, first paint).
   */
  function rerenderCalendarSideIfActive() {
    if (state.screen !== 'calendar') return;
    const oldSide = document.querySelector('.gb-cal-side');
    if (!oldSide || !window.GB.RenderCalendarSide) {
      render();
      return;
    }
    const newSide = window.GB.RenderCalendarSide({
      selectedDate: state.selectedDate,
      reminders: state.reminders,
      tasks: state.tasks,
      goals: state.goals,
      gratitude: state.gratitude,
      wellness: state.wellness,
      foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
      dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
      dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
      onRetryFood: retryCalendarFoodDate,
      onAddReminder: addReminder,
      onDeleteReminder: deleteReminder,
    });
    oldSide.replaceWith(newSide);
    refreshIcons();
  }

  function rerenderHomeMiniCalendarIfActive() {
    if (state.screen !== 'home') return false;
    const oldCard = document.querySelector('.gb-mini-cal-card');
    if (!oldCard || !window.GB.RenderMiniCalendarCard) {
      return false;
    }
    const fresh = window.GB.RenderMiniCalendarCard({
      tasks: state.tasks,
      reminders: state.reminders,
      foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
      dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
      dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
      calYear: state.calYear,
      calMonth: state.calMonth,
      selectedDate: state.selectedDate,
      onSelectDate: selectDate,
      onPrevMonth: calPrevMonth,
      onNextMonth: calNextMonth,
      onRetryFood: retryCalendarFoodDate,
    });
    oldCard.replaceWith(fresh);
    refreshIcons();
    return true;
  }

  /**
   * Update the `is-selected` / aria-pressed state on the month grid in
   * place — no DOM rebuild, no flicker.
   */
  function updateCalendarDaySelection(newKey) {
    const cells = document.querySelectorAll('.gb-cal-day[data-day-key]');
    cells.forEach(el => {
      const k = el.getAttribute('data-day-key');
      const on = k === newKey;
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', String(on));
    });
  }

  async function resetStaleCompletedTasks(tasks) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const stale = tasks.filter(t => t.done && t.doneAt && (new Date(t.doneAt) < start));
    if (!stale.length) {
      return tasks;
    }

    const updatedPairs = await Promise.all(stale.map(async (t) => {
      try {
        const updated = await api('/api/tasks/' + encodeURIComponent(t.id), {
          method: 'PUT',
          body: JSON.stringify({ done: false }),
        });
        return [t.id, updated];
      } catch (_) {
        return [t.id, t];
      }
    }));

    const byId = Object.fromEntries(updatedPairs);
    return tasks.map(t => byId[t.id] || t);
  }

  async function loadData() {
    if (!state.user) {
      return;
    }
    state.loading = true;
    state.error = '';
    render();
    try {
      const [tasksRaw, habits, goals, gratitude, reminders, quote, todayScore, notifications, water, food] = await Promise.all([
        api('/api/tasks'),
        api('/api/habits'),
        api('/api/goals'),
        api('/api/gratitude'),
        api('/api/reminders'),
        api('/api/quotes/today'),
        api('/api/score/today'),
        api('/api/notifications'),
        api('/api/water'),
        api('/api/food'),
      ]);

      const tasks = await resetStaleCompletedTasks(tasksRaw);

      state.tasks = tasks.map(mapTask);
      state.habits = habits;
      state.goals = goals || [];
      state.gratitude = gratitude || [];
      state.reminders = reminders;
      state.quote = quote;
      state.water = water;
      state.food = food;
      cacheFoodSummary(food);
      loadCalendarFoodForDate(state.selectedDate);
      state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : 0;
      state.notifications = notifications || [];
      connectWebSocket();
    } catch (err) {
      state.error = err.message || 'Failed to load data from backend.';
    } finally {
      state.loading = false;
      render();
    }
  }

  /* ---- WebSocket: realtime notification push ---- */
  function connectWebSocket() {
    if (!state.user || stomp || !window.StompJs || !window.SockJS) return;
    const token = loadToken();
    if (!token) return;
    try {
      stomp = new window.StompJs.Client({
        webSocketFactory: () => new window.SockJS(API_BASE + '/ws'),
        connectHeaders: { Authorization: 'Bearer ' + token },
        reconnectDelay: 5000,
        onConnect: () => {
          stomp.subscribe('/user/queue/notifications', frame => {
            try {
              const n = JSON.parse(frame.body);
              state.notifications = [n, ...state.notifications.filter(x => x.id !== n.id)];
              render();
            } catch (e) { console.warn('Bad notification frame', e); }
          });
        },
        onStompError: f => console.warn('STOMP error', f.headers, f.body),
      });
      stomp.activate();
    } catch (err) {
      console.warn('WebSocket setup failed', err);
    }
  }

  function disconnectWebSocket() {
    if (stomp) { try { stomp.deactivate(); } catch (_) {} stomp = null; }
  }

  async function toggleTask(id) {
    try {
      const updated = await api('/api/tasks/' + encodeURIComponent(id) + '/toggle', { method: 'PATCH' });
      state.tasks = state.tasks.map(t => (t.id === updated.id ? mapTask(updated) : t));
      const todayScore = await api('/api/score/today');
      state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : score();
      await refreshCurrentUser();
      render();
    } catch (err) {
      toastError(err, 'Could not toggle task.');
    }
  }

  async function toggleHabit(id) {
    try {
      const updated = await api('/api/habits/' + encodeURIComponent(id) + '/toggle', { method: 'PATCH' });
      state.habits = state.habits.map(h => (h.id === updated.id ? updated : h));
      const todayScore = await api('/api/score/today');
      state.score = todayScore && typeof todayScore.score === 'number' ? todayScore.score : score();
      await refreshCurrentUser();
      render();
    } catch (err) {
      toastError(err, 'Could not toggle habit.');
    }
  }

  async function refreshScore() {
    try {
      const s = await api('/api/score/today');
      if (s && typeof s.score === 'number') state.score = s.score;
    } catch (_) { /* silent */ }
  }

  async function refreshCurrentUser() {
    try {
      const me = await api('/api/auth/me');
      syncUserSession(me || {});
    } catch (_) { /* silent */ }
  }

  async function createTask(body) {
    const created = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    state.tasks = [mapTask(created), ...state.tasks];
    await refreshScore();
  }

  async function createHabit(body) {
    const created = await api('/api/habits', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    state.habits = [created, ...state.habits];
    await refreshScore();
  }

  async function loadGoals() {
    try {
      state.goals = await api('/api/goals');
      render();
    } catch (err) {
      toastError(err, 'Could not load goals.');
    }
  }

  async function createGoal(body) {
    const created = await api('/api/goals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await loadGoals();
    toastSuccess('Goal added.');
    return created;
  }

  async function toggleGoal(id) {
    await api('/api/goals/' + encodeURIComponent(id) + '/toggle', { method: 'PATCH' });
    await loadGoals();
  }

  async function deleteGoal(id) {
    await api('/api/goals/' + encodeURIComponent(id), { method: 'DELETE' });
    await loadGoals();
  }

  async function addGoalAction(id, body) {
    await api('/api/goals/' + encodeURIComponent(id) + '/actions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await loadGoals();
    toastSuccess('Action logged.');
  }

  async function updateGoalAction(goalId, actionId, body) {
    await api('/api/goals/' + encodeURIComponent(goalId) + '/actions/' + encodeURIComponent(actionId), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    await loadGoals();
    toastSuccess('Action updated.');
  }

  async function deleteGoalAction(goalId, actionId) {
    await api('/api/goals/' + encodeURIComponent(goalId) + '/actions/' + encodeURIComponent(actionId), { method: 'DELETE' });
    await loadGoals();
    toastSuccess('Action removed.');
  }

  async function loadGratitude() {
    try {
      state.gratitude = await api('/api/gratitude');
      render();
    } catch (err) {
      toastError(err, 'Could not load gratitude notes.');
    }
  }

  async function createGratitude(body) {
    await api('/api/gratitude', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await loadGratitude();
    toastSuccess('Gratitude saved.');
  }

  function openAddGratitude() {
    const today = dateKey(_now.getFullYear(), _now.getMonth(), _now.getDate());
    const noteInput = h('textarea', {
      class: 'gb-input gb-input--about',
      maxlength: '1000',
      placeholder: 'What are you grateful for today?',
    });
    const dateInput = h('input', { type: 'date', class: 'gb-input', value: state.selectedDate || today });
    const body = h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Gratitude note'),
      noteInput,
      h('div', { class: 'gb-field-label' }, 'Date'),
      dateInput
    );
    openModal({
      title: 'Add gratitude',
      sub: 'A small note for something that helped today.',
      body,
      primary: 'Save note',
      onPrimary: async () => {
        const note = noteInput.value.trim();
        if (!note) { noteInput.focus(); throw new Error('Gratitude note is required'); }
        await createGratitude({ note, entryDate: dateInput.value || null });
      },
    });
    setTimeout(() => noteInput.focus(), 60);
  }

  async function updateGratitude(id, body) {
    await api('/api/gratitude/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    await loadGratitude();
    toastSuccess('Gratitude updated.');
  }

  async function deleteGratitude(id) {
    await api('/api/gratitude/' + encodeURIComponent(id), { method: 'DELETE' });
    await loadGratitude();
    toastSuccess('Gratitude removed.');
  }

  async function deleteHabit(id) {
    await api('/api/habits/' + encodeURIComponent(id), { method: 'DELETE' });
    state.habits = state.habits.filter(h => h.id !== id);
    await refreshScore();
  }

  async function deleteTask(id) {
    await api('/api/tasks/' + encodeURIComponent(id), { method: 'DELETE' });
    state.tasks = state.tasks.filter(t => t.id !== id);
    await refreshScore();
  }

  async function quickAddWater(amountMl) {
    try {
      const updated = await api('/api/water/entries', {
        method: 'POST',
        body: JSON.stringify({ amountMl: amountMl }),
      });
      state.water = updated;
      render();
    } catch (err) {
      toastError(err, 'Could not log water right now.');
    }
  }

  async function updateWaterGoal(goalMl) {
    try {
      const updated = await api('/api/water/goal', {
        method: 'PUT',
        body: JSON.stringify({ goalMl: goalMl }),
      });
      state.water = updated;
      render();
    } catch (err) {
      toastError(err, 'Could not update water goal right now.');
    }
  }

  async function logFoodEntry(payload) {
    try {
      const updated = await api('/api/food/entries', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      state.food = updated;
      cacheFoodSummary(updated);
      render();
      toastSuccess('Food logged.');
    } catch (err) {
      toastError(err, 'Could not log food right now.');
    }
  }

  function todayKeyNow() {
    const t = new Date();
    return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function saveSleepEntry(payload) {
    const key = payload.date || todayKeyNow();
    state.wellness = Object.assign(emptyWellness(), state.wellness || {});
    state.wellness.sleepByDate = Object.assign({}, state.wellness.sleepByDate || {}, {
      [key]: {
        date: key,
        bedtime: payload.bedtime || '',
        wakeTime: payload.wakeTime || '',
        quality: payload.quality || 'okay',
        note: payload.note || '',
        updatedAt: new Date().toISOString(),
      },
    });
    persistWellness();
    render();
    toastSuccess('Sleep saved.');
  }

  function saveMoodEntry(payload) {
    const key = payload.date || todayKeyNow();
    state.wellness = Object.assign(emptyWellness(), state.wellness || {});
    state.wellness.moodByDate = Object.assign({}, state.wellness.moodByDate || {}, {
      [key]: {
        date: key,
        mood: payload.mood || 'okay',
        energy: payload.energy || 'medium',
        stress: payload.stress || 'normal',
        note: payload.note || '',
        updatedAt: new Date().toISOString(),
      },
    });
    persistWellness();
    render();
    toastSuccess('Check-in saved.');
  }

  function rememberPhotoFood(foodName, estimate, usedPhoto) {
    if (!usedPhoto) return;
    const history = Array.isArray(state.wellness && state.wellness.photoHistory)
      ? state.wellness.photoHistory
      : [];
    const confidence = estimate && Number.isFinite(Number(estimate.confidence))
      ? Math.round(Number(estimate.confidence) * 100)
      : null;
    state.wellness = Object.assign(emptyWellness(), state.wellness || {}, {
      photoHistory: [{
        id: String(Date.now()),
        date: todayKeyNow(),
        foodName,
        mealType: (estimate && (estimate.mealType || estimate.suggestedMealType)) || 'meal',
        confidence,
        fallbackNeeded: !!(estimate && estimate.fallbackNeeded),
        createdAt: new Date().toISOString(),
      }, ...history].slice(0, 12),
    });
    persistWellness();
  }

  function openSleepSchedule() {
    const today = todayKeyNow();
    const existing = (state.wellness.sleepByDate || {})[today] || {};
    const dateInput = h('input', { type: 'date', class: 'gb-input', value: existing.date || today });
    const bedInput = h('input', { type: 'time', class: 'gb-input', value: existing.bedtime || '23:00' });
    const wakeInput = h('input', { type: 'time', class: 'gb-input', value: existing.wakeTime || '07:00' });
    const quality = segmented([
      { value: 'low', label: 'Low' },
      { value: 'okay', label: 'Okay' },
      { value: 'good', label: 'Good' },
      { value: 'great', label: 'Great' },
    ], existing.quality || 'okay');
    const noteInput = h('textarea', { class: 'gb-input gb-input--about', maxlength: '280', placeholder: 'Optional note' }, existing.note || '');
    openModal({
      title: 'Sleep schedule',
      sub: 'Save bedtime, wake time, and quality for today.',
      body: h('div', { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Date'), dateInput,
        h('div', { class: 'gb-field-label' }, 'Bedtime'), bedInput,
        h('div', { class: 'gb-field-label' }, 'Wake time'), wakeInput,
        h('div', { class: 'gb-field-label' }, 'Quality'), quality.node,
        h('div', { class: 'gb-field-label' }, 'Note'), noteInput
      ),
      primary: 'Save sleep',
      onPrimary: async () => saveSleepEntry({
        date: dateInput.value || today,
        bedtime: bedInput.value,
        wakeTime: wakeInput.value,
        quality: quality.get(),
        note: noteInput.value.trim(),
      }),
    });
  }

  function openMoodCheckin() {
    const today = todayKeyNow();
    const existing = (state.wellness.moodByDate || {})[today] || {};
    const mood = segmented([
      { value: 'low', label: 'Low' },
      { value: 'okay', label: 'Okay' },
      { value: 'good', label: 'Good' },
      { value: 'great', label: 'Great' },
    ], existing.mood || 'okay');
    const energy = segmented([
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ], existing.energy || 'medium');
    const stress = segmented([
      { value: 'calm', label: 'Calm' },
      { value: 'normal', label: 'Normal' },
      { value: 'high', label: 'High' },
    ], existing.stress || 'normal');
    const noteInput = h('textarea', { class: 'gb-input gb-input--about', maxlength: '280', placeholder: 'Optional note' }, existing.note || '');
    openModal({
      title: 'Mood check-in',
      sub: 'A quick signal for your weekly patterns.',
      body: h('div', { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Mood'), mood.node,
        h('div', { class: 'gb-field-label' }, 'Energy'), energy.node,
        h('div', { class: 'gb-field-label' }, 'Stress'), stress.node,
        h('div', { class: 'gb-field-label' }, 'Note'), noteInput
      ),
      primary: 'Save check-in',
      onPrimary: async () => saveMoodEntry({
        date: today,
        mood: mood.get(),
        energy: energy.get(),
        stress: stress.get(),
        note: noteInput.value.trim(),
      }),
    });
  }

  function openDailyPlan() {
    const today = todayKeyNow();
    const pendingTasks = state.tasks.filter(t => !t.done).slice(0, 4);
    const pendingHabits = state.habits.filter(habit => !habit.doneToday).slice(0, 4);
    const waterGoal = state.water && state.water.goalMl ? state.water.goalMl : 2000;
    const waterDone = state.water && state.water.consumedMl ? state.water.consumedMl : 0;
    const sleep = (state.wellness.sleepByDate || {})[today];
    const mood = (state.wellness.moodByDate || {})[today];
    const rows = [
      { icon: 'sunrise', title: 'Start steady', text: pendingHabits.length ? ('Do ' + pendingHabits[0].name + ' first.') : 'Pick one small habit and finish it early.' },
      { icon: 'list-checks', title: 'Focus block', text: pendingTasks.length ? ('Work on ' + pendingTasks[0].title + '.') : 'Add one meaningful task for today.' },
      { icon: 'droplets', title: 'Hydration', text: waterDone >= waterGoal ? 'Water goal is already covered.' : ('Drink ' + Math.max(250, waterGoal - waterDone) + ' ml through the day.') },
      { icon: 'moon', title: 'Evening close', text: sleep ? 'Protect your saved sleep routine.' : 'Add sleep schedule before the day ends.' },
      { icon: 'heart', title: 'Reflection', text: mood ? 'Use your mood note to plan gently.' : 'Do a 20-second mood check-in.' },
    ];
    openModal({
      title: 'Today plan',
      sub: 'A simple plan from your current tasks, habits, water, sleep, and mood.',
      body: h('div', { class: 'gb-plan-list' }, rows.map(row => h('div', { class: 'gb-plan-row' },
        h('span', { class: 'gb-plan-icon' }, Icon(row.icon, { size: 17, sw: 2.4 })),
        h('span', { class: 'gb-plan-copy' }, h('strong', null, row.title), h('span', null, row.text))
      ))),
      primary: 'Looks good',
      onPrimary: async () => {},
    });
  }

  async function addSuggestedReminder(text, time, tag) {
    await addReminder(todayKeyNow(), text, time || '19:00', tag || 'personal', 'none', null);
  }

  function openAddFood() {
    let photoDataUrl = '';
    let photoEstimate = null;
    const foodNameInput = h('input', {
      type: 'text', class: 'gb-input',
      placeholder: 'e.g. Paneer butter masala',
      maxlength: 255,
    });
    const platePhotoInput = h('input', {
      type: 'file', class: 'gb-input',
      accept: 'image/*',
      capture: 'environment',
    });
    const photoHint = h(
      'div',
      { style: { fontSize: '12px', color: 'var(--fg3)' } },
      'Optional: upload a plate photo for better estimate.'
    );

    async function readImageDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read image file.'));
        reader.readAsDataURL(file);
      });
    }

    async function estimateFromPhoto() {
      const file = platePhotoInput.files && platePhotoInput.files[0];
      if (!file) {
        throw new Error('Please choose a photo first.');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Photo is too large. Use an image under 5 MB.');
      }
      const dataUrl = await readImageDataUrl(file);
      if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
        throw new Error('Invalid image file.');
      }
      photoDataUrl = dataUrl;
      const result = await api('/api/food/photo-estimate', {
        method: 'POST',
        body: JSON.stringify({
          imageDataUrl: photoDataUrl,
        }),
      });
      photoEstimate = result || null;
      if (photoEstimate && photoEstimate.suggestedFoodName && !foodNameInput.value.trim()) {
        foodNameInput.value = photoEstimate.suggestedFoodName;
      }
      if (photoEstimate && photoEstimate.message) {
        toastSuccess(photoEstimate.message);
      } else {
        toastSuccess('Photo analyzed.');
      }
      return photoEstimate;
    }

    const body = h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Food name'),
      foodNameInput,
      h('div', { class: 'gb-field-label' }, 'Plate photo (optional)'),
      platePhotoInput,
      h('button', {
        type: 'button', class: 'gb-btn gb-btn--secondary gb-btn--compact',
        onclick: async () => {
          try {
            await estimateFromPhoto();
          } catch (err) {
            toastError(err, 'Could not analyze photo.');
          }
        },
      }, 'Analyze photo'),
      photoHint,
      h('div', { style: { fontSize: '12px', color: 'var(--fg3)' } },
        'No grams needed. We estimate from food name and optional plate photo.'
      )
    );

    openModal({
      title: 'Log food',
      body,
      primary: 'Add food',
      onPrimary: async () => {
        const foodName = foodNameInput.value.trim();
        if (!foodName) {
          foodNameInput.focus();
          throw new Error('Food name is required');
        }
        const highConfidencePhoto = photoEstimate
          && Number(photoEstimate.confidence || 0) >= 0.70
          && !photoEstimate.fallbackNeeded
          && Number.isFinite(Number(photoEstimate.quantityGrams));
        const grams = highConfidencePhoto ? Number(photoEstimate.quantityGrams) : null;
        await logFoodEntry({
          foodName: foodName,
          quantityGrams: Number.isFinite(Number(grams)) ? Math.round(grams) : null,
          note: photoDataUrl ? 'photo:' + (highConfidencePhoto ? 'used' : 'fallback') : null,
        });
        rememberPhotoFood(foodName, photoEstimate, !!photoDataUrl);
      },
    });

    setTimeout(() => foodNameInput.focus(), 60);
  }

  async function deleteWaterEntry(entryId) {
    try {
      const updated = await api('/api/water/entries/' + entryId, {
        method: 'DELETE',
      });
      state.water = updated;
      render();
    } catch (err) {
      toastError(err, 'Could not delete water entry.');
    }
  }

  async function deleteFoodEntry(entryId) {
    try {
      const updated = await api('/api/food/entries/' + entryId, {
        method: 'DELETE',
      });
      state.food = updated;
      cacheFoodSummary(updated);
      render();
      toastSuccess('Food entry deleted.');
    } catch (err) {
      toastError(err, 'Could not delete food entry.');
    }
  }

  /* ---- Notification handlers ---- */
  function unreadNotifs() {
    return state.notifications.filter(n => !n.readAt).length;
  }

  async function refreshNotifications() {
    try { state.notifications = await api('/api/notifications'); render(); }
    catch (_) { /* silent */ }
  }

  async function markNotificationRead(id) {
    try {
      await api('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH' });
      state.notifications = state.notifications.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n);
      render();
    } catch (err) { console.warn(err); }
  }

  async function respondMentorshipRequest(requestId, notifId, accept) {
    try {
      await api('/api/mentorship/requests/' + encodeURIComponent(requestId) + (accept ? '/accept' : '/reject'),
        { method: 'POST' });
      // Backend deletes the request-bell entry on accept/reject. Drop it
      // optimistically here so the UI doesn't flash a stale row.
      state.notifications = state.notifications.filter(n => n.id !== notifId);
      render();
      // Re-fetch in case the server-side delete also created new rows.
      await refreshNotifications();
    } catch (err) {
      toastError(err, 'Could not respond to invite.');
    }
  }

  function toggleNotifOpen() {
    state.notifOpen = !state.notifOpen;
    state.profileOpen = false;
    render();
  }

  function toggleProfileOpen() {
    state.profileOpen = !state.profileOpen;
    state.notifOpen = false;
    render();
  }

  function profileDropdown() {
    if (!state.profileOpen) return null;
    const u = state.user || {};
    return h(
      'div',
      { class: 'gb-profile-pop' },
      h('div', { class: 'gb-profile-pop-head' },
        h('div', { class: 'gb-profile-pop-name' }, u.displayName || 'Buddy'),
        h('div', { class: 'gb-profile-pop-email' }, u.email || ''),
        h('div', { class: 'gb-profile-pop-meta' }, 'Level ' + (u.level || 1) + ' · ' + (u.xpTotal || 0) + ' XP')
      ),
      h('button', {
        type: 'button', class: 'gb-profile-pop-item',
        onclick: () => { toggleTheme(); state.profileOpen = false; render(); },
      }, Icon(state.theme === 'dark' ? 'sun' : 'moon', { size: 16 }),
         state.theme === 'dark' ? 'Light mode' : 'Dark mode'),
      h('button', {
        type: 'button', class: 'gb-profile-pop-item',
        onclick: () => { state.profileOpen = false; render(); openAboutDiet(); },
      }, Icon('user-round', { size: 16 }), 'About & diet'),
      h('button', {
        type: 'button', class: 'gb-profile-pop-item is-danger',
        onclick: () => { state.profileOpen = false; logout(); },
      }, Icon('log-out', { size: 16 }), 'Log out')
    );
  }

  const SCREEN_IDS = ['home', 'habits', 'food', 'goals', 'calendar', 'mentor', 'circle'];

  /** Parse the current location hash → screen id. Defaults to home. */
  function screenFromHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
    return SCREEN_IDS.includes(raw) ? raw : 'home';
  }

  function setScreen(id, opts) {
    opts = opts || {};
    if (state.screen === id && !opts.force) return;
    state.screen = id;
    state.notifOpen = false;
    state.profileOpen = false;
    if (!opts.fromHash) {
      const target = '#/' + id;
      if (window.location.hash !== target) {
        // pushState avoids piling history entries when the user double-taps.
        history.pushState(null, '', target);
      }
    }
    render();
  }

  /** Sync screen with the URL on back/forward navigation. */
  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    setScreen(screenFromHash(), { fromHash: true });
  });

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    try { localStorage.setItem(THEME_KEY, state.theme); } catch (_) {}
    render();
  }

  async function saveProfileDetails(payload) {
    const updated = await api('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    syncUserSession(updated);
    toastSuccess('Profile updated.');
    render();
    return updated;
  }

  async function getNutritionSuggestion() {
    return api('/api/auth/nutrition-suggestion');
  }

  function openAboutDiet() {
    const u = state.user || {};
    const now = new Date();
    const thisYear = now.getFullYear();
    const fallbackDob = u.dob
      ? String(u.dob)
      : (u.ageYears ? (thisYear - Number(u.ageYears)) + '-01-01' : '');
    const dobInput = h('input', {
      type: 'date',
      class: 'gb-input',
      value: fallbackDob,
    });
    const heightInput = h('input', { type: 'number', class: 'gb-input', min: '100', max: '250', value: u.heightCm || '' });
    const weightInput = h('input', { type: 'number', class: 'gb-input', min: '25', max: '300', value: u.weightKg || '' });
    const dietInput = h('input', {
      type: 'text', class: 'gb-input', maxlength: '64',
      placeholder: 'e.g. vegetarian, eggetarian, high-protein', value: u.dietPreference || '',
    });
    const foodGoalInput = h('input', { type: 'number', class: 'gb-input', min: '800', max: '6000', value: u.dailyFoodGoalKcal || '' });
    const waterGoalInput = h('input', { type: 'number', class: 'gb-input', min: '1000', max: '7000', value: u.dailyWaterGoalMl || '' });
    const aboutInput = h('textarea', {
      class: 'gb-input gb-input--about', maxlength: '500',
      placeholder: 'Tell us about your routine, health priorities, and dietary preferences.',
    }, u.aboutMe || '');

    const suggestionBox = h('div', { class: 'gb-profile-suggest', style: { display: 'none' } });
    const suggestBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--secondary gb-profile-suggest-btn',
        onclick: async () => {
          suggestBtn.disabled = true;
          suggestBtn.textContent = 'Generating...';
          try {
            const s = await getNutritionSuggestion();
            suggestionBox.style.display = '';
            suggestionBox.replaceChildren(
              h('div', { class: 'gb-profile-suggest-title' }, 'AI Nutrition Suggestion'),
              h('div', { class: 'gb-profile-suggest-line' }, 'Water goal: ' + s.recommendedWaterMl + ' ml/day'),
              h('div', { class: 'gb-profile-suggest-line' }, 'Food goal: ' + s.recommendedFoodGoalKcal + ' kcal/day'),
              h('div', { class: 'gb-profile-suggest-line' }, s.guidance || ''),
              h('ul', { class: 'gb-profile-suggest-list' },
                (s.indianFoodSuggestions || []).map(item => h('li', null, item))
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--soft gb-profile-apply',
                  onclick: () => {
                    if (s.recommendedWaterMl) waterGoalInput.value = String(s.recommendedWaterMl);
                    if (s.recommendedFoodGoalKcal) foodGoalInput.value = String(s.recommendedFoodGoalKcal);
                    toastSuccess('Suggested goals applied to form. Save to keep them.');
                  },
                },
                'Use these goals'
              )
            );
          } catch (err) {
            const msg = err && err.message ? err.message : 'Could not generate nutrition suggestion. Please check your connection or try again later.';
            toastError(new Error(msg), 'Suggestion error');
          } finally {
            suggestBtn.disabled = false;
            suggestBtn.textContent = 'Get AI nutrition suggestion';
          }
        },
      },
      'Get AI nutrition suggestion'
    );

    const body = h(
      'div',
      { class: 'gb-form gb-form--about-diet' },
      h('div', { class: 'gb-field-label' }, 'Date of birth'),
      dobInput,
      h('div', { class: 'gb-field-label' }, 'Height (cm)'),
      heightInput,
      h('div', { class: 'gb-field-label' }, 'Weight (kg)'),
      weightInput,
      h('div', { class: 'gb-field-label' }, 'Diet preference'),
      dietInput,
      h('div', { class: 'gb-field-label' }, 'Daily food goal (kcal)'),
      foodGoalInput,
      h('div', { class: 'gb-field-label' }, 'Daily water goal (ml)'),
      waterGoalInput,
      h('div', { class: 'gb-field-label' }, 'About you'),
      aboutInput,
      suggestBtn,
      suggestionBox
    );

    openModal({
      title: 'About & Diet',
      sub: 'We use this to personalize Indian food and water suggestions.',
      body,
      primary: 'Save profile',
      onPrimary: async () => {
        const parseDobToAge = (raw, inputRef) => {
          if (!raw) return null;
          const dob = new Date(raw + 'T00:00:00');
          if (Number.isNaN(dob.getTime())) {
            if (inputRef && inputRef.focus) inputRef.focus();
            throw new Error('Date of birth is invalid.');
          }
          let age = now.getFullYear() - dob.getFullYear();
          const m = now.getMonth() - dob.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
            age -= 1;
          }
          if (age < 10 || age > 100) {
            if (inputRef && inputRef.focus) inputRef.focus();
            throw new Error('Age from date of birth must be between 10 and 100 years.');
          }
          return age;
        };

        const parseRanged = (label, raw, min, max, inputRef) => {
          if (!raw) return null;
          const n = Number(raw);
          if (!Number.isFinite(n) || n < min || n > max) {
            if (inputRef && inputRef.focus) inputRef.focus();
            throw new Error(label + ' must be between ' + min + ' and ' + max + '.');
          }
          return Math.round(n);
        };

        const payload = {
          dob: dobInput.value || null,
          ageYears: parseDobToAge(dobInput.value, dobInput),
          heightCm: parseRanged('Height', heightInput.value, 100, 250, heightInput),
          weightKg: parseRanged('Weight', weightInput.value, 25, 300, weightInput),
          dietPreference: (dietInput.value || '').trim() || null,
          aboutMe: (aboutInput.value || '').trim() || null,
          dailyFoodGoalKcal: parseRanged('Daily food goal', foodGoalInput.value, 800, 6000, foodGoalInput),
          dailyWaterGoalMl: parseRanged('Daily water goal', waterGoalInput.value, 1000, 7000, waterGoalInput),
        };
        await saveProfileDetails(payload);
      },
    });
  }

  /* ---- Calendar / reminder handlers ---- */
  function syncSelectedDateToVisibleMonth() {
    const parts = String(state.selectedDate || '').split('-').map(Number);
    const day = Number.isFinite(parts[2]) ? parts[2] : 1;
    const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    state.selectedDate = dateKey(state.calYear, state.calMonth, Math.min(day, daysInMonth));
  }

  function rerenderCalendarToolbarIfActive() {
    if (state.screen !== 'calendar') return false;
    const oldToolbar = document.querySelector('.gb-cal-toolbar');
    if (!oldToolbar || !window.GB.RenderCalendarToolbar) {
      return false;
    }
    const fresh = window.GB.RenderCalendarToolbar({
      year: state.calYear,
      month: state.calMonth,
      reminders: state.reminders,
      tasks: state.tasks,
      onPrevMonth: calPrevMonth,
      onNextMonth: calNextMonth,
      onToday: calToday,
    });
    oldToolbar.replaceWith(fresh);
    refreshIcons();
    return true;
  }

  function rerenderCalendarMonthInPlace() {
    syncSelectedDateToVisibleMonth();
    const updated = rerenderCalendarToolbarIfActive();
    repaintCalendarGrid();
    rerenderCalendarSideIfActive();
    loadCalendarFoodForDate(state.selectedDate);
    if (!updated) render();
  }

  function calPrevMonth() {
    if (state.calMonth === 0) { state.calMonth = 11; state.calYear -= 1; }
    else { state.calMonth -= 1; }
    if (state.screen === 'calendar') {
      rerenderCalendarMonthInPlace();
      return;
    }
    if (state.screen === 'home' && rerenderHomeMiniCalendarIfActive()) {
      return;
    }
    render();
  }

  function calNextMonth() {
    if (state.calMonth === 11) { state.calMonth = 0; state.calYear += 1; }
    else { state.calMonth += 1; }
    if (state.screen === 'calendar') {
      rerenderCalendarMonthInPlace();
      return;
    }
    if (state.screen === 'home' && rerenderHomeMiniCalendarIfActive()) {
      return;
    }
    render();
  }

  function calToday() {
    const t = new Date();
    state.calYear = t.getFullYear();
    state.calMonth = t.getMonth();
    state.selectedDate = dateKey(t.getFullYear(), t.getMonth(), t.getDate());
    if (state.screen === 'calendar') {
      repaintCalendarGrid();
      rerenderCalendarSideIfActive();
    } else if (state.screen === 'home' && rerenderHomeMiniCalendarIfActive()) {
      // mini calendar updated in place
    } else {
      render();
    }
    loadCalendarFoodForDate(state.selectedDate);
  }

  /**
   * Day click: surgical update only. Toggle the selected-cell class on
   * the grid and rebuild the side panel in place. The form DOM is
   * preserved (module-cached) so any text the user typed survives.
   */
  function selectDate(key) {
    if (state.selectedDate === key) return;
    state.selectedDate = key;
    if (state.screen === 'calendar') {
      updateCalendarDaySelection(key);
      rerenderCalendarSideIfActive();
    } else if (state.screen === 'home') {
      if (!rerenderHomeMiniCalendarIfActive()) {
        render();
      }
    } else {
      render();
    }
    loadCalendarFoodForDate(key);
  }

  function retryCalendarFoodDate(key) {
    loadCalendarFoodForDate(key, { force: true });
  }

  async function addReminder(key, text, time, tag, repeat, until) {
    if (!text) return;
    try {
      const body = {
        text: text,
        date: key,
        time: time || null,
        tag: tag || 'personal',
        repeat: repeat || 'none',
        until: until || null,
      };
      const created = await api('/api/reminders', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      state.reminders.push(created);
      if (window.GB.resetCalendarForm) window.GB.resetCalendarForm();
      if (state.screen === 'calendar') {
        rerenderCalendarSideIfActive();
        // Repaint the month grid's dot indicators for the affected day.
        repaintCalendarGrid();
      } else {
        render();
      }
      toastSuccess('Reminder added.');
    } catch (err) {
      toastError(err, 'Could not add reminder.');
    }
  }

  /**
   * Repaint just the month grid (dots + counts) in place. Used after
   * adding/deleting reminders so the side panel — and form DOM — stays
   * stable. Falls back to full render if the grid isn't mounted.
   */
  function repaintCalendarGrid() {
    if (state.screen !== 'calendar') return;
    const grid = document.querySelector('.gb-cal-card');
    if (!grid || !window.GB.RenderCalendarGrid) {
      render();
      return;
    }
    const fresh = window.GB.RenderCalendarGrid({
      year: state.calYear,
      month: state.calMonth,
      selectedDate: state.selectedDate,
      reminders: state.reminders,
      onSelectDate: selectDate,
    });
    grid.replaceWith(fresh);
    refreshIcons();
  }

  // Shift a 'YYYY-MM-DD' key by `delta` days.
  function shiftKey(key, delta) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  // scope: 'all' | 'this' | 'future' | 'before'
  async function deleteReminder(scope, id, occKey) {
    try {
      const qs = new URLSearchParams();
      qs.set('scope', scope || 'all');
      if (occKey) {
        qs.set('date', occKey);
      }
      await api('/api/reminders/' + encodeURIComponent(id) + '?' + qs.toString(), {
        method: 'DELETE',
      });
      state.reminders = await api('/api/reminders');
      if (state.screen === 'calendar') {
        rerenderCalendarSideIfActive();
        repaintCalendarGrid();
      } else {
        render();
      }
      toastSuccess('Reminder deleted.');
    } catch (err) {
      toastError(err, 'Could not delete reminder.');
    }
  }

  /* ---- Modal scaffolding ---- */
  function openModal({ title, sub, body, primary, onPrimary }) {
    let overlay;
    function close() {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
    }
    const primaryBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--primary',
        style: { width: '100%', marginTop: '14px' },
        onclick: async () => {
          try {
            primaryBtn.disabled = true;
            await onPrimary();
            close();
            render();
          } catch (err) {
            primaryBtn.disabled = false;
            toastError(err, 'Something went wrong.');
          }
        },
      },
      primary || 'Save'
    );
    const sheet = h(
      'div',
      { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h(
        'div',
        { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, title),
        sub ? h('div', { class: 'gb-modal-sub' }, sub) : null
      ),
      h('div', { class: 'gb-modal-body' }, body),
      primaryBtn,
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
        'Cancel'
      )
    );
    overlay = h(
      'div',
      { class: 'gb-modal-overlay', onclick: e => { if (e.target === overlay) close(); } },
      sheet
    );
    document.body.appendChild(overlay);
    refreshIcons();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function segmented(options, initial, onChange) {
    let selected = initial;
    const segs = {};
    const wrap = h('div', { class: 'gb-segmented', role: 'radiogroup' });
    options.forEach(opt => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'gb-seg' + (opt.value === selected ? ' is-on' : ''),
          role: 'radio',
          'aria-checked': String(opt.value === selected),
          onclick: () => {
            selected = opt.value;
            for (const k in segs) {
              const on = k === opt.value;
              segs[k].classList.toggle('is-on', on);
              segs[k].setAttribute('aria-checked', String(on));
            }
            if (onChange) onChange(opt.value);
          },
        },
        opt.label
      );
      segs[opt.value] = btn;
      wrap.appendChild(btn);
    });
    return { node: wrap, get: () => selected };
  }

  function openAddSheet() {
    let overlay;
    function close() {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
    }
    const opts = [
      { key: 'task',     icon: 'list-todo',     label: 'Task',     sub: 'A to-do for today',         action: () => { close(); openAddTask(); } },
      { key: 'habit',    icon: 'repeat',        label: 'Habit',    sub: 'Something to do every day', action: () => { close(); openAddHabit(); } },
      { key: 'reminder', icon: 'calendar-plus', label: 'Reminder', sub: 'On a specific day or time', action: () => { close(); calToday(); setScreen('calendar'); } },
      { key: 'gratitude', icon: 'heart',        label: 'Gratitude', sub: 'Save a small good thing',   action: () => { close(); openAddGratitude(); } },
      { key: 'sleep',    icon: 'moon',          label: 'Sleep',    sub: 'Bedtime and wake time',     action: () => { close(); openSleepSchedule(); } },
      { key: 'mood',     icon: 'smile-plus',    label: 'Mood',     sub: 'Energy and stress check-in', action: () => { close(); openMoodCheckin(); } },
    ];
    const sheet = h(
      'div',
      { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quick add' },
      h(
        'div',
        { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, 'What would you like to add?'),
        h('div', { class: 'gb-modal-sub' }, 'Pick one to get started.')
      ),
      h(
        'div',
        { class: 'gb-modal-opts' },
        opts.map(o =>
          h(
            'button',
            { type: 'button', class: 'gb-modal-opt', onclick: o.action },
            h('span', { class: 'gb-modal-opt-ic' }, Icon(o.icon, { size: 18 })),
            h(
              'span',
              { class: 'gb-modal-opt-tx' },
              h('span', { class: 'gb-modal-opt-l' }, o.label),
              h('span', { class: 'gb-modal-opt-s' }, o.sub)
            )
          )
        )
      ),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
        'Cancel'
      )
    );
    overlay = h(
      'div',
      { class: 'gb-modal-overlay', onclick: e => { if (e.target === overlay) close(); } },
      sheet
    );
    document.body.appendChild(overlay);
    refreshIcons();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function openAddTask() {
    const titleInput = h('input', {
      type: 'text', class: 'gb-input',
      placeholder: 'e.g. Finish the design review',
      maxlength: 255,
    });
    const priority = segmented(
      [{ value: 'Low', label: 'Low' }, { value: 'Medium', label: 'Medium' }, { value: 'High', label: 'High' }],
      'Medium'
    );
    const dueInput = h('input', { type: 'datetime-local', class: 'gb-input' });

    const body = h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Title'),
      titleInput,
      h('div', { class: 'gb-field-label' }, 'Priority'),
      priority.node,
      h('div', { class: 'gb-field-label' }, 'Due (optional)'),
      dueInput
    );

    openModal({
      title: 'New task',
      body,
      primary: 'Add task',
      onPrimary: async () => {
        const title = titleInput.value.trim();
        if (!title) { titleInput.focus(); throw new Error('Title is required'); }
        const due = dueInput.value ? new Date(dueInput.value).toISOString() : null;
        await createTask({ title, priority: priority.get(), dueAt: due });
      },
    });
    setTimeout(() => titleInput.focus(), 60);
  }

  function colorPicker(initial) {
    // Friendly palette mapped to token-aware hexes (so dark mode still reads OK).
    const swatches = [
      { v: '#F97316', name: 'orange' },
      { v: '#22C55E', name: 'green' },
      { v: '#0EA5E9', name: 'sky' },
      { v: '#6C5CE7', name: 'iris' },
      { v: '#E11D48', name: 'coral' },
      { v: '#EAB308', name: 'sun' },
    ];
    let selected = initial || '';
    const wrap = h('div', { class: 'gb-color-pick', role: 'radiogroup', 'aria-label': 'Color' });
    const dots = {};
    swatches.forEach(s => {
      const dot = h('button', {
        type: 'button', class: 'gb-color-dot' + (s.v === selected ? ' is-on' : ''),
        style: { background: s.v },
        'aria-label': s.name, 'aria-checked': String(s.v === selected),
        onclick: () => {
          selected = (selected === s.v) ? '' : s.v;
          for (const k in dots) dots[k].classList.toggle('is-on', k === selected);
        },
      });
      dots[s.v] = dot;
      wrap.appendChild(dot);
    });
    return { node: wrap, get: () => selected };
  }

  function openAddHabit() {
    const nameInput = h('input', {
      type: 'text', class: 'gb-input',
      placeholder: 'e.g. Meditate',
      maxlength: 120,
    });
    const domain = segmented(
      [
        { value: 'habit',   label: 'General' },
        { value: 'fitness', label: 'Fitness' },
        { value: 'study',   label: 'Study' },
        { value: 'journal', label: 'Journal' },
      ],
      'habit'
    );
    const cadence = segmented(
      [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }],
      'daily'
    );
    const color = colorPicker('');
    const reminderInput = h('input', { type: 'time', class: 'gb-input' });

    const body = h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Name'),
      nameInput,
      h('div', { class: 'gb-field-label' }, 'Category'),
      domain.node,
      h('div', { class: 'gb-field-label' }, 'Color (optional)'),
      color.node,
      h('div', { class: 'gb-field-label' }, 'Cadence'),
      cadence.node,
      h('div', { class: 'gb-field-label' }, 'Daily reminder (optional)'),
      reminderInput
    );

    openModal({
      title: 'New habit',
      body,
      primary: 'Add habit',
      onPrimary: async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); throw new Error('Name is required'); }
        const d = domain.get();
        const icon = (DOMAIN[d] && DOMAIN[d].icon) || 'repeat';
        await createHabit({
          name, domain: d, icon, cadence: cadence.get(),
          color: color.get() || null,
          reminderTime: reminderInput.value || null,
        });
      },
    });
    setTimeout(() => nameInput.focus(), 60);
  }

  /** "Just now" / "5 min ago" / "2 h ago" / "3 d ago". */
  function relativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return Math.round(diffSec / 60) + ' min ago';
    if (diffSec < 86400) return Math.round(diffSec / 3600) + ' h ago';
    if (diffSec < 604800) return Math.round(diffSec / 86400) + ' d ago';
    return new Date(iso).toLocaleDateString();
  }

  /* ---- Bell dropdown ---- */
  function notificationDropdown() {
    if (!state.notifOpen) return null;
    const items = state.notifications.slice(0, 12);
    const card = h('div', { class: 'gb-notif-pop' });
    card.appendChild(h('div', { class: 'gb-notif-head' },
      h('span', null, 'Notifications'),
      state.notifications.length
        ? h('a', {
            role: 'button', tabindex: '0',
            class: 'gb-login-link',
            onclick: async () => {
              try { await api('/api/notifications/read-all', { method: 'PATCH' }); } catch (_) {}
              state.notifications = state.notifications.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() }));
              render();
            },
          }, 'Mark all read')
        : null
    ));
    if (!items.length) {
      card.appendChild(h('div', { class: 'gb-notif-empty' }, 'You\'re all caught up.'));
    } else {
      items.forEach(n => {
        const isMentorshipReq = n.kind === 'mentorship_request' && !n.readAt;
        const row = h('div', { class: 'gb-notif-row' + (n.readAt ? '' : ' is-unread') },
          h('div', { class: 'gb-notif-dot' }),
          h('div', { class: 'gb-notif-body', onclick: () => markNotificationRead(n.id) },
            h('div', { class: 'gb-notif-title' }, n.title),
            n.body ? h('div', { class: 'gb-notif-sub' }, n.body) : null,
            h('div', { class: 'gb-notif-time' }, relativeTime(n.createdAt))
          ),
          isMentorshipReq
            ? h('div', { class: 'gb-notif-actions' },
                h('button', {
                  type: 'button', class: 'gb-btn gb-btn--primary',
                  style: { width: 'auto', padding: '6px 12px', fontSize: '12px' },
                  onclick: () => respondMentorshipRequest(n.relatedId, n.id, true),
                }, 'Accept'),
                h('button', {
                  type: 'button', class: 'gb-btn gb-btn--ghost',
                  style: { width: 'auto', padding: '6px 12px', fontSize: '12px' },
                  onclick: () => respondMentorshipRequest(n.relatedId, n.id, false),
                }, 'Reject')
              )
            : null
        );
        card.appendChild(row);
      });
    }
    return card;
  }

  function toastStack() {
    if (!state.toasts.length) return null;
    return h(
      'div',
      { class: 'gb-toast-stack', role: 'status', 'aria-live': 'polite' },
      state.toasts.map(t =>
        h(
          'div',
          { class: 'gb-toast is-' + (t.kind || 'error') },
          h('span', { class: 'gb-toast-icon', 'aria-hidden': 'true' },
            Icon((t.kind || 'error') === 'success' ? 'check-circle-2' : 'circle-alert', { size: 15, sw: 2.4 })
          ),
          h('span', { class: 'gb-toast-msg' }, t.message),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-toast-close',
              'aria-label': 'Dismiss message',
              onclick: () => dismissToast(t.id),
            },
            Icon('x', { size: 14 })
          )
        )
      )
    );
  }

  function confirmDelete(message, onYes) {
    const body = h('div', { class: 'gb-form' }, h('p', { class: 'gb-confirm-text' }, message));
    openModal({
      title: 'Please confirm',
      body,
      primary: 'Delete',
      onPrimary: async () => {
        await onYes();
        toastSuccess('Deleted.');
      },
    });
  }

  /* ---- Habits screen ---- */
  function ScreenHabits() {
    if (!state.habits.length) {
      return h(
        'div',
        { class: 'gb-placeholder gb-rise' },
        h('div', { class: 'chip' }, Icon('repeat', { size: 30, sw: 2.2, color: 'var(--brand-soft-fg)' })),
        h('h2', null, 'No habits yet'),
        h('p', null, 'Start small — pick one thing you’d like to do every day.'),
        h(
          'button',
          { type: 'button', class: 'gb-btn gb-btn--primary', style: { marginTop: '14px', maxWidth: '280px' }, onclick: openAddHabit },
          Icon('plus', { size: 18, sw: 2.6, color: 'var(--fg-on-brand)' }),
          'Add a habit'
        )
      );
    }
    const rows = state.habits.map(habit => h(
      'div',
      { class: 'gb-row' },
      IconChip({ domain: habit.domain, icon: habit.icon }),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'title' }, habit.name),
        h('div', { class: 'sub' },
          (habit.cadence || 'daily') + (habit.streak ? ' · 🔥 ' + habit.streak + '-day streak' : ''))
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-rem-del',
          'aria-label': 'Delete habit',
          onclick: () => confirmDelete('Delete this habit?', () => deleteHabit(habit.id)),
        },
        Icon('trash-2', { size: 16 })
      ),
      Check({ done: habit.doneToday, onToggle: () => toggleHabit(habit.id) })
    ));
    return h(
      'div',
      { class: 'gb-rise', style: { padding: '0 0 24px' } },
      h(
        'div',
        { style: { padding: '6px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('h3', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', margin: 0 } }, 'Your habits'),
        h(
          'button',
          { type: 'button', class: 'gb-btn gb-btn--soft', style: { width: 'auto', padding: '8px 14px' }, onclick: openAddHabit },
          Icon('plus', { size: 16, sw: 2.6 }), 'Add'
        )
      ),
      h('div', { style: { padding: '0 20px' } },
        h('div', { class: 'gb-card', style: { padding: '4px 0' } }, rows)
      )
    );
  }

  /* ---- Placeholder screen ---- */
  function Placeholder({ icon, title, body }) {
    return h(
      'div',
      { class: 'gb-placeholder gb-rise' },
      h(
        'div',
        { class: 'chip' },
        Icon(icon, { size: 30, sw: 2.2, color: 'var(--brand-soft-fg)' })
      ),
      h('h2', null, title),
      h('p', null, body)
    );
  }

  const SCREENS = {
    home: {
      headerLabel: () => todayLabel(),
      headerName:  () => 'Hey, ' + (state.user && state.user.displayName ? state.user.displayName : 'Buddy') + ' 👋',
      render: () => ScreenDashboard({
        tasks: state.tasks,
        toggleTask,
        reminders: state.reminders,
        habits: state.habits,
        toggleHabit,
        score: score(),
        quote: state.quote,
        water: state.water,
        food: state.food,
        goals: state.goals,
        gratitude: state.gratitude,
        wellness: state.wellness,
        foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
        dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
        dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
        onQuickAddWater: quickAddWater,
        onUpdateWaterGoal: updateWaterGoal,
        onAddFood: openAddFood,
        onDeleteWater: deleteWaterEntry,
        onDeleteFood: deleteFoodEntry,
        level: (state.user && state.user.level) || 1,
        onAddTask: openAddTask,
        onAddHabit: openAddHabit,
        timerWidget: getHomeTimerWidget(),
        calYear: state.calYear,
        calMonth: state.calMonth,
        selectedDate: state.selectedDate,
        onSelectDate: selectDate,
        onPrevMonth: calPrevMonth,
        onNextMonth: calNextMonth,
        onRetryFood: retryCalendarFoodDate,
        onPlanToday: openDailyPlan,
        onAddSleep: openSleepSchedule,
        onAddMood: openMoodCheckin,
        onAddSuggestedReminder: addSuggestedReminder,
      }),
    },
    habits: {
      headerLabel: () => '',
      headerName:  () => 'Habits',
      render: () => ScreenHabits(),
    },
    food: {
      headerLabel: () => 'Water & meals',
      headerName:  () => 'Food',
      render: () => ScreenFood({
        water: state.water,
        food: state.food,
        photoHistory: state.wellness.photoHistory || [],
        onQuickAddWater: quickAddWater,
        onUpdateWaterGoal: updateWaterGoal,
        onAddFood: openAddFood,
        onDeleteWater: deleteWaterEntry,
        onDeleteFood: deleteFoodEntry,
      }),
    },
    calendar: {
      headerLabel: () => 'Plan & remember',
      headerName:  () => 'Calendar',
      render: () => ScreenCalendar({
        year: state.calYear,
        month: state.calMonth,
        selectedDate: state.selectedDate,
        reminders: state.reminders,
        tasks: state.tasks,
        goals: state.goals,
        gratitude: state.gratitude,
        wellness: state.wellness,
        foodSummary: state.calendarFoodByDate[state.selectedDate] || null,
        dayFoodLoading: state.calendarFoodLoadingFor === state.selectedDate,
        dayFoodError: state.calendarFoodErrorByDate[state.selectedDate] || '',
        onPrevMonth: calPrevMonth,
        onNextMonth: calNextMonth,
        onToday: calToday,
        onSelectDate: selectDate,
        onRetryFood: retryCalendarFoodDate,
        onAddReminder: addReminder,
        onDeleteReminder: deleteReminder,
      }),
    },
    mentor: {
      headerLabel: () => 'Your AI mentor',
      headerName:  () => 'Buddy',
      render: () => ScreenMentor({
        api: {
          get:  () => api('/api/mentor/chat'),
          post: (text) => api('/api/mentor/chat/messages', {
            method: 'POST', body: JSON.stringify({ content: text }),
          }),
          clear: () => api('/api/mentor/chat/messages', { method: 'DELETE' }),
        },
      }),
    },
    circle: {
      headerLabel: () => 'Grow together',
      headerName:  () => 'Growth Circle',
      render: () => ScreenCircle({
        onSearch:       (q)        => api('/api/users/search?q=' + encodeURIComponent(q)),
        onBrowse:       ()         => api('/api/users/browse'),
        onSendInvite:   (toUserId, direction, note) => api('/api/mentorship/requests', {
          method: 'POST', body: JSON.stringify({ toUserId, direction, note }),
        }),
        onLoadOutgoing: () => api('/api/mentorship/requests/outgoing'),
        onLoadIncoming: () => api('/api/mentorship/requests/incoming'),
        onLoadStatus:   (partnerId) => api('/api/mentorship/connections/' + encodeURIComponent(partnerId) + '/status'),
        onRevoke:       (requestId) => api('/api/mentorship/requests/' + encodeURIComponent(requestId) + '/revoke', { method: 'POST' }),
      }),
    },
    goals: {
      headerLabel: () => 'Track progress',
      headerName:  () => 'Goals',
      render: () => ScreenGoals({
        sections: state.goals,
        gratitude: state.gratitude,
        onCreateGoal: createGoal,
        onToggleGoal: toggleGoal,
        onDeleteGoal: deleteGoal,
        onAddAction: addGoalAction,
        onUpdateAction: updateGoalAction,
        onDeleteAction: deleteGoalAction,
        onCreateGratitude: createGratitude,
        onUpdateGratitude: updateGratitude,
        onDeleteGratitude: deleteGratitude,
      }),
    },
  };

  /* ---- Render ---- */
  const root = document.getElementById('root');
  let renderedScreen = '';

  function captureScrollPosition() {
    const scroll = document.querySelector('.gb-scroll');
    if (!scroll) return null;
    return {
      screen: renderedScreen,
      top: scroll.scrollTop,
      left: scroll.scrollLeft,
    };
  }

  function restoreScrollPosition(snapshot) {
    if (!snapshot || snapshot.screen !== state.screen) return;
    const scroll = document.querySelector('.gb-scroll');
    if (!scroll) return;
    const apply = () => {
      const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      scroll.scrollTop = Math.min(snapshot.top, maxTop);
      scroll.scrollLeft = snapshot.left;
    };
    apply();
    requestAnimationFrame(apply);
  }

  /* ---- Auth: low-level POST that surfaces backend status + json body ---- */
  async function authPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    let payload = null;
    try { payload = await res.json(); } catch (_) { /* 204s */ }
    if (!res.ok) {
      const msg = (payload && payload.message) || ('Request failed (' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return payload;
  }

  function setAuthMode(mode, opts) {
    opts = opts || {};
    state.authMode = mode;
    state.error = '';
    state.authNotice = opts.notice || '';
    if (opts.email !== undefined) state.authEmail = opts.email;
    render();
  }

  function authLink(label, onClick) {
    return h('a', {
      role: 'button', tabindex: '0',
      class: 'gb-login-link',
      onclick: onClick,
      onkeydown: e => { if (e.key === 'Enter') onClick(); },
    }, label);
  }

  function authShell(title, subtitle, children) {
    return h(
      'div',
      { class: 'gb-login-wrap' },
      h(
        'div',
        { class: 'gb-login-card gb-rise' },
        h('div', { class: 'gb-login-brand' },
          Icon('sprout', { size: 28, color: 'var(--brand)' }),
          h('span', null, 'Growth Buddy')),
        h('h1', { class: 'gb-login-title' }, title),
        h('p', { class: 'gb-login-sub' }, subtitle),
        state.authNotice ? h('p', { class: 'gb-login-notice' }, state.authNotice) : null,
        children,
        state.error ? h('p', { class: 'gb-login-error' }, state.error) : null
      )
    );
  }

  function primaryBtn(label, onClick) {
    return h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--primary gb-login-btn',
        onclick: onClick,
        disabled: state.loading ? true : null,
      },
      state.loading ? 'Please wait…' : label
    );
  }

  function field(label, input) {
    return [h('label', { class: 'gb-login-label' }, label), input];
  }

  function runAuth(action) {
    state.loading = true;
    state.error = '';
    render();
    return action()
      .catch(err => { state.error = err.message || 'Something went wrong.'; })
      .finally(() => { state.loading = false; render(); });
  }

  /* ---- Sign-in ---- */
  function viewSignin() {
    const emailInput = h('input', {
      type: 'email', class: 'gb-input gb-login-input',
      placeholder: 'you@example.com', required: true, value: state.authEmail || '',
    });
    const pwInput = h('input', {
      type: 'password', class: 'gb-input gb-login-input',
      placeholder: '••••••••', maxlength: 128,
    });

    function submit() {
      const email = emailInput.value.trim();
      const password = pwInput.value;
      if (!email) { emailInput.focus(); return; }
      if (!password) { pwInput.focus(); return; }
      runAuth(async () => {
        try {
          const user = await authPost('/api/auth/login', { email, password });
          state.user = user;
          saveSession(user, user.token);
          state.wellness = loadWellness();
          state.screen = 'home';
          history.replaceState(null, '', '#/home');
          await loadData();
        } catch (err) {
          if (err.status === 403) {
            // Email unverified — backend just re-sent the OTP. Route to verify.
            setAuthMode('verify', {
              email,
              notice: 'We sent a 6-digit code to ' + email + '. Enter it below.',
            });
            return;
          }
          throw err;
        }
      });
    }

    [emailInput, pwInput].forEach(el => el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    }));

    return authShell(
      'Welcome back',
      'Sign in to sync your habits, tasks, reminders, and score.',
      [
        ...field('Email', emailInput),
        ...field('Password', pwInput),
        primaryBtn('Sign in', submit),
        h('div', { class: 'gb-login-row' },
          authLink('Forgot password?', () => setAuthMode('forgot', { email: emailInput.value.trim() })),
          authLink('Create account', () => setAuthMode('signup', { email: emailInput.value.trim() }))
        ),
      ]
    );
  }

  /* ---- Sign-up ---- */
  function viewSignup() {
    const emailInput = h('input', {
      type: 'email', class: 'gb-input gb-login-input',
      placeholder: 'you@example.com', required: true, value: state.authEmail || '',
    });
    const nameInput = h('input', {
      type: 'text', class: 'gb-input gb-login-input',
      placeholder: 'Your name', maxlength: 120,
    });
    const pwInput = h('input', {
      type: 'password', class: 'gb-input gb-login-input',
      placeholder: 'At least 8 characters', maxlength: 128,
    });

    function submit() {
      const email = emailInput.value.trim();
      const displayName = nameInput.value.trim();
      const password = pwInput.value;
      if (!email) { emailInput.focus(); return; }
      if (password.length < 8) { state.error = 'Password must be at least 8 characters.'; render(); pwInput.focus(); return; }
      runAuth(async () => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        await authPost('/api/auth/signup', { email, password, displayName, timezone: tz });
        setAuthMode('verify', {
          email,
          notice: 'We sent a 6-digit code to ' + email + '. Enter it below to finish signing up.',
        });
      });
    }

    [emailInput, nameInput, pwInput].forEach(el => el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    }));

    return authShell(
      'Create your account',
      'We’ll email you a 6-digit code to confirm your address.',
      [
        ...field('Email', emailInput),
        ...field('Name', nameInput),
        ...field('Password', pwInput),
        primaryBtn('Create account', submit),
        h('div', { class: 'gb-login-row' },
          authLink('Have an account? Sign in', () => setAuthMode('signin', { email: emailInput.value.trim() }))
        ),
      ]
    );
  }

  /* ---- Verify (OTP entered after signup or after blocked login) ---- */
  function viewVerify() {
    const otpInput = h('input', {
      type: 'text', inputmode: 'numeric', pattern: '\\d{6}',
      class: 'gb-input gb-login-input gb-otp-input',
      placeholder: '••••••', maxlength: 6,
    });
    function submit() {
      const otp = (otpInput.value || '').replace(/\D/g, '');
      if (otp.length !== 6) { otpInput.focus(); state.error = 'Enter the 6-digit code (must be exactly 6 digits).'; render(); return; }
      runAuth(async () => {
        const user = await authPost('/api/auth/verify', { email: state.authEmail, otp });
        state.user = user;
        saveSession(user, user.token);
        state.wellness = loadWellness();
        state.screen = 'home';
        history.replaceState(null, '', '#/home');
        await loadData();
      });
    }
    function resend() {
      runAuth(async () => {
        await authPost('/api/auth/resend-verification', { email: state.authEmail });
        state.authNotice = 'New code sent to ' + state.authEmail + '. Check your email or console logs.';
        otpInput.value = '';
      });
    }
    otpInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    setTimeout(() => otpInput.focus(), 60);

    return authShell(
      'Verify your email',
      'Code sent to ' + state.authEmail + '. Check your email or console logs for the 6-digit code.',
      [
        ...field('6-digit code', otpInput),
        primaryBtn('Verify & continue', submit),
        h('div', { class: 'gb-login-row' },
          authLink('Resend code', resend),
          authLink('Use a different email', () => setAuthMode('signup', { email: state.authEmail }))
        ),
      ]
    );
  }

  /* ---- Forgot password (request a reset code) ---- */
  function viewForgot() {
    const emailInput = h('input', {
      type: 'email', class: 'gb-input gb-login-input',
      placeholder: 'you@example.com', value: state.authEmail || '',
    });
    function submit() {
      const email = emailInput.value.trim();
      if (!email) { emailInput.focus(); return; }
      runAuth(async () => {
        await authPost('/api/auth/forgot-password', { email });
        setAuthMode('reset', {
          email,
          notice: 'If that email is registered, we just sent a 6-digit code to it.',
        });
      });
    }
    emailInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    return authShell(
      'Reset password',
      'Enter your email and we’ll send you a code.',
      [
        ...field('Email', emailInput),
        primaryBtn('Send code', submit),
        h('div', { class: 'gb-login-row' },
          authLink('Back to sign in', () => setAuthMode('signin', { email: emailInput.value.trim() }))
        ),
      ]
    );
  }

  /* ---- Reset password (enter code + new password) ---- */
  function viewReset() {
    const otpInput = h('input', {
      type: 'text', inputmode: 'numeric', pattern: '\\d{6}',
      class: 'gb-input gb-login-input gb-otp-input',
      placeholder: '••••••', maxlength: 6,
    });
    const pwInput = h('input', {
      type: 'password', class: 'gb-input gb-login-input',
      placeholder: 'At least 8 characters', maxlength: 128,
    });
    function submit() {
      const otp = (otpInput.value || '').replace(/\D/g, '');
      if (otp.length !== 6) { otpInput.focus(); state.error = 'Enter the 6-digit code.'; render(); return; }
      if (pwInput.value.length < 8) { pwInput.focus(); state.error = 'Password must be at least 8 characters.'; render(); return; }
      runAuth(async () => {
        const user = await authPost('/api/auth/reset-password', {
          email: state.authEmail, otp, password: pwInput.value,
        });
        state.user = user;
        saveSession(user, user.token);
        state.wellness = loadWellness();
        state.screen = 'home';
        history.replaceState(null, '', '#/home');
        await loadData();
      });
    }
    [otpInput, pwInput].forEach(el => el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    }));

    return authShell(
      'Set a new password',
      'Code sent to ' + state.authEmail + '.',
      [
        ...field('6-digit code', otpInput),
        ...field('New password', pwInput),
        primaryBtn('Reset password', submit),
        h('div', { class: 'gb-login-row' },
          authLink('Back to sign in', () => setAuthMode('signin', { email: state.authEmail }))
        ),
      ]
    );
  }

  function loginCard() {
    switch (state.authMode) {
      case 'signup': return viewSignup();
      case 'verify': return viewVerify();
      case 'forgot': return viewForgot();
      case 'reset':  return viewReset();
      default:       return viewSignin();
    }
  }

  function logout() {
    // Fire-and-forget; the token is invalidated locally either way.
    const token = loadToken();
    if (token) {
      fetch(API_BASE + '/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      }).catch(() => {/* silent */});
    }
    disconnectWebSocket();
    clearSession();
    state.user = null;
    state.tasks = [];
    state.habits = [];
    state.reminders = [];
    state.quote = null;
    state.score = 0;
    state.error = '';
    state.loading = false;
    state.screen = 'home';
    state.authMode = 'signin';
    state.authEmail = '';
    state.authNotice = '';
    homeTimerWidget = null;
    // Drop the hash so the URL doesn't say "#/circle" on the sign-in screen.
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    render();
  }

  function render() {
    const scrollSnapshot = renderedScreen === state.screen ? captureScrollPosition() : null;
    const quietRefresh = !!scrollSnapshot;
    if (!state.user) {
      root.replaceChildren(loginCard());
      refreshIcons();
      renderedScreen = '';
      return;
    }

    const cfg = SCREENS[state.screen] || SCREENS.home;

    const app = h(
      'div',
      { class: 'gb-app' + (quietRefresh ? ' is-refreshing' : '') },
      AppHeader({
        label: cfg.headerLabel(),
        name: cfg.headerName(),
        userName: state.user.displayName || 'Buddy',
        theme: state.theme,
        onAdd: openAddSheet,
        onTheme: toggleTheme,
        onAccount: toggleProfileOpen,
        unreadCount: unreadNotifs(),
        onBell: toggleNotifOpen,
      }),
      notificationDropdown(),
      profileDropdown(),
      toastStack(),
      h('div', { class: 'gb-scroll' },
        state.error
          ? h('div', { class: 'gb-placeholder gb-rise' }, h('h2', null, 'Backend error'), h('p', null, state.error))
          : cfg.render()
      ),
      BottomNav({
        active: state.screen,
        onNav: setScreen,
      })
    );

    root.replaceChildren(app);
    refreshIcons();
    restoreScrollPosition(scrollSnapshot);
    renderedScreen = state.screen;
    installOutsideClickToCloseHeaderPopovers();
  }

  /**
   * If a popover (notifications or profile) is open, close it on the next
   * mousedown anywhere outside of it. The handler self-removes after one
   * fire so we don't pile up listeners across renders.
   */
  function installOutsideClickToCloseHeaderPopovers() {
    if (!state.notifOpen && !state.profileOpen) return;
    function onDocDown(ev) {
      const pop = ev.target.closest('.gb-notif-pop, .gb-profile-pop, .gb-bell, .gb-avatar');
      if (pop) return; // click inside the popover or its trigger
      document.removeEventListener('mousedown', onDocDown, true);
      state.notifOpen = false;
      state.profileOpen = false;
      render();
    }
    // Defer so the click that opened the popover doesn't immediately close it.
    setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  }

  /* ---- Boot ---- */
  document.documentElement.setAttribute('data-theme', state.theme);
  if (state.user) {
    // Restore the screen from the URL fragment, so refreshing on /circle stays there.
    state.screen = screenFromHash();
    loadData();
  }
  render();
  window.addEventListener('load', refreshIcons);
})();
