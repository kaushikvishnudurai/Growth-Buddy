/* Run: node scripts/money-category.test.mjs

   predictCategory: what tag a new expense (typed, scanned, or said to Quick
   add) starts on. The user's own history first, so a tag they corrected
   becomes the next guess; then keywords, by whole word. */
import assert from 'node:assert/strict';
import { predictCategory, suggestCategory, mergedCats } from './money-core.js';

const cats = mergedCats({
  customCategories: [
    { key: 'groceries', label: 'Groceries' },
    { key: 'pets', label: 'Pet care' },
  ],
});

// Keywords, by whole word.
assert.equal(predictCategory('Swiggy dinner', [], cats), 'food');
assert.equal(predictCategory('Uber to office', [], cats), 'transport');
assert.equal(predictCategory('Netflix', [], cats), 'entertainment');
assert.equal(
  predictCategory('Dark chocolate', [], cats),
  'others',
  '"ola" inside chocolate is not a cab'
);
assert.equal(
  predictCategory('Movies with friends', [], cats),
  'entertainment',
  'plural of a keyword'
);
assert.equal(predictCategory('', [], cats), null);
assert.equal(predictCategory('   ', [], cats), null);
assert.equal(predictCategory('xyz 123', [], cats), 'others');

// A custom tag is found by its label.
assert.equal(predictCategory('groceries for the week', [], cats), 'groceries');
assert.equal(predictCategory('pet care visit', [], cats), 'pets');

// History beats keywords: they file milk under Groceries, so milk is Groceries.
const hist = [
  { note: 'Milk', category: 'groceries', date: '2026-10-01', createdAt: 1 },
  { note: 'Coffee', category: 'food', date: '2026-10-02', createdAt: 2 },
  { note: 'Coffee mug', category: 'shopping', date: '2026-10-03', createdAt: 3 },
  { note: 'Stuff', category: 'others', date: '2026-10-04', createdAt: 4 },
];
assert.equal(predictCategory('milk', hist, cats), 'groceries', 'same note, any case');
assert.equal(predictCategory('Milk and bread', hist, cats), 'groceries', 'shared word');
assert.equal(
  predictCategory('coffee', hist, cats),
  'food',
  'exact note beats a longer one sharing the word'
);
assert.equal(predictCategory('coffee mug', hist, cats), 'shopping', 'more shared words wins');
assert.equal(predictCategory('stuff', hist, cats), 'others', 'an exact Others is respected');
assert.equal(
  predictCategory('new stuff for kitchen', hist, cats),
  'others',
  'a partial Others is no signal'
);

// A correction teaches: the newest expense with that note carries what they changed it to.
const corrected = hist.concat({
  note: 'Coffee',
  category: 'groceries',
  date: '2026-10-05',
  createdAt: 5,
});
assert.equal(predictCategory('Coffee', corrected, cats), 'groceries', 'newest same-note wins');

// A tag that no longer exists is never guessed.
assert.equal(
  predictCategory('vet', [{ note: 'vet', category: 'gone', date: '2026-10-01' }], cats),
  'others'
);

// suggestCategory is the same thing over a money doc.
assert.equal(
  suggestCategory('milk', {
    expenses: hist,
    customCategories: [{ key: 'groceries', label: 'Groceries' }],
  }),
  'groceries'
);
assert.equal(suggestCategory('Lunch at cafe'), 'food');


console.log('money-category.test.mjs: ok');
