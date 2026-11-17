import './style.css';
import { SUPPORTED_LANGUAGES, t } from './i18n/translations';
import { MapController } from './map/mapController';
import { fetchNearbyPois, PoiFilterKind, reverseGeocode, searchPlaces } from './services/geocoding';
import { DEFAULT_FALLBACK_FIX, GpsWatcher, requestInitialGpsFix } from './services/location';
import { fetchRoadSignsAround, renderRoadSignSvg } from './services/roadSigns';
import { calculateRoutes, computeBearing, distanceToRouteMeters, haversineMeters } from './services/routing';
import { voiceNav } from './services/voice';
import {
  addRecentPlace,
  loadSettings,
  saveSettings,
  toggleFavoritePlace,
  TRUCK_PRESETS,
} from './storage/settings';
import {
  AppSettings,
  GeocodedPlace,
  GpsFix,
  LatLng,
  ManeuverKind,
  PoiItem,
  RoadSignItem,
  RouteOption,
  TransportMode,
  TruckPresetId,
} from './types/navigation';

type ModalKind = null | 'vehicle' | 'saved' | 'settings';

class BestGpsApp {
  private root: HTMLElement;
  private settings: AppSettings;
  private mapCtrl: MapController | null = null;
  private gpsWatcher = new GpsWatcher();

  private currentFix: GpsFix = { ...DEFAULT_FALLBACK_FIX };
  private hasLiveGps = false;
  private customStart: GeocodedPlace | null = null;
  private destination: GeocodedPlace | null = null;
  private tappedPlace: GeocodedPlace | null = null;

  private searchResults: GeocodedPlace[] = [];
  private searchOpen = false;
  private searchTimer: number | null = null;

  private routes: RouteOption[] = [];
  private selectedRouteIdx = 0;
  private showSteps = false;
  private isRouting = false;

  private activePoiFilter: PoiFilterKind | null = null;
  private poiItems: PoiItem[] = [];

  private currentMaxSpeedKmh: number | null = null;
  private roadSigns: RoadSignItem[] = [];
  private lastSignFetchFix: LatLng | null = null;
  private lastSignFetchAt = 0;
  private signFetchInFlight = false;
  private lastWarnedSignId = '';

  private isNavigating = false;
  private isSimulating = false;
  private simTimer: number | null = null;
  private simCoordIndex = 0;
  private followCamera = true;
  private lastSpokenStepKey = '';
  private lastRerouteAt = 0;

  private modal: ModalKind = null;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.applyBodyTheme();
    this.renderShell();
    void this.initServices();
  }

  private applyBodyTheme(): void {
    document.body.classList.toggle('theme-day', this.settings.mapTheme === 'day');
  }

  private async initServices(): Promise<void> {
    const initial = await requestInitialGpsFix();
    this.currentFix = initial.fix;
    this.hasLiveGps = initial.hasLiveGps;

    const mapEl = this.root.querySelector<HTMLElement>('#map-canvas');
    if (mapEl) {
      this.mapCtrl = new MapController(
        mapEl,
        { lat: this.currentFix.lat, lon: this.currentFix.lon },
        this.settings.mapTheme,
        (latlng) => void this.handleMapTap(latlng),
        (poi) => this.handlePoiTap(poi),
        (sign) => this.handleSignTap(sign)
      );
      this.mapCtrl.updateGpsFix(this.currentFix, false);
    }

    if (!this.hasLiveGps) {
      this.showToast(t(this.settings.language).gpsFallbackNotice);
    }

    await this.gpsWatcher.start((fix) => {
      if (this.isSimulating) return;
      this.handleIncomingFix(fix);
    });

    this.renderUi();
    void this.refreshRoadSigns(true);
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="app-shell">
        <div id="map-canvas"></div>
        <div id="ui-layer"></div>
        <div id="modal-layer"></div>
      </div>
    `;
  }

  private formatDistance(meters: number): string {
    if (this.settings.units === 'imperial') {
      const miles = meters / 1609.344;
      if (miles < 0.2) return `${Math.round(meters * 3.28084)} ft`;
      return `${miles >= 10 ? miles.toFixed(0) : miles.toFixed(1)} mi`;
    }
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
    const km = meters / 1000;
    return `${km >= 50 ? km.toFixed(0) : km.toFixed(1)} km`;
  }

  private formatDuration(sec: number): string {
    const mins = Math.max(1, Math.round(sec / 60));
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const rem = mins % 60;
    return `${h}u ${rem}m`;
  }

  private formatEta(sec: number): string {
    const arrival = new Date(Date.now() + sec * 1000);
    return arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private formatSpeed(kmh: number): { value: number; unit: string } {
    if (this.settings.units === 'imperial') {
      return { value: Math.round(kmh * 0.621371), unit: 'mph' };
    }
    return { value: Math.round(kmh), unit: t(this.settings.language).speedUnit };
  }

  private maneuverArrow(kind: ManeuverKind): string {
    switch (kind) {
      case 'left':
        return '↰';
      case 'slight_left':
        return '↖️';
      case 'sharp_left':
        return '↩️';
      case 'right':
        return '↱';
      case 'slight_right':
        return '↗️';
      case 'sharp_right':
        return '↪️';
      case 'uturn':
        return '🔄';
      case 'roundabout':
        return '🔁';
      case 'ramp_left':
        return '↙️';
      case 'ramp_right':
        return '↘️';
      case 'ferry':
        return '⛴️';
      case 'arrive':
        return '🏁';
      default:
        return '⬆️';
    }
  }

  private renderUi(): void {
    const layer = this.root.querySelector<HTMLElement>('#ui-layer');
    if (!layer) return;
    const bundle = t(this.settings.language);
    const activeRoute = this.routes[this.selectedRouteIdx] ?? null;

    if (this.isNavigating && activeRoute) {
      layer.innerHTML = this.renderActiveNavHud(activeRoute, bundle);
      this.bindActiveNavEvents();
      this.renderModal();
      return;
    }

    const truckSummary = `${this.settings.truck.heightM.toFixed(1)}m H • ${this.settings.truck.weightT}t${
      this.settings.truck.hazmat ? ' • ADR' : ''
    }`;

    const poiButtons: { kind: PoiFilterKind; label: string; ico: string }[] = [
      { kind: 'fuel', label: bundle.poiFuel, ico: '⛽' },
      { kind: 'parking', label: bundle.poiParking, ico: '🅿️' },
      { kind: 'ev', label: bundle.poiEv, ico: '⚡' },
      { kind: 'bike', label: bundle.poiBike, ico: '🚲' },
      { kind: 'water', label: bundle.poiWater, ico: '🚰' },
    ];

    layer.innerHTML = `
      <div class="top-overlay">
        <div class="search-row">
          <input
            id="search-box"
            class="search-input"
            type="search"
            placeholder="${bundle.searchPlaceholder}"
            value="${this.destination ? this.escapeHtml(this.destination.name) : ''}"
          />
          ${
            this.destination
              ? `<button class="round-icon-btn" id="btn-clear-dest" title="Clear">✕</button>`
              : ''
          }
          <button class="round-icon-btn" id="btn-open-saved" title="${bundle.savedPlaces}">⭐</button>
          <button class="round-icon-btn" id="btn-open-settings" title="${bundle.settingsTitle}">🌐</button>
        </div>

        <div class="modes-grid">
          <button class="mode-btn ${this.settings.mode === 'pedestrian' ? 'active' : ''}" data-mode="pedestrian">
            <span class="m-ico">🚶</span>
            <span class="m-lbl">${bundle.modes.pedestrian}</span>
          </button>
          <button class="mode-btn ${this.settings.mode === 'bicycle' ? 'active' : ''}" data-mode="bicycle">
            <span class="m-ico">🚲</span>
            <span class="m-lbl">${bundle.modes.bicycle}</span>
          </button>
          <button class="mode-btn ${this.settings.mode === 'auto' ? 'active' : ''}" data-mode="auto">
            <span class="m-ico">🚗</span>
            <span class="m-lbl">${bundle.modes.auto}</span>
          </button>
          <button class="mode-btn ${this.settings.mode === 'truck' ? 'active' : ''}" data-mode="truck">
            <span class="m-ico">🚛</span>
            <span class="m-lbl">${bundle.modes.truck}</span>
          </button>
        </div>

        <div class="chips-strip">
          <button class="pill-chip ${this.settings.mode === 'truck' ? 'highlight' : ''}" id="btn-open-vehicle">
            ⚙️ ${this.settings.mode === 'truck' ? truckSummary : bundle.vehicleSettings}
          </button>
          <button class="pill-chip ${this.settings.showRoadSigns ? 'active' : ''}" id="btn-toggle-signs">
            🚸 ${bundle.roadSignsChip}
          </button>
          ${poiButtons
            .map(
              (p) => `
            <button class="pill-chip ${this.activePoiFilter === p.kind ? 'active' : ''}" data-poi="${p.kind}">
              ${p.ico} ${p.label}
            </button>
          `
            )
            .join('')}
        </div>

        ${this.searchOpen ? this.renderSearchDropdown(bundle) : ''}
      </div>

      <div class="map-fab-stack">
        <button class="fab-btn" id="btn-gps-center" title="${bundle.recenter}">🎯</button>
        <button class="fab-btn" id="btn-toggle-theme" title="${bundle.themeLabel}">
          ${this.settings.mapTheme === 'night' ? '☀️' : '🌙'}
        </button>
        <button class="fab-btn" id="btn-toggle-voice" title="${bundle.voiceLabel}">
          ${this.settings.voiceEnabled ? '🔊' : '🔇'}
        </button>
      </div>

      <div class="bottom-dock">
        <div id="vehicle-cockpit-slot">${this.renderVehicleCockpit(bundle)}</div>
        ${this.renderBottomSheet(bundle, activeRoute)}
      </div>
    `;

    this.bindPlanningEvents();
    this.renderModal();
  }

  private renderSearchDropdown(bundle: ReturnType<typeof t>): string {
    const items = this.searchResults;
    if (items.length === 0 && !this.settings.homePlace && !this.settings.workPlace && this.settings.recents.length === 0) {
      return '';
    }
    return `
      <div class="search-dropdown">
        ${
          this.settings.homePlace && items.length === 0
            ? `<button class="search-item" data-pick-id="__home__"><strong>🏠 ${bundle.home}</strong><small>${this.escapeHtml(this.settings.homePlace.name)}</small></button>`
            : ''
        }
        ${
          this.settings.workPlace && items.length === 0
            ? `<button class="search-item" data-pick-id="__work__"><strong>💼 ${bundle.work}</strong><small>${this.escapeHtml(this.settings.workPlace.name)}</small></button>`
            : ''
        }
        ${(items.length > 0 ? items : this.settings.recents.slice(0, 5))
          .map(
            (p) => `
          <button class="search-item" data-pick-id="${this.escapeHtml(p.id)}">
            <strong>${this.escapeHtml(p.name)}</strong>
            <small>${this.escapeHtml(p.subtitle)}</small>
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  private renderBottomSheet(bundle: ReturnType<typeof t>, route: RouteOption | null): string {
    if (this.isRouting) {
      return `
        <div class="bottom-sheet">
          <div style="font-weight:800;font-size:14px;">⏳ ${bundle.calculatingRoute}</div>
        </div>
      `;
    }

    if (this.tappedPlace && !route) {
      const p = this.tappedPlace;
      return `
        <div class="bottom-sheet">
          <div>
            <div style="font-size:15px;font-weight:900;">📍 ${this.escapeHtml(p.name)}</div>
            <div style="font-size:12px;color:var(--muted);">${this.escapeHtml(p.subtitle || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`)}</div>
          </div>
          <div class="btn-row">
            <button class="primary-btn" id="btn-tap-dest">🧭 ${bundle.setDestination}</button>
            <button class="secondary-btn" id="btn-tap-start">🅰️ ${bundle.setStart}</button>
            <button class="secondary-btn" id="btn-tap-fav">⭐</button>
            <button class="secondary-btn" id="btn-tap-close">✕</button>
          </div>
        </div>
      `;
    }

    if (route) {
      return `
        <div class="bottom-sheet">
          <div class="route-summary-row">
            <div class="route-metrics">
              <span class="route-time">${this.formatDuration(route.durationSeconds)}</span>
              <span class="route-dist">(${this.formatDistance(route.distanceMeters)})</span>
              <span class="route-meta">• ${bundle.etaLabel}: <b>${this.formatEta(route.durationSeconds)}</b></span>
            </div>
            <button class="secondary-btn" id="btn-toggle-steps" style="padding:6px 10px;">
              ${this.showSteps ? '▼' : '▲'} ${bundle.stepsTitle} (${route.steps.length})
            </button>
          </div>

          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted);">
            <span>${bundle.modes[route.mode]} • ${bundle.providerLabel}: <b>${route.provider}</b></span>
            ${
              this.routes.length > 1
                ? this.routes
                    .map(
                      (r, i) => `
                  <button class="pill-chip ${i === this.selectedRouteIdx ? 'active' : ''}" data-route-idx="${i}">
                    ${i === 0 ? bundle.primaryRoute : bundle.altRoute}: ${this.formatDuration(r.durationSeconds)}
                  </button>
                `
                    )
                    .join('')
                : ''
            }
          </div>

          ${
            route.fallbackNotice
              ? `<div class="warn-banner">⚠️ ${this.escapeHtml(route.fallbackNotice)}</div>`
              : this.settings.mode === 'truck'
                ? `<div class="warn-banner">🚛 ${this.escapeHtml(bundle.truckWarning)}</div>`
                : ''
          }

          <div class="btn-row">
            <button class="primary-btn" id="btn-start-nav">▶ ${bundle.startNav}</button>
            <button class="secondary-btn" id="btn-sim-nav">🎮 ${bundle.simulateDrive}</button>
          </div>

          ${
            this.showSteps
              ? `
            <div class="steps-list">
              ${route.steps
                .map(
                  (st) => `
                <div class="step-row">
                  <span class="step-ico">${this.maneuverArrow(st.maneuver)}</span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;">${this.escapeHtml(st.instruction)}</div>
                    <div style="font-size:11px;color:var(--muted);">${this.formatDistance(st.distanceMeters)}</div>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          `
              : ''
          }
        </div>
      `;
    }

    return `
      <div class="bottom-sheet" style="padding:9px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-size:12px;color:var(--muted);">${bundle.tapMapHint}</span>
          <span style="font-size:11px;font-weight:800;color:${this.hasLiveGps ? 'var(--green)' : 'var(--amber)'};white-space:nowrap;">
            ● ${this.hasLiveGps ? bundle.gpsActive : 'GPS Demo'}
          </span>
        </div>
      </div>
    `;
  }

  private renderSpeedLimitSignHtml(size = 36): string {
    if (this.currentMaxSpeedKmh === null) {
      return `<div class="speed-limit-unknown">--</div>`;
    }
    const displayLimit =
      this.settings.units === 'imperial'
        ? Math.round(this.currentMaxSpeedKmh * 0.621371)
        : this.currentMaxSpeedKmh;
    return renderRoadSignSvg('maxspeed', String(displayLimit), size);
  }

  private isOverSpeedLimit(): boolean {
    if (this.currentMaxSpeedKmh === null) return false;
    return this.currentFix.speedKmh > this.currentMaxSpeedKmh + 3;
  }

  private renderMiniSignsStripHtml(): string {
    if (!this.settings.showRoadSigns || this.roadSigns.length === 0) return '';
    const refPos = this.currentFix;
    const nearby = this.roadSigns
      .map((s) => ({ sign: s, distM: Math.round(haversineMeters(refPos, s)) }))
      .filter(({ sign, distM }) => {
        if (distM > 1400) return false;
        if (sign.kind === 'maxspeed' && sign.maxSpeedKmh === this.currentMaxSpeedKmh && distM < 250) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const scoreA = a.distM - (a.sign.isDangerForMode ? 500 : 0) - (a.sign.priority ?? 0) * 20;
        const scoreB = b.distM - (b.sign.isDangerForMode ? 500 : 0) - (b.sign.priority ?? 0) * 20;
        return scoreA - scoreB;
      })
      .slice(0, 8);

    if (nearby.length === 0) return '';

    return `
      <div class="mini-signs-strip">
        ${nearby
          .map(
            ({ sign, distM }) => `
          <button class="mini-sign-pill ${sign.isDangerForMode ? 'danger' : ''}" data-sign-id="${this.escapeHtml(sign.id)}" title="${this.escapeHtml(sign.title)}">
            ${renderRoadSignSvg(sign.kind, sign.label, 24, Boolean(sign.isDangerForMode))}
            <span>${this.formatDistance(distM)}</span>
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  private renderVehicleCockpit(_bundle: ReturnType<typeof t>): string {
    // Show speedometer + signs for all vehicle modes (everything except walking / pedestrian)
    if (this.settings.mode === 'pedestrian') return '';
    const sp = this.formatSpeed(this.currentFix.speedKmh);
    const speeding = this.isOverSpeedLimit();

    return `
      <div class="vehicle-cockpit">
        <div class="speed-cluster">
          <div class="speed-badge ${speeding ? 'speeding' : ''}">
            <strong>${sp.value}</strong>
            <small>${sp.unit}</small>
          </div>
          <div class="speed-limit-holder">
            ${this.renderSpeedLimitSignHtml(38)}
          </div>
        </div>
        ${this.renderMiniSignsStripHtml()}
      </div>
    `;
  }

  private updateVehicleCockpitDom(): void {
    const slot = this.root.querySelector<HTMLElement>('#vehicle-cockpit-slot');
    if (!slot) return;
    slot.innerHTML = this.renderVehicleCockpit(t(this.settings.language));
    this.bindSignPillEvents();
  }

  private renderActiveNavHud(route: RouteOption, bundle: ReturnType<typeof t>): string {
    const progress = this.computeNavProgress(route);
    const sp = this.formatSpeed(this.currentFix.speedKmh);
    const isVehicle = this.settings.mode !== 'pedestrian';
    const speeding = isVehicle && this.isOverSpeedLimit();

    return `
      <div class="nav-top-banner ${this.settings.mode === 'truck' ? 'truck-banner' : ''}">
        <div class="nav-arrow-box">${this.maneuverArrow(progress.nextStep.maneuver)}</div>
        <div class="nav-instr-col">
          <div class="nav-dist-next">${bundle.inDistance} ${this.formatDistance(progress.distanceToStepM)}</div>
          <div class="nav-street-next">${this.escapeHtml(progress.nextStep.instruction)}</div>
        </div>
      </div>

      <div class="nav-bottom-dock">
        ${isVehicle ? this.renderMiniSignsStripHtml() : ''}
        <div class="nav-bottom-bar">
          ${
            isVehicle
              ? `
            <div class="speed-badge ${speeding ? 'speeding' : ''}">
              <strong>${sp.value}</strong>
              <small>${sp.unit}</small>
            </div>
            <div class="speed-limit-holder">
              ${this.renderSpeedLimitSignHtml(38)}
            </div>
          `
              : `<div class="speed-badge" style="border-color:var(--green);"><strong>🚶</strong></div>`
          }
          <div style="flex:1;min-width:0;">
            <div style="font-size:16px;font-weight:900;color:var(--green);">
              ${this.formatDuration(progress.remainingSeconds)} • ${this.formatDistance(progress.remainingMeters)}
            </div>
            <div style="font-size:11px;color:var(--muted);">
              ${bundle.etaLabel}: <b>${this.formatEta(progress.remainingSeconds)}</b> • ${bundle.modes[this.settings.mode]}${
                this.isSimulating ? ' (DEMO)' : ''
              }
            </div>
          </div>
          <button class="round-icon-btn" id="btn-nav-voice">${this.settings.voiceEnabled ? '🔊' : '🔇'}</button>
          <button class="round-icon-btn" id="btn-nav-recenter" title="${bundle.recenter}">🎯</button>
          <button class="danger-btn" id="btn-stop-nav">${bundle.stopNav}</button>
        </div>
      </div>
    `;
  }

  private bindSignPillEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-sign-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = this.roadSigns.find((item) => item.id === btn.dataset.signId);
        if (s) this.handleSignTap(s);
      });
    });
  }

  private bindPlanningEvents(): void {
    const searchInput = this.root.querySelector<HTMLInputElement>('#search-box');
    searchInput?.addEventListener('focus', () => {
      this.searchOpen = true;
      this.renderSearchPopupOnly();
    });
    searchInput?.addEventListener('input', () => {
      const q = searchInput.value;
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        void this.performSearch(q);
      }, 320);
    });

    this.root.querySelector('#btn-clear-dest')?.addEventListener('click', () => {
      this.destination = null;
      this.tappedPlace = null;
      this.routes = [];
      this.mapCtrl?.setDestinationPin(null);
      this.mapCtrl?.renderRoutes([], 0);
      this.searchResults = [];
      this.searchOpen = false;
      this.renderUi();
    });

    this.root.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as TransportMode;
        if (this.settings.mode === mode && mode === 'truck') {
          this.modal = 'vehicle';
          this.renderModal();
          return;
        }
        this.settings.mode = mode;
        saveSettings(this.settings);
        this.renderUi();
        void this.refreshRoadSigns(true);
        if (this.destination) void this.computeActiveRoute();
        if (this.activePoiFilter) void this.loadPois(this.activePoiFilter);
      });
    });

    this.root.querySelector('#btn-toggle-signs')?.addEventListener('click', () => {
      this.settings.showRoadSigns = !this.settings.showRoadSigns;
      saveSettings(this.settings);
      if (this.settings.showRoadSigns) {
        void this.refreshRoadSigns(true);
      } else {
        this.mapCtrl?.clearRoadSigns();
      }
      this.renderUi();
    });

    this.root.querySelector('#btn-open-vehicle')?.addEventListener('click', () => {
      this.modal = 'vehicle';
      this.renderModal();
    });
    this.root.querySelector('#btn-open-saved')?.addEventListener('click', () => {
      this.modal = 'saved';
      this.renderModal();
    });
    this.root.querySelector('#btn-open-settings')?.addEventListener('click', () => {
      this.modal = 'settings';
      this.renderModal();
    });

    this.bindSignPillEvents();

    this.root.querySelectorAll<HTMLButtonElement>('[data-poi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.poi as PoiFilterKind;
        if (this.activePoiFilter === kind) {
          this.activePoiFilter = null;
          this.poiItems = [];
          this.mapCtrl?.clearPois();
          this.renderUi();
        } else {
          void this.loadPois(kind);
        }
      });
    });

    this.root.querySelector('#btn-gps-center')?.addEventListener('click', () => {
      this.mapCtrl?.flyTo({ lat: this.currentFix.lat, lon: this.currentFix.lon }, 15, 0);
    });

    this.root.querySelector('#btn-toggle-theme')?.addEventListener('click', () => {
      this.settings.mapTheme = this.settings.mapTheme === 'night' ? 'day' : 'night';
      saveSettings(this.settings);
      this.applyBodyTheme();
      this.mapCtrl?.setTheme(this.settings.mapTheme);
      this.renderUi();
    });

    this.root.querySelector('#btn-toggle-voice')?.addEventListener('click', () => {
      this.settings.voiceEnabled = !this.settings.voiceEnabled;
      saveSettings(this.settings);
      if (!this.settings.voiceEnabled) void voiceNav.stop();
      this.renderUi();
    });

    this.root.querySelector('#btn-tap-dest')?.addEventListener('click', () => {
      if (!this.tappedPlace) return;
      this.selectDestination(this.tappedPlace);
    });

    this.root.querySelector('#btn-tap-start')?.addEventListener('click', () => {
      if (!this.tappedPlace) return;
      this.customStart = this.tappedPlace;
      this.mapCtrl?.setStartPin(this.tappedPlace);
      this.tappedPlace = null;
      this.renderUi();
      if (this.destination) void this.computeActiveRoute();
    });

    this.root.querySelector('#btn-tap-fav')?.addEventListener('click', () => {
      if (!this.tappedPlace) return;
      const added = toggleFavoritePlace(this.settings, this.tappedPlace);
      this.showToast(added ? `⭐ ${this.tappedPlace.name}` : 'Removed from favorites');
    });

    this.root.querySelector('#btn-tap-close')?.addEventListener('click', () => {
      this.tappedPlace = null;
      this.renderUi();
    });

    this.root.querySelector('#btn-toggle-steps')?.addEventListener('click', () => {
      this.showSteps = !this.showSteps;
      this.renderUi();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-route-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedRouteIdx = Number(btn.dataset.routeIdx);
        this.mapCtrl?.renderRoutes(this.routes, this.selectedRouteIdx);
        this.renderUi();
      });
    });

    this.root.querySelector('#btn-start-nav')?.addEventListener('click', () => this.startNavigation(false));
    this.root.querySelector('#btn-sim-nav')?.addEventListener('click', () => this.startNavigation(true));

    this.bindDropdownItemClicks();
  }

  private bindDropdownItemClicks(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-pick-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pickId!;
        let place: GeocodedPlace | null = null;
        if (id === '__home__') place = this.settings.homePlace;
        else if (id === '__work__') place = this.settings.workPlace;
        else {
          place =
            this.searchResults.find((p) => p.id === id) ||
            this.settings.recents.find((p) => p.id === id) ||
            null;
        }
        if (place) this.selectDestination(place);
      });
    });
  }

  private renderSearchPopupOnly(): void {
    const overlay = this.root.querySelector('.top-overlay');
    if (!overlay) return;
    overlay.querySelector('.search-dropdown')?.remove();
    if (!this.searchOpen) return;
    const html = this.renderSearchDropdown(t(this.settings.language));
    if (html) {
      overlay.insertAdjacentHTML('beforeend', html);
      this.bindDropdownItemClicks();
    }
  }

  private async performSearch(q: string): Promise<void> {
    if (q.trim().length < 2) {
      this.searchResults = [];
      this.renderSearchPopupOnly();
      return;
    }
    this.searchResults = await searchPlaces(q, this.currentFix.lat, this.currentFix.lon, this.settings.language);
    this.searchOpen = true;
    this.renderSearchPopupOnly();
  }

  private selectDestination(place: GeocodedPlace): void {
    this.destination = place;
    this.tappedPlace = null;
    this.searchOpen = false;
    addRecentPlace(this.settings, place);
    this.mapCtrl?.setDestinationPin({ lat: place.lat, lon: place.lon });
    void this.computeActiveRoute();
  }

  private async computeActiveRoute(): Promise<void> {
    if (!this.destination) return;
    const origin: LatLng = this.customStart ?? { lat: this.currentFix.lat, lon: this.currentFix.lon };
    this.isRouting = true;
    this.renderUi();
    try {
      const res = await calculateRoutes(origin, { lat: this.destination.lat, lon: this.destination.lon }, this.settings);
      this.routes = res;
      this.selectedRouteIdx = 0;
      this.mapCtrl?.renderRoutes(this.routes, 0);
      if (this.routes[0] && !this.isNavigating) {
        this.mapCtrl?.fitRoute(this.routes[0]);
      }
    } catch {
      this.routes = [];
      this.mapCtrl?.renderRoutes([], 0);
      this.showToast(t(this.settings.language).noRouteFound);
    } finally {
      this.isRouting = false;
      this.renderUi();
    }
  }

  private async handleMapTap(latlng: LatLng): Promise<void> {
    if (this.isNavigating) return;
    this.searchOpen = false;
    this.tappedPlace = {
      id: `pin-${Date.now()}`,
      name: `${latlng.lat.toFixed(5)}, ${latlng.lon.toFixed(5)}`,
      subtitle: '...',
      lat: latlng.lat,
      lon: latlng.lon,
    };
    this.mapCtrl?.setDestinationPin(latlng);
    this.renderUi();
    const resolved = await reverseGeocode(latlng.lat, latlng.lon, this.settings.language);
    if (this.tappedPlace) {
      this.tappedPlace = resolved;
      this.renderUi();
    }
  }

  private handlePoiTap(poi: PoiItem): void {
    this.tappedPlace = {
      id: poi.id,
      name: `${poi.emoji} ${poi.name}`,
      subtitle: poi.extra || poi.category,
      lat: poi.lat,
      lon: poi.lon,
    };
    this.mapCtrl?.flyTo({ lat: poi.lat, lon: poi.lon }, 14.5, 0);
    this.renderUi();
  }

  private handleSignTap(sign: RoadSignItem): void {
    const dist = Math.round(haversineMeters(this.currentFix, sign));
    const dangerMsg = sign.isDangerForMode ? ` ⚠️ ${t(this.settings.language).truckSignDanger}` : '';
    this.showToast(`🚸 ${sign.title} (${this.formatDistance(dist)})${dangerMsg}`);
    this.mapCtrl?.flyTo({ lat: sign.lat, lon: sign.lon }, 15.5, 0);
  }

  private async refreshRoadSigns(force = false): Promise<void> {
    if (!this.settings.showRoadSigns) {
      this.mapCtrl?.clearRoadSigns();
      return;
    }
    if (this.signFetchInFlight) return;
    const now = Date.now();
    const movedM = this.lastSignFetchFix ? haversineMeters(this.lastSignFetchFix, this.currentFix) : 9999;
    if (!force && movedM < 320 && now - this.lastSignFetchAt < 45_000) {
      return;
    }

    this.signFetchInFlight = true;
    this.lastSignFetchFix = { lat: this.currentFix.lat, lon: this.currentFix.lon };
    this.lastSignFetchAt = now;
    try {
      const snap = await fetchRoadSignsAround(this.currentFix.lat, this.currentFix.lon, this.settings);
      this.currentMaxSpeedKmh = snap.currentMaxSpeedKmh;
      this.roadSigns = snap.signs;
      this.mapCtrl?.setRoadSigns(this.settings.showRoadSigns ? this.roadSigns : []);

      // Alert once if a close dangerous sign matches the user's vehicle (e.g. low bridge or HGV ban)
      const closeDanger = this.roadSigns.find(
        (s) => s.isDangerForMode && haversineMeters(this.currentFix, s) < 280
      );
      if (closeDanger && closeDanger.id !== this.lastWarnedSignId) {
        this.lastWarnedSignId = closeDanger.id;
        const msg = `${closeDanger.title} — ${t(this.settings.language).truckSignDanger}`;
        this.showToast(`⚠️ ${msg}`);
        if (this.isNavigating) {
          void voiceNav.speak(msg, this.settings.language, this.settings.voiceEnabled, true);
        }
      }

      if (this.isNavigating) {
        this.renderUi();
      } else {
        this.updateVehicleCockpitDom();
      }
    } finally {
      this.signFetchInFlight = false;
    }
  }

  private async loadPois(kind: PoiFilterKind): Promise<void> {
    const bundle = t(this.settings.language);
    this.activePoiFilter = kind;
    this.showToast(bundle.poiLoading);
    this.renderUi();
    const center = this.destination ?? this.currentFix;
    this.poiItems = await fetchNearbyPois(center.lat, center.lon, kind, this.settings.mode);
    this.mapCtrl?.setPois(this.poiItems);
    this.showToast(`${this.poiItems.length} ${bundle.poiCount}`);
    this.renderUi();
  }

  private startNavigation(simulate: boolean): void {
    const route = this.routes[this.selectedRouteIdx];
    if (!route) return;
    this.isNavigating = true;
    this.isSimulating = simulate;
    this.followCamera = true;
    this.lastSpokenStepKey = '';

    const bundle = t(this.settings.language);
    if (route.steps[0]) {
      void voiceNav.speak(route.steps[0].instruction, this.settings.language, this.settings.voiceEnabled, true);
    }

    if (simulate) {
      this.simCoordIndex = 0;
      const stepStride = Math.max(1, Math.floor(route.coordinates.length / 110));
      if (this.simTimer !== null) window.clearInterval(this.simTimer);
      this.simTimer = window.setInterval(() => {
        if (!this.isNavigating || !this.isSimulating) return;
        const active = this.routes[this.selectedRouteIdx];
        if (!active) return;
        const curr = active.coordinates[this.simCoordIndex];
        const next = active.coordinates[Math.min(active.coordinates.length - 1, this.simCoordIndex + stepStride)];
        if (!curr) return;
        const bearing = next ? computeBearing({ lat: curr[1], lon: curr[0] }, { lat: next[1], lon: next[0] }) : 0;

        let simSpeed =
          this.settings.mode === 'pedestrian'
            ? 5
            : this.settings.mode === 'bicycle'
              ? 21
              : this.settings.mode === 'truck'
                ? Math.min(80, this.currentMaxSpeedKmh ?? 78)
                : Math.min(120, this.currentMaxSpeedKmh ?? 52);
        if (this.settings.mode !== 'pedestrian') {
          simSpeed = Math.max(12, Math.round(simSpeed + Math.sin(this.simCoordIndex * 0.4) * 3));
        }

        this.handleIncomingFix({
          lat: curr[1],
          lon: curr[0],
          heading: bearing,
          speedKmh: simSpeed,
          accuracyM: 5,
          timestamp: Date.now(),
          isSimulated: true,
        });
        if (this.simCoordIndex >= active.coordinates.length - 1) {
          this.stopNavigation(true);
          this.showToast(`🏁 ${bundle.arrived}`);
          void voiceNav.speak(bundle.arrived, this.settings.language, this.settings.voiceEnabled, true);
          return;
        }
        this.simCoordIndex = Math.min(active.coordinates.length - 1, this.simCoordIndex + stepStride);
      }, 650);
    }

    this.mapCtrl?.updateGpsFix(this.currentFix, true);
    this.renderUi();
  }

  private stopNavigation(arrived = false): void {
    this.isNavigating = false;
    this.isSimulating = false;
    if (this.simTimer !== null) {
      window.clearInterval(this.simTimer);
      this.simTimer = null;
    }
    if (!arrived) void voiceNav.stop();
    this.mapCtrl?.flyTo({ lat: this.currentFix.lat, lon: this.currentFix.lon }, 14, 0);
    this.renderUi();
  }

  private handleIncomingFix(fix: GpsFix): void {
    const prev = this.currentFix;
    const distMoved = haversineMeters(prev, fix);
    const dtSec = (fix.timestamp - prev.timestamp) / 1000;

    // Fallback delta speed if device omits coords.speed (common on some Android WebViews)
    let resolvedSpeedKmh = fix.speedKmh;
    if (!fix.isSimulated && resolvedSpeedKmh === 0 && dtSec >= 0.6 && dtSec <= 8 && fix.accuracyM <= 45) {
      if (distMoved >= 2.2) {
        const calc = Math.round((distMoved / dtSec) * 3.6);
        if (calc > 0 && calc < 220) {
          resolvedSpeedKmh = prev.speedKmh > 0 ? Math.round(prev.speedKmh * 0.4 + calc * 0.6) : calc;
        }
      }
    }

    const computedHeading =
      fix.heading !== null
        ? fix.heading
        : distMoved > 4
          ? computeBearing(prev, fix)
          : prev.heading;

    this.currentFix = { ...fix, speedKmh: resolvedSpeedKmh, heading: computedHeading };
    if (!fix.isSimulated) this.hasLiveGps = true;

    this.mapCtrl?.updateGpsFix(this.currentFix, this.isNavigating && this.followCamera);
    void this.refreshRoadSigns(false);

    if (!this.isNavigating) {
      if (this.settings.mode !== 'pedestrian') {
        this.updateVehicleCockpitDom();
      }
      return;
    }
    const route = this.routes[this.selectedRouteIdx];
    if (!route) return;

    const bundle = t(this.settings.language);
    const snap = distanceToRouteMeters({ lat: fix.lat, lon: fix.lon }, route.coordinates);

    // Off-route detection (> 70m) -> automatic reroute
    if (!fix.isSimulated && this.settings.autoReroute && snap.minMeters > 70 && Date.now() - this.lastRerouteAt > 12_000) {
      this.lastRerouteAt = Date.now();
      this.showToast(bundle.rerouting);
      void voiceNav.speak(bundle.rerouting, this.settings.language, this.settings.voiceEnabled, true);
      void this.computeActiveRoute();
      return;
    }

    // Check arrival (< 35m from end)
    const endCoord = route.coordinates[route.coordinates.length - 1];
    if (endCoord && haversineMeters(fix, { lat: endCoord[1], lon: endCoord[0] }) < 35) {
      this.stopNavigation(true);
      this.showToast(`🏁 ${bundle.arrived}`);
      void voiceNav.speak(bundle.arrived, this.settings.language, this.settings.voiceEnabled, true);
      return;
    }

    const prog = this.computeNavProgress(route);
    if (prog.distanceToStepM <= 260 && prog.stepIndex > 0) {
      const key = `${prog.stepIndex}-${prog.distanceToStepM <= 70 ? 'now' : 'soon'}`;
      if (key !== this.lastSpokenStepKey) {
        this.lastSpokenStepKey = key;
        const msg =
          prog.distanceToStepM <= 70
            ? prog.nextStep.instruction
            : `${bundle.inDistance} ${this.formatDistance(prog.distanceToStepM)}, ${prog.nextStep.instruction}`;
        void voiceNav.speak(msg, this.settings.language, this.settings.voiceEnabled, true);
      }
    }

    this.renderUi();
  }

  private computeNavProgress(route: RouteOption): {
    stepIndex: number;
    nextStep: RouteOption['steps'][number];
    distanceToStepM: number;
    remainingMeters: number;
    remainingSeconds: number;
  } {
    const snap = distanceToRouteMeters({ lat: this.currentFix.lat, lon: this.currentFix.lon }, route.coordinates);
    let stepIdx = route.steps.findIndex((s) => s.coordIndex > snap.nearestIndex);
    if (stepIdx < 0) stepIdx = Math.max(0, route.steps.length - 1);
    const nextStep = route.steps[stepIdx] ?? {
      instruction: t(this.settings.language).arrived,
      streetName: '',
      distanceMeters: 0,
      durationSeconds: 0,
      maneuver: 'arrive' as ManeuverKind,
      coordIndex: route.coordinates.length - 1,
      lat: this.currentFix.lat,
      lon: this.currentFix.lon,
    };

    const distanceToStepM = Math.max(
      10,
      Math.round(haversineMeters({ lat: this.currentFix.lat, lon: this.currentFix.lon }, nextStep))
    );

    const fracRemaining =
      route.coordinates.length > 1 ? Math.max(0, 1 - snap.nearestIndex / (route.coordinates.length - 1)) : 0;
    return {
      stepIndex: stepIdx,
      nextStep,
      distanceToStepM,
      remainingMeters: Math.round(route.distanceMeters * fracRemaining),
      remainingSeconds: Math.max(30, Math.round(route.durationSeconds * fracRemaining)),
    };
  }

  private bindActiveNavEvents(): void {
    this.root.querySelector('#btn-stop-nav')?.addEventListener('click', () => this.stopNavigation(false));
    this.root.querySelector('#btn-nav-recenter')?.addEventListener('click', () => {
      this.followCamera = true;
      this.mapCtrl?.updateGpsFix(this.currentFix, true);
    });
    this.root.querySelector('#btn-nav-voice')?.addEventListener('click', () => {
      this.settings.voiceEnabled = !this.settings.voiceEnabled;
      saveSettings(this.settings);
      if (!this.settings.voiceEnabled) void voiceNav.stop();
      this.renderUi();
    });
    this.bindSignPillEvents();
  }

  private renderModal(): void {
    const container = this.root.querySelector<HTMLElement>('#modal-layer');
    if (!container) return;
    if (!this.modal) {
      container.innerHTML = '';
      return;
    }
    const bundle = t(this.settings.language);

    if (this.modal === 'vehicle') {
      const tr = this.settings.truck;
      container.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="modal-card">
            <div class="modal-header">
              <h2>⚙️ ${bundle.vehicleSettings}</h2>
              <button class="round-icon-btn" id="modal-close">✕</button>
            </div>

            ${
              this.settings.mode === 'truck'
                ? `
              <div style="font-size:12px;font-weight:800;color:var(--amber);">🚛 ${bundle.truckPresets}</div>
              <div class="chips-strip">
                ${(
                  [
                    ['van', bundle.presetVan],
                    ['box12', bundle.presetBox12],
                    ['semi40', bundle.presetSemi40],
                    ['lzv60', bundle.presetLzv60],
                    ['camper', bundle.presetCamper],
                  ] as [TruckPresetId, string][]
                )
                  .map(
                    ([id, label]) => `
                  <button class="pill-chip ${tr.presetId === id ? 'highlight' : ''}" data-preset="${id}">${label}</button>
                `
                  )
                  .join('')}
              </div>
              <div class="form-grid">
                <label class="field">${bundle.heightM}<input id="in-h" type="number" step="0.1" min="1.5" max="5.0" value="${tr.heightM}"></label>
                <label class="field">${bundle.widthM}<input id="in-w" type="number" step="0.05" min="1.5" max="3.5" value="${tr.widthM}"></label>
                <label class="field">${bundle.lengthM}<input id="in-l" type="number" step="0.5" min="3.0" max="30.0" value="${tr.lengthM}"></label>
                <label class="field">${bundle.weightT}<input id="in-wt" type="number" step="0.5" min="1.5" max="80.0" value="${tr.weightT}"></label>
                <label class="field">${bundle.axleLoadT}<input id="in-ax" type="number" step="0.5" min="1.0" max="15.0" value="${tr.axleLoadT}"></label>
              </div>
              <label class="toggle-row"><span>☣️ ${bundle.hazmatAdr}</span><input id="in-adr" type="checkbox" ${tr.hazmat ? 'checked' : ''}></label>
              <label class="toggle-row"><span>🛣️ ${bundle.avoidTolls}</span><input id="in-ttoll" type="checkbox" ${tr.avoidTolls ? 'checked' : ''}></label>
              <label class="toggle-row"><span>⛴️ ${bundle.avoidFerries}</span><input id="in-tferry" type="checkbox" ${tr.avoidFerries ? 'checked' : ''}></label>
            `
                : this.settings.mode === 'auto'
                  ? `
              <label class="toggle-row"><span>📏 ${bundle.shortestRoute}</span><input id="in-short" type="checkbox" ${this.settings.car.shortest ? 'checked' : ''}></label>
              <label class="toggle-row"><span>🛣️ ${bundle.avoidTolls}</span><input id="in-ctoll" type="checkbox" ${this.settings.car.avoidTolls ? 'checked' : ''}></label>
              <label class="toggle-row"><span>🏎️ ${bundle.avoidHighways}</span><input id="in-chwy" type="checkbox" ${this.settings.car.avoidHighways ? 'checked' : ''}></label>
              <label class="toggle-row"><span>⛴️ ${bundle.avoidFerries}</span><input id="in-cferry" type="checkbox" ${this.settings.car.avoidFerries ? 'checked' : ''}></label>
            `
                  : this.settings.mode === 'bicycle'
                    ? `
              <label class="field">${bundle.bikeType}
                <select id="in-btype">
                  ${['City', 'Hybrid', 'Road', 'Mountain'].map((bt) => `<option value="${bt}" ${this.settings.bike.bicycleType === bt ? 'selected' : ''}>${bt}</option>`).join('')}
                </select>
              </label>
              <label class="toggle-row"><span>⛰️ ${bundle.avoidHills}</span><input id="in-hills" type="checkbox" ${this.settings.bike.useHills < 0.4 ? 'checked' : ''}></label>
            `
                    : `
              <label class="field">${bundle.walkSpeed}<input id="in-wspeed" type="number" step="0.2" min="2.5" max="8.0" value="${this.settings.walk.walkingSpeedKmh}"></label>
              <label class="toggle-row"><span>🪜 ${bundle.avoidStairs}</span><input id="in-stairs" type="checkbox" ${this.settings.walk.avoidStairs ? 'checked' : ''}></label>
            `
            }

            <button class="primary-btn" id="btn-save-vehicle">${bundle.saveSettings}</button>
          </div>
        </div>
      `;

      container.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
        b.addEventListener('click', () => {
          const pid = b.dataset.preset as TruckPresetId;
          this.settings.truck = { ...this.settings.truck, presetId: pid, ...TRUCK_PRESETS[pid] };
          saveSettings(this.settings);
          this.renderModal();
        });
      });

      container.querySelector('#btn-save-vehicle')?.addEventListener('click', () => {
        if (this.settings.mode === 'truck') {
          this.settings.truck.heightM = Number((container.querySelector('#in-h') as HTMLInputElement).value) || 4.0;
          this.settings.truck.widthM = Number((container.querySelector('#in-w') as HTMLInputElement).value) || 2.55;
          this.settings.truck.lengthM = Number((container.querySelector('#in-l') as HTMLInputElement).value) || 16.5;
          this.settings.truck.weightT = Number((container.querySelector('#in-wt') as HTMLInputElement).value) || 40;
          this.settings.truck.axleLoadT = Number((container.querySelector('#in-ax') as HTMLInputElement).value) || 11.5;
          this.settings.truck.hazmat = (container.querySelector('#in-adr') as HTMLInputElement).checked;
          this.settings.truck.avoidTolls = (container.querySelector('#in-ttoll') as HTMLInputElement).checked;
          this.settings.truck.avoidFerries = (container.querySelector('#in-tferry') as HTMLInputElement).checked;
        } else if (this.settings.mode === 'auto') {
          this.settings.car.shortest = (container.querySelector('#in-short') as HTMLInputElement).checked;
          this.settings.car.avoidTolls = (container.querySelector('#in-ctoll') as HTMLInputElement).checked;
          this.settings.car.avoidHighways = (container.querySelector('#in-chwy') as HTMLInputElement).checked;
          this.settings.car.avoidFerries = (container.querySelector('#in-cferry') as HTMLInputElement).checked;
        } else if (this.settings.mode === 'bicycle') {
          this.settings.bike.bicycleType = (container.querySelector('#in-btype') as HTMLSelectElement).value as AppSettings['bike']['bicycleType'];
          this.settings.bike.useHills = (container.querySelector('#in-hills') as HTMLInputElement).checked ? 0.1 : 0.7;
        } else {
          this.settings.walk.walkingSpeedKmh = Number((container.querySelector('#in-wspeed') as HTMLInputElement).value) || 5.1;
          this.settings.walk.avoidStairs = (container.querySelector('#in-stairs') as HTMLInputElement).checked;
        }
        saveSettings(this.settings);
        this.modal = null;
        this.renderUi();
        void this.refreshRoadSigns(true);
        if (this.destination) void this.computeActiveRoute();
      });
    } else if (this.modal === 'saved') {
      const activePlace = this.destination ?? this.tappedPlace;
      container.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="modal-card">
            <div class="modal-header">
              <h2>⭐ ${bundle.savedPlaces}</h2>
              <button class="round-icon-btn" id="modal-close">✕</button>
            </div>
            ${
              activePlace
                ? `
              <div class="btn-row">
                <button class="secondary-btn" id="btn-set-home" style="flex:1;">🏠 ${bundle.setAsHome}</button>
                <button class="secondary-btn" id="btn-set-work" style="flex:1;">💼 ${bundle.setAsWork}</button>
              </div>
            `
                : ''
            }
            <div class="steps-list" style="max-height:300px;border-top:none;">
              ${
                this.settings.homePlace
                  ? `<button class="search-item" data-saved="home"><strong>🏠 ${bundle.home}: ${this.escapeHtml(this.settings.homePlace.name)}</strong><small>${this.escapeHtml(this.settings.homePlace.subtitle)}</small></button>`
                  : ''
              }
              ${
                this.settings.workPlace
                  ? `<button class="search-item" data-saved="work"><strong>💼 ${bundle.work}: ${this.escapeHtml(this.settings.workPlace.name)}</strong><small>${this.escapeHtml(this.settings.workPlace.subtitle)}</small></button>`
                  : ''
              }
              ${this.settings.favorites
                .map(
                  (f, i) => `
                <button class="search-item" data-saved="fav-${i}"><strong>⭐ ${this.escapeHtml(f.name)}</strong><small>${this.escapeHtml(f.subtitle)}</small></button>
              `
                )
                .join('')}
              ${this.settings.recents
                .map(
                  (r, i) => `
                <button class="search-item" data-saved="rec-${i}"><strong>🕒 ${this.escapeHtml(r.name)}</strong><small>${this.escapeHtml(r.subtitle)}</small></button>
              `
                )
                .join('')}
            </div>
            <button class="secondary-btn" id="btn-clear-hist">${bundle.clearHistory}</button>
          </div>
        </div>
      `;

      container.querySelector('#btn-set-home')?.addEventListener('click', () => {
        if (!activePlace) return;
        this.settings.homePlace = { ...activePlace, kind: 'home', savedAt: Date.now() };
        saveSettings(this.settings);
        this.renderModal();
      });
      container.querySelector('#btn-set-work')?.addEventListener('click', () => {
        if (!activePlace) return;
        this.settings.workPlace = { ...activePlace, kind: 'work', savedAt: Date.now() };
        saveSettings(this.settings);
        this.renderModal();
      });
      container.querySelector('#btn-clear-hist')?.addEventListener('click', () => {
        this.settings.recents = [];
        saveSettings(this.settings);
        this.renderModal();
      });
      container.querySelectorAll<HTMLButtonElement>('[data-saved]').forEach((b) => {
        b.addEventListener('click', () => {
          const k = b.dataset.saved!;
          let p: GeocodedPlace | null = null;
          if (k === 'home') p = this.settings.homePlace;
          else if (k === 'work') p = this.settings.workPlace;
          else if (k.startsWith('fav-')) p = this.settings.favorites[Number(k.slice(4))] ?? null;
          else if (k.startsWith('rec-')) p = this.settings.recents[Number(k.slice(4))] ?? null;
          if (p) {
            this.modal = null;
            this.selectDestination(p);
          }
        });
      });
    } else if (this.modal === 'settings') {
      container.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="modal-card">
            <div class="modal-header">
              <h2>🌐 ${bundle.settingsTitle}</h2>
              <button class="round-icon-btn" id="modal-close">✕</button>
            </div>

            <div style="font-size:12px;font-weight:800;">${bundle.languageLabel}</div>
            <div class="lang-grid">
              ${SUPPORTED_LANGUAGES.map(
                (l) => `
                <button class="lang-btn ${this.settings.language === l.code ? 'active' : ''}" data-lang="${l.code}">
                  ${l.flag} ${l.label}
                </button>
              `
              ).join('')}
            </div>

            <div class="form-grid">
              <label class="field">${bundle.themeLabel}
                <select id="set-theme">
                  <option value="night" ${this.settings.mapTheme === 'night' ? 'selected' : ''}>🌙 ${bundle.nightTheme}</option>
                  <option value="day" ${this.settings.mapTheme === 'day' ? 'selected' : ''}>☀️ ${bundle.dayTheme}</option>
                </select>
              </label>
              <label class="field">${bundle.unitsLabel}
                <select id="set-units">
                  <option value="metric" ${this.settings.units === 'metric' ? 'selected' : ''}>${bundle.metricUnits}</option>
                  <option value="imperial" ${this.settings.units === 'imperial' ? 'selected' : ''}>${bundle.imperialUnits}</option>
                </select>
              </label>
            </div>

            <label class="toggle-row"><span>🔊 ${bundle.voiceLabel}</span><input id="set-voice" type="checkbox" ${this.settings.voiceEnabled ? 'checked' : ''}></label>
            <label class="toggle-row"><span>🔄 ${bundle.autoRerouteLabel}</span><input id="set-reroute" type="checkbox" ${this.settings.autoReroute ? 'checked' : ''}></label>
            <button class="secondary-btn" id="btn-test-voice">🗣️ ${bundle.testVoice}</button>

            <div style="border-top:1px solid var(--border);padding-top:10px;display:flex;flex-direction:column;gap:6px;">
              <strong style="font-size:12px;">${bundle.proRoutingTitle}</strong>
              <span style="font-size:11px;color:var(--muted);">${bundle.proRoutingDesc}</span>
              <label class="field">${bundle.orsKeyLabel}<input id="set-ors" type="text" value="${this.escapeHtml(this.settings.orsApiKey)}" placeholder="eyJvcmciOi..."></label>
              <label class="field">${bundle.hereKeyLabel}<input id="set-here" type="text" value="${this.escapeHtml(this.settings.hereApiKey)}" placeholder="HERE API Key"></label>
              <label class="field">${bundle.valhallaUrlLabel}<input id="set-valhalla" type="url" value="${this.escapeHtml(this.settings.customValhallaUrl)}"></label>
            </div>

            <button class="primary-btn" id="btn-save-settings">${bundle.saveSettings}</button>
          </div>
        </div>
      `;

      container.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
        b.addEventListener('click', () => {
          this.settings.language = b.dataset.lang as AppSettings['language'];
          saveSettings(this.settings);
          this.renderModal();
          this.renderUi();
        });
      });

      container.querySelector('#btn-test-voice')?.addEventListener('click', () => {
        const b = t(this.settings.language);
        void voiceNav.speak(b.voiceSample, this.settings.language, true, true);
      });

      container.querySelector('#btn-save-settings')?.addEventListener('click', () => {
        this.settings.mapTheme = (container.querySelector('#set-theme') as HTMLSelectElement).value as AppSettings['mapTheme'];
        this.settings.units = (container.querySelector('#set-units') as HTMLSelectElement).value as AppSettings['units'];
        this.settings.voiceEnabled = (container.querySelector('#set-voice') as HTMLInputElement).checked;
        this.settings.autoReroute = (container.querySelector('#set-reroute') as HTMLInputElement).checked;
        this.settings.orsApiKey = (container.querySelector('#set-ors') as HTMLInputElement).value.trim();
        this.settings.hereApiKey = (container.querySelector('#set-here') as HTMLInputElement).value.trim();
        this.settings.customValhallaUrl =
          (container.querySelector('#set-valhalla') as HTMLInputElement).value.trim() ||
          'https://valhalla1.openstreetmap.de/route';
        saveSettings(this.settings);
        this.applyBodyTheme();
        this.mapCtrl?.setTheme(this.settings.mapTheme);
        this.modal = null;
        this.renderUi();
        if (this.destination) void this.computeActiveRoute();
      });
    }

    container.querySelector('#modal-close')?.addEventListener('click', () => {
      this.modal = null;
      this.renderModal();
    });
    container.querySelector('#modal-bg')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'modal-bg') {
        this.modal = null;
        this.renderModal();
      }
    });
  }

  private showToast(msg: string): void {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.remove(), 3400);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new BestGpsApp(appRoot);
}
