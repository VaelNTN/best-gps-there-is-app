import './style.css';
import { SUPPORTED_LANGUAGES, t } from './i18n/translations';
import { MapController } from './map/mapController';
import { fetchNearbyPois, parseCoordinatesInput, PoiFilterKind, reverseGeocode, searchPlaces } from './services/geocoding';
import {
  angleDiffDeg,
  DEFAULT_FALLBACK_FIX,
  filterGpsFix,
  GpsWatcher,
  requestInitialGpsFix,
} from './services/location';
import { radioEngine, RadioSnapshot } from './services/radioEngine';
import { fetchRoadSignsAround, renderRoadSignSvg } from './services/roadSigns';
import { calculateRoutes, computeBearing, distanceToRouteMeters, haversineMeters } from './services/routing';
import { voiceNav } from './services/voice';
import { assistantReplies } from './services/voiceAssistantReplies';
import { ParsedVoiceCommand, parseVoiceCommand, voiceListener } from './services/voiceCommands';
import {
  addRecentPlace,
  deleteCustomVehicle,
  loadSettings,
  saveSettings,
  selectCustomVehicle,
  toggleFavoritePlace,
  TRUCK_PRESETS,
  upsertCustomVehicle,
  VOICE_STYLE_PRESETS,
} from './storage/settings';
import {
  AppSettings,
  CustomVehicle,
  GeocodedPlace,
  GpsFix,
  LatLng,
  ManeuverKind,
  PoiItem,
  RadioGenreFilter,
  RoadSignItem,
  RouteOption,
  TransportMode,
  TruckPresetId,
  VoiceStyle,
} from './types/navigation';

type ModalKind = null | 'vehicle' | 'vehicles' | 'saved' | 'settings' | 'coords' | 'radio';

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
  private simDistanceM = 0;
  private simCumDist: number[] = [];
  private simMultiplier: 1 | 3 | 8 | 20 = 3;
  private lastHudRenderAt = 0;
  private followCamera = true;
  private lastSpokenStepKey = '';
  private lastSpokenNavInstruction = '';
  private lastRerouteAt = 0;
  private offRouteStreak = 0;

  private isListening = false;
  private handsfreeLoopActive = false;
  private voiceBanner: { heard?: string; reply?: string; showHints?: boolean } | null = null;
  private voiceBannerTimer = 0;

  private radioSnap: RadioSnapshot = radioEngine.getSnapshot();
  private radioModalTab: 'stations' | 'blocked' = 'stations';
  private radioModalPointerDown = false;

  private modal: ModalKind = null;
  private launcherOpen = true;
  private launcherTab: 'modes' | 'vehicles' = 'modes';
  private quickSetupMode: TransportMode | null = null;
  private editingVehicle: CustomVehicle | null = null;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    radioEngine.setAutoDj(this.settings.radioAutoDj);
    radioEngine.setBlockedStations(this.settings.blockedRadioStations);
    this.applyBodyTheme();
    this.renderShell();
    voiceNav.setSpeechDuckCallback((speaking) => {
      radioEngine.setVoiceDucking(speaking, this.isListening);
    });
    radioEngine.subscribe((snap) => {
      this.radioSnap = snap;
      this.updateRadioDom();
    });
    void this.initServices();
  }

  private applyBodyTheme(): void {
    document.body.classList.toggle('theme-day', this.settings.mapTheme === 'day');
  }

  private async initServices(): Promise<void> {
    const initial = await requestInitialGpsFix();
    this.currentFix = initial.fix;
    this.hasLiveGps = initial.hasLiveGps;
    radioEngine.setGenreFilter(this.settings.radioGenreFilter, this.currentFix.lat, this.currentFix.lon);

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

    if (this.launcherOpen) {
      layer.innerHTML = this.renderStartupOverlay(bundle);
      this.bindStartupEvents();
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
          <button class="round-icon-btn" id="btn-open-launcher" title="${bundle.chooseModeTitle}">☰</button>
          <input
            id="search-box"
            class="search-input"
            type="search"
            placeholder="${bundle.searchPlaceholder}"
            value="${this.destination ? this.escapeHtml(this.destination.name) : ''}"
          />
          <button
            class="round-icon-btn ${this.isListening ? 'mic-listening' : this.settings.voiceHandsfree ? 'mic-handsfree' : ''}"
            id="btn-mic-listen"
            title="${bundle.micBtnTitle}"
          >🎙️</button>
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
          <button class="pill-chip ${this.radioSnap.isPlaying ? 'radio-active' : ''}" id="btn-toggle-radio">
            📻 ${bundle.radioChip}
          </button>
          <button class="pill-chip" id="btn-open-coords">
            📍 ${bundle.coordsChip}
          </button>
          <button class="pill-chip ${this.settings.voiceHandsfree ? 'active' : ''}" id="btn-toggle-handsfree">
            🎧 ${bundle.handsfreeChip}
          </button>
          <button class="pill-chip ${this.settings.mode === 'truck' ? 'highlight' : ''}" id="btn-open-vehicles">
            🚛 ${bundle.vehiclesTab} (${this.settings.savedVehicles.length})${this.settings.mode === 'truck' ? ` • ${truckSummary}` : ''}
          </button>
          <button class="pill-chip" id="btn-open-vehicle">
            ⚙️ ${bundle.vehicleSettings}
          </button>
          <button class="pill-chip ${this.settings.showRoadSigns ? 'active' : ''}" id="btn-toggle-signs">
            🚸 ${bundle.roadSignsChip}${this.settings.showRoadSigns && this.roadSigns.length > 0 ? ` (${this.roadSigns.length})` : ''}
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

        ${this.renderVoiceAssistantBanner(bundle)}
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
        <div id="radio-mini-slot">${this.renderRadioMiniBar(bundle)}</div>
        <div id="vehicle-cockpit-slot">${this.renderVehicleCockpit(bundle)}</div>
        ${this.renderBottomSheet(bundle, activeRoute)}
      </div>
    `;

    this.bindPlanningEvents();
    this.renderModal();
  }

  private renderRadioMiniBar(bundle: ReturnType<typeof t>): string {
    const snap = this.radioSnap;
    if (!snap.isPlaying && !snap.isLoading) return '';
    const st = snap.currentStation;
    const freqLabel = st?.frequencyLabel || 'FM';
    const stationName = st?.name || bundle.radioScanning;
    const trackText = snap.isLoading
      ? bundle.radioScanning
      : st?.lastTitle || (st?.state === 'music_started' ? `🟢 ${bundle.radioFreshStart}` : bundle.radioMusicBadge);
    const conf = Math.max(10, Math.min(100, Math.round(snap.musicConfidence || 75)));

    return `
      <div class="radio-mini-bar">
        <div class="radio-mini-info" id="btn-radio-mini-open">
          <div class="radio-mini-top">
            <span class="radio-freq-pill">${this.escapeHtml(freqLabel)}</span>
            <span class="radio-station-name">📻 ${this.escapeHtml(stationName)}</span>
          </div>
          <div class="radio-track-line">${this.escapeHtml(trackText)}</div>
          <div class="radio-dsp-meter" title="Music confidence ${conf}%">
            <div class="radio-dsp-fill" style="width:${conf}%;"></div>
          </div>
        </div>
        <div class="radio-mini-actions">
          <button type="button" class="round-icon-btn" id="btn-radio-next" title="${bundle.radioNextBtn}">⏭️</button>
          ${
            st
              ? `<button type="button" class="round-icon-btn" id="btn-radio-mini-block" title="${bundle.radioBlockTitle}">🚫</button>`
              : ''
          }
          <button type="button" class="round-icon-btn" id="btn-radio-scanner" title="${bundle.radioModalTitle}">📡</button>
          <button type="button" class="round-icon-btn" id="btn-radio-stop" title="${bundle.stopNav}">⏹️</button>
        </div>
      </div>
    `;
  }

  private bindRadioMiniEvents(): void {
    const openScanner = (): void => {
      this.modal = 'radio';
      this.renderModal();
    };
    this.root.querySelector('#btn-radio-mini-open')?.addEventListener('click', openScanner);
    this.root.querySelector('#btn-radio-scanner')?.addEventListener('click', openScanner);
    this.root.querySelector('#btn-radio-next')?.addEventListener('click', () => {
      void radioEngine.skipToNextMusic('manual_skip');
    });
    this.root.querySelector('#btn-radio-mini-block')?.addEventListener('click', () => {
      const curr = this.radioSnap.currentStation;
      if (curr) this.blockRadioStation(curr);
    });
    this.root.querySelector('#btn-radio-stop')?.addEventListener('click', () => {
      radioEngine.stop();
    });
  }

  private updateRadioDom(): void {
    const bundle = t(this.settings.language);
    const slot = this.root.querySelector<HTMLElement>('#radio-mini-slot');
    if (slot) {
      slot.innerHTML = this.renderRadioMiniBar(bundle);
      this.bindRadioMiniEvents();
    }
    const planBtn = this.root.querySelector<HTMLButtonElement>('#btn-toggle-radio');
    if (planBtn) {
      planBtn.classList.toggle('radio-active', this.radioSnap.isPlaying);
    }
    const navBtn = this.root.querySelector<HTMLButtonElement>('#btn-nav-radio');
    if (navBtn) {
      navBtn.classList.toggle('mic-handsfree', this.radioSnap.isPlaying);
    }
    if (this.modal === 'radio' && !this.radioModalPointerDown) {
      const body = this.root.querySelector<HTMLElement>('#modal-radio-body');
      if (body) {
        const prevScroll = body.querySelector<HTMLElement>('.radio-stations-list')?.scrollTop ?? 0;
        body.innerHTML = this.renderRadioModalBody(bundle);
        const newList = body.querySelector<HTMLElement>('.radio-stations-list');
        if (newList) newList.scrollTop = prevScroll;
      }
    }
  }

  private renderVoiceAssistantBanner(bundle: ReturnType<typeof t>): string {
    if (!this.isListening && !this.voiceBanner) return '';
    const b = this.voiceBanner;
    const showQuickChips = this.isListening || Boolean(b?.showHints);
    return `
      <div class="voice-assistant-pill ${this.isListening ? 'listening' : ''}">
        <div class="voice-assistant-row">
          <strong style="font-size:12px;">${this.isListening ? '🎙️ ...' : '💬 Road Mapper'}</strong>
          <button type="button" class="round-icon-btn" id="btn-voice-banner-close" style="width:26px;height:26px;font-size:12px;">✕</button>
        </div>
        ${this.isListening ? `<div class="voice-reply">${this.escapeHtml(bundle.voiceListeningPrompt)}</div>` : ''}
        ${b?.heard ? `<div class="voice-heard">“${this.escapeHtml(b.heard)}”</div>` : ''}
        ${b?.reply ? `<div class="voice-reply">🔊 ${this.escapeHtml(b.reply)}</div>` : ''}
        ${
          showQuickChips
            ? `
          <div class="voice-hints-row">
            <button type="button" class="voice-hint-chip" data-voice-sim="${this.escapeHtml(bundle.voiceQuickHint1)}">${this.escapeHtml(bundle.voiceQuickHint1)}</button>
            <button type="button" class="voice-hint-chip" data-voice-sim="${this.escapeHtml(bundle.voiceQuickHint2)}">${this.escapeHtml(bundle.voiceQuickHint2)}</button>
            <button type="button" class="voice-hint-chip" data-voice-sim="${this.escapeHtml(bundle.voiceQuickHint3)}">${this.escapeHtml(bundle.voiceQuickHint3)}</button>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private getModeIcon(mode: TransportMode): string {
    switch (mode) {
      case 'pedestrian':
        return '🚶';
      case 'bicycle':
        return '🚲';
      case 'auto':
        return '🚗';
      case 'truck':
        return '🚛';
    }
  }

  private getModeSummary(mode: TransportMode, bundle: ReturnType<typeof t>): string {
    if (mode === 'pedestrian') {
      const sp = `${this.settings.walk.walkingSpeedKmh.toFixed(1)} ${bundle.speedUnit}`;
      return this.settings.walk.avoidStairs ? `${sp} • 🪜✕` : sp;
    }
    if (mode === 'bicycle') {
      const parts: string[] = [this.settings.bike.bicycleType];
      if (this.settings.bike.useHills < 0.4) parts.push('⛰️✕');
      if (this.settings.bike.avoidBadRoads) parts.push('🪨✕');
      return parts.join(' • ');
    }
    if (mode === 'auto') {
      const parts: string[] = [this.settings.car.shortest ? '📏' : `⚡ ${bundle.fastestRoute.split(' ')[0]}`];
      if (this.settings.car.avoidTolls) parts.push('Tol✕');
      if (this.settings.car.avoidHighways) parts.push('Hwy✕');
      if (this.settings.car.avoidFerries) parts.push('⛴️✕');
      return parts.join(' • ');
    }
    return `${this.settings.truck.heightM.toFixed(1)}m H • ${this.settings.truck.weightT}t${
      this.settings.truck.hazmat ? ' • ADR' : ''
    }`;
  }

  private enterMode(mode: TransportMode, forceSetup = false): void {
    this.settings.mode = mode;
    const isConfigured = Boolean(this.settings.configuredModes[mode]);
    if (forceSetup || !isConfigured) {
      this.quickSetupMode = mode;
      this.launcherOpen = true;
      saveSettings(this.settings);
      this.renderUi();
      return;
    }
    saveSettings(this.settings);
    this.launcherOpen = false;
    this.quickSetupMode = null;
    this.renderUi();
    void this.refreshRoadSigns(true);
    if (this.destination) void this.computeActiveRoute();
    if (this.activePoiFilter) void this.loadPois(this.activePoiFilter);
  }

  private renderStartupOverlay(bundle: ReturnType<typeof t>): string {
    if (this.quickSetupMode) {
      const mode = this.quickSetupMode;
      return `
        <div class="startup-overlay">
          <div class="launcher-card">
            <div class="launcher-header">
              <div>
                <div class="launcher-brand">${this.getModeIcon(mode)} ${bundle.launcherModes[mode]}</div>
                <h1 class="launcher-title">${bundle.vehicleSettings}</h1>
                <p class="launcher-sub">${bundle.quickSetupHint}</p>
              </div>
              <button type="button" class="secondary-btn" id="btn-quick-back">← ${bundle.backLabel}</button>
            </div>

            ${this.renderQuickSetupBody(mode, bundle)}

            <button type="button" class="primary-btn" id="btn-quick-go" style="width:100%;padding:13px 16px;font-size:15px;">
              ✅ ${bundle.saveAndGo}
            </button>
          </div>
        </div>
      `;
    }

    const modes: TransportMode[] = ['pedestrian', 'bicycle', 'auto', 'truck'];
    return `
      <div class="startup-overlay">
        <div class="launcher-card">
          <div class="launcher-header">
            <div>
              <div class="launcher-brand">🧭 ${bundle.appTitle}</div>
              <h1 class="launcher-title">${
                this.launcherTab === 'vehicles' ? bundle.myVehiclesTitle : bundle.chooseModeTitle
              }</h1>
              <p class="launcher-sub">${
                this.launcherTab === 'vehicles' ? bundle.vehicleRoutingNote : bundle.chooseModeSub
              }</p>
            </div>
            <button type="button" class="round-icon-btn" id="btn-launcher-settings" title="${bundle.settingsTitle}">🌐</button>
          </div>

          <div class="launcher-tabs">
            <button type="button" class="launcher-tab-btn ${this.launcherTab === 'modes' ? 'active' : ''}" data-launch-tab="modes">
              🧭 ${bundle.chooseModeTab}
            </button>
            <button type="button" class="launcher-tab-btn ${this.launcherTab === 'vehicles' ? 'active' : ''}" data-launch-tab="vehicles">
              🚛 ${bundle.vehiclesTab} (${this.settings.savedVehicles.length})
            </button>
          </div>

          ${
            this.launcherTab === 'vehicles'
              ? `<div id="launcher-vehicles-body">${this.renderVehiclesTabBody(bundle)}</div>`
              : `
          <div class="launcher-grid">
            ${modes
              .map((m) => {
                const configured = Boolean(this.settings.configuredModes[m]);
                return `
                <div role="button" tabindex="0" class="mode-hero-card ${configured ? 'configured' : ''}" data-launch-mode="${m}">
                  <div class="mode-hero-top">
                    <span class="mode-hero-ico">${this.getModeIcon(m)}</span>
                    ${
                      configured
                        ? `<button type="button" class="mode-hero-edit" data-edit-mode="${m}" title="${bundle.editLabel}">⚙️</button>`
                        : ''
                    }
                  </div>
                  <div class="mode-hero-title">${bundle.launcherModes[m]}</div>
                  <div class="mode-hero-desc">${bundle.modeSubtitles[m]}</div>
                  <div class="mode-hero-badge ${configured ? 'saved' : ''}">
                    ${configured ? `✅ ${this.getModeSummary(m, bundle)}` : `⚡ ${bundle.quickPickTag}`}
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
          `
          }

          <div class="launcher-footer">
            <div class="quick-lang-strip">
              ${SUPPORTED_LANGUAGES.map(
                (l) => `
                <button type="button" class="quick-lang-btn ${this.settings.language === l.code ? 'active' : ''}" data-quick-lang="${l.code}">
                  ${l.flag} ${l.code.toUpperCase()}
                </button>
              `
              ).join('')}
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="round-icon-btn" id="btn-launch-theme" title="${bundle.themeLabel}">
                ${this.settings.mapTheme === 'night' ? '☀️' : '🌙'}
              </button>
              <button type="button" class="round-icon-btn" id="btn-launch-voice" title="${bundle.voiceLabel}">
                ${this.settings.voiceEnabled ? '🔊' : '🔇'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderVehiclesTabBody(bundle: ReturnType<typeof t>): string {
    if (this.editingVehicle) {
      const ev = this.editingVehicle;
      const p = ev.profile;
      const icons = ['🚛', '🚚', '🚐', '🚌', '🚜'];
      const presets: [TruckPresetId, string][] = [
        ['van', bundle.presetVan],
        ['box12', bundle.presetBox12],
        ['semi40', bundle.presetSemi40],
        ['lzv60', bundle.presetLzv60],
        ['camper', bundle.presetCamper],
      ];
      const isExisting = this.settings.savedVehicles.some((v) => v.id === ev.id);

      return `
        <div class="vehicle-editor-box">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <strong style="font-size:14px;">${isExisting ? `✏️ ${bundle.editVehicleTitle}` : `➕ ${bundle.newVehicleTitle}`}</strong>
            <button type="button" class="secondary-btn" id="btn-veh-cancel" style="padding:6px 10px;">← ${bundle.backLabel}</button>
          </div>

          <div class="quick-chips-row">
            ${presets
              .map(
                ([id, label]) => `
              <button type="button" class="pill-chip ${p.presetId === id ? 'highlight' : ''}" data-veh-preset="${id}">${label}</button>
            `
              )
              .join('')}
          </div>

          <label class="field">${bundle.vehicleNameLabel}
            <input id="veh-in-name" type="text" placeholder="${bundle.vehicleNamePlaceholder}" value="${this.escapeHtml(ev.name)}">
          </label>

          <div class="icon-picker-row">
            ${icons
              .map(
                (ico) => `
              <button type="button" class="icon-pick-btn ${ev.icon === ico ? 'active' : ''}" data-veh-icon="${ico}">${ico}</button>
            `
              )
              .join('')}
          </div>

          <div class="form-grid">
            <label class="field">${bundle.heightM}<input id="veh-in-h" type="number" step="0.05" min="1.5" max="5.0" value="${p.heightM}"></label>
            <label class="field">${bundle.widthM}<input id="veh-in-w" type="number" step="0.05" min="1.5" max="3.8" value="${p.widthM}"></label>
            <label class="field">${bundle.lengthM}<input id="veh-in-l" type="number" step="0.25" min="3.0" max="35.0" value="${p.lengthM}"></label>
            <label class="field">${bundle.weightT}<input id="veh-in-wt" type="number" step="0.5" min="1.5" max="90.0" value="${p.weightT}"></label>
            <label class="field">${bundle.axleLoadT}<input id="veh-in-ax" type="number" step="0.5" min="1.0" max="15.0" value="${p.axleLoadT}"></label>
          </div>

          <div class="quick-chips-row">
            <button type="button" class="quick-chip ${p.hazmat ? 'active-amber' : ''}" data-veh-toggle="hazmat">☣️ ${bundle.hazmatAdr}</button>
            <button type="button" class="quick-chip ${p.avoidUnpaved ? 'active-amber' : ''}" data-veh-toggle="avoidUnpaved">🪨 ${bundle.avoidUnpaved}</button>
            <button type="button" class="quick-chip ${p.avoidTolls ? 'active-amber' : ''}" data-veh-toggle="avoidTolls">🛣️ ${bundle.avoidTolls}</button>
            <button type="button" class="quick-chip ${p.avoidFerries ? 'active-amber' : ''}" data-veh-toggle="avoidFerries">⛴️ ${bundle.avoidFerries}</button>
          </div>

          <button type="button" class="primary-btn" id="btn-veh-save" style="width:100%;">✅ ${bundle.saveSettings}</button>
        </div>
      `;
    }

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-size:12px;color:var(--muted);flex:1;">${bundle.vehicleRoutingNote}</span>
        <button type="button" class="primary-btn" id="btn-veh-add" style="flex:0 0 auto;padding:8px 12px;">➕ ${bundle.addVehicleBtn}</button>
      </div>

      <div class="vehicles-list">
        ${this.settings.savedVehicles
          .map((v) => {
            const isActive = this.settings.activeVehicleId === v.id;
            const pr = v.profile;
            return `
            <div class="vehicle-card ${isActive ? 'active' : ''}">
              <div class="vehicle-card-top">
                <div class="vehicle-card-title">
                  <span style="font-size:22px;">${v.icon}</span>
                  <span class="v-name">${this.escapeHtml(v.name)}</span>
                </div>
                ${isActive ? `<span class="vehicle-active-tag">✅ ${bundle.activeBadge}</span>` : ''}
              </div>
              <div class="vehicle-card-specs">
                <span>↕️ ${pr.heightM.toFixed(2)}m</span>
                <span>↔️ ${pr.widthM.toFixed(2)}m</span>
                <span>📏 ${pr.lengthM.toFixed(1)}m</span>
                <span>⚖️ ${pr.weightT}t</span>
                <span>🛞 ${pr.axleLoadT}t</span>
                ${pr.hazmat ? '<span>☣️ ADR</span>' : ''}
                ${pr.avoidTolls ? '<span>🛣️✕</span>' : ''}
                ${pr.avoidFerries ? '<span>⛴️✕</span>' : ''}
              </div>
              <div class="vehicle-card-actions">
                <button type="button" class="primary-btn" data-veh-use="${this.escapeHtml(v.id)}" style="padding:7px 10px;font-size:12px;">
                  ▶ ${bundle.useVehicleBtn}
                </button>
                <button type="button" class="secondary-btn" data-veh-edit="${this.escapeHtml(v.id)}" title="${bundle.editLabel}">✏️</button>
                ${
                  this.settings.savedVehicles.length > 1
                    ? `<button type="button" class="secondary-btn" data-veh-del="${this.escapeHtml(v.id)}" title="${bundle.deleteLabel}">🗑️</button>`
                    : ''
                }
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    `;
  }

  private bindVehiclesTabEvents(scope: Element): void {
    const syncEditorInputs = (): void => {
      if (!this.editingVehicle) return;
      const nameEl = scope.querySelector<HTMLInputElement>('#veh-in-name');
      const h = scope.querySelector<HTMLInputElement>('#veh-in-h');
      const w = scope.querySelector<HTMLInputElement>('#veh-in-w');
      const l = scope.querySelector<HTMLInputElement>('#veh-in-l');
      const wt = scope.querySelector<HTMLInputElement>('#veh-in-wt');
      const ax = scope.querySelector<HTMLInputElement>('#veh-in-ax');
      if (nameEl) this.editingVehicle.name = nameEl.value;
      if (h) this.editingVehicle.profile.heightM = Number(h.value) || 4.0;
      if (w) this.editingVehicle.profile.widthM = Number(w.value) || 2.55;
      if (l) this.editingVehicle.profile.lengthM = Number(l.value) || 16.5;
      if (wt) this.editingVehicle.profile.weightT = Number(wt.value) || 40;
      if (ax) this.editingVehicle.profile.axleLoadT = Number(ax.value) || 11.5;
    };

    const refresh = (): void => {
      if (this.modal === 'vehicles') this.renderModal();
      else this.renderUi();
    };

    scope.querySelector('#btn-veh-add')?.addEventListener('click', () => {
      this.editingVehicle = {
        id: `veh-${Date.now()}`,
        name: '',
        icon: '🚛',
        profile: { ...this.settings.truck, presetId: 'custom' },
      };
      refresh();
    });

    scope.querySelector('#btn-veh-cancel')?.addEventListener('click', () => {
      this.editingVehicle = null;
      refresh();
    });

    scope.querySelectorAll<HTMLButtonElement>('[data-veh-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.editingVehicle) return;
        syncEditorInputs();
        const pid = btn.dataset.vehPreset as TruckPresetId;
        this.editingVehicle.profile = { ...this.editingVehicle.profile, presetId: pid, ...TRUCK_PRESETS[pid] };
        refresh();
      });
    });

    scope.querySelectorAll<HTMLButtonElement>('[data-veh-icon]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.editingVehicle) return;
        syncEditorInputs();
        this.editingVehicle.icon = btn.dataset.vehIcon || '🚛';
        refresh();
      });
    });

    scope.querySelectorAll<HTMLButtonElement>('[data-veh-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.editingVehicle) return;
        syncEditorInputs();
        const k = btn.dataset.vehToggle as 'hazmat' | 'avoidUnpaved' | 'avoidTolls' | 'avoidFerries';
        this.editingVehicle.profile[k] = !this.editingVehicle.profile[k];
        refresh();
      });
    });

    scope.querySelector('#btn-veh-save')?.addEventListener('click', () => {
      if (!this.editingVehicle) return;
      syncEditorInputs();
      upsertCustomVehicle(this.settings, this.editingVehicle);
      this.settings.mode = 'truck';
      this.settings.configuredModes.truck = true;
      saveSettings(this.settings);
      this.editingVehicle = null;
      this.showToast(`🚛 ${t(this.settings.language).activeBadge}: ${this.settings.truck.heightM.toFixed(1)}m / ${this.settings.truck.weightT}t`);
      refresh();
      void this.refreshRoadSigns(true);
      if (this.destination) void this.computeActiveRoute();
    });

    scope.querySelectorAll<HTMLButtonElement>('[data-veh-use]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const vid = btn.dataset.vehUse!;
        const selected = selectCustomVehicle(this.settings, vid);
        if (!selected) return;
        this.settings.mode = 'truck';
        this.settings.configuredModes.truck = true;
        saveSettings(this.settings);
        this.launcherOpen = false;
        this.launcherTab = 'modes';
        this.quickSetupMode = null;
        this.modal = null;
        this.showToast(`${selected.icon} ${selected.name}`);
        this.renderUi();
        void this.refreshRoadSigns(true);
        if (this.destination) void this.computeActiveRoute();
      });
    });

    scope.querySelectorAll<HTMLButtonElement>('[data-veh-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = this.settings.savedVehicles.find((item) => item.id === btn.dataset.vehEdit);
        if (!v) return;
        this.editingVehicle = { ...v, profile: { ...v.profile } };
        refresh();
      });
    });

    scope.querySelectorAll<HTMLButtonElement>('[data-veh-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteCustomVehicle(this.settings, btn.dataset.vehDel!);
        refresh();
        void this.refreshRoadSigns(true);
        if (this.destination) void this.computeActiveRoute();
      });
    });
  }

  private renderQuickSetupBody(mode: TransportMode, bundle: ReturnType<typeof t>): string {
    if (mode === 'pedestrian') {
      const speeds = [
        { v: 4.0, label: '🐢 4.0' },
        { v: 5.1, label: '🚶 5.1' },
        { v: 6.5, label: '🏃 6.5' },
      ];
      return `
        <div class="quick-setup-section">
          <div class="quick-setup-label">${bundle.walkSpeed}</div>
          <div class="quick-chips-row">
            ${speeds
              .map(
                (s) => `
              <button type="button" class="quick-chip ${Math.abs(this.settings.walk.walkingSpeedKmh - s.v) < 0.25 ? 'active' : ''}" data-q-wspeed="${s.v}">
                ${s.label} ${bundle.speedUnit}
              </button>
            `
              )
              .join('')}
          </div>
        </div>
        <div class="quick-setup-section">
          <div class="quick-chips-row">
            <button type="button" class="quick-chip ${this.settings.walk.avoidStairs ? 'active' : ''}" data-q-toggle="walk.avoidStairs">
              🪜 ${bundle.avoidStairs}
            </button>
          </div>
        </div>
      `;
    }

    if (mode === 'bicycle') {
      const types: { id: AppSettings['bike']['bicycleType']; ico: string }[] = [
        { id: 'City', ico: '🚲' },
        { id: 'Hybrid', ico: '⚡' },
        { id: 'Road', ico: '🚴' },
        { id: 'Mountain', ico: '🚵' },
      ];
      return `
        <div class="quick-setup-section">
          <div class="quick-setup-label">${bundle.bikeType}</div>
          <div class="quick-chips-row">
            ${types
              .map(
                (bt) => `
              <button type="button" class="quick-chip ${this.settings.bike.bicycleType === bt.id ? 'active' : ''}" data-q-btype="${bt.id}">
                ${bt.ico} ${bt.id}
              </button>
            `
              )
              .join('')}
          </div>
        </div>
        <div class="quick-setup-section">
          <div class="quick-chips-row">
            <button type="button" class="quick-chip ${this.settings.bike.useHills < 0.4 ? 'active' : ''}" data-q-toggle="bike.avoidHills">
              ⛰️ ${bundle.avoidHills}
            </button>
            <button type="button" class="quick-chip ${this.settings.bike.avoidBadRoads ? 'active' : ''}" data-q-toggle="bike.avoidBadRoads">
              🪨 ${bundle.avoidBadRoads}
            </button>
          </div>
        </div>
      `;
    }

    if (mode === 'auto') {
      return `
        <div class="quick-setup-section">
          <div class="quick-chips-row">
            <button type="button" class="quick-chip ${!this.settings.car.shortest ? 'active' : ''}" data-q-car-short="0">
              ⚡ ${bundle.fastestRoute}
            </button>
            <button type="button" class="quick-chip ${this.settings.car.shortest ? 'active' : ''}" data-q-car-short="1">
              📏 ${bundle.shortestRoute}
            </button>
          </div>
        </div>
        <div class="quick-setup-section">
          <div class="quick-chips-row">
            <button type="button" class="quick-chip ${this.settings.car.avoidTolls ? 'active' : ''}" data-q-toggle="car.avoidTolls">
              🛣️ ${bundle.avoidTolls}
            </button>
            <button type="button" class="quick-chip ${this.settings.car.avoidHighways ? 'active' : ''}" data-q-toggle="car.avoidHighways">
              🏎️ ${bundle.avoidHighways}
            </button>
            <button type="button" class="quick-chip ${this.settings.car.avoidFerries ? 'active' : ''}" data-q-toggle="car.avoidFerries">
              ⛴️ ${bundle.avoidFerries}
            </button>
          </div>
        </div>
      `;
    }

    const tr = this.settings.truck;
    const presets: [TruckPresetId, string][] = [
      ['van', bundle.presetVan],
      ['box12', bundle.presetBox12],
      ['semi40', bundle.presetSemi40],
      ['lzv60', bundle.presetLzv60],
      ['camper', bundle.presetCamper],
    ];
    return `
      ${
        this.settings.savedVehicles.length > 0
          ? `
        <div class="quick-setup-section">
          <div class="quick-setup-label">🚛 ${bundle.myVehiclesTitle}</div>
          <div class="quick-chips-row">
            ${this.settings.savedVehicles
              .map(
                (v) => `
              <button type="button" class="quick-chip ${this.settings.activeVehicleId === v.id ? 'active-amber' : ''}" data-q-saved-veh="${this.escapeHtml(v.id)}">
                ${v.icon} ${this.escapeHtml(v.name)}
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `
          : ''
      }
      <div class="quick-setup-section">
        <div class="quick-setup-label">⚙️ ${bundle.truckPresets}</div>
        <div class="quick-chips-row">
          ${presets
            .map(
              ([id, label]) => `
            <button type="button" class="quick-chip ${tr.presetId === id ? 'active-amber' : ''}" data-q-preset="${id}">
              ${label}
            </button>
          `
            )
            .join('')}
        </div>
      </div>
      <div class="form-grid">
        <label class="field">${bundle.heightM}<input id="q-in-h" type="number" step="0.1" min="1.5" max="5.0" value="${tr.heightM}"></label>
        <label class="field">${bundle.widthM}<input id="q-in-w" type="number" step="0.05" min="1.5" max="3.5" value="${tr.widthM}"></label>
        <label class="field">${bundle.lengthM}<input id="q-in-l" type="number" step="0.5" min="3.0" max="30.0" value="${tr.lengthM}"></label>
        <label class="field">${bundle.weightT}<input id="q-in-wt" type="number" step="0.5" min="1.5" max="80.0" value="${tr.weightT}"></label>
        <label class="field">${bundle.axleLoadT}<input id="q-in-ax" type="number" step="0.5" min="1.0" max="15.0" value="${tr.axleLoadT}"></label>
      </div>
      <div class="quick-setup-section">
        <div class="quick-chips-row">
          <button type="button" class="quick-chip ${tr.hazmat ? 'active-amber' : ''}" data-q-toggle="truck.hazmat">
            ☣️ ${bundle.hazmatAdr}
          </button>
          <button type="button" class="quick-chip ${tr.avoidTolls ? 'active-amber' : ''}" data-q-toggle="truck.avoidTolls">
            🛣️ ${bundle.avoidTolls}
          </button>
          <button type="button" class="quick-chip ${tr.avoidFerries ? 'active-amber' : ''}" data-q-toggle="truck.avoidFerries">
            ⛴️ ${bundle.avoidFerries}
          </button>
        </div>
      </div>
    `;
  }

  private bindStartupEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-launch-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.launcherTab = btn.dataset.launchTab as 'modes' | 'vehicles';
        this.editingVehicle = null;
        this.renderUi();
      });
    });

    const vehScope = this.root.querySelector('#launcher-vehicles-body');
    if (vehScope) this.bindVehiclesTabEvents(vehScope);

    this.root.querySelectorAll<HTMLElement>('[data-launch-mode]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-edit-mode]')) return;
        const mode = card.dataset.launchMode as TransportMode;
        this.enterMode(mode, false);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-edit-mode]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.editMode as TransportMode;
        this.enterMode(mode, true);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-quick-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.language = btn.dataset.quickLang as AppSettings['language'];
        saveSettings(this.settings);
        this.renderUi();
      });
    });

    this.root.querySelector('#btn-launch-theme')?.addEventListener('click', () => {
      this.settings.mapTheme = this.settings.mapTheme === 'night' ? 'day' : 'night';
      saveSettings(this.settings);
      this.applyBodyTheme();
      this.mapCtrl?.setTheme(this.settings.mapTheme);
      this.renderUi();
    });

    this.root.querySelector('#btn-launch-voice')?.addEventListener('click', () => {
      this.settings.voiceEnabled = !this.settings.voiceEnabled;
      saveSettings(this.settings);
      if (!this.settings.voiceEnabled) void voiceNav.stop();
      this.renderUi();
    });

    this.root.querySelector('#btn-launcher-settings')?.addEventListener('click', () => {
      this.modal = 'settings';
      this.renderModal();
    });

    this.root.querySelector('#btn-quick-back')?.addEventListener('click', () => {
      this.quickSetupMode = null;
      this.renderUi();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-q-wspeed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.walk.walkingSpeedKmh = Number(btn.dataset.qWspeed) || 5.1;
        this.renderUi();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-q-btype]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.bike.bicycleType = btn.dataset.qBtype as AppSettings['bike']['bicycleType'];
        this.renderUi();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-q-car-short]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.car.shortest = btn.dataset.qCarShort === '1';
        this.renderUi();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-q-saved-veh]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectCustomVehicle(this.settings, btn.dataset.qSavedVeh!);
        this.renderUi();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-q-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.qPreset as TruckPresetId;
        this.settings.truck = { ...this.settings.truck, presetId: pid, ...TRUCK_PRESETS[pid] };
        this.settings.activeVehicleId = null;
        this.renderUi();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-q-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.qToggle!;
        if (key === 'walk.avoidStairs') this.settings.walk.avoidStairs = !this.settings.walk.avoidStairs;
        else if (key === 'bike.avoidHills') this.settings.bike.useHills = this.settings.bike.useHills < 0.4 ? 0.7 : 0.1;
        else if (key === 'bike.avoidBadRoads') this.settings.bike.avoidBadRoads = !this.settings.bike.avoidBadRoads;
        else if (key === 'car.avoidTolls') this.settings.car.avoidTolls = !this.settings.car.avoidTolls;
        else if (key === 'car.avoidHighways') this.settings.car.avoidHighways = !this.settings.car.avoidHighways;
        else if (key === 'car.avoidFerries') this.settings.car.avoidFerries = !this.settings.car.avoidFerries;
        else if (key === 'truck.hazmat') this.settings.truck.hazmat = !this.settings.truck.hazmat;
        else if (key === 'truck.avoidTolls') this.settings.truck.avoidTolls = !this.settings.truck.avoidTolls;
        else if (key === 'truck.avoidFerries') this.settings.truck.avoidFerries = !this.settings.truck.avoidFerries;
        this.renderUi();
      });
    });

    const syncTruckNums = (): void => {
      const h = this.root.querySelector<HTMLInputElement>('#q-in-h');
      const w = this.root.querySelector<HTMLInputElement>('#q-in-w');
      const l = this.root.querySelector<HTMLInputElement>('#q-in-l');
      const wt = this.root.querySelector<HTMLInputElement>('#q-in-wt');
      const ax = this.root.querySelector<HTMLInputElement>('#q-in-ax');
      if (h) this.settings.truck.heightM = Number(h.value) || 4.0;
      if (w) this.settings.truck.widthM = Number(w.value) || 2.55;
      if (l) this.settings.truck.lengthM = Number(l.value) || 16.5;
      if (wt) this.settings.truck.weightT = Number(wt.value) || 40;
      if (ax) this.settings.truck.axleLoadT = Number(ax.value) || 11.5;
    };
    ['#q-in-h', '#q-in-w', '#q-in-l', '#q-in-wt', '#q-in-ax'].forEach((sel) => {
      this.root.querySelector<HTMLInputElement>(sel)?.addEventListener('change', syncTruckNums);
    });

    this.root.querySelector('#btn-quick-go')?.addEventListener('click', () => {
      if (!this.quickSetupMode) return;
      if (this.quickSetupMode === 'truck') syncTruckNums();
      this.settings.mode = this.quickSetupMode;
      this.settings.configuredModes[this.quickSetupMode] = true;
      saveSettings(this.settings);
      this.quickSetupMode = null;
      this.launcherOpen = false;
      this.renderUi();
      void this.refreshRoadSigns(true);
      if (this.destination) void this.computeActiveRoute();
      if (this.activePoiFilter) void this.loadPois(this.activePoiFilter);
    });
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
      const analysis = route.analysis;
      const showSaved = analysis && (analysis.savedMeters >= 300 || analysis.savedSeconds >= 30);
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

          ${
            analysis
              ? `
            <div class="route-best-row">
              <span class="route-best-pill">🏆 ${this.escapeHtml(bundle.routeBestOfLabel(analysis.evaluatedCount))} • ${this.escapeHtml(bundle.routeZeroDetourLabel)}</span>
              ${
                showSaved
                  ? `<span class="route-saved-pill">⚡ ${this.escapeHtml(
                      bundle.routeSavedVsAlt(
                        this.formatDistance(analysis.savedMeters),
                        this.formatDuration(analysis.savedSeconds)
                      )
                    )}</span>`
                  : ''
              }
            </div>
          `
              : ''
          }

          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted);">
            <span>${bundle.modes[route.mode]} • ${bundle.providerLabel}: <b>${route.provider}</b></span>
            ${
              this.hasLiveGps
                ? `<span class="gps-acc-pill" style="color:var(--green);">• 📡 ±${Math.round(this.currentFix.accuracyM)}m</span>`
                : ''
            }
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
          <span class="gps-acc-pill" style="color:${this.hasLiveGps ? 'var(--green)' : 'var(--amber)'};">
            ● ${this.hasLiveGps ? `${bundle.gpsActive} (📡 ±${Math.round(this.currentFix.accuracyM)}m)` : 'GPS Demo'}
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
          <div class="nav-dist-next" id="nav-dist-next">${bundle.inDistance} ${this.formatDistance(progress.distanceToStepM)}</div>
          <div class="nav-street-next">${this.escapeHtml(progress.nextStep.instruction)}</div>
        </div>
      </div>

      <div class="nav-bottom-dock">
        ${this.renderVoiceAssistantBanner(bundle)}
        <div id="radio-mini-slot">${this.renderRadioMiniBar(bundle)}</div>
        ${isVehicle ? this.renderMiniSignsStripHtml() : ''}
        <div class="nav-bottom-bar">
          <div class="nav-bar-main">
            ${
              isVehicle
                ? `
              <div class="speed-badge ${speeding ? 'speeding' : ''}">
                <strong id="hud-speed-val">${sp.value}</strong>
                <small>${sp.unit}</small>
              </div>
              <div class="speed-limit-holder">
                ${this.renderSpeedLimitSignHtml(38)}
              </div>
            `
                : `<div class="speed-badge" style="border-color:var(--green);"><strong>🚶</strong></div>`
            }
            <div style="flex:1;min-width:0;">
              <div style="font-size:16px;font-weight:900;color:var(--green);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${this.formatDuration(progress.remainingSeconds)} • ${this.formatDistance(progress.remainingMeters)}
              </div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${bundle.etaLabel}: <b>${this.formatEta(progress.remainingSeconds)}</b> • ${bundle.modes[this.settings.mode]}${
                  this.isSimulating
                    ? ' (DEMO)'
                    : this.hasLiveGps
                      ? ` • <span style="color:var(--green);font-weight:800;">📡 ±${Math.round(this.currentFix.accuracyM)}m</span>`
                      : ''
                }
              </div>
            </div>
          </div>
          <div class="nav-bar-actions">
            ${
              this.isSimulating
                ? `<button class="sim-mult-btn" id="btn-sim-mult">${this.simMultiplier}x</button>`
                : ''
            }
            <button
              class="round-icon-btn ${this.radioSnap.isPlaying ? 'mic-handsfree' : ''}"
              id="btn-nav-radio"
              title="${bundle.radioChip}"
            >📻</button>
            <button
              class="round-icon-btn ${this.isListening ? 'mic-listening' : this.settings.voiceHandsfree ? 'mic-handsfree' : ''}"
              id="btn-nav-mic"
              title="${bundle.micBtnTitle}"
            >🎙️</button>
            <button class="round-icon-btn" id="btn-nav-voice">${this.settings.voiceEnabled ? '🔊' : '🔇'}</button>
            <button class="round-icon-btn" id="btn-nav-recenter" title="${bundle.recenter}">🎯</button>
            <button class="danger-btn" id="btn-stop-nav">${bundle.stopNav}</button>
          </div>
        </div>
      </div>
    `;
  }

  private bindVoiceBannerEvents(): void {
    this.root.querySelector('#btn-voice-banner-close')?.addEventListener('click', () => {
      if (this.isListening) {
        this.isListening = false;
        this.handsfreeLoopActive = false;
        voiceListener.stop();
        radioEngine.setVoiceDucking(false, false);
      }
      this.voiceBanner = null;
      window.clearTimeout(this.voiceBannerTimer);
      this.renderUi();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-voice-sim]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const phrase = btn.dataset.voiceSim?.trim();
        if (!phrase) return;
        this.isListening = false;
        voiceListener.stop();
        radioEngine.setVoiceDucking(false, false);
        const cmd = parseVoiceCommand(phrase, this.settings.language);
        void this.executeVoiceCommand(cmd, phrase);
      });
    });
  }

  private bindSignPillEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-sign-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = this.roadSigns.find((item) => item.id === btn.dataset.signId);
        if (s) this.handleSignTap(s);
      });
    });
  }

  private handleRadioChipTap(): void {
    if (!this.radioSnap.isPlaying) {
      void radioEngine.start(this.currentFix.lat, this.currentFix.lon);
    } else {
      this.modal = 'radio';
      this.renderModal();
    }
  }

  private bindPlanningEvents(): void {
    this.root.querySelector('#btn-open-launcher')?.addEventListener('click', () => {
      this.quickSetupMode = null;
      this.launcherOpen = true;
      this.renderUi();
    });
    this.root.querySelector('#btn-toggle-radio')?.addEventListener('click', () => {
      this.handleRadioChipTap();
    });
    this.bindRadioMiniEvents();
    this.root.querySelector('#btn-mic-listen')?.addEventListener('click', () => {
      void this.toggleVoiceListening();
    });
    this.root.querySelector('#btn-toggle-handsfree')?.addEventListener('click', () => {
      void this.toggleHandsfreeMode();
    });
    this.bindVoiceBannerEvents();

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
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = searchInput.value.trim();
      const parsed = parseCoordinatesInput(q);
      if (parsed) {
        e.preventDefault();
        void this.handleCoordinateAction(parsed.lat, parsed.lon, 'navigate');
      } else if (this.searchResults.length > 0) {
        e.preventDefault();
        this.selectDestination(this.searchResults[0]);
      }
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
        if (this.settings.mode === mode) {
          this.modal = 'vehicle';
          this.renderModal();
          return;
        }
        this.enterMode(mode, false);
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

    this.root.querySelector('#btn-open-coords')?.addEventListener('click', () => {
      this.modal = 'coords';
      this.renderModal();
    });
    this.root.querySelector('#btn-open-vehicles')?.addEventListener('click', () => {
      this.editingVehicle = null;
      this.modal = 'vehicles';
      this.renderModal();
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
      void this.refreshRoadSigns(true);
    } catch {
      this.routes = [];
      this.mapCtrl?.renderRoutes([], 0);
      this.showToast(t(this.settings.language).noRouteFound);
    } finally {
      this.isRouting = false;
      this.renderUi();
    }
  }

  private async handleCoordinateAction(lat: number, lon: number, action: 'show' | 'navigate'): Promise<void> {
    const coordLabel = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const initialPlace: GeocodedPlace = {
      id: `coord-${Date.now()}`,
      name: `📍 ${coordLabel}`,
      subtitle: 'GPS',
      lat,
      lon,
      category: 'coordinates',
    };
    this.modal = null;
    this.searchOpen = false;

    const enrichSubtitle = async (): Promise<string | null> => {
      const resolved = await reverseGeocode(lat, lon, this.settings.language);
      if (!resolved.name && !resolved.subtitle) return null;
      return resolved.name && resolved.name !== coordLabel
        ? `${resolved.name}${resolved.subtitle ? `, ${resolved.subtitle}` : ''}`
        : resolved.subtitle || 'GPS';
    };

    if (action === 'navigate') {
      this.selectDestination(initialPlace);
      const sub = await enrichSubtitle();
      if (sub && this.destination && this.destination.id === initialPlace.id) {
        this.destination = { ...initialPlace, subtitle: sub };
        this.renderUi();
      }
      return;
    }

    this.routes = [];
    this.destination = null;
    this.mapCtrl?.renderRoutes([], 0);
    this.tappedPlace = initialPlace;
    this.mapCtrl?.setDestinationPin({ lat, lon });
    this.mapCtrl?.flyTo({ lat, lon }, 15, 0);
    this.renderUi();

    const sub = await enrichSubtitle();
    if (sub && this.tappedPlace && this.tappedPlace.id === initialPlace.id) {
      this.tappedPlace = { ...initialPlace, subtitle: sub };
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
      const activeRoute = this.routes[this.selectedRouteIdx] ?? null;
      const snap = await fetchRoadSignsAround(this.currentFix.lat, this.currentFix.lon, this.settings, activeRoute);
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
          void voiceNav.speak(msg, this.settings, true);
        }
      }

      if (this.isNavigating) {
        this.renderUi();
      } else if (!this.searchOpen) {
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

  private interpolateAlongRoute(
    coords: [number, number][],
    cumDist: number[],
    targetM: number
  ): { lat: number; lon: number; bearing: number; finished: boolean } {
    if (coords.length === 0) return { lat: this.currentFix.lat, lon: this.currentFix.lon, bearing: 0, finished: true };
    if (coords.length === 1) return { lat: coords[0][1], lon: coords[0][0], bearing: 0, finished: true };
    const total = cumDist[cumDist.length - 1] || 0;
    if (targetM >= total) {
      const a = coords[coords.length - 2];
      const b = coords[coords.length - 1];
      return {
        lat: b[1],
        lon: b[0],
        bearing: computeBearing({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] }),
        finished: true,
      };
    }

    let lo = 0;
    let hi = cumDist.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumDist[mid] <= targetM) lo = mid;
      else hi = mid - 1;
    }
    const segStart = cumDist[lo];
    const segEnd = cumDist[lo + 1];
    const segLen = segEnd - segStart;
    const frac = segLen > 0 ? Math.max(0, Math.min(1, (targetM - segStart) / segLen)) : 0;
    const a = coords[lo];
    const b = coords[lo + 1];
    return {
      lat: a[1] + (b[1] - a[1]) * frac,
      lon: a[0] + (b[0] - a[0]) * frac,
      bearing: computeBearing({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] }),
      finished: false,
    };
  }

  private startNavigation(simulate: boolean): void {
    const route = this.routes[this.selectedRouteIdx];
    if (!route) return;
    this.isNavigating = true;
    this.isSimulating = simulate;
    this.followCamera = true;
    this.offRouteStreak = 0;
    this.lastSpokenStepKey = '';
    this.lastHudRenderAt = 0;

    const bundle = t(this.settings.language);
    if (route.steps[0]) {
      this.lastSpokenNavInstruction = route.steps[0].instruction;
      void voiceNav.speak(route.steps[0].instruction, this.settings, true);
    }

    if (simulate) {
      this.simDistanceM = 0;
      this.simCumDist = [0];
      for (let i = 1; i < route.coordinates.length; i++) {
        const a = route.coordinates[i - 1];
        const b = route.coordinates[i];
        this.simCumDist.push(
          this.simCumDist[i - 1] + haversineMeters({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] })
        );
      }

      const startPos = this.interpolateAlongRoute(route.coordinates, this.simCumDist, 0);
      this.currentFix = {
        lat: startPos.lat,
        lon: startPos.lon,
        heading: startPos.bearing,
        speedKmh: this.settings.mode === 'pedestrian' ? 5 : this.settings.mode === 'bicycle' ? 21 : 50,
        accuracyM: 5,
        timestamp: Date.now(),
        isSimulated: true,
      };
      void this.refreshRoadSigns(true);

      if (this.simTimer !== null) window.clearInterval(this.simTimer);
      const tickMs = 100;
      this.simTimer = window.setInterval(() => {
        if (!this.isNavigating || !this.isSimulating) return;
        const active = this.routes[this.selectedRouteIdx];
        if (!active || this.simCumDist.length < 2) return;

        let simSpeed =
          this.settings.mode === 'pedestrian'
            ? 5
            : this.settings.mode === 'bicycle'
              ? 22
              : this.settings.mode === 'truck'
                ? Math.min(82, this.currentMaxSpeedKmh ?? 76)
                : Math.min(120, this.currentMaxSpeedKmh ?? 54);
        if (this.settings.mode !== 'pedestrian') {
          simSpeed = Math.max(15, Math.round(simSpeed + Math.sin(this.simDistanceM * 0.008) * 2));
        }

        this.simDistanceM += (simSpeed / 3.6) * (tickMs / 1000) * this.simMultiplier;
        const pos = this.interpolateAlongRoute(active.coordinates, this.simCumDist, this.simDistanceM);

        this.handleIncomingFix({
          lat: pos.lat,
          lon: pos.lon,
          heading: pos.bearing,
          speedKmh: simSpeed,
          accuracyM: 5,
          timestamp: Date.now(),
          isSimulated: true,
        });

        if (pos.finished) {
          this.stopNavigation(true);
          this.showToast(`🏁 ${bundle.arrived}`);
          void voiceNav.speak(bundle.arrived, this.settings, true);
        }
      }, tickMs);
    }

    this.mapCtrl?.updateGpsFix(this.currentFix, true);
    this.renderUi();
    if (this.settings.voiceHandsfree && !this.handsfreeLoopActive) {
      void this.runHandsfreeLoop();
    }
  }

  private stopNavigation(arrived = false): void {
    this.isNavigating = false;
    this.isSimulating = false;
    this.offRouteStreak = 0;
    if (this.simTimer !== null) {
      window.clearInterval(this.simTimer);
      this.simTimer = null;
    }
    this.handsfreeLoopActive = false;
    if (this.isListening) {
      this.isListening = false;
      voiceListener.stop();
    }
    if (!arrived) void voiceNav.stop();
    this.mapCtrl?.flyTo({ lat: this.currentFix.lat, lon: this.currentFix.lon }, 14, 0);
    this.renderUi();
  }

  private handleIncomingFix(fix: GpsFix): void {
    const prev = this.currentFix;
    const filtered = fix.isSimulated ? fix : filterGpsFix(fix, this.hasLiveGps ? prev : null);
    if (!filtered) return;

    const distMoved = haversineMeters(prev, filtered);
    const dtSec = (filtered.timestamp - prev.timestamp) / 1000;

    // Fallback delta speed if device omits coords.speed (common on some Android WebViews)
    let resolvedSpeedKmh = filtered.speedKmh;
    if (!filtered.isSimulated && resolvedSpeedKmh === 0 && dtSec >= 0.6 && dtSec <= 8 && filtered.accuracyM <= 45) {
      if (distMoved >= 2.2) {
        const calc = Math.round((distMoved / dtSec) * 3.6);
        if (calc > 0 && calc < 220) {
          resolvedSpeedKmh = prev.speedKmh > 0 ? Math.round(prev.speedKmh * 0.4 + calc * 0.6) : calc;
        }
      }
    }

    const computedHeading =
      filtered.heading !== null
        ? filtered.heading
        : distMoved > 4
          ? computeBearing(prev, filtered)
          : prev.heading;

    let nextFix: GpsFix = {
      ...filtered,
      speedKmh: resolvedSpeedKmh,
      heading: computedHeading,
      snappedToRoad: false,
    };

    const activeRoute = this.isNavigating ? this.routes[this.selectedRouteIdx] : undefined;
    if (this.isNavigating && activeRoute && !filtered.isSimulated) {
      const snap = distanceToRouteMeters({ lat: filtered.lat, lon: filtered.lon }, activeRoute.coordinates);
      const snapThresholdM = Math.min(35, Math.max(18, filtered.accuracyM * 1.25));
      if (snap.minMeters <= snapThresholdM) {
        this.offRouteStreak = 0;
        const alignedHeading =
          computedHeading === null ||
          resolvedSpeedKmh < 8 ||
          angleDiffDeg(computedHeading, snap.segmentBearing) <= 70
            ? snap.segmentBearing
            : computedHeading;
        nextFix = {
          ...nextFix,
          lat: snap.snappedLat,
          lon: snap.snappedLon,
          heading: alignedHeading,
          snappedToRoad: true,
        };
      } else if (snap.minMeters > 55) {
        this.offRouteStreak += 1;
      } else {
        this.offRouteStreak = 0;
      }
    }

    this.currentFix = nextFix;
    if (!filtered.isSimulated) this.hasLiveGps = true;

    this.mapCtrl?.updateGpsFix(this.currentFix, this.isNavigating && this.followCamera);
    void this.refreshRoadSigns(false);
    void radioEngine.maybeRefreshForPosition(this.currentFix.lat, this.currentFix.lon);

    if (!this.isNavigating) {
      if (this.settings.mode !== 'pedestrian') {
        this.updateVehicleCockpitDom();
      }
      return;
    }
    const route = activeRoute;
    if (!route) return;

    const bundle = t(this.settings.language);

    // Off-route hysteresis (2 consecutive fixes > 55m) -> automatic reroute without urban-canyon jitter triggers
    if (
      !filtered.isSimulated &&
      this.settings.autoReroute &&
      this.offRouteStreak >= 2 &&
      Date.now() - this.lastRerouteAt > 12_000
    ) {
      this.offRouteStreak = 0;
      this.lastRerouteAt = Date.now();
      this.showToast(bundle.rerouting);
      void voiceNav.speak(bundle.rerouting, this.settings, true);
      void this.computeActiveRoute();
      return;
    }

    // Check arrival (< 35m from end)
    const endCoord = route.coordinates[route.coordinates.length - 1];
    if (endCoord && haversineMeters(this.currentFix, { lat: endCoord[1], lon: endCoord[0] }) < 35) {
      this.stopNavigation(true);
      this.showToast(`🏁 ${bundle.arrived}`);
      void voiceNav.speak(bundle.arrived, this.settings, true);
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
        this.lastSpokenNavInstruction = msg;
        void voiceNav.speak(msg, this.settings, true);
      }
    }

    const now = Date.now();
    if (!filtered.isSimulated || now - this.lastHudRenderAt >= 350) {
      this.lastHudRenderAt = now;
      this.renderUi();
    } else {
      const speedEl = this.root.querySelector<HTMLElement>('#hud-speed-val');
      if (speedEl) speedEl.textContent = String(this.formatSpeed(this.currentFix.speedKmh).value);
      const distEl = this.root.querySelector<HTMLElement>('#nav-dist-next');
      if (distEl) distEl.textContent = `${bundle.inDistance} ${this.formatDistance(prog.distanceToStepM)}`;
    }
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
    this.root.querySelector('#btn-nav-radio')?.addEventListener('click', () => {
      this.handleRadioChipTap();
    });
    this.bindRadioMiniEvents();
    this.root.querySelector('#btn-nav-mic')?.addEventListener('click', () => {
      void this.toggleVoiceListening();
    });
    this.bindVoiceBannerEvents();
    this.root.querySelector('#btn-nav-voice')?.addEventListener('click', () => {
      this.settings.voiceEnabled = !this.settings.voiceEnabled;
      saveSettings(this.settings);
      if (!this.settings.voiceEnabled) void voiceNav.stop();
      this.renderUi();
    });
    this.root.querySelector('#btn-sim-mult')?.addEventListener('click', () => {
      const order: (1 | 3 | 8 | 20)[] = [1, 3, 8, 20];
      const idx = order.indexOf(this.simMultiplier);
      this.simMultiplier = order[(idx + 1) % order.length];
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

    if (this.modal === 'vehicles') {
      container.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="modal-card">
            <div class="modal-header">
              <h2>🚛 ${bundle.myVehiclesTitle}</h2>
              <button class="round-icon-btn" id="modal-close">✕</button>
            </div>
            <div id="modal-vehicles-body" style="display:flex;flex-direction:column;gap:10px;">
              ${this.renderVehiclesTabBody(bundle)}
            </div>
          </div>
        </div>
      `;
      const scope = container.querySelector('#modal-vehicles-body');
      if (scope) this.bindVehiclesTabEvents(scope);
    } else if (this.modal === 'vehicle') {
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
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:12px;font-weight:800;color:var(--amber);">🚛 ${bundle.truckPresets}</span>
                <button type="button" class="pill-chip highlight" id="btn-jump-vehicles">🚛 ${bundle.vehiclesTab} (${this.settings.savedVehicles.length})</button>
              </div>
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
              <label class="toggle-row"><span>🪨 ${bundle.avoidBadRoads}</span><input id="in-badroads" type="checkbox" ${this.settings.bike.avoidBadRoads ? 'checked' : ''}></label>
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

      container.querySelector('#btn-jump-vehicles')?.addEventListener('click', () => {
        this.editingVehicle = null;
        this.modal = 'vehicles';
        this.renderModal();
      });

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
          this.settings.bike.avoidBadRoads = (container.querySelector('#in-badroads') as HTMLInputElement).checked;
        } else {
          this.settings.walk.walkingSpeedKmh = Number((container.querySelector('#in-wspeed') as HTMLInputElement).value) || 5.1;
          this.settings.walk.avoidStairs = (container.querySelector('#in-stairs') as HTMLInputElement).checked;
        }
        this.settings.configuredModes[this.settings.mode] = true;
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
      let draftStyle: VoiceStyle = this.settings.voiceStyle;
      let draftRate = this.settings.voiceRate;
      let draftPitch = this.settings.voicePitch;
      let draftUri = this.settings.voiceUri;

      const styleOptions: [VoiceStyle, string][] = [
        ['smooth', bundle.voiceSmooth],
        ['calm', bundle.voiceCalm],
        ['crisp', bundle.voiceCrisp],
        ['standard', bundle.voiceStandard],
      ];

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
            <label class="toggle-row"><span>🎧 ${bundle.voiceHandsfreeLabel}</span><input id="set-handsfree" type="checkbox" ${this.settings.voiceHandsfree ? 'checked' : ''}></label>

            <div style="border-top:1px solid var(--border);padding-top:10px;display:flex;flex-direction:column;gap:8px;">
              <div style="font-size:12px;font-weight:800;">🎙️ ${bundle.voiceStyleLabel}</div>
              <div class="quick-chips-row">
                ${styleOptions
                  .map(
                    ([id, label]) => `
                  <button type="button" class="quick-chip ${draftStyle === id ? 'active' : ''}" data-voice-style="${id}">${label}</button>
                `
                  )
                  .join('')}
              </div>

              <label class="field">${bundle.voiceSelectLabel}
                <select id="set-voice-uri">
                  <option value="">${bundle.voiceAutoBest}</option>
                </select>
              </label>

              <div class="form-grid">
                <label class="field">${bundle.voiceRateLabel}: <b id="lbl-voice-rate">${draftRate.toFixed(2)}x</b>
                  <input id="set-voice-rate" type="range" min="0.72" max="1.20" step="0.02" value="${draftRate}">
                </label>
                <label class="field">${bundle.voicePitchLabel}: <b id="lbl-voice-pitch">${draftPitch.toFixed(2)}</b>
                  <input id="set-voice-pitch" type="range" min="0.72" max="1.20" step="0.02" value="${draftPitch}">
                </label>
              </div>

              <div class="btn-row">
                <button type="button" class="secondary-btn" id="btn-test-voice" style="flex:1;">🗣️ ${bundle.testVoice}</button>
                <button type="button" class="secondary-btn" id="btn-install-voices">${bundle.voiceInstallMore}</button>
              </div>
              <div style="font-size:11px;color:var(--muted);">${bundle.voiceInstallTip}</div>
            </div>

            <label class="toggle-row"><span>🔄 ${bundle.autoRerouteLabel}</span><input id="set-reroute" type="checkbox" ${this.settings.autoReroute ? 'checked' : ''}></label>

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

      const voiceSelect = container.querySelector<HTMLSelectElement>('#set-voice-uri');
      const rateSlider = container.querySelector<HTMLInputElement>('#set-voice-rate');
      const pitchSlider = container.querySelector<HTMLInputElement>('#set-voice-pitch');
      const rateLbl = container.querySelector<HTMLElement>('#lbl-voice-rate');
      const pitchLbl = container.querySelector<HTMLElement>('#lbl-voice-pitch');

      void voiceNav.getAvailableVoices(this.settings.language).then((voices) => {
        if (this.modal !== 'settings' || !voiceSelect) return;
        const opts = [
          `<option value="">${this.escapeHtml(bundle.voiceAutoBest)}</option>`,
          ...voices.map(
            (v) =>
              `<option value="${this.escapeHtml(v.voiceURI)}" ${draftUri === v.voiceURI ? 'selected' : ''}>${this.escapeHtml(v.label)}</option>`
          ),
        ];
        voiceSelect.innerHTML = opts.join('');
      });

      voiceSelect?.addEventListener('change', () => {
        draftUri = voiceSelect.value;
      });

      rateSlider?.addEventListener('input', () => {
        draftRate = Number(rateSlider.value) || 0.91;
        if (rateLbl) rateLbl.textContent = `${draftRate.toFixed(2)}x`;
      });

      pitchSlider?.addEventListener('input', () => {
        draftPitch = Number(pitchSlider.value) || 0.90;
        if (pitchLbl) pitchLbl.textContent = draftPitch.toFixed(2);
      });

      container.querySelectorAll<HTMLButtonElement>('[data-voice-style]').forEach((b) => {
        b.addEventListener('click', () => {
          draftStyle = b.dataset.voiceStyle as VoiceStyle;
          const preset = VOICE_STYLE_PRESETS[draftStyle];
          draftRate = preset.rate;
          draftPitch = preset.pitch;
          if (rateSlider) rateSlider.value = String(draftRate);
          if (pitchSlider) pitchSlider.value = String(draftPitch);
          if (rateLbl) rateLbl.textContent = `${draftRate.toFixed(2)}x`;
          if (pitchLbl) pitchLbl.textContent = draftPitch.toFixed(2);
          container.querySelectorAll<HTMLButtonElement>('[data-voice-style]').forEach((chip) => {
            chip.classList.toggle('active', chip.dataset.voiceStyle === draftStyle);
          });
        });
      });

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
        void voiceNav.speak(b.voiceSample, this.settings.language, true, true, {
          voiceStyle: draftStyle,
          voiceRate: draftRate,
          voicePitch: draftPitch,
          voiceUri: draftUri,
        });
      });

      container.querySelector('#btn-install-voices')?.addEventListener('click', () => {
        void voiceNav.openVoiceInstall().then((opened) => {
          if (!opened) this.showToast(bundle.voiceInstallTip);
        });
      });

      container.querySelector('#btn-save-settings')?.addEventListener('click', () => {
        this.settings.mapTheme = (container.querySelector('#set-theme') as HTMLSelectElement).value as AppSettings['mapTheme'];
        this.settings.units = (container.querySelector('#set-units') as HTMLSelectElement).value as AppSettings['units'];
        this.settings.voiceEnabled = (container.querySelector('#set-voice') as HTMLInputElement).checked;
        this.settings.voiceHandsfree = (container.querySelector('#set-handsfree') as HTMLInputElement).checked;
        this.settings.voiceStyle = draftStyle;
        this.settings.voiceRate = draftRate;
        this.settings.voicePitch = draftPitch;
        this.settings.voiceUri = draftUri;
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
        if (this.settings.voiceHandsfree && !this.handsfreeLoopActive) {
          void this.runHandsfreeLoop();
        } else if (!this.settings.voiceHandsfree) {
          this.stopHandsfreeLoop();
        }
        if (this.destination) void this.computeActiveRoute();
      });
    } else if (this.modal === 'coords') {
      container.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="modal-card">
            <div class="modal-header">
              <h2>📍 ${bundle.coordsTitle}</h2>
              <button class="round-icon-btn" id="modal-close">✕</button>
            </div>
            <div style="font-size:12px;color:var(--muted);">${bundle.coordsHint}</div>
            <label class="field">${bundle.coordsQuickLabel}
              <input id="coords-combined" type="text" placeholder="${bundle.coordsQuickPlaceholder}">
            </label>
            <div class="form-grid">
              <label class="field">${bundle.latitudeLabel}
                <input id="coords-lat" type="text" inputmode="decimal" placeholder="50.8503">
              </label>
              <label class="field">${bundle.longitudeLabel}
                <input id="coords-lon" type="text" inputmode="decimal" placeholder="4.3517">
              </label>
            </div>
            <button type="button" class="pill-chip" id="btn-coords-mygps" style="align-self:flex-start;">
              🎯 ${bundle.fromMyLocation}: ${this.currentFix.lat.toFixed(5)}, ${this.currentFix.lon.toFixed(5)}
            </button>
            <div class="btn-row">
              <button type="button" class="secondary-btn" id="btn-coords-show" style="flex:1;">🗺️ ${bundle.showOnMapBtn}</button>
              <button type="button" class="primary-btn" id="btn-coords-nav" style="flex:1;">🧭 ${bundle.setDestination}</button>
            </div>
          </div>
        </div>
      `;

      const combinedInput = container.querySelector<HTMLInputElement>('#coords-combined');
      const latInput = container.querySelector<HTMLInputElement>('#coords-lat');
      const lonInput = container.querySelector<HTMLInputElement>('#coords-lon');

      combinedInput?.addEventListener('input', () => {
        const parsed = parseCoordinatesInput(combinedInput.value);
        if (parsed && latInput && lonInput) {
          latInput.value = parsed.lat.toFixed(6);
          lonInput.value = parsed.lon.toFixed(6);
        }
      });

      container.querySelector('#btn-coords-mygps')?.addEventListener('click', () => {
        if (latInput) latInput.value = this.currentFix.lat.toFixed(6);
        if (lonInput) lonInput.value = this.currentFix.lon.toFixed(6);
        if (combinedInput) {
          combinedInput.value = `${this.currentFix.lat.toFixed(6)}, ${this.currentFix.lon.toFixed(6)}`;
        }
      });

      const readCoords = (): { lat: number; lon: number } | null => {
        const latRaw = latInput?.value.trim() ?? '';
        const lonRaw = lonInput?.value.trim() ?? '';
        if (latRaw !== '' && lonRaw !== '') {
          const lat = Number(latRaw.replace(',', '.'));
          const lon = Number(lonRaw.replace(',', '.'));
          if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            return { lat, lon };
          }
          return null;
        }
        const combined = combinedInput?.value.trim() ?? '';
        return combined ? parseCoordinatesInput(combined) : null;
      };

      const submitCoords = (action: 'show' | 'navigate'): void => {
        const res = readCoords();
        if (!res) {
          this.showToast(bundle.invalidCoordsError);
          return;
        }
        void this.handleCoordinateAction(res.lat, res.lon, action);
      };

      container.querySelector('#btn-coords-show')?.addEventListener('click', () => submitCoords('show'));
      container.querySelector('#btn-coords-nav')?.addEventListener('click', () => submitCoords('navigate'));
      [combinedInput, latInput, lonInput].forEach((inp) => {
        inp?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitCoords('show');
          }
        });
      });
    } else if (this.modal === 'radio') {
      if (this.radioSnap.stations.length === 0 && !this.radioSnap.isPlaying) {
        void radioEngine.refreshLocalStations(this.currentFix.lat, this.currentFix.lon, false);
      }
      container.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="modal-card">
            <div class="modal-header">
              <h2>📻 ${bundle.radioModalTitle}</h2>
              <button class="round-icon-btn" id="modal-close">✕</button>
            </div>
            <div id="modal-radio-body" style="display:flex;flex-direction:column;gap:10px;">
              ${this.renderRadioModalBody(bundle)}
            </div>
          </div>
        </div>
      `;
      const body = container.querySelector<HTMLElement>('#modal-radio-body');
      if (body) this.bindRadioModalEvents(body);
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

  private blockRadioStation(st: { id: string; name: string; streamUrl: string; frequencyLabel?: string }): void {
    const normUrl = st.streamUrl.trim().toLowerCase();
    const normName = st.name.trim().toLowerCase();
    const already = this.settings.blockedRadioStations.some(
      (b) =>
        b.id === st.id ||
        (normUrl && b.streamUrl.trim().toLowerCase() === normUrl) ||
        (normName && b.name.trim().toLowerCase() === normName)
    );
    if (!already) {
      this.settings.blockedRadioStations = [
        {
          id: st.id,
          name: st.name,
          streamUrl: st.streamUrl,
          frequencyLabel: st.frequencyLabel,
          blockedAt: Date.now(),
        },
        ...this.settings.blockedRadioStations,
      ];
      saveSettings(this.settings);
    }
    radioEngine.setBlockedStations(this.settings.blockedRadioStations);
    this.showToast(t(this.settings.language).radioBlockedToast(st.name));
  }

  private unblockRadioStation(idOrUrl: string): void {
    this.settings.blockedRadioStations = this.settings.blockedRadioStations.filter(
      (b) => b.id !== idOrUrl && b.streamUrl !== idOrUrl
    );
    saveSettings(this.settings);
    radioEngine.setBlockedStations(this.settings.blockedRadioStations);
  }

  private renderRadioModalBody(bundle: ReturnType<typeof t>): string {
    const snap = this.radioSnap;
    const blocked = this.settings.blockedRadioStations;
    const genres: [RadioGenreFilter, string][] = [
      ['all', bundle.radioGenreAll],
      ['hits', bundle.radioGenreHits],
      ['dance', bundle.radioGenreDance],
      ['rock', bundle.radioGenreRock],
      ['chill', bundle.radioGenreChill],
      ['nonstop', bundle.radioGenreNonstop],
    ];

    const stateBadge = (state: RadioSnapshot['stations'][number]['state']): { cls: string; text: string } => {
      switch (state) {
        case 'music_started':
          return { cls: 'fresh', text: `🟢 ${bundle.radioFreshStart}` };
        case 'music':
          return { cls: 'music', text: `🎵 ${bundle.radioMusicBadge}` };
        case 'talk':
          return { cls: 'talk', text: `🗣️ ${bundle.radioTalkSkipped}` };
        case 'ad':
          return { cls: 'ad', text: `📢 ${bundle.radioAdSkipped}` };
        case 'offline':
          return { cls: 'offline', text: `⚪ ${bundle.radioOfflineBadge}` };
        default:
          return { cls: 'scanning', text: '⏳ ...' };
      }
    };

    const st = snap.currentStation;
    const conf = Math.max(10, Math.min(100, Math.round(snap.musicConfidence || 75)));

    return `
      <div style="font-size:12px;color:var(--muted);line-height:1.35;">${bundle.radioModalSub}</div>

      <div class="btn-row">
        <button type="button" class="${snap.isPlaying ? 'danger-btn' : 'primary-btn'}" id="btn-radio-modal-playstop" style="flex:1;">
          ${snap.isPlaying ? `⏹️ ${bundle.stopNav}` : `▶️ ${bundle.radioChip}`}
        </button>
        <button type="button" class="secondary-btn" id="btn-radio-modal-next">
          ⏭️ ${bundle.radioNextBtn}
        </button>
        <button type="button" class="secondary-btn" id="btn-radio-modal-refresh" title="${bundle.radioRefreshBtn}">
          🔄
        </button>
      </div>

      ${
        snap.isPlaying && st
          ? `
        <div class="radio-mini-bar" style="box-shadow:none;">
          <div style="flex:1;min-width:0;">
            <div class="radio-mini-top">
              <span class="radio-freq-pill">${this.escapeHtml(st.frequencyLabel)}</span>
              <span class="radio-station-name">${this.escapeHtml(st.name)}</span>
            </div>
            <div class="radio-track-line">${this.escapeHtml(st.lastTitle || bundle.radioMusicBadge)}</div>
            <div class="radio-dsp-meter"><div class="radio-dsp-fill" style="width:${conf}%;"></div></div>
          </div>
          <span style="font-size:11px;font-weight:800;color:var(--green);flex-shrink:0;">${conf}% 🎵</span>
          <button type="button" class="radio-block-btn" id="btn-radio-modal-block-current" title="${bundle.radioBlockTitle}">🚫</button>
        </div>
      `
          : ''
      }

      <label class="toggle-row">
        <span>🤖 ${bundle.radioAutoDjLabel}</span>
        <input id="set-radio-autodj" type="checkbox" ${snap.autoDj ? 'checked' : ''}>
      </label>

      <div class="quick-chips-row">
        ${genres
          .map(
            ([id, label]) => `
          <button type="button" class="pill-chip ${this.settings.radioGenreFilter === id ? 'active' : ''}" data-radio-genre="${id}">
            ${label}
          </button>
        `
          )
          .join('')}
      </div>

      <div class="radio-stats-row">
        <span>📡 ${this.escapeHtml(snap.regionLabel || bundle.radioScanning)}</span>
        <span>•</span>
        <span>🎵 ${snap.songsPlayedCount}</span>
        <span>•</span>
        <span>🗣️✕ ${snap.switchedAvoidedTalkCount}</span>
      </div>

      <div class="radio-tabs-row">
        <button type="button" class="pill-chip ${this.radioModalTab === 'stations' ? 'active' : ''}" data-radio-tab="stations">
          📻 ${bundle.radioStationsTab(snap.stations.length)}
        </button>
        <button type="button" class="pill-chip ${this.radioModalTab === 'blocked' ? 'active' : ''}" data-radio-tab="blocked">
          🚫 ${bundle.radioBlockedTab(blocked.length)}
        </button>
      </div>

      <div class="radio-stations-list">
        ${
          this.radioModalTab === 'blocked'
            ? blocked.length === 0
              ? `<div style="font-size:12px;color:var(--muted);padding:12px 4px;">${bundle.radioNoBlocked}</div>`
              : blocked
                  .map(
                    (b) => `
                  <div class="radio-station-row">
                    <div class="radio-station-meta">
                      <div class="radio-mini-top">
                        ${b.frequencyLabel ? `<span class="radio-freq-pill">${this.escapeHtml(b.frequencyLabel)}</span>` : ''}
                        <span class="radio-station-name">${this.escapeHtml(b.name)}</span>
                      </div>
                      <div class="radio-track-line">${this.escapeHtml(b.streamUrl)}</div>
                    </div>
                    <button type="button" class="radio-unblock-btn" data-radio-unblock="${this.escapeHtml(b.id)}">
                      ${bundle.radioUnblockBtn}
                    </button>
                  </div>
                `
                  )
                  .join('')
            : snap.stations.length === 0
              ? `<div style="font-size:12px;color:var(--muted);padding:10px 0;">${
                  snap.isLoading ? `⏳ ${bundle.radioScanning}` : bundle.radioNoStations
                }</div>`
              : snap.stations
                  .map((station) => {
                    const isCurrent = st?.id === station.id && snap.isPlaying;
                    const dimmed = station.state === 'talk' || station.state === 'ad' || station.state === 'offline';
                    const badge = stateBadge(station.state);
                    const distLabel =
                      typeof station.distanceKm === 'number' ? ` • ${station.distanceKm} km` : '';
                    const subLine = station.lastTitle || station.tags.slice(0, 3).join(', ') || station.stateName || '';
                    return `
                  <div class="radio-station-row ${isCurrent ? 'active' : ''} ${dimmed ? 'dimmed' : ''}">
                    <button type="button" class="radio-station-main" data-radio-station="${this.escapeHtml(station.id)}">
                      <div class="radio-station-meta">
                        <div class="radio-mini-top">
                          <span class="radio-freq-pill">${this.escapeHtml(station.frequencyLabel)}</span>
                          <span class="radio-station-name">${this.escapeHtml(station.name)}</span>
                          <span style="font-size:10px;color:var(--muted);flex-shrink:0;">${distLabel}</span>
                        </div>
                        <div class="radio-track-line">${this.escapeHtml(subLine)}</div>
                      </div>
                      <span class="radio-badge ${badge.cls}">${badge.text}</span>
                    </button>
                    <button type="button" class="radio-block-btn" data-radio-block="${this.escapeHtml(station.id)}" title="${bundle.radioBlockTitle}">🚫</button>
                  </div>
                `;
                  })
                  .join('')
        }
      </div>
    `;
  }

  private bindRadioModalEvents(body: HTMLElement): void {
    const clearPointer = (): void => {
      this.radioModalPointerDown = false;
    };
    body.addEventListener('pointerdown', () => {
      this.radioModalPointerDown = true;
    });
    body.addEventListener('pointerup', clearPointer);
    body.addEventListener('pointercancel', clearPointer);

    body.addEventListener('change', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.id === 'set-radio-autodj') {
        const checked = (target as HTMLInputElement).checked;
        this.settings.radioAutoDj = checked;
        saveSettings(this.settings);
        radioEngine.setAutoDj(checked);
      }
    });

    body.addEventListener('click', (e) => {
      this.radioModalPointerDown = false;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('button');
      if (!el) return;

      if (el.id === 'btn-radio-modal-playstop') {
        if (this.radioSnap.isPlaying) {
          radioEngine.stop();
        } else {
          void radioEngine.start(this.currentFix.lat, this.currentFix.lon);
        }
        return;
      }

      if (el.id === 'btn-radio-modal-next') {
        void radioEngine.skipToNextMusic('manual_skip');
        return;
      }

      if (el.id === 'btn-radio-modal-refresh') {
        void radioEngine.refreshLocalStations(this.currentFix.lat, this.currentFix.lon, true);
        return;
      }

      if (el.id === 'btn-radio-modal-block-current') {
        if (this.radioSnap.currentStation) {
          this.blockRadioStation(this.radioSnap.currentStation);
        }
        return;
      }

      const tab = el.dataset.radioTab as 'stations' | 'blocked' | undefined;
      if (tab) {
        this.radioModalTab = tab;
        this.updateRadioDom();
        return;
      }

      const genre = el.dataset.radioGenre as RadioGenreFilter | undefined;
      if (genre) {
        this.settings.radioGenreFilter = genre;
        saveSettings(this.settings);
        radioEngine.setGenreFilter(genre, this.currentFix.lat, this.currentFix.lon);
        this.updateRadioDom();
        return;
      }

      const blockId = el.dataset.radioBlock;
      if (blockId) {
        const st = this.radioSnap.stations.find((s) => s.id === blockId);
        if (st) this.blockRadioStation(st);
        return;
      }

      const unblockId = el.dataset.radioUnblock;
      if (unblockId) {
        this.unblockRadioStation(unblockId);
        return;
      }

      const stationId = el.dataset.radioStation;
      if (stationId) {
        void radioEngine.playSpecificStation(stationId);
      }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private setVoiceBanner(heard?: string, reply?: string, durationMs = 6500, showHints = false): void {
    window.clearTimeout(this.voiceBannerTimer);
    this.voiceBanner = { heard, reply, showHints };
    this.renderUi();
    this.voiceBannerTimer = window.setTimeout(() => {
      if (!this.isListening) {
        this.voiceBanner = null;
        this.renderUi();
      }
    }, durationMs);
  }

  private stopHandsfreeLoop(): void {
    this.handsfreeLoopActive = false;
    if (this.isListening) {
      this.isListening = false;
      voiceListener.stop();
      radioEngine.setVoiceDucking(false, false);
    }
    this.renderUi();
  }

  private async toggleHandsfreeMode(): Promise<void> {
    this.settings.voiceHandsfree = !this.settings.voiceHandsfree;
    saveSettings(this.settings);
    if (this.settings.voiceHandsfree) {
      this.renderUi();
      void this.runHandsfreeLoop();
    } else {
      this.stopHandsfreeLoop();
    }
  }

  private async toggleVoiceListening(): Promise<void> {
    if (this.isListening) {
      this.isListening = false;
      voiceListener.stop();
      radioEngine.setVoiceDucking(false, false);
      this.renderUi();
      return;
    }
    await this.runSingleListen();
  }

  private async runSingleListen(): Promise<void> {
    const bundle = t(this.settings.language);
    await voiceNav.stop();
    this.isListening = true;
    radioEngine.setVoiceDucking(false, true);
    this.voiceBanner = null;
    this.renderUi();

    const res = await voiceListener.listenOnce(this.settings.language);
    this.isListening = false;
    radioEngine.setVoiceDucking(false, false);

    if (res.transcript) {
      const cmd = parseVoiceCommand(res.transcript, this.settings.language);
      await this.executeVoiceCommand(cmd, res.transcript);
      return;
    }

    if (res.reason === 'denied') {
      this.showToast(bundle.voiceNoPermission);
      this.setVoiceBanner(undefined, bundle.voiceNoPermission, 6000, false);
    } else if (res.reason === 'unavailable') {
      this.showToast(bundle.voiceUnavailable);
      this.setVoiceBanner(undefined, bundle.voiceUnavailable, 9000, true);
    } else if (res.reason === 'no-match') {
      this.showToast(bundle.voiceDidNotCatch);
      this.renderUi();
    } else {
      this.renderUi();
    }
  }

  private async runHandsfreeLoop(): Promise<void> {
    if (this.handsfreeLoopActive) return;
    this.handsfreeLoopActive = true;

    while (this.handsfreeLoopActive && this.settings.voiceHandsfree) {
      if (this.modal !== null || this.launcherOpen) {
        await this.sleep(600);
        continue;
      }
      if (this.isListening) {
        await this.sleep(300);
        continue;
      }

      await voiceNav.stop();
      this.isListening = true;
      radioEngine.setVoiceDucking(false, true);
      this.renderUi();

      const res = await voiceListener.listenOnce(this.settings.language);
      this.isListening = false;
      radioEngine.setVoiceDucking(false, false);

      if (!this.handsfreeLoopActive || !this.settings.voiceHandsfree) {
        this.renderUi();
        break;
      }

      const bundle = t(this.settings.language);
      if (res.transcript) {
        const cmd = parseVoiceCommand(res.transcript, this.settings.language);
        await this.executeVoiceCommand(cmd, res.transcript);
        await this.sleep(550);
      } else if (res.reason === 'denied') {
        this.settings.voiceHandsfree = false;
        saveSettings(this.settings);
        this.handsfreeLoopActive = false;
        this.setVoiceBanner(undefined, bundle.voiceNoPermission, 6000, false);
        break;
      } else if (res.reason === 'unavailable') {
        this.settings.voiceHandsfree = false;
        saveSettings(this.settings);
        this.handsfreeLoopActive = false;
        this.setVoiceBanner(undefined, bundle.voiceUnavailable, 9000, true);
        break;
      } else {
        this.renderUi();
        await this.sleep(900);
      }
    }
  }

  private async executeVoiceCommand(cmd: ParsedVoiceCommand, rawTranscript: string): Promise<void> {
    const lang = this.settings.language;
    const r = assistantReplies(lang);
    const activeRoute = this.routes[this.selectedRouteIdx] ?? null;

    const respond = async (reply: string, showHints = false): Promise<void> => {
      this.setVoiceBanner(rawTranscript, reply, 6500, showHints);
      await voiceNav.speakAssistantReply(reply, this.settings);
    };

    switch (cmd.kind) {
      case 'mute': {
        this.settings.voiceEnabled = false;
        saveSettings(this.settings);
        await respond(r.muted);
        return;
      }
      case 'unmute': {
        this.settings.voiceEnabled = true;
        saveSettings(this.settings);
        await respond(r.unmuted);
        return;
      }
      case 'greeting': {
        await respond(r.greeting);
        return;
      }
      case 'thanks': {
        await respond(r.thanks);
        return;
      }
      case 'help': {
        await respond(r.help, true);
        return;
      }
      case 'eta': {
        if (!activeRoute) {
          await respond(r.noActiveRoute);
          return;
        }
        const secs = this.isNavigating ? this.computeNavProgress(activeRoute).remainingSeconds : activeRoute.durationSeconds;
        const meters = this.isNavigating ? this.computeNavProgress(activeRoute).remainingMeters : activeRoute.distanceMeters;
        await respond(r.eta(this.formatDuration(secs), this.formatDistance(meters), this.formatEta(secs)));
        return;
      }
      case 'next_turn': {
        if (!activeRoute) {
          await respond(r.noActiveRoute);
          return;
        }
        const prog = this.isNavigating
          ? this.computeNavProgress(activeRoute)
          : { nextStep: activeRoute.steps[0], distanceToStepM: activeRoute.steps[0]?.distanceMeters ?? 0 };
        if (!prog.nextStep) {
          await respond(r.repeatNone);
          return;
        }
        await respond(r.nextTurn(this.formatDistance(prog.distanceToStepM), prog.nextStep.instruction));
        return;
      }
      case 'repeat': {
        if (this.lastSpokenNavInstruction) {
          await respond(this.lastSpokenNavInstruction);
          return;
        }
        if (activeRoute?.steps[0]) {
          await respond(activeRoute.steps[0].instruction);
          return;
        }
        await respond(r.repeatNone);
        return;
      }
      case 'speed': {
        const sp = this.formatSpeed(this.currentFix.speedKmh);
        const limitDisp =
          this.currentMaxSpeedKmh === null
            ? null
            : this.settings.units === 'imperial'
              ? Math.round(this.currentMaxSpeedKmh * 0.621371)
              : this.currentMaxSpeedKmh;
        const nearbyDanger =
          this.roadSigns.find((s) => s.isDangerForMode && haversineMeters(this.currentFix, s) < 800)?.title ?? null;
        await respond(r.speed(sp.value, sp.unit, limitDisp, nearbyDanger));
        return;
      }
      case 'where_am_i': {
        const place = await reverseGeocode(this.currentFix.lat, this.currentFix.lon, lang);
        const label = place.subtitle ? `${place.name}, ${place.subtitle}` : place.name;
        await respond(r.whereAmI(label));
        return;
      }
      case 'poi': {
        await this.loadPois(cmd.poiKind);
        const kindLabel = r.poiNames[cmd.poiKind];
        if (this.poiItems.length === 0) {
          await respond(r.poiNotFound(kindLabel));
          return;
        }
        const sorted = [...this.poiItems].sort(
          (a, b) => haversineMeters(this.currentFix, a) - haversineMeters(this.currentFix, b)
        );
        const closest = sorted[0];
        const dist = haversineMeters(this.currentFix, closest);
        this.mapCtrl?.flyTo({ lat: closest.lat, lon: closest.lon }, 14, 0);
        await respond(r.poiFound(this.poiItems.length, kindLabel, closest.name, this.formatDistance(dist)));
        return;
      }
      case 'go_home': {
        if (!this.settings.homePlace) {
          await respond(r.noSavedHome);
          return;
        }
        this.selectDestination(this.settings.homePlace);
        await respond(r.navigatingTo(this.settings.homePlace.name));
        return;
      }
      case 'go_work': {
        if (!this.settings.workPlace) {
          await respond(r.noSavedWork);
          return;
        }
        this.selectDestination(this.settings.workPlace);
        await respond(r.navigatingTo(this.settings.workPlace.name));
        return;
      }
      case 'navigate': {
        const parsedCoords = parseCoordinatesInput(cmd.query);
        if (parsedCoords) {
          await this.handleCoordinateAction(parsedCoords.lat, parsedCoords.lon, 'navigate');
          await respond(r.navigatingTo(`${parsedCoords.lat.toFixed(4)}, ${parsedCoords.lon.toFixed(4)}`));
          return;
        }
        const hits = await searchPlaces(cmd.query, this.currentFix.lat, this.currentFix.lon, lang);
        if (hits.length === 0) {
          await respond(r.placeNotFound(cmd.query));
          return;
        }
        this.selectDestination(hits[0]);
        await respond(r.navigatingTo(hits[0].name));
        return;
      }
      case 'start_nav': {
        if (!activeRoute) {
          await respond(r.startNavNeedRoute);
          return;
        }
        await respond(r.startNavOk);
        this.startNavigation(false);
        return;
      }
      case 'stop_nav': {
        if (this.isNavigating) {
          this.stopNavigation(false);
        }
        await respond(r.stopNavOk);
        return;
      }
      case 'recenter': {
        this.followCamera = true;
        this.mapCtrl?.flyTo({ lat: this.currentFix.lat, lon: this.currentFix.lon }, 15, 0);
        await respond(r.recenterOk);
        return;
      }
      case 'set_mode': {
        this.settings.mode = cmd.mode;
        this.settings.configuredModes[cmd.mode] = true;
        this.launcherOpen = false;
        this.quickSetupMode = null;
        saveSettings(this.settings);
        void this.refreshRoadSigns(true);
        if (this.destination) void this.computeActiveRoute();
        await respond(r.modeChanged(r.modeNames[cmd.mode]));
        return;
      }
      case 'set_theme': {
        this.settings.mapTheme = cmd.theme;
        saveSettings(this.settings);
        this.applyBodyTheme();
        this.mapCtrl?.setTheme(cmd.theme);
        await respond(cmd.theme === 'day' ? r.themeDay : r.themeNight);
        return;
      }
      case 'radio_on': {
        void radioEngine.start(this.currentFix.lat, this.currentFix.lon);
        await respond(r.radioOn);
        return;
      }
      case 'radio_off': {
        radioEngine.stop();
        await respond(r.radioOff);
        return;
      }
      case 'radio_next': {
        if (!this.radioSnap.isPlaying) {
          void radioEngine.start(this.currentFix.lat, this.currentFix.lon);
          await respond(r.radioOn);
        } else {
          const picked = await radioEngine.skipToNextMusic('voice_next');
          await respond(r.radioNext(picked?.name));
        }
        return;
      }
      case 'radio_what_playing': {
        const st = this.radioSnap.currentStation;
        if (!this.radioSnap.isPlaying || !st) {
          await respond(r.radioNothingPlaying);
        } else {
          await respond(r.radioPlaying(st.lastTitle || st.lastTrack, `${st.name} (${st.frequencyLabel})`));
        }
        return;
      }
      case 'unknown': {
        await respond(r.unknown(cmd.raw), true);
        return;
      }
    }
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
