// tests/i18n-lite.test.mjs
//
// Coverage for shared/i18n-lite.js. No DOM library is used — documentRef
// and querySelectorAll() results are hand-rolled fakes, and localStorage
// is a plain object stub (plus a throwing variant for the private-mode
// case). This keeps the suite runnable under plain `node --test` with no
// dependencies, matching the module itself.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createI18n, interpolate, formatEntry } from '../shared/i18n-lite.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const strings = {
  en: {
    post: 'Post',
    minutesAgo: '{n}m ago',
    greet: 'Hello, {name}',
    layerCount: { one: '1 layer', other: '{n} layers' },
    titlePlaceholder: 'Title',
    favorite: 'Favorite',
    onlyInEn: 'only in en',
  },
  ja: {
    post: '投稿する',
    minutesAgo: '{n}分前',
    greet: 'こんにちは、{name}',
    layerCount: '{n} レイヤー',
    titlePlaceholder: 'タイトル',
    favorite: 'お気に入り',
  },
};

/** A localStorage-like stub backed by a plain object. */
function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
    store,
  };
}

/** Simulates a private-mode browser where storage access throws. */
function makeThrowingStorage() {
  return {
    getItem() {
      throw new Error('storage disabled');
    },
    setItem() {
      throw new Error('storage disabled');
    },
  };
}

/** A minimal element stub: attribute map + textContent, no DOM library. */
function makeEl(attrs) {
  return {
    attrs: { ...attrs },
    textContent: '',
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

/** A root/documentRef fake: querySelectorAll answers from fixed lists. */
function makeRoot({ i18nEls = [], attrEls = [] } = {}) {
  return {
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return i18nEls;
      if (selector === '[data-i18n-attr]') return attrEls;
      return [];
    },
  };
}

function makeDocumentRef(opts) {
  const root = makeRoot(opts);
  return { documentElement: { lang: '' }, querySelectorAll: root.querySelectorAll };
}

// ---------------------------------------------------------------------------
// interpolate
// ---------------------------------------------------------------------------

test('interpolate: replaces a single placeholder', () => {
  assert.equal(interpolate('Hello, {name}', { name: 'Ken' }), 'Hello, Ken');
});

test('interpolate: replaces multiple placeholders', () => {
  assert.equal(
    interpolate('{a} and {b}', { a: 'foo', b: 'bar' }),
    'foo and bar',
  );
});

test('interpolate: leaves unknown placeholders untouched', () => {
  assert.equal(interpolate('Hello, {name}', {}), 'Hello, {name}');
  assert.equal(interpolate('{a} and {b}', { a: 'foo' }), 'foo and {b}');
});

test('interpolate: stringifies non-string params (numbers)', () => {
  assert.equal(interpolate('{n}m ago', { n: 5 }), '5m ago');
  assert.equal(interpolate('{n}m ago', { n: 0 }), '0m ago');
});

// ---------------------------------------------------------------------------
// formatEntry
// ---------------------------------------------------------------------------

test('formatEntry: plain string is interpolated', () => {
  assert.equal(formatEntry('Hello, {name}', { name: 'Ken' }), 'Hello, Ken');
});

test('formatEntry: plural entry picks "one" when n === 1', () => {
  const entry = { one: '1 layer', other: '{n} layers' };
  assert.equal(formatEntry(entry, { n: 1 }), '1 layer');
});

test('formatEntry: plural entry picks "other" for any n !== 1', () => {
  const entry = { one: '1 layer', other: '{n} layers' };
  assert.equal(formatEntry(entry, { n: 2 }), '2 layers');
  assert.equal(formatEntry(entry, { n: 0 }), '0 layers');
  assert.equal(formatEntry(entry, {}), '{n} layers');
});

test('formatEntry: the selected plural branch is interpolated', () => {
  const entry = { one: '{n} layer (single)', other: '{n} layers' };
  assert.equal(formatEntry(entry, { n: 1 }), '1 layer (single)');
});

// ---------------------------------------------------------------------------
// t()
// ---------------------------------------------------------------------------

test('t: looks up the key in the current language table', () => {
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'ja' }) });
  assert.equal(i18n.t('post'), '投稿する');
});

test('t: falls back to defaultLang when the key is missing in the current lang', () => {
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'ja' }) });
  // 'onlyInEn' has no ja entry.
  assert.equal(i18n.t('onlyInEn'), 'only in en');
});

test('t: returns the key itself when missing in every table', () => {
  const i18n = createI18n({ strings, storage: makeStorage() });
  assert.equal(i18n.t('does.not.exist'), 'does.not.exist');
});

test('t: passes params through to interpolation', () => {
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'en' }) });
  assert.equal(i18n.t('greet', { name: 'Ken' }), 'Hello, Ken');
  assert.equal(i18n.t('minutesAgo', { n: 3 }), '3m ago');
});

// ---------------------------------------------------------------------------
// Initial language resolution
// ---------------------------------------------------------------------------

test('init: a valid stored value wins over legacy keys and navigatorLanguage', () => {
  const i18n = createI18n({
    strings,
    storage: makeStorage({ 'chunk-lang': 'ja' }),
    legacyKeys: ['old-lang'],
    navigatorLanguage: 'en-US',
  });
  assert.equal(i18n.getLang(), 'ja');
});

test('init: an invalid stored value is ignored and resolution continues', () => {
  const storage = makeStorage({ 'chunk-lang': 'fr', 'old-lang': 'ja' });
  const i18n = createI18n({ strings, storage, legacyKeys: ['old-lang'] });
  assert.equal(i18n.getLang(), 'ja');
});

test('init: legacy key migration seeds and persists the new key without touching the legacy one', () => {
  const storage = makeStorage({ 'old-lang-1': 'xx', 'old-lang-2': 'ja' });
  const i18n = createI18n({ strings, storage, legacyKeys: ['old-lang-1', 'old-lang-2'] });

  assert.equal(i18n.getLang(), 'ja');
  assert.equal(storage.store['chunk-lang'], 'ja'); // seeded
  assert.equal(storage.store['old-lang-2'], 'ja'); // legacy value untouched
  assert.equal('old-lang-1' in storage.store, true);
  assert.equal(storage.store['old-lang-1'], 'xx'); // legacy value untouched, not deleted
});

test('init: navigatorLanguage prefix match, e.g. "ja-JP" -> "ja"', () => {
  const i18n = createI18n({ strings, storage: makeStorage(), navigatorLanguage: 'ja-JP' });
  assert.equal(i18n.getLang(), 'ja');
});

test('init: falls back to defaultLang when nothing else resolves', () => {
  const i18n = createI18n({ strings, storage: makeStorage(), navigatorLanguage: 'fr-FR' });
  assert.equal(i18n.getLang(), 'en');
});

// ---------------------------------------------------------------------------
// setLang
// ---------------------------------------------------------------------------

test('setLang: persists the new value to storage', () => {
  const storage = makeStorage();
  const i18n = createI18n({ strings, storage });
  i18n.setLang('ja');
  assert.equal(storage.store['chunk-lang'], 'ja');
});

test('setLang: updates documentRef.documentElement.lang', () => {
  const documentRef = makeDocumentRef();
  const i18n = createI18n({ strings, storage: makeStorage(), documentRef });
  i18n.setLang('ja');
  assert.equal(documentRef.documentElement.lang, 'ja');
});

test('setLang: fires onChange listeners with the new lang', () => {
  const i18n = createI18n({ strings, storage: makeStorage() });
  const seen = [];
  i18n.onChange((lang) => seen.push(lang));
  i18n.setLang('ja');
  assert.deepEqual(seen, ['ja']);
});

test('setLang: an invalid lang falls back to defaultLang', () => {
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'ja' }) });
  const result = i18n.setLang('xx');
  assert.equal(result, 'en');
  assert.equal(i18n.getLang(), 'en');
});

test('setLang: a throwing storage does not throw outward', () => {
  const i18n = createI18n({ strings, storage: makeThrowingStorage() });
  assert.doesNotThrow(() => i18n.setLang('ja'));
  assert.equal(i18n.getLang(), 'ja');
});

// ---------------------------------------------------------------------------
// toggle
// ---------------------------------------------------------------------------

test('toggle: cycles en -> ja -> en with two langs', () => {
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'en' }) });
  assert.equal(i18n.toggle(), 'ja');
  assert.equal(i18n.toggle(), 'en');
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

test('apply: sets textContent from data-i18n', () => {
  const postEl = makeEl({ 'data-i18n': 'post' });
  const root = makeRoot({ i18nEls: [postEl] });
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'en' }) });

  i18n.apply(root);

  assert.equal(postEl.textContent, 'Post');
});

test('apply: parses a comma-separated data-i18n-attr list into setAttribute calls', () => {
  const el = makeEl({ 'data-i18n-attr': 'placeholder:titlePlaceholder, aria-label:favorite' });
  const root = makeRoot({ attrEls: [el] });
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'ja' }) });

  i18n.apply(root);

  assert.equal(el.attrs.placeholder, 'タイトル');
  assert.equal(el.attrs['aria-label'], 'お気に入り');
});

test('apply: is a no-op with no root and no documentRef', () => {
  const i18n = createI18n({ strings, storage: makeStorage() });
  assert.doesNotThrow(() => i18n.apply());
});

// ---------------------------------------------------------------------------
// onChange
// ---------------------------------------------------------------------------

test('onChange: the returned unsubscribe function stops further notifications', () => {
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'en' }) });
  const seen = [];
  const unsubscribe = i18n.onChange((lang) => seen.push(lang));

  i18n.setLang('ja');
  unsubscribe();
  i18n.setLang('en');

  assert.deepEqual(seen, ['ja']);
});

test('onChange: one listener throwing does not prevent others from running', () => {
  const i18n = createI18n({ strings, storage: makeStorage({ 'chunk-lang': 'en' }) });
  const seen = [];
  i18n.onChange(() => {
    throw new Error('listener boom');
  });
  i18n.onChange((lang) => seen.push(lang));

  assert.doesNotThrow(() => i18n.setLang('ja'));
  assert.deepEqual(seen, ['ja']);
});
