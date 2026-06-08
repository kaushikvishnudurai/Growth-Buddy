/* =====================================================================
   Growth Buddy — Growth Circle (search people + mentorship invites)
   ===================================================================== */
(function () {
  'use strict';

  const { h, Icon, Avatar, Card } = window.GB;

  function PersonRow(person, onOffer, onRequest, onView) {
    const rel = person.relationship || 'none';
    let trailing;
    if (rel === 'mentoring' || rel === 'mentee') {
      const label = rel === 'mentoring' ? 'You mentor them' : 'They mentor you';
      trailing = h('span', {
        class: 'gb-tag-pill is-accepted',
        style: { cursor: 'pointer' },
        onclick: () => onView(person),
      }, label);
    } else if (rel === 'pending') {
      trailing = h('span', { class: 'gb-tag-pill is-pending' }, 'Invite pending');
    } else {
      trailing = h(
        'div',
        { class: 'gb-person-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft',
            style: { width: 'auto', padding: '8px 12px', fontSize: '12.5px' },
            onclick: () => onOffer(person),
          },
          Icon('hand-helping', { size: 14, sw: 2.4 }),
          'Mentor them'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary',
            style: { width: 'auto', padding: '8px 12px', fontSize: '12.5px' },
            onclick: () => onRequest(person),
          },
          Icon('user-plus', { size: 14, sw: 2.4 }),
          'Ask to mentor me'
        )
      );
    }
    return h(
      'div',
      { class: 'gb-row gb-person-row' },
      Avatar({ name: person.displayName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'title' }, person.displayName),
        h('div', { class: 'sub' },
          (person.email ? person.email + ' · ' : '') + 'Level ' + person.level)
      ),
      trailing
    );
  }

  /**
   * Status window for a connected partner. Shows their level, current task
   * progress, and habit streaks. Only the mentee/mentor sees this — the
   * backend enforces it via the {@code /connections/{id}/status} endpoint.
   */
  function showPartnerStatus(partnerId, fallbackName, statusApi) {
    let overlay;
    function close() {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
    }
    const subEl = h('div', { class: 'gb-modal-sub' }, 'Loading…');
    const taskBlock = h('div', { class: 'gb-status-block' });
    const habitBlock = h('div', { class: 'gb-status-block' });
    const card = h(
      'div',
      { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'gb-profile-head' },
        Avatar({ name: fallbackName, bg: 'var(--iris-100)', fg: 'var(--iris-700)', size: 64 }),
        h('div', null,
          h('div', { class: 'gb-modal-title' }, fallbackName),
          subEl)
      ),
      taskBlock,
      habitBlock,
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close }, 'Close')
    );
    overlay = h('div', { class: 'gb-modal-overlay', onclick: e => { if (e.target === overlay) close(); } }, card);
    document.body.appendChild(overlay);
    if (window.GB.refreshIcons) window.GB.refreshIcons();
    requestAnimationFrame(() => overlay.classList.add('is-open'));

    statusApi(partnerId)
      .then(data => {
        subEl.textContent = 'Level ' + data.level + ' · ' + (data.relationship === 'mentoring' ? 'Your mentee' : 'Your mentor');
        const t = data.tasksTotal === 0
          ? 'No tasks logged yet.'
          : (data.tasksDone + '/' + data.tasksTotal + ' tasks done today');
        taskBlock.appendChild(h('h4', { class: 'gb-status-label' }, 'Tasks'));
        taskBlock.appendChild(h('p', { class: 'gb-status-summary' }, t));
        if (data.tasks && data.tasks.length) {
          const list = h('ul', { class: 'gb-status-list' });
          data.tasks.slice(0, 6).forEach(it => {
            list.appendChild(h('li', { class: it.done ? 'is-done' : '' },
              h('span', null, it.done ? '✓ ' : '○ '),
              it.title));
          });
          taskBlock.appendChild(list);
        }
        habitBlock.appendChild(h('h4', { class: 'gb-status-label' }, 'Habits'));
        habitBlock.appendChild(h('pre', { class: 'gb-status-pre' }, data.habitsSummary || 'No habits tracked.'));
      })
      .catch(err => { subEl.textContent = err.message || 'Could not load status.'; });
  }

  function OutgoingRow(req, statusApi, onRevoke) {
    const isAccepted = req.status === 'accepted';
    const isPending = req.status === 'pending';
    const canRevoke = (isAccepted || isPending) && !!onRevoke;
    const label = req.direction === 'offer'
      ? (isAccepted ? 'You mentor ' + req.toName : 'You offered to mentor ' + req.toName)
      : (isAccepted ? req.toName + ' mentors you'  : 'You asked ' + req.toName + ' to mentor you');
    const statusClass = 'gb-tag-pill is-' + req.status;
    const confirmMsg = isAccepted ? 'Revoke this connection?' : 'Cancel this pending invite?';
    return h(
      'div',
      {
        class: 'gb-row' + (isAccepted ? ' is-clickable' : ''),
        onclick: isAccepted ? (e) => {
          if (e.target.closest('.gb-revoke-btn')) return;
          showPartnerStatus(req.toUserId, req.toName, statusApi);
        } : null,
        tabindex: isAccepted ? '0' : null,
      },
      Avatar({ name: req.toName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'title' }, label),
        h('div', { class: 'sub' }, req.note ? '“' + req.note + '”' : '')
      ),
      h('span', { class: statusClass }, req.status),
      canRevoke
        ? h('button', {
            type: 'button',
            class: 'gb-revoke-btn',
            'aria-label': isAccepted ? 'Revoke connection' : 'Cancel invite',
            title: isAccepted ? 'Revoke' : 'Cancel',
            onclick: () => { if (confirm(confirmMsg)) onRevoke(req.id); },
          }, Icon('x', { size: 14, sw: 2.4 }))
        : null
    );
  }

  function IncomingRow(req, statusApi, onRevoke) {
    const isAccepted = req.status === 'accepted';
    const label = req.direction === 'offer'
      ? (isAccepted ? req.fromName + ' mentors you' : req.fromName + ' offered to mentor you')
      : (isAccepted ? 'You mentor ' + req.fromName : req.fromName + ' asked you to mentor them');
    const statusClass = 'gb-tag-pill is-' + req.status;
    return h(
      'div',
      {
        class: 'gb-row' + (isAccepted ? ' is-clickable' : ''),
        onclick: isAccepted ? (e) => {
          if (e.target.closest('.gb-revoke-btn')) return;
          showPartnerStatus(req.fromUserId, req.fromName, statusApi);
        } : null,
        tabindex: isAccepted ? '0' : null,
      },
      Avatar({ name: req.fromName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'title' }, label),
        h('div', { class: 'sub' }, req.note ? '“' + req.note + '”' : '')
      ),
      h('span', { class: statusClass }, req.status),
      isAccepted && onRevoke
        ? h('button', {
            type: 'button',
            class: 'gb-revoke-btn',
            'aria-label': 'Revoke',
            onclick: () => { if (confirm('Revoke this connection?')) onRevoke(req.id); },
          }, Icon('x', { size: 14, sw: 2.4 }))
        : null
    );
  }

  /**
   * ScreenCircle({
   *   onSearch: (q) => Promise<People[]>,
   *   onSendInvite: (toUserId, direction, note) => Promise,
   *   onLoadOutgoing: () => Promise<Request[]>,
   *   onLoadIncoming: () => Promise<Request[]>,
   * })
   */
  /**
   * Modal opened by "Find someone". On open, eagerly fetches the full browse
   * list so the user has something to scroll through immediately. Typing then
   * narrows the list either client-side (fast, on substrings) or via the
   * server search endpoint (which also surfaces users not in the recent list).
   */
  function openSearchModal({ onBrowse, onSearch, onOffer, onRequest, onView }) {
    let overlay;
    function close() {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
    }
    const queryInput = h('input', {
      type: 'search', class: 'gb-input',
      placeholder: 'Search by name or email…',
      autofocus: true, maxlength: 80,
    });
    const resultsEl = h('div', { class: 'gb-card gb-search-results' });

    function paintLoading() {
      resultsEl.replaceChildren(h('div', { class: 'gb-empty' },
        h('p', null, 'Loading people…')));
    }
    function paintEmpty(msg) {
      resultsEl.replaceChildren(h('div', { class: 'gb-empty' },
        Icon('users-round', { size: 22, color: 'var(--fg3)' }),
        h('p', null, msg)));
    }
    function paintList(list) {
      if (!list.length) { paintEmpty('No matches.'); return; }
      resultsEl.replaceChildren();
      list.forEach(p => resultsEl.appendChild(
        PersonRow(p,
          person => { onOffer(person); close(); },
          person => { onRequest(person); close(); },
          person => { onView(person); close(); })));
    }

    let allPeople = [];
    paintLoading();
    (onBrowse ? onBrowse() : Promise.resolve([]))
      .then(list => { allPeople = list || []; paintList(allPeople); })
      .catch(() => paintEmpty('Could not load people.'));

    let lastQ = '', timer = null;
    queryInput.addEventListener('input', () => {
      const q = queryInput.value.trim().toLowerCase();
      clearTimeout(timer);
      // Empty query → restore the full browse list.
      if (q.length === 0) { paintList(allPeople); lastQ = ''; return; }
      // 1-character query → filter locally (avoids a server round-trip on every keystroke).
      const localFiltered = allPeople.filter(p =>
        (p.displayName || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q));
      paintList(localFiltered);
      if (q.length < 2) return;
      // 2+ chars → also ask the server (catches users not in the recent browse window).
      timer = setTimeout(async () => {
        if (q === lastQ) return; lastQ = q;
        try {
          const ppl = await onSearch(q);
          // Merge server results with local filter, dedupe by id, keep stable order.
          const seen = new Set();
          const merged = [];
          [...localFiltered, ...ppl].forEach(p => {
            if (seen.has(p.id)) return;
            seen.add(p.id);
            merged.push(p);
          });
          paintList(merged);
        } catch (_) { /* keep local-filtered view */ }
      }, 220);
    });

    const sheet = h(
      'div',
      { class: 'gb-modal gb-search-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Find people' },
      h('div', { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, 'Find someone'),
        h('div', { class: 'gb-modal-sub' }, 'Scroll the list or search by name / email.')),
      queryInput,
      resultsEl,
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close }, 'Close')
    );
    overlay = h('div', { class: 'gb-modal-overlay', onclick: e => { if (e.target === overlay) close(); } }, sheet);
    document.body.appendChild(overlay);
    if (window.GB.refreshIcons) window.GB.refreshIcons();
    requestAnimationFrame(() => { overlay.classList.add('is-open'); queryInput.focus(); });
  }

  function ScreenCircle({ onSearch, onSendInvite, onLoadOutgoing, onLoadIncoming, onLoadStatus, onBrowse, onRevoke }) {
    const outgoingEl = h('div');

    const incomingEl = h('div');

    function openNoteModal(person, direction) {
      const verb = direction === 'offer' ? 'mentor them' : 'ask them to mentor you';
      let overlay;
      const noteInput = h('textarea', {
        class: 'gb-input gb-input--about',
        maxlength: '500',
        placeholder: 'Add a short note (optional)',
      });

      function close() {
        overlay.classList.remove('is-open');
        setTimeout(() => overlay && overlay.remove(), 180);
      }

      const sheet = h(
        'div',
        { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add a short note' },
        h('div', { class: 'gb-modal-head' },
          h('div', { class: 'gb-modal-title' }, 'Add a short note'),
          h('div', { class: 'gb-modal-sub' }, verb + ' (' + person.displayName + ')')
        ),
        h('div', { class: 'gb-modal-body' },
          h('div', { class: 'gb-form' },
            h('div', { class: 'gb-field-label' }, 'Note (optional)'),
            noteInput,
            h('div', { class: 'gb-note-hint' }, 'Keep it short and friendly.')
          )
        ),
        h('div', { class: 'gb-water-prompt-actions' },
          h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel'),
          h('button', {
            type: 'button', class: 'gb-btn gb-btn--primary',
            onclick: async () => {
              try {
                await onSendInvite(person.id, direction, noteInput.value.trim() || null);
                if (window.GB.toastSuccess) {
                  window.GB.toastSuccess('Invite sent to ' + person.displayName + '.');
                }
                refreshOutgoing();
                close();
              } catch (err) {
                if (window.GB.toastError) {
                  window.GB.toastError(err, 'Could not send invite.');
                }
              }
            }
          }, 'Send invite')
        )
      );
      overlay = h('div', { class: 'gb-modal-overlay', onclick: e => { if (e.target === overlay) close(); } }, sheet);
      document.body.appendChild(overlay);
      if (window.GB.refreshIcons) window.GB.refreshIcons();
      requestAnimationFrame(() => overlay.classList.add('is-open'));
      setTimeout(() => noteInput.focus(), 60);
    }

    function promptAndSend(person, direction) {
      openNoteModal(person, direction);
    }

    function revokeAndRefresh(reqId) {
      onRevoke(reqId)
        .then(() => { refreshOutgoing(); refreshIncoming(); })
        .catch(err => window.GB.toastError ? window.GB.toastError(err, 'Could not revoke.') : null);
    }

    let cachedOutgoing = [];
    let cachedIncoming = [];

    function paint() {
      // Connections: every ACCEPTED relationship from either side, merged.
      const accepted = [];
      cachedOutgoing.filter(r => r.status === 'accepted').forEach(r =>
        accepted.push({ side: 'outgoing', req: r, partnerName: r.toName, partnerId: r.toUserId }));
      cachedIncoming.filter(r => r.status === 'accepted').forEach(r =>
        accepted.push({ side: 'incoming', req: r, partnerName: r.fromName, partnerId: r.fromUserId }));

      incomingEl.replaceChildren();
      if (!accepted.length) {
        incomingEl.appendChild(h('p', { class: 'gb-circle-empty' }, 'No connections yet. Send an invite to get started.'));
      } else {
        const card = h('div', { class: 'gb-card', style: { padding: '4px 0' } });
        accepted.forEach(item => card.appendChild(
          item.side === 'incoming'
            ? IncomingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null)
            : OutgoingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null)
        ));
        incomingEl.appendChild(card);
      }

      // Your invites: only OUTGOING + still meaningful to show. Cancelled
      // invites are hidden — once revoked, the user doesn't want to keep
      // seeing them. Rejected stays visible briefly so you know the result.
      const invites = cachedOutgoing.filter(r =>
        r.status !== 'accepted' && r.status !== 'cancelled');
      outgoingEl.replaceChildren();
      if (!invites.length) {
        outgoingEl.appendChild(h('p', { class: 'gb-circle-empty' }, 'No pending invites.'));
      } else {
        const card = h('div', { class: 'gb-card', style: { padding: '4px 0' } });
        invites.forEach(r => card.appendChild(OutgoingRow(r, onLoadStatus, onRevoke ? revokeAndRefresh : null)));
        outgoingEl.appendChild(card);
      }
    }

    function refreshOutgoing() {
      onLoadOutgoing().then(list => { cachedOutgoing = list || []; paint(); }).catch(() => {/* silent */});
    }
    function refreshIncoming() {
      if (!onLoadIncoming) return;
      onLoadIncoming().then(list => { cachedIncoming = list || []; paint(); }).catch(() => {/* silent */});
    }

    refreshAll();

    function refreshAll() {
      refreshOutgoing();
      refreshIncoming();
    }

    function launchSearch() {
      openSearchModal({
        onBrowse,
        onSearch,
        onOffer:   person => promptAndSend(person, 'offer'),
        onRequest: person => promptAndSend(person, 'request'),
        onView:    person => showPartnerStatus(person.id, person.displayName, onLoadStatus),
      });
    }

    const addBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--primary',
        style: { width: 'auto', padding: '8px 14px', fontSize: '13px' },
        onclick: launchSearch,
      },
      Icon('plus', { size: 14, sw: 2.6 }), 'Find someone'
    );

    return h(
      'div',
      { class: 'gb-rise', style: { padding: '0 0 24px' } },
      h(
        'div',
        { style: { padding: '6px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '10px' } },
        h('div', null,
          h('h3', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', margin: '0 0 4px' } }, 'Growth Circle'),
          h('p', { style: { color: 'var(--fg3)', fontSize: '13px', margin: 0 } }, 'Your mentors, your mentees, and your sent invites.')),
        addBtn
      ),
      h(
        'div',
        { style: { padding: '18px 20px 6px' } },
        h('h4', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', margin: '0 0 10px' } }, 'Connections')
      ),
      h('div', { style: { padding: '0 20px' } }, incomingEl),
      h(
        'div',
        { style: { padding: '18px 20px 6px' } },
        h('h4', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', margin: '0 0 10px' } }, 'Your invites')
      ),
      h('div', { style: { padding: '0 20px' } }, outgoingEl)
    );
  }

  window.GB.ScreenCircle = ScreenCircle;
})();
