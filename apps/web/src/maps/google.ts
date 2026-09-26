// Everything that talks to the Google Maps JS API directly.
//
// The map pins still use google.maps.Marker. Its successor, the
// AdvancedMarkerElement, needs a cloud map id - and a map with a map id
// ignores the JSON `styles` the passport look is built from. So the old
// marker stays, behind one helper that carries the deprecation note.

import type { LatLng, PinSnapshot, PlayedRound, RoundResult, Settings, Telemetry } from '@geo-battler/shared';
import { fmtNum, t } from '../i18n/index.ts';

declare global {
  interface Window {
    __geoBattleMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let loadPromise: Promise<typeof google.maps> | null = null;

/** Load the Maps API once; later calls get the same promise. */
export function loadMaps(apiKey: string): Promise<typeof google.maps> {
  loadPromise ??= new Promise((resolve, reject) => {
    window.__geoBattleMapsReady = () => {
      delete window.__geoBattleMapsReady;
      resolve(google.maps);
    };
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js'
      + `?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=__geoBattleMapsReady`;
    script.async = true;
    script.onerror = () => { reject(new Error(t('maps.loadFailed'))); };
    document.head.appendChild(script);
  });
  return loadPromise;
}

/** Called by the Maps API when the key is invalid or not authorised. */
export function onAuthFailure(handler: () => void): void {
  window.gm_authFailure = handler;
}

// --- Markers -------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-deprecated -- see the note at the top
type Marker = google.maps.Marker;

// eslint-disable-next-line @typescript-eslint/no-deprecated -- see the note at the top
function marker(options: google.maps.MarkerOptions): Marker {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see the note at the top
  return new google.maps.Marker(options);
}

function svgIcon(svg: string, w: number, h: number, anchorX: number, anchorY: number): google.maps.Icon {
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(anchorX, anchorY),
  };
}

function pinIcon(color: string): google.maps.Icon {
  const icon = svgIcon(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
       <path d="M13 0C5.8 0 0 5.8 0 13c0 9.1 13 23 13 23s13-13.9 13-23C26 5.8 20.2 0 13 0z"
             fill="${color}" stroke="#1f2d4d" stroke-width="1.6"/>
       <circle cx="13" cy="13" r="4.4" fill="#1f2d4d" opacity=".8"/>
     </svg>`,
    26, 36, 13, 36,
  );
  // A name on the pin (spectator map) sits below the tip.
  icon.labelOrigin = new google.maps.Point(13, 44);
  return icon;
}

/** Pin with a crown - worn by whoever is in the lead right now. */
function crownedPinIcon(color: string): google.maps.Icon {
  return svgIcon(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="52" viewBox="0 0 34 52">
       <defs>
         <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="#ffefbe"/>
           <stop offset=".5" stop-color="#ffc63b"/>
           <stop offset="1" stop-color="#d9900d"/>
         </linearGradient>
       </defs>
       <g transform="translate(4,16)">
         <path d="M13 0C5.8 0 0 5.8 0 13c0 9.1 13 23 13 23s13-13.9 13-23C26 5.8 20.2 0 13 0z"
               fill="${color}" stroke="#1f2d4d" stroke-width="1.6"/>
         <circle cx="13" cy="13" r="4.4" fill="#1f2d4d" opacity=".8"/>
       </g>
       <!-- set on slightly askew -->
       <g transform="translate(3.2,2.4) rotate(-16 11 9)">
         <path d="M0 3.4 2.6 13 h16.8 L22 3.4 16.4 7.6 11 .6 5.6 7.6 Z"
               fill="url(#gold)" stroke="#6b4a05" stroke-width="1.3" stroke-linejoin="round"/>
         <rect x="1.4" y="12" width="19.2" height="4.2" rx="1.6"
               fill="url(#gold)" stroke="#6b4a05" stroke-width="1.3"/>
         <circle cx="11" cy=".8" r="1.7" fill="#fff6dd" stroke="#6b4a05" stroke-width="1"/>
         <circle cx=".4" cy="3.6" r="1.5" fill="#fff6dd" stroke="#6b4a05" stroke-width="1"/>
         <circle cx="21.6" cy="3.6" r="1.5" fill="#fff6dd" stroke="#6b4a05" stroke-width="1"/>
         <circle cx="11" cy="14.1" r="1.5" fill="#b8323a" stroke="#6b4a05" stroke-width="1"/>
       </g>
     </svg>`,
    34, 52, 17, 52,
  );
}

/** The target in the passport's colours: cover blue, paper, stamp red. */
function targetIcon(): google.maps.Icon {
  return svgIcon(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
       <circle cx="17" cy="17" r="15" fill="#1c2a48" opacity=".7"/>
       <circle cx="17" cy="17" r="11" fill="none" stroke="#e8efe7" stroke-width="2.5"/>
       <circle cx="17" cy="17" r="4.5" fill="#e24b4b"/>
     </svg>`,
    34, 34, 17, 17,
  );
}

/** Target marker with the round number - for the map in the final standings. */
function roundTargetIcon(label: number): google.maps.Icon {
  return svgIcon(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
       <circle cx="14" cy="14" r="12" fill="#1c2a48" stroke="#e8efe7" stroke-width="2"/>
       <text x="14" y="18.6" text-anchor="middle" fill="#e8efe7"
             font-family="Karla, system-ui, sans-serif" font-size="13" font-weight="700">${label}</text>
     </svg>`,
    28, 28, 14, 14,
  );
}

/** Guess marker for the overview - smaller than the pin, or it gets crowded. */
function dotIcon(color: string): google.maps.Icon {
  return svgIcon(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
       <circle cx="8" cy="8" r="6" fill="${color}" stroke="#1f2d4d" stroke-width="2"/>
     </svg>`,
    16, 16, 8, 8,
  );
}

// The map is printed like a passport page: desert, forest and ice stay
// distinguishable, only quieter and pulled a touch into the paper. Water in
// passport blue, lettering in ink. The colours come from style.css.
const PASSPORT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { saturation: -35 }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ saturation: -30 }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e4e8df' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#98b4cc' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d5775' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#98b4cc' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#1f2d4d' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#eef3ed' }, { weight: 3 }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#6f7f99' }, { weight: 0.7 }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#1f2d4d' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#8f9cb0' }, { weight: 0.5 }] },
  { featureType: 'administrative.province', elementType: 'labels.text.fill', stylers: [{ color: '#55627d' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#2e3d5f' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#fbfcf8' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#cfd6c9' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f1dc9a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d2b566' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#55627d' }] },
];

const WORLD_CENTER: LatLng = { lat: 20, lng: 5 };
const WORLD_ZOOM = 1;

const WORLD_MAP_OPTIONS: google.maps.MapOptions = {
  center: WORLD_CENTER,
  zoom: WORLD_ZOOM,
  minZoom: 1,
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  gestureHandling: 'greedy',
  keyboardShortcuts: false,
  backgroundColor: '#98b4cc',
  styles: PASSPORT_MAP_STYLE,
};

/** Fit the map to what it shows, but never closer than zoom 8. */
function fitCapped(map: google.maps.Map, bounds: google.maps.LatLngBounds, padding: number): void {
  map.fitBounds(bounds, padding);
  // A single point would zoom in down to the house number.
  google.maps.event.addListenerOnce(map, 'idle', () => {
    if ((map.getZoom() ?? 0) > 8) map.setZoom(8);
  });
}

// --- Telemetry -----------------------------------------------------------
//
// Pure observation for the titles in the final standings - none of it
// affects the game. The client sends the numbers to the server during the
// round.

export type PanoTelemetry = Pick<Telemetry, 'panoSteps' | 'panoReturns' | 'panDeg' | 'zoomMax' | 'zoomEvents'>;
export type MapTelemetry = Pick<Telemetry, 'mapZoomMax' | 'mapClicks'>;

const emptyPanoTelemetry = (): PanoTelemetry => ({ panoSteps: 0, panoReturns: 0, panDeg: 0, zoomMax: 0, zoomEvents: 0 });
const emptyMapTelemetry = (): MapTelemetry => ({ mapZoomMax: 0, mapClicks: 0 });

// --- Panorama ------------------------------------------------------------

/** The restrictions a round can carry; missing means allowed. */
export type PanoSettings = Partial<Pick<Settings, 'noMove' | 'noPan' | 'noZoom'>>;

// How long we wait for the first image before rebuilding the panorama.
const PANO_TIMEOUT_MS = 6000;
// After that it is no longer a display problem but the place or the network.
const PANO_MAX_REBUILDS = 2;

type Pano = google.maps.StreetViewPanorama;

export class PanoView {
  private pano: Pano | null = null;
  private listeners: google.maps.MapsEventListener[] = [];
  /** The last show() - what a rebuild starts from. */
  private current: { panoId: string; settings: PanoSettings } | null = null;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private rebuilds = 0;
  private jumpingHome = false;
  /** Play behaviour, see trackTelemetry(). */
  tele: PanoTelemetry = emptyPanoTelemetry();

  /** `lockEl` is optional - in the final standings there is nothing to lock. */
  constructor(private readonly el: HTMLElement, private readonly lockEl: HTMLElement | null = null) {
    // When the browser loses the WebGL context (GPU reset, tab in the
    // background for long, graphics driver), the panorama simply stays black
    // - the Maps API reports nothing. The event arrives at the canvas and does
    // not bubble, so we listen in the capture phase.
    el.addEventListener('webglcontextlost', () => { this.rebuild('WebGL context lost'); }, true);

    // A tab that was in the background when the round started has often
    // measured a wrong size - measure again on return.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refresh();
    });
  }

  show(panoId: string, settings: PanoSettings = {}): void {
    this.clearListeners();
    if (this.current?.panoId !== panoId) this.rebuilds = 0; // a new round
    this.current = { panoId, settings };
    this.jumpingHome = false;

    const noMove = settings.noMove ?? false;
    const noPan = settings.noPan ?? false;
    const noZoom = settings.noZoom ?? false;
    const options: google.maps.StreetViewPanoramaOptions = {
      pano: panoId,
      addressControl: false,
      showRoadLabels: false,
      fullscreenControl: false,
      imageDateControl: false,
      enableCloseButton: false,
      motionTracking: false,
      motionTrackingControl: false,
      linksControl: !noMove,
      clickToGo: !noMove,
      panControl: !noPan,
      zoomControl: !noZoom,
      scrollwheel: !noZoom,
      disableDoubleClickZoom: noMove || noZoom,
    };

    let pano = this.pano;
    if (!pano) {
      pano = new google.maps.StreetViewPanorama(this.el, options);
      this.pano = pano;
    } else {
      pano.setOptions(options);
      pano.setPano(panoId);
    }

    // Before applyGuards: the guards should take the fresh view as their base.
    this.resetView(pano);
    this.watchForBlackScreen(pano);
    this.trackTelemetry(pano, panoId, settings);

    // No Pan blocks mouse and touch entirely; the pov guard catches the keyboard.
    if (this.lockEl) this.lockEl.hidden = !noPan;

    this.applyGuards(pano, panoId, settings);
  }

  /**
   * Every round starts the same: fully zoomed out, looking at the horizon in
   * the direction the photo was taken. Without this the reused panorama
   * instance drags along the zoom and heading of the last round.
   */
  private resetView(pano: Pano): void {
    const apply = (): void => {
      // Before the metadata has arrived this can come back empty.
      const shot = pano.getPhotographerPov() as google.maps.StreetViewPov | undefined;
      pano.setPov({ heading: shot?.heading ?? pano.getPov().heading, pitch: 0 });
      pano.setZoom(0);
    };
    // Right away, so the old zoom level never flashes up - and once more on
    // 'position_changed': only then does getPhotographerPov() describe the
    // new image. ('pano_changed' is useless here, it fires before the metadata.)
    apply();
    this.once(pano, 'position_changed', apply);
  }

  /**
   * Catch a black panorama without anyone having to reload the page: if the
   * image does not come up or the API reports a bad status, we rebuild the
   * panorama.
   */
  private watchForBlackScreen(pano: Pano): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => { this.rebuild('panorama did not come up'); }, PANO_TIMEOUT_MS);

    // The image is there - all clear.
    this.once(pano, 'position_changed', () => {
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
      this.rebuilds = 0;
    });

    this.on(pano, 'status_changed', () => {
      const status = pano.getStatus();
      if (status === 'OK') return;
      this.rebuild(`status ${status}`);
    });
  }

  /**
   * Count what the player does in the panorama - the basis for the titles
   * in the final standings. Locked freedoms are not counted, or the
   * corrections of the guards would inflate the numbers.
   */
  private trackTelemetry(pano: Pano, panoId: string, settings: PanoSettings): void {
    this.tele = emptyPanoTelemetry();
    const tele = this.tele;

    if (!settings.noMove) {
      let lastPano = panoId;
      let away = false; // walked away from the start panorama yet?
      this.on(pano, 'pano_changed', () => {
        const id = pano.getPano();
        if (id && id !== lastPano) {
          // The jump via the button is not a step but a return.
          if (this.jumpingHome) tele.panoReturns++;
          else {
            tele.panoSteps++;
            if (id === panoId && away) tele.panoReturns++; // walked back
          }
          away = id !== panoId;
        }
        this.jumpingHome = false;
        lastPano = id;
      });
    }

    if (!settings.noPan) {
      let lastHeading: number | null = null;
      this.on(pano, 'pov_changed', () => {
        const heading = pano.getPov().heading;
        if (lastHeading !== null) {
          // measured the short way round, or a wrap would count 359 instead of 1
          tele.panDeg += Math.abs(((((heading - lastHeading) % 360) + 540) % 360) - 180);
        }
        lastHeading = heading;
      });
    }

    if (!settings.noZoom) {
      this.on(pano, 'zoom_changed', () => {
        tele.zoomEvents++;
        tele.zoomMax = Math.max(tele.zoomMax, pano.getZoom());
      });
    }
  }

  /**
   * Back to the start of the round. Whoever got lost in the panorama cannot
   * find their way back otherwise - the Maps API offers nothing for this.
   */
  returnToStart(): void {
    if (!this.pano || !this.current) return;
    const { panoId, settings } = this.current;
    if (settings.noMove || this.pano.getPano() === panoId) return;
    this.jumpingHome = true;
    this.pano.setPano(panoId);
  }

  /** Throw the panorama away entirely and rebuild it from the last show(). */
  private rebuild(reason: string): void {
    if (!this.current || this.rebuilds >= PANO_MAX_REBUILDS) return;
    this.rebuilds++;
    console.warn(`[pano] rebuilding after "${reason}" (attempt ${this.rebuilds})`);

    clearTimeout(this.watchdog);
    this.watchdog = undefined;
    this.clearListeners();
    this.pano = null;
    this.el.replaceChildren(); // remove the dead canvas

    const { panoId, settings } = this.current;
    this.show(panoId, settings);
  }

  /**
   * The API has no options for "view fixed" or "zoom locked", so we put the
   * start values back as soon as they change.
   */
  private applyGuards(pano: Pano, panoId: string, settings: PanoSettings): void {
    if (!settings.noPan && !settings.noZoom && !settings.noMove) return;

    let basePov: google.maps.StreetViewPov | null = null;
    let baseZoom: number | null = null;
    let restoring = false;

    const capture = (): void => {
      if (basePov) return;
      basePov = pano.getPov();
      baseZoom = pano.getZoom();
    };
    this.once(pano, 'pano_changed', capture);
    this.once(pano, 'position_changed', capture);

    const restore = (fn: () => void): void => {
      if (restoring) return;
      restoring = true;
      fn();
      restoring = false;
    };

    if (settings.noPan) {
      this.on(pano, 'pov_changed', () => {
        const base = basePov;
        if (!base) return;
        const pov = pano.getPov();
        if (Math.abs(pov.heading - base.heading) < 0.01 && Math.abs(pov.pitch - base.pitch) < 0.01) return;
        restore(() => { pano.setPov({ ...base }); });
      });
    }

    if (settings.noZoom) {
      this.on(pano, 'zoom_changed', () => {
        const base = baseZoom;
        if (base === null) return;
        if (Math.abs(pano.getZoom() - base) < 0.01) return;
        restore(() => { pano.setZoom(base); });
      });
    }

    if (settings.noMove) {
      this.on(pano, 'pano_changed', () => {
        if (pano.getPano() === panoId) return;
        restore(() => { pano.setPano(panoId); });
      });
    }
  }

  private on(pano: Pano, event: string, fn: () => void): void {
    this.listeners.push(pano.addListener(event, fn));
  }

  private once(pano: Pano, event: string, fn: () => void): void {
    this.listeners.push(google.maps.event.addListenerOnce(pano, event, fn));
  }

  private clearListeners(): void {
    for (const l of this.listeners) l.remove();
    this.listeners = [];
  }

  /** After the container changed size the API has to measure again. */
  refresh(): void {
    if (this.pano) google.maps.event.trigger(this.pano, 'resize');
  }
}

// --- Guess map -----------------------------------------------------------

/** Someone else's pin as a spectator sees it. */
export interface OtherPin extends PinSnapshot {
  name: string;
  color: string;
}

export class GuessMap {
  private readonly map: google.maps.Map;
  private marker: Marker | null = null;
  /** Spectators do not set a pin. */
  locked = false;
  /** playerId -> marker: the others' pins (spectators only). */
  private readonly others = new Map<string, Marker>();
  tele: MapTelemetry = emptyMapTelemetry();

  constructor(el: HTMLElement, onPick: (pos: LatLng) => void) {
    this.map = new google.maps.Map(el, WORLD_MAP_OPTIONS);

    this.map.addListener('zoom_changed', () => {
      this.tele.mapZoomMax = Math.max(this.tele.mapZoomMax, this.map.getZoom() ?? 0);
    });

    // The map stays open for the whole round - even after submitting, the
    // pin can still be moved.
    this.map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (this.locked || !event.latLng) return;
      const pos = { lat: event.latLng.lat(), lng: event.latLng.lng() };
      this.tele.mapClicks++;
      this.setPin(pos);
      onPick(pos);
    });
  }

  setPin(pos: LatLng): void {
    if (!this.marker) {
      this.marker = marker({ map: this.map, position: pos, icon: pinIcon('#e24b4b'), zIndex: 10 });
    } else {
      this.marker.setPosition(pos);
    }
  }

  /**
   * The others' pins as they lie right now - only spectators see this. A pin
   * that has not been submitted yet is drawn paler.
   */
  showOthers(pins: readonly OtherPin[]): void {
    const seen = new Set<string>();
    for (const pin of pins) {
      seen.add(pin.playerId);
      const pos = { lat: pin.lat, lng: pin.lng };
      const title = `${pin.name}${pin.confirmed ? '' : t('maps.notSubmitted')}`;
      let m = this.others.get(pin.playerId);
      if (!m) {
        m = marker({
          map: this.map,
          position: pos,
          icon: pinIcon(pin.color),
          label: { text: pin.name, color: '#1f2d4d', fontSize: '12px', fontWeight: '700', className: 'pin-label' },
          zIndex: 5,
        });
        this.others.set(pin.playerId, m);
      } else {
        m.setPosition(pos);
      }
      m.setTitle(title);
      m.setOpacity(pin.confirmed ? 1 : 0.55);
    }
    for (const [id, m] of this.others) {
      if (seen.has(id)) continue;
      m.setMap(null);
      this.others.delete(id);
    }
  }

  clearOthers(): void {
    for (const m of this.others.values()) m.setMap(null);
    this.others.clear();
  }

  reset(): void {
    this.tele = emptyMapTelemetry();
    if (this.marker) {
      this.marker.setMap(null);
      this.marker = null;
    }
    this.clearOthers();
    this.map.setCenter(WORLD_CENTER);
    this.map.setZoom(WORLD_ZOOM);
  }

  /** After the container is expanded or collapsed the API has to measure again. */
  refresh(): void {
    google.maps.event.trigger(this.map, 'resize');
  }
}

// --- Reveal map ----------------------------------------------------------

type Overlay = Marker | google.maps.Polyline;

/** Base for the two result maps: a world map that owns a set of overlays. */
abstract class OverlayMap {
  protected readonly map: google.maps.Map;
  protected overlays: Overlay[] = [];

  constructor(el: HTMLElement) {
    this.map = new google.maps.Map(el, { ...WORLD_MAP_OPTIONS, zoomControl: true, streetViewControl: false });
  }

  clear(): void {
    for (const o of this.overlays) o.setMap(null);
    this.overlays = [];
  }

  refresh(): void {
    google.maps.event.trigger(this.map, 'resize');
  }
}

export class RevealMap extends OverlayMap {
  /**
   * Who is in the lead after this round - all of them on a tie. Solo games
   * and games before the first points get no crown.
   */
  static leaders(results: readonly RoundResult[]): Set<string> {
    if (results.length < 2) return new Set();
    // In a duel the lead goes to whoever has the most hit points left - otherwise the points.
    const standing = (r: RoundResult): number => r.hp ?? r.total;
    const best = Math.max(...results.map(standing));
    if (best <= 0) return new Set();
    return new Set(results.filter((r) => standing(r) === best).map((r) => r.playerId));
  }

  render(actual: LatLng, results: readonly RoundResult[]): void {
    this.clear();
    const bounds = new google.maps.LatLngBounds();
    const leaders = RevealMap.leaders(results);

    this.overlays.push(marker({
      map: this.map,
      position: actual,
      icon: targetIcon(),
      zIndex: 100,
      title: t('maps.actualLocation'),
    }));
    bounds.extend(actual);

    for (const r of results) {
      if (!r.guess) continue;
      bounds.extend(r.guess);

      const crowned = leaders.has(r.playerId);
      this.overlays.push(marker({
        map: this.map,
        position: r.guess,
        icon: crowned ? crownedPinIcon(r.color) : pinIcon(r.color),
        title: `${r.name} - ${formatDistance(r.distanceKm)}${crowned ? t('maps.leading') : ''}`,
        zIndex: crowned ? 20 : 10,
      }));

      this.overlays.push(new google.maps.Polyline({
        map: this.map,
        path: [r.guess, actual],
        geodesic: true,
        strokeColor: r.color,
        strokeOpacity: 0.85,
        strokeWeight: 2,
      }));
    }

    if (!bounds.isEmpty()) fitCapped(this.map, bounds, 70);
  }
}

// --- Final map -----------------------------------------------------------

/**
 * All rounds on one world map: targets numbered, plus every player's guesses
 * in their colour. `only` narrows it down to a single round.
 */
export class FinalMap extends OverlayMap {
  render(rounds: readonly PlayedRound[], only: number | null = null): void {
    this.clear();
    const shown = only === null ? rounds : rounds.filter((r) => r.round === only);
    const bounds = new google.maps.LatLngBounds();

    for (const round of shown) {
      const label = t('maps.round', { n: round.round });
      this.overlays.push(marker({
        map: this.map,
        position: round.actual,
        icon: roundTargetIcon(round.round),
        zIndex: 100 + round.round,
        title: label,
      }));
      bounds.extend(round.actual);

      for (const r of round.results) {
        bounds.extend(r.guess);

        this.overlays.push(marker({
          map: this.map,
          position: r.guess,
          icon: dotIcon(r.color),
          title: `${r.name} - ${label} - ${formatDistance(r.distanceKm)}`,
          zIndex: 10,
        }));

        this.overlays.push(new google.maps.Polyline({
          map: this.map,
          path: [r.guess, round.actual],
          geodesic: true,
          strokeColor: r.color,
          strokeOpacity: 0.55,
          strokeWeight: 1.6,
        }));
      }
    }

    if (bounds.isEmpty()) {
      this.map.setCenter(WORLD_CENTER);
      this.map.setZoom(WORLD_ZOOM);
      return;
    }
    fitCapped(this.map, bounds, 60);
  }
}

/** "850 m", "12.3 km", "1,234 km" - in the active locale; "-" without a distance. */
export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined) return '-';
  if (km < 1) return `${fmtNum(Math.round(km * 1000))} m`;
  if (km < 100) return `${fmtNum(km, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  return `${fmtNum(Math.round(km))} km`;
}
