// i18n-lite v1.0.0
//
// Dependency-free EN/JA UI language switcher shared across CHUNK's static,
// build-step-free tools (chunk-portal, Neiro, single-file HTML tools). The
// canonical copy lives in chunk-portal/shared/i18n-lite.js — other repos
// vendor (copy) it in; bump the version comment above on any change so
// vendored copies can be diffed against the source.
//
// Works in both browsers and Node: nothing here touches document,
// localStorage, or navigator at module load time. createI18n() accepts
// injectable stand-ins (storage, documentRef, navigatorLanguage) so it can
// be unit-tested with plain fakes, falling back to the real globals only
// when they exist (checked via typeof, never assumed present).

/**
 * Replace {name} placeholders in `template` with values from `params`.
 * A placeholder with no matching param (or an undefined/null value) is
 * left untouched rather than rendered as "undefined".
 */
export function interpolate(template, params = {}) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Resolve one dictionary entry (plain string, or a {one, other} plural
 * pair) into a display string. Plural selection is the minimal EN/JA rule:
 * params.n === 1 picks "one", anything else (including a missing n) picks
 * "other".
 */
export function formatEntry(entry, params = {}) {
  if (entry && typeof entry === 'object') {
    const selected = params.n === 1 ? entry.one : entry.other;
    return interpolate(selected, params);
  }
  return interpolate(entry, params);
}

// Reads a global by name without ever assuming it exists — required so this
// module loads cleanly in Node, where document/localStorage are absent.
const hasGlobal = (name) => typeof globalThis[name] !== 'undefined';

/**
 * Create an i18n instance bound to a strings dictionary. `strings` is
 * required; everything else (langs, defaultLang, storageKey, legacyKeys,
 * and the storage/documentRef/navigatorLanguage injectables) is optional
 * and falls back to real globals or sensible defaults — see module header.
 */
export function createI18n(options) {
  const {
    strings,
    langs = Object.keys(strings),
    defaultLang = 'en',
    storageKey = 'chunk-lang',
    legacyKeys = [],
    storage = hasGlobal('localStorage') ? globalThis.localStorage : undefined,
    documentRef = hasGlobal('document') ? globalThis.document : undefined,
    navigatorLanguage = hasGlobal('navigator') ? globalThis.navigator.language : undefined,
  } = options;

  const isValidLang = (lang) => typeof lang === 'string' && langs.includes(lang);

  // Storage access is wrapped everywhere: private-mode browsers can throw
  // on getItem/setItem, not just when the quota is exceeded.
  const readStorage = (key) => {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  };
  const writeStorage = (key, value) => {
    try {
      if (storage) storage.setItem(key, value);
    } catch {
      // ignore — disabled/private storage must never break the app
    }
  };

  function resolveInitialLang() {
    const stored = readStorage(storageKey);
    if (isValidLang(stored)) return stored;
    for (const legacyKey of legacyKeys) {
      const legacyValue = readStorage(legacyKey);
      if (isValidLang(legacyValue)) {
        // One-time migration: seed the new key, never touch the legacy one.
        writeStorage(storageKey, legacyValue);
        return legacyValue;
      }
    }
    if (typeof navigatorLanguage === 'string') {
      const prefix = navigatorLanguage.split('-')[0];
      if (isValidLang(prefix)) return prefix;
    }
    return defaultLang;
  }

  let currentLang = resolveInitialLang();
  const listeners = new Set();

  if (documentRef) {
    documentRef.documentElement.lang = currentLang;
  }

  function t(key, params) {
    const table = strings[currentLang] || {};
    const fallbackTable = strings[defaultLang] || {};
    const entry = key in table ? table[key] : key in fallbackTable ? fallbackTable[key] : key;
    return formatEntry(entry, params);
  }

  function apply(root = documentRef) {
    if (!root) return;

    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }

    for (const el of root.querySelectorAll('[data-i18n-attr]')) {
      const spec = el.getAttribute('data-i18n-attr') || '';
      for (const pair of spec.split(',')) {
        const [attrName, key] = pair.split(':').map((part) => part.trim());
        if (attrName && key) el.setAttribute(attrName, t(key));
      }
    }
  }

  function setLang(lang) {
    currentLang = isValidLang(lang) ? lang : defaultLang;
    writeStorage(storageKey, currentLang);

    if (documentRef) {
      documentRef.documentElement.lang = currentLang;
      apply(documentRef);
    }

    for (const fn of listeners) {
      try {
        fn(currentLang);
      } catch {
        // one bad listener must not block the rest
      }
    }

    return currentLang;
  }

  function toggle() {
    const index = langs.indexOf(currentLang);
    const next = langs[(index + 1) % langs.length];
    return setLang(next);
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    getLang: () => currentLang,
    t,
    setLang,
    toggle,
    apply,
    onChange,
  };
}
