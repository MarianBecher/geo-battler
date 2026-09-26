// Translations for everything the player reads.
//
// The dictionaries are flat objects keyed by dotted paths ('lobby.ready');
// English is the reference and its keys are the type every other language
// has to satisfy, so a missing translation is a compile error. A value is a
// string with {placeholders} or, for plurals, { one, other } chosen by the
// `n` parameter.
//
// The language is picked once at load time: the stored choice first, then
// the browser language. Switching reloads the page, which is the simplest
// way to get every screen consistent - the session survives a reload anyway.

import { en } from './en.ts';
import { de } from './de.ts';
import type { Message } from './types.ts';

export type { Message };
export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, Message>;
export type Params = Record<string, string | number | undefined>;

export const LANGUAGES = [
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const DICTS: Record<LanguageCode, Dictionary> = { en, de };
const STORE_KEY = 'geo-battle-lang';

const isLanguage = (value: unknown): value is LanguageCode => LANGUAGES.some((l) => l.code === value);

function detect(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORE_KEY);
    if (isLanguage(stored)) return stored;
  } catch { /* private mode - fall through to the browser language */ }
  const wanted = (navigator.languages.length ? navigator.languages : [navigator.language]).map((l) => l.slice(0, 2).toLowerCase());
  return wanted.find(isLanguage) ?? 'en';
}

let current: LanguageCode = detect();
document.documentElement.lang = current;

/** The active language code. */
export const lang = (): LanguageCode => current;

/** The BCP 47 locale for number and date formatting. */
export const locale = (): string => LANGUAGES.find((l) => l.code === current)?.locale ?? 'en-US';

/** Remember the choice and reload - see the note at the top. */
export function setLang(code: LanguageCode): void {
  if (code === current) return;
  try { localStorage.setItem(STORE_KEY, code); } catch { /* the reload still applies it for this visit */ }
  current = code;
  location.reload();
}

function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Translate `key`. Placeholders come from `params`; a plural entry picks its
 * form from `params.n`.
 */
export function t(key: MessageKey, params: Params = {}): string {
  const entry = DICTS[current][key];
  if (typeof entry === 'string') return format(entry, params);
  const n = Number(params.n);
  return format(n === 1 ? entry.one : entry.other, params);
}

/** Number in the active locale ("1,234" / "1.234"). */
export const fmtNum = (n: number, options?: Intl.NumberFormatOptions): string => n.toLocaleString(locale(), options);

/** Short numeric date in the active locale (09/26/26 / 26.09.26). */
export const fmtDate = (date: Date | string | number): string =>
  new Date(date).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit' });

const regionNames = ((): Intl.DisplayNames | null => {
  try { return new Intl.DisplayNames([current], { type: 'region' }); } catch { return null; }
})();

/** Country name for an ISO code, in the active language. */
export function countryName(code: string): string {
  try { return regionNames?.of(code) ?? code; } catch { return code; }
}

/**
 * Fill static markup: every element with data-i18n gets its text, and
 * data-i18n-title / -placeholder / -aria-label / -html set that attribute
 * (or innerHTML, for entries that carry entities or tags).
 */
export function translateDom(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder as MessageKey));
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel as MessageKey));
}
