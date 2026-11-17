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
import { RadioGenreFilter } from '../types/navigation';

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
}

type SnapshotListener = (snap: RadioSnapshot) => void;

class SmartRadioEngine {
  private stations: RadioStation[] = [];
  private currentStationId: string | null = null;
  private isPlaying = false;
  private isLoading = false;
  private autoDj = true;
  private genreFilter: RadioGenreFilter = 'all';
  private regionLabel = '';
  private lastGeoCenter: { lat: number; lon: number; countryCode: string } | null = null;

  private listeners = new Set<SnapshotListener>();
  private scanTimer: number | null = null;
  private dspTimer: number | null = null;
  private scanCursor = 0;
  private switchInFlight = false;

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
    const currentStation = this.stations.find((s) => s.id === this.currentStationId) ?? null;
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
    };
  }

  setGenreFilter(genre: RadioGenreFilter, lat: number, lon: number): void {
    this.genreFilter = genre;
    this.emit();
    if (this.isPlaying || this.stations.length > 0) {
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

  async start(lat: number, lon: number): Promise<void> {
    this.isPlaying = true;
    this.isLoading = true;
    this.switchReason = 'scan';
    this.emit();

    await this.refreshLocalStations(lat, lon, this.stations.length === 0);
    if (!this.isPlaying) return;

    await this.probeNextBatch(true);
    if (!this.isPlaying) return;

    const best = this.pickBestStation();
    if (best) {
      await this.switchToStation(best, 'fresh_music');
    } else {
      this.isLoading = false;
      this.emit();
    }

    this.startBackgroundLoops();
  }

  stop(): void {
    this.isPlaying = false;
    this.isLoading = false;
    this.switchReason = '';
    this.stopBackgroundLoops();
    this.stopDeck(this.deckA);
    this.stopDeck(this.deckB);
    this.dspActive = false;
    this.emit();
  }

  async skipToNextMusic(reason = 'manual_skip'): Promise<RadioStation | null> {
    const prevId = this.currentStationId;
    if (prevId) {
      const curr = this.stations.find((s) => s.id === prevId);
      if (curr) curr.cooldownUntil = Date.now() + 45_000;
    }
    await this.probeNextBatch(true);
    const next = this.pickBestStation(prevId ?? undefined);
    if (!next) {
      // Clear cooldowns and try any playable station
      this.stations.forEach((s) => {
        if (s.id !== prevId) s.cooldownUntil = 0;
      });
      const fallback = this.pickBestStation(prevId ?? undefined);
      if (fallback) {
        await this.switchToStation(fallback, reason);
        return fallback;
      }
      return null;
    }
    await this.switchToStation(next, reason);
    return next;
  }

  async playSpecificStation(stationId: string): Promise<void> {
    const st = this.stations.find((s) => s.id === stationId);
    if (!st) return;
    st.cooldownUntil = 0;
    this.isPlaying = true;
    this.autoDj = false; // Locking onto chosen station until user re-enables Auto-DJ
    await this.switchToStation(st, 'manual_pick');
    this.startBackgroundLoops();
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
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
          fetch(
            `${mirror}/json/stations/search?countrycode=${encodeURIComponent(
              countryCode
            )}&has_geo_info=true&hidebroken=true&order=votes&reverse=true&limit=70`,
            { headers: { Accept: 'application/json' } }
          ),
          fetch(
            `${mirror}/json/stations/search?countrycode=${encodeURIComponent(
              countryCode
            )}&hidebroken=true&order=votes&reverse=true&limit=65`,
            { headers: { Accept: 'application/json' } }
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

    const byUrl = new Map<string, RadioStation>();
    const existingMap = new Map(this.stations.map((s) => [s.id, s]));

    for (const r of rawCollected) {
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
      if (!byUrl.has(streamUrl)) {
        byUrl.set(streamUrl, st);
      }
    }

    // Prioritize nearby local stations + high-vote regional/national music stations
    const ranked = [...byUrl.values()].sort((a, b) => {
      const localA = a.distanceKm !== undefined ? Math.max(0, 200 - a.distanceKm) : 20;
      const localB = b.distanceKm !== undefined ? Math.max(0, 200 - b.distanceKm) : 20;
      return localB + Math.min(200, b.votes * 0.4) - (localA + Math.min(200, a.votes * 0.4));
    });

    this.stations = ranked.slice(0, 20);
    this.emit();
  }

  private startBackgroundLoops(): void {
    this.stopBackgroundLoops();
    this.scanTimer = window.setInterval(() => {
      if (!this.isPlaying) return;
      void this.probeNextBatch(false);
    }, 4500);

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
    if (this.stations.length === 0) return;
    const targets: RadioStation[] = [];
    const active = this.stations.find((s) => s.id === this.currentStationId);
    if (active) targets.push(active);

    const limit = fullScan ? Math.min(16, this.stations.length) : Math.min(10, this.stations.length);
    for (let i = 0; i < this.stations.length && targets.length < limit; i++) {
      const idx = (this.scanCursor + i) % this.stations.length;
      const cand = this.stations[idx];
      if (!targets.some((t) => t.id === cand.id)) {
        targets.push(cand);
      }
    }
    this.scanCursor = (this.scanCursor + 6) % Math.max(1, this.stations.length);

    let results: RadioIcyProbeResult[] = [];
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await RadioIcy.probeStations({ urls: targets.map((t) => t.streamUrl) });
        results = Array.isArray(res?.results) ? res.results : [];
      } catch {
        results = [];
      }
    } else {
      // Browser fallback: lightweight parallel HEAD/CORS check on batch
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
      if (!st) continue;
      st.lastProbedAt = now;

      if (!r.ok) {
        st.failCount++;
        if (st.failCount >= 3) st.state = 'offline';
        continue;
      }
      st.failCount = 0;
      if (r.corsAllowed) st.corsAllowed = true;
      if (r.bitrate > 0) st.bitrate = r.bitrate;

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
          // Unrecognized / empty tagline after music may mean track finished & DJ is talking
          const wasMusic = st.state === 'music' || st.state === 'music_started';
          if (wasMusic && now - st.trackStartedAt > 45_000) {
            st.state = 'talk';
            st.trackEndedAt = now;
            st.lastTitle = r.streamTitle;
            if (st.id === this.currentStationId && this.autoDj) {
              activeTriggeredSwitch = true;
            }
          } else {
            st.state = 'music';
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
    // and another station JUST started a brand-new song!
    const current = this.stations.find((s) => s.id === this.currentStationId);
    if (this.autoDj && current && !activeTriggeredSwitch) {
      const currentAge = current.trackStartedAt > 0 ? now - current.trackStartedAt : 0;
      const freshOther = this.stations.find(
        (s) =>
          s.id !== current.id &&
          s.state === 'music_started' &&
          now - s.trackStartedAt < 25_000 &&
          s.cooldownUntil <= now
      );
      if (freshOther && currentAge > 235_000) {
        activeTriggeredSwitch = true;
      }
    }

    this.emit();

    if (activeTriggeredSwitch && !this.switchInFlight) {
      this.switchedAvoidedTalkCount++;
      const next = this.pickBestStation(this.currentStationId ?? undefined);
      if (next) {
        await this.switchToStation(next, 'avoided_dj_talk');
      }
    }
  }

  private tickDspAnalysis(): void {
    if (!this.isPlaying || !this.dspActive || !this.analyser || !this.fftBins) return;
    if (this.muteForMic || this.duckForTts) return;

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

    // ~4 seconds of steady dry speech OR ~3.5 seconds of dead air -> Auto-DJ hops to fresh music!
    if (
      this.autoDj &&
      !this.switchInFlight &&
      (this.consecutiveSpeechTicks >= 16 || this.consecutiveSilenceTicks >= 14)
    ) {
      const reason = this.consecutiveSilenceTicks >= 14 ? 'silence_end' : 'dj_voice_detected';
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
      const sc = scoreCandidateStation(st, now, excludeId);
      if (sc > bestScore) {
        bestScore = sc;
        best = st;
      }
    }
    return best;
  }

  private async switchToStation(station: RadioStation, reason: string): Promise<void> {
    if (this.switchInFlight) return;
    this.switchInFlight = true;
    this.isLoading = true;
    this.switchReason = reason;
    this.consecutiveSpeechTicks = 0;
    this.consecutiveSilenceTicks = 0;
    this.emit();

    const nextDeckKey: 'A' | 'B' = this.activeDeck === 'A' ? 'B' : 'A';
    const nextDeck = this.getDeck(nextDeckKey);
    const prevDeck = this.getDeck(this.activeDeck);

    if (!nextDeck) {
      this.switchInFlight = false;
      this.isLoading = false;
      return;
    }

    try {
      const startedWithCors = await this.tryLoadAndPlay(nextDeck, station.streamUrl, true);
      let activeNextDeck: HTMLAudioElement = nextDeck;
      let ok = startedWithCors.ok;
      let corsActive = startedWithCors.corsActive;

      if (!ok) {
        if (this.sourceNodes.has(activeNextDeck)) {
          this.stopDeck(activeNextDeck);
          activeNextDeck = document.createElement('audio');
          activeNextDeck.preload = 'none';
          if (nextDeckKey === 'A') this.deckA = activeNextDeck;
          else this.deckB = activeNextDeck;
        }
        const plainTry = await this.tryLoadAndPlay(activeNextDeck, station.streamUrl, false);
        ok = plainTry.ok;
        corsActive = false;
      }

      if (!ok || !this.isPlaying) {
        station.failCount++;
        if (station.failCount >= 3) station.state = 'offline';
        station.cooldownUntil = Date.now() + 30_000;
        this.switchInFlight = false;
        this.isLoading = false;
        const alt = this.pickBestStation(station.id);
        if (alt && this.isPlaying) {
          await this.switchToStation(alt, 'stream_retry');
        } else {
          this.emit();
        }
        return;
      }

      // Attach live FFT speech-vs-music analyzer when CORS allows WebAudio
      this.attachDspAnalyzer(activeNextDeck, corsActive);

      // Smooth 900ms crossfade from outgoing deck -> incoming deck
      const targetVol = this.targetVolume();
      await this.crossfade(prevDeck, activeNextDeck, targetVol);

      if (prevDeck) this.stopDeck(prevDeck);
      this.activeDeck = nextDeckKey;
      this.currentStationId = station.id;
      this.songsPlayedCount++;
      this.isLoading = false;
      this.updateMediaSession();
      this.emit();
    } finally {
      this.switchInFlight = false;
    }
  }

  private tryLoadAndPlay(
    audio: HTMLAudioElement,
    url: string,
    withCors: boolean
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

      const timer = window.setTimeout(() => done(false), 5000);
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

  private async crossfade(outgoing: HTMLAudioElement | null, incoming: HTMLAudioElement, targetVol: number): Promise<void> {
    const steps = 15;
    const stepMs = 55;
    const outStart = outgoing ? outgoing.volume : 0;
    for (let i = 1; i <= steps; i++) {
      if (!this.isPlaying) return;
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
