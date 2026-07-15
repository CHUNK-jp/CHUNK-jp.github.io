# shared/

Modules meant to be **vendored** (copied) into other CHUNK static-site
repos — Neiro, single-file HTML tools, and any other build-step-free
GitHub Pages project that needs the same small piece of behavior.

This directory (`chunk-portal/shared/`) is the **canonical source**. If
you need one of these files in another repo, copy it in verbatim rather
than reimplementing it or importing across repos (these are separate
static sites with no shared build/package step).

## Vendoring rule

- Copy the file byte-for-byte into the consuming repo (e.g.
  `shared/i18n-lite.js` -> `some-other-repo/shared/i18n-lite.js` or
  wherever that repo keeps its vendored deps).
- When you change a file here, bump the version comment at the top of
  the file (e.g. `i18n-lite v1.0.0` -> `v1.1.0`) so consuming repos can
  diff their vendored copy against this one and tell whether they're
  stale.
- Do not fork the file per-repo. If a repo needs different behavior,
  add an option/injectable rather than editing the vendored copy.

## i18n-lite.js

Dependency-free EN/JA UI language switcher. Works in browsers and Node
(no top-level DOM/storage access — everything is passed in or read lazily
inside `createI18n()`).

```js
import { createI18n } from './shared/i18n-lite.js';

const i18n = createI18n({
  strings: {
    en: { post: 'Post', minutesAgo: '{n}m ago' },
    ja: { post: '投稿する', minutesAgo: '{n}分前' },
  },
});

i18n.t('minutesAgo', { n: 5 }); // "5m ago" or "5分前"
i18n.apply();                   // fills [data-i18n] / [data-i18n-attr] on the page
i18n.toggle();                  // switch language, persists + re-applies
```
