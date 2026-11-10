import { h } from './gb-kit.js';

/* Words that read like a crisis. Checked on the user's own message before it is
   sent, on the device; the card it shows is never sent or saved. A false
   positive costs one card of phone numbers, a miss costs more, so it leans wide.
   Used by Buddy's chat and the mood check-in's note; no model, network or AI
   is involved. Its own module so the mood dialog needn't load the chat chunk. */
const CRISIS = new RegExp(
  '\\b(' +
    [
      'suicid\\w*',
      // "kms" anywhere, except as a distance: "ran 5 kms", "a few kms away".
      // Only a number or a quantity word excuses it: "thinking of kms" and
      // "in kms mode" must still show the card (a missed card is the costly way).
      '(?<!(\\d|\\b(few|many|several|per)) ?)kms',
      'unalive\\w*',
      '(kill|hurt|harm|cut)(s|ed|ing|ting)? ?my ?self',
      'self[- ]?harm\\w*',
      'take my (own )?life',
      'end(s|ed|ing)? (it all|my (own )?life)',
      // "want to die", "wanna die", "wanting to end it", "thinking about dying"
      '(want(s|ed|ing)? to|wanna|going to|gonna|ready to|plan(ning)? to|about to|trying to|thinking (of|about)) ' +
        '(die|dying|be dead|end(ing)? (it|things|everything|my life))',
      // "I don't want to live anymore", "dont want to be alive" (not "live in Pune")
      '(dont|do not|no longer|never) (want|wanna)( to)? (live(?! (in|with|at|near|there|here|on|like)\\b)|be alive|exist|be here anymore)',
      'wish i (was|were) dead',
      'wish i could die',
      'rather be dead',
      'better off dead',
      'better off without me',
      '(hope|wish) i (dont|never) wake up',
      'no (reason|point) (to|in) (live|living|go on|going on)',
      'nothing (left )?to live for',
      'cant go on',
    ].join('|') +
    ')\\b',
  'i'
);

export function crisisMatch(text) {
  // Apostrophes dropped first, so "don't" / "dont" / curly quotes read the same.
  return CRISIS.test(String(text || '').replace(/['\u2018\u2019`]/g, ''));
}

/** `tail` closes the card: Buddy adds that it is not a crisis service. */
export function crisisCard(tail = '') {
  return h(
    'div',
    { class: 'gb-msg-crisis', role: 'note' },
    h('strong', null, 'You deserve support right now.'),
    'If you are thinking about harming yourself, please reach out to someone who can help today. ' +
      'India: Tele-MANAS ',
    h('a', { href: 'tel:14416' }, '14416'),
    ' (24x7). US: ',
    h('a', { href: 'tel:988' }, '988'),
    '. Elsewhere: ',
    h(
      'a',
      { href: 'https://findahelpline.com', target: '_blank', rel: 'noopener noreferrer' },
      'findahelpline.com'
    ),
    '. In danger right now? Call your local emergency number.' + tail
  );
}
