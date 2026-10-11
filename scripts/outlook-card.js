/* =====================================================================
   Growth Buddy — Home's Outlook card: the strongest Insight and where the
   current pace leads (data: outlook.js). InsightRow is also Report's row.
   ===================================================================== */
import { h, Card, SectionTitle, Icon } from './gb-kit.js';

/** One insight (insights.js card): title, text, "Based on", its action, a dismiss x. */
export function InsightRow(it, { onDismiss, onAction } = {}) {
  return h(
    'div',
    { class: 'gb-insight-row' },
    h('span', { class: 'gb-insight-ic' }, Icon(it.icon, { size: 18, color: 'var(--brand)' })),
    h(
      'div',
      { style: { minWidth: 0 } },
      h('div', { class: 'gb-insight-title' }, it.title),
      h('div', { class: 'gb-insight-text' }, it.text),
      it.basis ? h('div', { class: 'gb-insight-basis' }, 'Based on ' + it.basis) : null,
      it.action && onAction
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact gb-insight-action',
              onclick: () => onAction(it.action, it),
            },
            it.action.label
          )
        : null
    ),
    onDismiss && it.id
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-insight-dismiss',
            'aria-label': 'Dismiss insight: ' + it.title,
            title: 'Dismiss',
            onclick: () => onDismiss(it.id),
          },
          Icon('x', { size: 16, sw: 2.4 })
        )
      : null
  );
}

function paceRow(icon, title, text) {
  return h(
    'div',
    { class: 'gb-insight-row' },
    h('span', { class: 'gb-insight-ic' }, Icon(icon, { size: 18, color: 'var(--brand)' })),
    h(
      'div',
      { style: { minWidth: 0 } },
      h('div', { class: 'gb-insight-title' }, title),
      // Body face, not mono: mono inside a sentence spaced out "₹2,60,388" and caught
      // the digits in a habit's own name ("Read 10 pages").
      h('div', { class: 'gb-insight-text' }, text)
    )
  );
}

export function OutlookCard({ outlook, onDismissInsight, onInsightAction }) {
  if (!outlook) return null;
  const { insight, savings, streak } = outlook;
  return [
    SectionTitle({ title: 'Outlook' }),
    Card({
      children: [
        insight
          ? InsightRow(insight, { onDismiss: onDismissInsight, onAction: onInsightAction })
          : null,
        savings ? paceRow('piggy-bank', 'Savings pace', savings.text) : null,
        streak ? paceRow('flame', 'Streak pace', streak.text) : null,
      ].filter(Boolean),
    }),
  ];
}
