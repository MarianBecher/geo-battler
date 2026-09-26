// The passport on the home screen: closed, only the cover lies there; when
// it opens, the cover swings to the left and reveals the inside cover and
// the data page.

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

/** How long the cover turns - must match --turn in style.css. */
const TURN_MS = 900;

/** Read layout, so the browser applies the classes set so far before the next ones. */
const reflow = (el: HTMLElement): void => { el.getBoundingClientRect(); };

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

let settleTimer: ReturnType<typeof setTimeout> | undefined;

// While the cover is closed, the pages beneath cannot be reached - neither
// with the mouse nor with the tab key.
function setInert(closed: boolean): void {
  $('home-card').inert = closed;
  $('pp-inner').inert = closed;
}

export function initPassport(): void {
  setInert(!isOpen());
}

export function isOpen(): boolean {
  return $('passport').classList.contains('open');
}

export interface OpenOptions {
  /** false when the passport is expected open already (back from the lobby, failed rejoin). */
  animate?: boolean;
  /** Receives focus - right away, so a key press that opened the passport already lands in the field. */
  focus?: HTMLElement | null;
}

/** Open the passport. */
export function openPassport({ animate = true, focus = null }: OpenOptions = {}): void {
  const pass = $('passport');
  if (isOpen()) return;
  const instant = !animate || reducedMotion();

  clearTimeout(settleTimer);
  pass.classList.toggle('instant', instant);
  pass.classList.add('open');
  setInert(false);
  focus?.focus({ preventScroll: true });

  const settle = (): void => { pass.classList.add('settled'); };
  if (instant) {
    settle();
    reflow(pass);
    pass.classList.remove('instant');
  } else {
    settleTimer = setTimeout(settle, TURN_MS);
  }
}

// ---------------------------------------------------------------- Lobby
//
// The way into the lobby: the entry stamp lands on the data page, then the
// passport grows to the size of the lobby spread and the data page turns
// over to the left - beneath it lie the travel conditions.
//
// The lobby is a screen of its own with its own layout, so the growing
// passport really is the lobby already: its spread starts exactly over the
// passport and gets two blank sheets laid over it that look like the
// passport without content. The right one turns over, then both fade out.
// On a phone there is no spread - there the passport swings away and the
// lobby moves up.

const narrow = (): boolean => matchMedia('(max-width: 760px)').matches;
const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const STAMP_MS = 700; // press the stamp and let it lie for a moment
const BLANK_MS = 220; // page contents fade out
const GROW_MS = 680; // .spread.growing
const FADE_MS = 320; // the sheets fade out

let busy = false;

/** Is a transition running? Then nobody else switches the screen. */
export function turning(): boolean {
  return busy;
}

interface Sheets {
  leaf: HTMLElement;
  fade(out: boolean): void;
  turn(over: boolean): Promise<void>;
  remove(): void;
}

/** The two blank sheets over the lobby spread. */
function coverSheets(spread: HTMLElement): Sheets {
  const under = document.createElement('div');
  under.className = 'turn-under';
  const leaf = document.createElement('div');
  leaf.className = 'turn-leaf';
  leaf.innerHTML = '<div class="turn-face front paper"></div><div class="turn-face back"></div>';
  spread.append(under, leaf);
  return {
    leaf,
    fade(out) { for (const el of [under, leaf]) el.classList.toggle('gone', out); },
    async turn(over) {
      leaf.classList.add('turning');
      leaf.classList.toggle('turned', over);
      await wait(TURN_MS + 20);
      leaf.classList.remove('turning');
    },
    remove() { under.remove(); leaf.remove(); },
  };
}

/** The transform that lays `el` from its place exactly onto the rectangle `to`. */
function mapOnto(el: HTMLElement, to: DOMRect): string {
  const from = el.getBoundingClientRect();
  return `translate(${to.left - from.left}px, ${to.top - from.top}px) `
    + `scale(${to.width / from.width}, ${to.height / from.height})`;
}

function resetSpread(spread: HTMLElement): void {
  spread.classList.remove('growing');
  spread.style.transform = '';
  spread.style.transformOrigin = '';
  spread.style.opacity = '';
}

/** The rows glide in and the room code gets stamped - once. */
function arrive(spread: HTMLElement): void {
  spread.classList.add('arrive');
  setTimeout(() => { spread.classList.remove('arrive'); }, 900);
}

/**
 * From the passport into the lobby. `showLobby` switches the screen -
 * called exactly when the lobby takes over from the passport.
 */
export async function turnIntoLobby(code: string, showLobby: () => void): Promise<void> {
  if (busy || reducedMotion()) {
    showLobby();
    return;
  }
  busy = true;
  const pass = $('passport');
  const home = $('screen-home');
  const lobby = $('screen-lobby');
  const spread = $('lobby-spread');
  try {
    $('home-stamp-sub').textContent = `${$('home-issued').textContent} · ${code}`;
    $('home-stamp').classList.add('on');
    await wait(STAMP_MS);

    if (narrow()) {
      pass.classList.add('away');
      await wait(560);
      showLobby();
      lobby.classList.add('arriving');
      spread.style.transform = 'translateY(28px)';
      spread.style.opacity = '0';
      reflow(spread);
      spread.classList.add('growing');
      spread.style.transform = '';
      spread.style.opacity = '';
      await wait(GROW_MS);
      lobby.classList.remove('arriving');
      arrive(spread);
      return;
    }

    pass.classList.add('blank');
    await wait(BLANK_MS);
    const from = pass.getBoundingClientRect();

    // The home screen stays beneath the lobby and fades out while the
    // spread grows from the passport to its full size.
    home.classList.add('held');
    showLobby();
    pass.classList.add('ghost');
    lobby.classList.add('arriving');
    lobby.scrollTop = 0;
    const sheets = coverSheets(spread);
    spread.style.transformOrigin = '0 0';
    spread.style.transform = mapOnto(spread, from);
    reflow(spread);
    spread.classList.add('growing');
    spread.style.transform = '';
    home.classList.add('faded');
    await wait(GROW_MS);
    spread.classList.remove('growing');

    await sheets.turn(true);
    lobby.classList.remove('arriving');
    sheets.fade(true);
    arrive(spread);
    await wait(FADE_MS);
    sheets.remove();
  } finally {
    // Clean up even if another screen took over in between.
    home.classList.remove('held', 'faded');
    lobby.classList.remove('arriving');
    resetSpread(spread);
    pass.classList.add('instant');
    pass.classList.remove('blank', 'ghost', 'away');
    $('home-stamp').classList.remove('on');
    reflow(pass);
    pass.classList.remove('instant');
    busy = false;
  }
}

/** From the lobby back onto the passport - the same way in reverse. */
export async function turnBackHome(showHome: () => void): Promise<void> {
  if (busy || reducedMotion()) {
    showHome();
    return;
  }
  busy = true;
  const pass = $('passport');
  const home = $('screen-home');
  const lobby = $('screen-lobby');
  const spread = $('lobby-spread');
  let sheets: Sheets | null = null;
  try {
    lobby.classList.add('arriving');

    if (narrow()) {
      spread.classList.add('growing');
      spread.style.transform = 'translateY(28px)';
      spread.style.opacity = '0';
      await wait(420);
      pass.classList.add('instant', 'away');
      showHome();
      reflow(pass);
      pass.classList.remove('instant', 'away');
      await wait(600);
      return;
    }

    // The sheets lay themselves over the lobby again and the right one
    // turns back. Then the spread shrinks onto the passport.
    sheets = coverSheets(spread);
    sheets.leaf.classList.add('turned');
    sheets.fade(true);
    reflow(spread);
    sheets.fade(false);
    await wait(FADE_MS);
    await sheets.turn(false);

    pass.classList.add('blank', 'ghost');
    home.classList.add('faded');
    lobby.classList.add('held');
    showHome();
    const to = pass.getBoundingClientRect();
    spread.style.transformOrigin = '0 0';
    spread.classList.add('growing');
    spread.style.transform = mapOnto(spread, to);
    home.classList.remove('faded');
    await wait(GROW_MS);

    pass.classList.remove('ghost');
    lobby.classList.remove('held');
    pass.classList.remove('blank');
  } finally {
    sheets?.remove();
    home.classList.remove('faded');
    lobby.classList.remove('held', 'arriving');
    resetSpread(spread);
    pass.classList.remove('blank', 'ghost');
    busy = false;
  }
}
