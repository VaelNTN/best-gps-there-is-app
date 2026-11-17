import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  analyzeFftSpectrum,
  classifyStreamTitle,
  extractFmFrequency,
  isTalkOnlyStation,
  matchesGenreFilter,
  RadioStation,
  scoreCandidateStation,
} from './radioClassifier';
import { haversineMeters } from './routing';
import { BlockedRadioStation, RadioGenreFilter } from '../types/navigation';

interface RadioIcyProbeResult {
  url: string;
  resolvedUrl?: string;
  ok: boolean;
  corsAllowed: boolean;
  streamTitle: string;
  icyName: string;
  icyGenre: string;
  bitrate: number;
}

interface RadioIcyPluginInterface {
  probeStations(options: { urls: string[] }): Promise<{ results: RadioIcyProbeResult[] }>;
}

const RadioIcy = registerPlugin<RadioIcyPluginInterface>('RadioIcy');

const RADIO_BROWSER_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];

interface RawRadioBrowserStation {
  stationuuid?: string;
  name?: string;
  url_resolved?: string;
  url?: string;
  homepage?: string;
  countrycode?: string;
  state?: string;
  tags?: string;
  bitrate?: number;
  votes?: number;
  hls?: number;
  lastcheckok?: number;
  geo_lat?: number | null;
  geo_long?: number | null;
}

export interface RadioSnapshot {
  isPlaying: boolean;
  isLoading: boolean;
  autoDj: boolean;
  genreFilter: RadioGenreFilter;
  regionLabel: string;
  currentStation: RadioStation | null;
  stations: RadioStation[];
  musicConfidence: number;
  dspActive: boolean;
  switchReason: string;
  songsPlayedCount: number;
  switchedAvoidedTalkCount: number;
  blockedCount: number;
}

type SnapshotListener = (snap: RadioSnapshot) => void;

function normalizeStreamUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

function normalizeStationName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 4500): Promise<Response> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

class SmartRadioEngine {
  private allFetchedStations: RadioStation[] = [];
  private stations: RadioStation[] = [];
  private currentStationId: string | null = null;
  private isPlaying = false;
  private isLoading = false;
  private autoDj = true;
  private genreFilter: RadioGenreFilter = 'all';
  private regionLabel = '';
  private lastGeoCenter: { lat: number; lon: number; countryCode: string } | null = null;

  private blockedList: BlockedRadioStation[] = [];
  private blockedIds = new Set<string>();
  private blockedUrls = new Set<string>();
  private blockedNames = new Set<string>();

  private listeners = new Set<SnapshotListener>();
  private scanTimer: number | null = null;
  private dspTimer: number | null = null;
  private stallTimer: number | null = null;
  private scanCursor = 0;
  private switchInFlight = false;
  private switchSeq = 0;
  private dspGraceUntil = 0;

  private deckA: HTMLAudioElement | null = null;
  private deckB: HTMLAudioElement | null = null;
  private activeDeck: 'A' | 'B' = 'A';

  private audioCtx: AudioContext | null = null;
  private sourceNodes = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
  private analyser: AnalyserNode | null = null;
  private fftBins: Uint8Array<ArrayBuffer> | null = null;
  private prevFftBins: Uint8Array<ArrayBuffer> | null = null;
  private dspActive = false;
  private musicConfidence = 82;
  private consecutiveSpeechTicks = 0;
  private consecutiveSilenceTicks = 0;

  private duckForTts = false;
  private muteForMic = false;
  private songsPlayedCount = 0;
  private switchedAvoidedTalkCount = 0;
  private switchReason = '';

  subscribe(fn: SnapshotListener): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  getSnapshot(): RadioSnapshot {
    const currentStation =
      this.stations.find((s) => s.id === this.currentStationId) ??
      this.allFetchedStations.find((s) => s.id === this.currentStationId && !this.isStationBlocked(s)) ??
      null;
    return {
      isPlaying: this.isPlaying,
      isLoading: this.isLoading,
      autoDj: this.autoDj,
      genreFilter: this.genreFilter,
      regionLabel: this.regionLabel,
      currentStation,
      stations: this.stations,
      musicConfidence: this.musicConfidence,
      dspActive: this.dspActive,
      switchReason: this.switchReason,
      songsPlayedCount: this.songsPlayedCount,
      switchedAvoidedTalkCount: this.switchedAvoidedTalkCount,
      blockedCount: this.blockedList.length,
    };
  }

  isStationBlocked(st: Pick<RadioStation, 'id' | 'streamUrl' | 'name'>): boolean {
    if (st.id && this.blockedIds.has(st.id)) return true;
    const normUrl = normalizeStreamUrl(st.streamUrl || '');
    if (normUrl && this.blockedUrls.has(normUrl)) return true;
    const normName = normalizeStationName(st.name || '');
    if (normName && this.blockedNames.has(normName)) return true;
    return false;
  }

  setBlockedStations(blocked: BlockedRadioStation[]): void {
    this.blockedList = [...blocked];
    this.blockedIds = new Set(blocked.map((b) => b.id).filter(Boolean));
    this.blockedUrls = new Set(blocked.map((b) => normalizeStreamUrl(b.streamUrl || '')).filter(Boolean));
    this.blockedNames = new Set(blocked.map((b) => normalizeStationName(b.name || '')).filter(Boolean));

    this.recomputeVisibleStations();

    const active =
      this.allFetchedStations.find((s) => s.id === this.currentStationId) ??
      this.stations.find((s) => s.id === this.currentStationId) ??
      null;

    if (this.currentStationId && (!active || this.isStationBlocked(active))) {
      this.switchSeq++;
      this.clearStallTimer();
      this.stopDeck(this.deckA);
      this.stopDeck(this.deckB);
      this.currentStationId = null;
      this.dspActive = false;

      if (this.isPlaying) {
        if (this.stations.length > 0) {
          this.emit();
          void this.skipToNextMusic('blocked_skip');
          return;
        }
        this.stop();
        return;
      }
    }

    this.emit();
  }

  private recomputeVisibleStations(): void {
    this.stations = this.allFetchedStations.filter((s) => !this.isStationBlocked(s)).slice(0, 25);
    if (this.scanCursor >= this.stations.length) {
      this.scanCursor = 0;
    }
  }

  setGenreFilter(genre: RadioGenreFilter, lat: number, lon: number): void {
    this.genreFilter = genre;
    this.emit();
    if (this.isPlaying || this.stations.length > 0 || this.allFetchedStations.length > 0) {
      void this.refreshLocalStations(lat, lon, true);
    }
  }

  setAutoDj(enabled: boolean): void {
    this.autoDj = enabled;
    this.emit();
  }

  /**
   * Ducks radio audio smoothly when GPS voice speaks or microphone is listening.
   */
  setVoiceDucking(ttsSpeaking: boolean, micListening: boolean): void {
    this.duckForTts = ttsSpeaking;
    this.muteForMic = micListening;
    const deck = this.getDeck(this.activeDeck);
    if (deck && this.isPlaying) {
      deck.volume = this.targetVolume();
    }
  }

  private targetVolume(): number {
    if (this.muteForMic) return 0.03;
    if (this.duckForTts) return 0.16;
    return 1.0;
  }

  private unlockAudio(): void {
    if (typeof window === 'undefined') return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        if (!this.audioCtx) {
          this.audioCtx = new Ctx();
        }
        if (this.audioCtx.state === 'suspended') {
          void this.audioCtx.resume();
        }
      }
    } catch {
      // ignore
    }
  }

  private getDeck(which: 'A' | 'B'): HTMLAudioElement | null {
    if (typeof document === 'undefined') return null;
    if (which === 'A') {
      if (!this.deckA) {
        this.deckA = document.createElement('audio');
        this.deckA.preload = 'none';
      }
      return this.deckA;
    }
    if (!this.deckB) {
      this.deckB = document.createElement('audio');
      this.deckB.preload = 'none';
    }
    return this.deckB;
  }

  private replaceDeck(which: 'A' | 'B'): HTMLAudioElement | null {
    if (typeof document === 'undefined') return null;
    const oldDeck = which === 'A' ? this.deckA : this.deckB;
    this.stopDeck(oldDeck);
    const fresh = document.createElement('audio');
    fresh.preload = 'none';
    if (which === 'A') this.deckA = fresh;
    else this.deckB = fresh;
    return fresh;
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) {
      window.clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  async start(lat: number, lon: number): Promise<void> {
    this.unlockAudio();
    const mySeq = ++this.switchSeq;
    this.isPlaying = true;
    this.isLoading = true;
    this.switchReason = 'scan';
    this.emit();

    await this.refreshLocalStations(lat, lon, this.stations.length === 0);
    if (!this.isPlaying || mySeq !== this.switchSeq) return;

    await this.probeNextBatch(true);
    if (!this.isPlaying || mySeq !== this.switchSeq) return;

    const best = this.pickBestStation();
    if (best) {
      await this.switchToStation(best, 'fresh_music', mySeq);
    } else {
      this.isLoading = false;
      this.emit();
    }

    if (this.isPlaying && mySeq === this.switchSeq) {
      this.startBackgroundLoops();
    }
  }

  stop(): void {
    this.switchSeq++;
    this.switchInFlight = false;
    this.isPlaying = false;
    this.isLoading = false;
    this.switchReason = '';
    this.clearStallTimer();
    this.stopBackgroundLoops();
    this.stopDeck(this.deckA);
    this.stopDeck(this.deckB);
    this.dspActive = false;
    this.emit();
  }

  async skipToNextMusic(reason = 'manual_skip'): Promise<RadioStation | null> {
    this.unlockAudio();
    const mySeq = ++this.switchSeq;
    const prevId = this.currentStationId;
    if (prevId) {
      const curr = this.stations.find((s) => s.id === prevId);
      if (curr) curr.cooldownUntil = Date.now() + 45_000;
    }

    this.isPlaying = true;
    this.isLoading = true;
    this.switchReason = reason;
    this.emit();

    await this.probeNextBatch(true);
    if (!this.isPlaying || mySeq !== this.switchSeq) return null;

    let next = this.pickBestStation(prevId ?? undefined);
    if (!next) {
      // Clear cooldowns and try any playable unblocked station
      this.stations.forEach((s) => {
        if (s.id !== prevId && !this.isStationBlocked(s)) s.cooldownUntil = 0;
      });
      next = this.pickBestStation(prevId ?? undefined) ?? this.pickBestStation();
    }

    if (!next) {
      this.isLoading = false;
      this.emit();
      return null;
    }

    await this.switchToStation(next, reason, mySeq);
    if (this.isPlaying && mySeq === this.switchSeq) {
      this.startBackgroundLoops();
    }
    return this.stations.find((s) => s.id === this.currentStationId) ?? next;
  }

  async playSpecificStation(stationId: string): Promise<void> {
    const st = this.stations.find((s) => s.id === stationId);
    if (!st || this.isStationBlocked(st)) return;

    this.unlockAudio();
    const mySeq = ++this.switchSeq;
    st.cooldownUntil = 0;
    st.failCount = 0;
    if (st.state === 'offline') st.state = 'music';
    this.isPlaying = true;
    this.autoDj = false; // Locking onto chosen station until user re-enables Auto-DJ
    await this.switchToStation(st, 'manual_pick', mySeq);
    if (this.isPlaying && mySeq === this.switchSeq) {
      this.startBackgroundLoops();
    }
  }

  async maybeRefreshForPosition(lat: number, lon: number): Promise<void> {
    if (!this.isPlaying) return;
    if (!this.lastGeoCenter) {
      await this.refreshLocalStations(lat, lon, true);
      return;
    }
    const movedM = haversineMeters(this.lastGeoCenter, { lat, lon });
    if (movedM > 75_000) {
      await this.refreshLocalStations(lat, lon, true);
    }
  }

  private async resolveCountryNear(lat: number, lon: number): Promise<{ countryCode: string; label: string }> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=5&addressdetails=1`;
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 4000);
      if (res.ok) {
        const data = (await res.json()) as {
          address?: { country_code?: string; country?: string; state?: string; city?: string; town?: string };
        };
        const cc = (data.address?.country_code || 'be').toUpperCase();
        const area = data.address?.state || data.address?.city || data.address?.town || data.address?.country || cc;
        return { countryCode: cc, label: `${area} (${cc})` };
      }
    } catch {
      // Offline / rate-limit fallback
    }
    return { countryCode: this.lastGeoCenter?.countryCode || 'BE', label: this.regionLabel || 'Regio FM' };
  }

  async refreshLocalStations(lat: number, lon: number, force = false): Promise<void> {
    if (!force && this.stations.length >= 10 && this.lastGeoCenter) {
      const moved = haversineMeters(this.lastGeoCenter, { lat, lon });
      if (moved < 60_000) return;
    }

    const { countryCode, label } = await this.resolveCountryNear(lat, lon);
    this.lastGeoCenter = { lat, lon, countryCode };
    this.regionLabel = label;

    const rawCollected: RawRadioBrowserStation[] = [];
    for (const mirror of RADIO_BROWSER_MIRRORS) {
      try {
        const [geoRes, topRes] = await Promise.all([
          fetchWithTimeout(
            `${mirror}/json/stations/search?countrycode=${encodeURIComponent(
              countryCode
            )}&has_geo_info=true&hidebroken=true&order=votes&reverse=true&limit=100`,
            { headers: { Accept: 'application/json' } },
            4500
          ),
          fetchWithTimeout(
            `${mirror}/json/stations/search?countrycode=${encodeURIComponent(
              countryCode
            )}&hidebroken=true&order=votes&reverse=true&limit=100`,
            { headers: { Accept: 'application/json' } },
            4500
          ),
        ]);
        if (geoRes.ok) {
          const arr = (await geoRes.json()) as RawRadioBrowserStation[];
          if (Array.isArray(arr)) rawCollected.push(...arr);
        }
        if (topRes.ok) {
          const arr = (await topRes.json()) as RawRadioBrowserStation[];
          if (Array.isArray(arr)) rawCollected.push(...arr);
        }
        if (rawCollected.length > 0) break;
      } catch {
        // Try next mirror
      }
    }

    const parseRawList = (items: RawRadioBrowserStation[], existingMap: Map<string, RadioStation>): RadioStation[] => {
      const byUrl = new Map<string, RadioStation>();
      for (const r of items) {
        const streamUrl = (r.url_resolved || r.url || '').trim();
        const name = (r.name || '').trim();
        if (!streamUrl || !name || r.hls === 1 || r.lastcheckok === 0) continue;
        if (!/^https?:\/\//i.test(streamUrl)) continue;
        if (/\.(m3u8|pls|asx)(\?|$)/i.test(streamUrl)) continue;

        const tags = (r.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        if (isTalkOnlyStation(name, tags)) continue;

        const stLat = typeof r.geo_lat === 'number' ? r.geo_lat : undefined;
        const stLon = typeof r.geo_long === 'number' ? r.geo_long : undefined;
        const distanceKm =
          stLat !== undefined && stLon !== undefined
            ? Math.round(haversineMeters({ lat, lon }, { lat: stLat, lon: stLon }) / 1000)
            : undefined;

        const id = r.stationuuid || streamUrl;
        const prev = existingMap.get(id);
        const st: RadioStation = prev
          ? { ...prev, streamUrl, distanceKm, tags }
          : {
              id,
              name,
              frequencyLabel: extractFmFrequency(name, tags),
              streamUrl,
              homepage: r.homepage,
              countryCode: r.countrycode || countryCode,
              stateName: r.state,
              tags,
              bitrate: Number(r.bitrate || 0),
              votes: Number(r.votes || 0),
              lat: stLat,
              lon: stLon,
              distanceKm,
              corsAllowed: false,
              lastTitle: '',
              lastArtist: '',
              lastTrack: '',
              trackStartedAt: 0,
              trackEndedAt: 0,
              state: 'scanning',
              musicScore: 60,
              lastProbedAt: 0,
              cooldownUntil: 0,
              failCount: 0,
            };

        if (!matchesGenreFilter(st, this.genreFilter)) continue;
        const urlKey = normalizeStreamUrl(streamUrl);
        if (!byUrl.has(urlKey)) {
          byUrl.set(urlKey, st);
        }
      }
      return [...byUrl.values()];
    };

    const existingMap = new Map(this.allFetchedStations.map((s) => [s.id, s]));
    let parsed = parseRawList(rawCollected, existingMap);

    // If too few unblocked local stations remain (e.g. user blocked many), top up from broader top-voted stations
    const unblockedCount = parsed.filter((s) => !this.isStationBlocked(s)).length;
    if (unblockedCount < 8) {
      for (const mirror of RADIO_BROWSER_MIRRORS) {
        try {
          const broadRes = await fetchWithTimeout(
            `${mirror}/json/stations/search?hidebroken=true&order=votes&reverse=true&limit=100`,
            { headers: { Accept: 'application/json' } },
            4500
          );
          if (broadRes.ok) {
            const arr = (await broadRes.json()) as RawRadioBrowserStation[];
            if (Array.isArray(arr) && arr.length > 0) {
              parsed = parseRawList([...rawCollected, ...arr], existingMap);
              break;
            }
          }
        } catch {
          // Try next mirror
        }
      }
    }

    // Prioritize nearby local stations + high-vote regional/national music stations
    this.allFetchedStations = parsed.sort((a, b) => {
      const localA = a.distanceKm !== undefined ? Math.max(0, 200 - a.distanceKm) : 20;
      const localB = b.distanceKm !== undefined ? Math.max(0, 200 - b.distanceKm) : 20;
      return localB + Math.min(200, b.votes * 0.4) - (localA + Math.min(200, a.votes * 0.4));
    });

    this.recomputeVisibleStations();
    this.emit();
  }

  private startBackgroundLoops(): void {
    this.stopBackgroundLoops();
    this.scanTimer = window.setInterval(() => {
      if (!this.isPlaying) return;
      void this.probeNextBatch(false);
    }, 5500);

    this.dspTimer = window.setInterval(() => {
      this.tickDspAnalysis();
    }, 250);
  }

  private stopBackgroundLoops(): void {
    if (this.scanTimer !== null) {
      window.clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.dspTimer !== null) {
      window.clearInterval(this.dspTimer);
      this.dspTimer = null;
    }
  }

  private async probeNextBatch(fullScan: boolean): Promise<void> {
    const eligible = this.stations.filter((s) => !this.isStationBlocked(s));
    if (eligible.length === 0) return;

    const targets: RadioStation[] = [];
    const active = eligible.find((s) => s.id === this.currentStationId);
    if (active) targets.push(active);

    const limit = fullScan ? Math.min(12, eligible.length) : Math.min(8, eligible.length);
    for (let i = 0; i < eligible.length && targets.length < limit; i++) {
      const idx = (this.scanCursor + i) % eligible.length;
      const cand = eligible[idx];
      if (!targets.some((t) => t.id === cand.id)) {
        targets.push(cand);
      }
    }
    this.scanCursor = (this.scanCursor + 5) % Math.max(1, eligible.length);

    let results: RadioIcyProbeResult[] = [];
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await RadioIcy.probeStations({ urls: targets.map((t) => t.streamUrl) });
        results = Array.isArray(res?.results) ? res.results : [];
      } catch {
        results = [];
      }
    } else {
      // Browser fallback: lightweight parallel GET/HEAD probe on batch
      results = await Promise.all(
        targets.map(async (st): Promise<RadioIcyProbeResult> => {
          const ac = new AbortController();
          const timer = window.setTimeout(() => ac.abort(), 2200);
          try {
            const resp = await fetch(st.streamUrl, {
              method: 'GET',
              headers: { 'Icy-MetaData': '1' },
              signal: ac.signal,
            });
            const streamTitle = resp.headers.get('icy-name') || '';
            ac.abort();
            return {
              url: st.streamUrl,
              ok: resp.ok,
              corsAllowed: true,
              streamTitle,
              icyName: resp.headers.get('icy-name') || '',
              icyGenre: resp.headers.get('icy-genre') || '',
              bitrate: Number(resp.headers.get('icy-br') || st.bitrate || 0),
            };
          } catch {
            // Browser opaque streams can still play in <audio> even if fetch hits CORS
            return {
              url: st.streamUrl,
              ok: true,
              corsAllowed: false,
              streamTitle: '',
              icyName: '',
              icyGenre: '',
              bitrate: st.bitrate,
            };
          } finally {
            window.clearTimeout(timer);
          }
        })
      );
    }

    const now = Date.now();
    let activeTriggeredSwitch = false;
    let activeTrackChanged = false;

    for (const r of results) {
      const st = targets.find((t) => t.streamUrl === r.url);
      if (!st || this.isStationBlocked(st)) continue;
      st.lastProbedAt = now;

      if (!r.ok) {
        st.failCount++;
        if (st.failCount >= 3) st.state = 'offline';
        continue;
      }
      st.failCount = 0;
      if (r.corsAllowed) st.corsAllowed = true;
      if (r.bitrate > 0) st.bitrate = r.bitrate;

      if (
        r.resolvedUrl &&
        /^https?:\/\//i.test(r.resolvedUrl) &&
        !/\.(m3u8|pls|asx)(\?|$)/i.test(r.resolvedUrl) &&
        !this.blockedUrls.has(normalizeStreamUrl(r.resolvedUrl))
      ) {
        st.streamUrl = r.resolvedUrl;
      }

      if (r.streamTitle) {
        const prevNorm = st.lastTitle.toLowerCase();
        const cls = classifyStreamTitle(r.streamTitle, st.name);

        if (cls.kind === 'ad' || cls.kind === 'talk') {
          const wasMusic = st.state === 'music' || st.state === 'music_started';
          st.state = cls.kind;
          st.musicScore = Math.max(10, st.musicScore - 35);
          st.lastTitle = r.streamTitle;
          if (wasMusic) st.trackEndedAt = now;
          if (st.id === this.currentStationId && this.autoDj) {
            activeTriggeredSwitch = true;
          }
        } else if (cls.kind === 'music') {
          const isNewSong = prevNorm !== cls.normalized;
          st.lastTitle = `${cls.artist} - ${cls.track}`;
          st.lastArtist = cls.artist;
          st.lastTrack = cls.track;
          if (isNewSong) {
            st.trackStartedAt = now;
            st.state = 'music_started';
            st.musicScore = Math.min(99, Math.max(st.musicScore, 80) + 12);
            if (st.id === this.currentStationId) activeTrackChanged = true;
          } else {
            const age = now - (st.trackStartedAt || now);
            st.state = age <= 38_000 ? 'music_started' : 'music';
          }
        } else {
          // Keep station as music when ICY sends a station slogan/program name instead of forcing a talk skip
          st.state = 'music';
          if (!st.lastTitle && r.streamTitle && r.streamTitle.length >= 3) {
            st.lastTitle = r.streamTitle;
          }
        }
      } else if (st.state === 'scanning') {
        st.state = 'music';
      }
    }

    if (activeTrackChanged) {
      this.songsPlayedCount++;
      this.updateMediaSession();
    }

    // Also check if current song has lasted > 4m15s (song likely ended without metadata update)
    // and another unblocked station JUST started a brand-new song!
    const current = this.stations.find((s) => s.id === this.currentStationId && !this.isStationBlocked(s));
    if (this.autoDj && current && !activeTriggeredSwitch) {
      const currentAge = current.trackStartedAt > 0 ? now - current.trackStartedAt : 0;
      const freshOther = this.stations.find(
        (s) =>
          !this.isStationBlocked(s) &&
          s.id !== current.id &&
          s.state === 'music_started' &&
          now - s.trackStartedAt < 25_000 &&
          s.cooldownUntil <= now
      );
      if (freshOther && currentAge > 255_000) {
        activeTriggeredSwitch = true;
      }
    }

    this.emit();

    if (activeTriggeredSwitch && !this.switchInFlight && this.isPlaying) {
      this.switchedAvoidedTalkCount++;
      const next = this.pickBestStation(this.currentStationId ?? undefined);
      if (next) {
        await this.switchToStation(next, 'avoided_dj_talk');
      }
    }
  }

  private tickDspAnalysis(): void {
    if (!this.isPlaying || !this.dspActive || !this.analyser || !this.fftBins) return;
    if (this.muteForMic || this.duckForTts || this.switchInFlight) return;
    const now = Date.now();
    if (now < this.dspGraceUntil) return;

    const deck = this.getDeck(this.activeDeck);
    // Do not misclassify network buffering or paused playback as dead air / DJ speech
    if (!deck || deck.paused || deck.readyState < 3) {
      this.consecutiveSilenceTicks = 0;
      this.consecutiveSpeechTicks = 0;
      return;
    }

    this.analyser.getByteFrequencyData(this.fftBins);
    const sampleRate = this.audioCtx?.sampleRate ?? 44100;
    const stats = analyzeFftSpectrum(this.fftBins, sampleRate, this.prevFftBins);

    if (!this.prevFftBins) {
      this.prevFftBins = new Uint8Array(new ArrayBuffer(this.fftBins.length));
    }
    this.prevFftBins.set(this.fftBins);

    if (stats.isSilence) {
      this.consecutiveSilenceTicks++;
      this.consecutiveSpeechTicks = Math.max(0, this.consecutiveSpeechTicks - 1);
    } else {
      this.consecutiveSilenceTicks = 0;
      this.musicConfidence = Math.round(this.musicConfidence * 0.8 + stats.musicConfidence * 0.2);
      if (stats.isLikelySpeech) {
        this.consecutiveSpeechTicks++;
      } else {
        this.consecutiveSpeechTicks = Math.max(0, this.consecutiveSpeechTicks - 2);
      }
    }

    const current = this.stations.find((s) => s.id === this.currentStationId);
    if (current) {
      current.musicScore = this.musicConfidence;
    }

    // ~6.5 seconds of steady dry speech OR ~5 seconds of dead air -> Auto-DJ hops to fresh music!
    if (
      this.autoDj &&
      !this.switchInFlight &&
      (this.consecutiveSpeechTicks >= 26 || this.consecutiveSilenceTicks >= 20)
    ) {
      const reason = this.consecutiveSilenceTicks >= 20 ? 'silence_end' : 'dj_voice_detected';
      this.consecutiveSpeechTicks = 0;
      this.consecutiveSilenceTicks = 0;
      if (current) {
        current.state = 'talk';
        current.cooldownUntil = Date.now() + 50_000;
      }
      this.switchedAvoidedTalkCount++;
      void this.skipToNextMusic(reason);
    }
  }

  private pickBestStation(excludeId?: string): RadioStation | null {
    const now = Date.now();
    let best: RadioStation | null = null;
    let bestScore = -9999;

    for (const st of this.stations) {
      if (this.isStationBlocked(st)) continue;
      const sc = scoreCandidateStation(st, now, excludeId);
      if (sc > bestScore) {
        bestScore = sc;
        best = st;
      }
    }
    return best;
  }

  private attachRuntimeListeners(audio: HTMLAudioElement, station: RadioStation, seq: number): void {
    const scheduleRecover = (reason: string): void => {
      if (!this.isPlaying || seq !== this.switchSeq) return;
      station.failCount++;
      if (station.failCount >= 3) station.state = 'offline';
      station.cooldownUntil = Date.now() + 30_000;
      void this.skipToNextMusic(reason);
    };

    audio.onerror = () => scheduleRecover('stream_error');
    audio.onended = () => scheduleRecover('stream_ended');
    audio.onstalled = () => {
      if (!this.isPlaying || seq !== this.switchSeq) return;
      this.clearStallTimer();
      this.stallTimer = window.setTimeout(() => {
        if (!this.isPlaying || seq !== this.switchSeq) return;
        if (audio.paused || audio.readyState < 3) {
          scheduleRecover('stream_stalled');
        }
      }, 7000);
    };
    audio.onplaying = () => {
      this.clearStallTimer();
    };
  }

  private async switchToStation(initialStation: RadioStation, initialReason: string, providedSeq?: number): Promise<void> {
    const mySeq = providedSeq ?? ++this.switchSeq;
    this.switchInFlight = true;
    this.clearStallTimer();

    try {
      let candidate: RadioStation | null = initialStation;
      let reason = initialReason;
      const triedIds = new Set<string>();

      for (let attempt = 0; attempt < 4 && candidate; attempt++) {
        if (!this.isPlaying || mySeq !== this.switchSeq) return;
        if (this.isStationBlocked(candidate)) {
          triedIds.add(candidate.id);
          candidate = this.pickBestStation(candidate.id);
          continue;
        }

        triedIds.add(candidate.id);
        this.isLoading = true;
        this.switchReason = reason;
        this.consecutiveSpeechTicks = 0;
        this.consecutiveSilenceTicks = 0;
        this.emit();

        const nextDeckKey: 'A' | 'B' = this.activeDeck === 'A' ? 'B' : 'A';
        let nextDeck = this.getDeck(nextDeckKey);
        const prevDeck = this.getDeck(this.activeDeck);

        if (!nextDeck) {
          this.isLoading = false;
          this.emit();
          return;
        }

        let ok = false;
        let corsActive = false;

        if (candidate.corsAllowed) {
          const resCors = await this.tryLoadAndPlay(nextDeck, candidate.streamUrl, true, 4000);
          ok = resCors.ok;
          corsActive = resCors.corsActive;
          if (!this.isPlaying || mySeq !== this.switchSeq) {
            this.stopDeck(nextDeck);
            return;
          }
        }

        if (!ok) {
          // If this audio element was ever bound to a WebAudio MediaElementSourceNode,
          // Chromium outputs silence for non-CORS streams -> replace with a clean element.
          if (this.sourceNodes.has(nextDeck)) {
            nextDeck = this.replaceDeck(nextDeckKey);
            if (!nextDeck) return;
          }
          const plainTry = await this.tryLoadAndPlay(nextDeck, candidate.streamUrl, false, 5000);
          ok = plainTry.ok;
          corsActive = false;
          if (!this.isPlaying || mySeq !== this.switchSeq) {
            this.stopDeck(nextDeck);
            return;
          }
        }

        if (!ok || this.isStationBlocked(candidate)) {
          this.stopDeck(nextDeck);
          candidate.failCount++;
          if (candidate.failCount >= 3) candidate.state = 'offline';
          candidate.cooldownUntil = Date.now() + 30_000;
          reason = 'stream_retry';
          candidate =
            this.pickBestStation(candidate.id) ??
            this.stations.find((s) => !triedIds.has(s.id) && !this.isStationBlocked(s)) ??
            null;
          continue;
        }

        // Attach live FFT speech-vs-music analyzer when CORS allows WebAudio
        this.attachDspAnalyzer(nextDeck, corsActive);
        this.dspGraceUntil = Date.now() + 12_000;

        // Smooth crossfade from outgoing deck -> incoming deck
        const targetVol = this.targetVolume();
        await this.crossfade(prevDeck, nextDeck, targetVol, mySeq);
        if (!this.isPlaying || mySeq !== this.switchSeq) {
          this.stopDeck(nextDeck);
          return;
        }

        if (prevDeck) this.stopDeck(prevDeck);
        this.activeDeck = nextDeckKey;
        this.currentStationId = candidate.id;
        this.attachRuntimeListeners(nextDeck, candidate, mySeq);
        this.songsPlayedCount++;
        this.isLoading = false;
        this.updateMediaSession();
        this.emit();
        return;
      }

      if (mySeq === this.switchSeq) {
        this.isLoading = false;
        this.emit();
      }
    } finally {
      if (mySeq === this.switchSeq) {
        this.switchInFlight = false;
      }
    }
  }

  private tryLoadAndPlay(
    audio: HTMLAudioElement,
    url: string,
    withCors: boolean,
    timeoutMs = 5000
  ): Promise<{ ok: boolean; corsActive: boolean }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        audio.onplaying = null;
        audio.onerror = null;
        resolve({ ok, corsActive: ok && withCors });
      };

      const timer = window.setTimeout(() => done(false), timeoutMs);
      audio.pause();
      audio.removeAttribute('src');
      if (withCors) audio.crossOrigin = 'anonymous';
      else audio.removeAttribute('crossorigin');
      audio.volume = 0;
      audio.src = url;
      audio.onplaying = () => done(true);
      audio.onerror = () => done(false);

      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => done(false));
      }
    });
  }

  private async crossfade(
    outgoing: HTMLAudioElement | null,
    incoming: HTMLAudioElement,
    targetVol: number,
    seq: number
  ): Promise<void> {
    const steps = 12;
    const stepMs = 45;
    const outStart = outgoing ? outgoing.volume : 0;
    for (let i = 1; i <= steps; i++) {
      if (!this.isPlaying || seq !== this.switchSeq) return;
      const t = i / steps;
      incoming.volume = Math.min(1, targetVol * t);
      if (outgoing) outgoing.volume = Math.max(0, outStart * (1 - t));
      await new Promise((r) => window.setTimeout(r, stepMs));
    }
  }

  private stopDeck(audio: HTMLAudioElement | null): void {
    if (!audio) return;
    try {
      audio.onplaying = null;
      audio.onerror = null;
      audio.onended = null;
      audio.onstalled = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // ignore
    }
  }

  private attachDspAnalyzer(audio: HTMLAudioElement, corsAllowed: boolean): void {
    if (!corsAllowed || typeof window === 'undefined') {
      this.dspActive = false;
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        this.dspActive = false;
        return;
      }
      if (!this.audioCtx) {
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
      let src = this.sourceNodes.get(audio);
      if (!src) {
        src = this.audioCtx.createMediaElementSource(audio);
        this.sourceNodes.set(audio, src);
      }
      if (!this.analyser) {
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.65;
      }
      src.disconnect();
      src.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this.fftBins = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.dspActive = true;
    } catch {
      this.dspActive = false;
    }
  }

  private updateMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const st = this.stations.find((s) => s.id === this.currentStationId);
    if (!st) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: st.lastTrack || st.lastTitle || st.name,
        artist: st.lastArtist || `${st.name} (${st.frequencyLabel})`,
        album: `Road Mapper • Non-Stop Radio`,
      });
    } catch {
      // ignore
    }
  }
}

export const radioEngine = new SmartRadioEngine();
