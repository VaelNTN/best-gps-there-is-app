import { RadioGenreFilter } from '../types/navigation';

export type StationScanState = 'music_started' | 'music' | 'talk' | 'ad' | 'scanning' | 'offline';

export interface RadioStation {
  id: string;
  name: string;
  frequencyLabel: string;
  streamUrl: string;
  homepage?: string;
  countryCode: string;
  stateName?: string;
  tags: string[];
  bitrate: number;
  votes: number;
  lat?: number;
  lon?: number;
  distanceKm?: number;
  corsAllowed: boolean;
  lastTitle: string;
  lastArtist: string;
  lastTrack: string;
  trackStartedAt: number;
  trackEndedAt: number;
  state: StationScanState;
  musicScore: number;
  lastProbedAt: number;
  cooldownUntil: number;
  failCount: number;
}

export interface ClassifiedTitle {
  kind: 'music' | 'talk' | 'ad' | 'unknown';
  artist: string;
  track: string;
  normalized: string;
}

const TALK_STATION_REGEX =
  /\b(talk\s*radio|news\s*radio|all\s*news|sport\s*radio|podcast|spoken|parliament|traffic\s*info|weather\s*radio|nieuwszender|praatradio|bnr\s+nieuws|france\s+info|deutschlandfunk|inforadio|bbc\s+radio\s*4|bbc\s+world\s+service|talksport|lbc\s+news)\b/i;

const EXPLICIT_TALK_TITLE_REGEX =
  /\b(het\s+journaal|journaal|weerbericht|verkeersinfo|filebericht|nieuwsupdate|nieuwsbulletin|news\s*update|news\s*bulletin|weather\s*report|traffic\s*report|station\s*id|talk\s*show|de\s+ochtendshow|ochtendspits|middagshow|avondspits|sportverslag|nachrichten|verkehrsmeldung|wettermeldung|publicit[eé]|wiadomo[sś]ci|reklama|haberler|reklam)\b/i;

const GENERIC_TALK_TITLE_REGEX =
  /\b(nieuws|weerbericht|verkeer|talk\s*show|live\s*show|interview|debat|commentary|commentaar|headlines|weather|traffic|podcast|nachrichten|verkehr|wetter|infos|journal|m[eé]t[eé]o|noticias|tr[aá]fico)\b/i;

const AD_TITLE_REGEX = /\b(reclame|advertentie|commercial|werbung|publicit[eé]|ad\s+break|reklam|sponsored\s+by)\b/i;

export function extractFmFrequency(name: string, tags: string[] = []): string {
  const hay = `${name} ${tags.join(' ')}`;
  const match = hay.match(/\b(8[7-9]|9\d|10[0-8])[.,](\d{1,2})\s*(?:mhz|fm)?\b/i);
  if (match) {
    return `${match[1]}.${match[2]} FM`;
  }
  if (/\bdab\+?\b/i.test(hay)) return 'DAB+';
  return 'FM / Web';
}

export function isTalkOnlyStation(name: string, tags: string[]): boolean {
  const hay = `${name} ${tags.join(' ')}`.toLowerCase();
  if (/\b(non[-\s]?stop|music\s*only|100%\s*hits|alleen\s*muziek)\b/.test(hay)) return false;
  if (TALK_STATION_REGEX.test(hay)) return true;
  const tagSet = tags.map((t) => t.trim().toLowerCase());
  const talkTags = ['news', 'talk', 'speech', 'spoken', 'public', 'religious', 'sermon', 'lecture', 'debate'];
  const musicTags = ['pop', 'rock', 'dance', 'electronic', 'hits', 'top 40', 'oldies', 'chill', 'jazz', 'house', '80s', '90s', 'indie', 'rnb', 'hiphop', 'music'];
  const hasTalkTag = tagSet.some((t) => talkTags.includes(t));
  const hasMusicTag = tagSet.some((t) => musicTags.some((m) => t.includes(m)));
  return hasTalkTag && !hasMusicTag;
}

export function matchesGenreFilter(station: Pick<RadioStation, 'name' | 'tags'>, genre: RadioGenreFilter): boolean {
  if (genre === 'all') return true;
  const hay = `${station.name} ${station.tags.join(' ')}`.toLowerCase();
  switch (genre) {
    case 'hits':
      return /\b(pop|hits|top\s*40|top40|charts|mainstream|adult\s*contemporary|80s|90s|00s|classic\s*hits)\b/.test(hay);
    case 'dance':
      return /\b(dance|electronic|edm|house|techno|trance|club|party|electro|dnb)\b/.test(hay);
    case 'rock':
      return /\b(rock|indie|alternative|metal|classic\s*rock|punk|guitar)\b/.test(hay);
    case 'chill':
      return /\b(chill|lounge|ambient|jazz|soul|rnb|smooth|relax|acoustic|easy\s*listening|lo-?fi)\b/.test(hay);
    case 'nonstop':
      return /\b(non[-\s]?stop|nonstop|continuous|100%|pure\s*music|music\s*only|all\s*music|without\s*dj)\b/.test(hay);
  }
}

export function classifyStreamTitle(rawTitle: string, stationName = ''): ClassifiedTitle {
  const cleaned = rawTitle
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 3) {
    return { kind: 'unknown', artist: '', track: '', normalized: '' };
  }

  if (AD_TITLE_REGEX.test(cleaned)) {
    return { kind: 'ad', artist: '', track: cleaned, normalized: cleaned.toLowerCase() };
  }

  if (EXPLICIT_TALK_TITLE_REGEX.test(cleaned)) {
    return { kind: 'talk', artist: '', track: cleaned, normalized: cleaned.toLowerCase() };
  }

  const lower = cleaned.toLowerCase();
  const stLower = stationName.toLowerCase().trim();
  if (stLower && stLower.length >= 4 && (lower === stLower || lower.startsWith(`${stLower} - live`) || lower.endsWith(`- ${stLower}`))) {
    // Only station slogan without song title
    if (!cleaned.includes(' - ') || cleaned.split(' - ').filter((p) => p.trim().length > 1).length < 2) {
      return { kind: 'unknown', artist: '', track: '', normalized: lower };
    }
  }

  // Standard "Artist - Song Title" format
  const sepMatch = cleaned.match(/^(.{2,60}?)\s[-–—|:]\s(.{2,90})$/);
  if (sepMatch) {
    const artist = sepMatch[1].trim();
    const track = sepMatch[2].trim();
    if (stLower && (artist.toLowerCase() === stLower || track.toLowerCase() === stLower)) {
      return { kind: 'unknown', artist: '', track: '', normalized: lower };
    }
    if (EXPLICIT_TALK_TITLE_REGEX.test(artist) || EXPLICIT_TALK_TITLE_REGEX.test(track)) {
      return { kind: 'talk', artist, track, normalized: lower };
    }
    return { kind: 'music', artist, track, normalized: `${artist.toLowerCase()} - ${track.toLowerCase()}` };
  }

  if (GENERIC_TALK_TITLE_REGEX.test(cleaned)) {
    return { kind: 'talk', artist: '', track: cleaned, normalized: lower };
  }

  // Fallback: looks like a tagline/jingle rather than Artist - Track
  if (cleaned.split(' ').length <= 3 && /\b(fm|radio|live|stream|hd)\b/i.test(cleaned)) {
    return { kind: 'unknown', artist: '', track: '', normalized: lower };
  }

  return { kind: 'unknown', artist: '', track: cleaned, normalized: lower };
}

export interface FftAnalysisResult {
  rms: number;
  isSilence: boolean;
  bassRatio: number;
  vocalRatio: number;
  airRatio: number;
  musicConfidence: number; // 0..100
  isLikelySpeech: boolean;
}

/**
 * Lightweight real-time speech-vs-music classifier using Web Audio AnalyserNode FFT bins (0..255).
 * Speech/DJs concentrate heavily in 300-2800Hz with weak sub-bass (<180Hz) and lack high-frequency percussion (>4.5kHz).
 */
export function analyzeFftSpectrum(
  bins: ArrayLike<number>,
  sampleRate = 44100,
  _prevBins: ArrayLike<number> | null = null
): FftAnalysisResult {
  const n = bins.length;
  if (n < 16) {
    return { rms: 0, isSilence: true, bassRatio: 0, vocalRatio: 0, airRatio: 0, musicConfidence: 50, isLikelySpeech: false };
  }

  const nyquist = sampleRate / 2;
  const hzPerBin = nyquist / n;

  let bassSum = 0;
  let bassCount = 0;
  let vocalSum = 0;
  let vocalCount = 0;
  let airSum = 0;
  let airCount = 0;
  let totalSum = 0;
  let totalCount = 0;

  for (let i = 1; i < n; i++) {
    const hz = i * hzPerBin;
    if (hz > 14000) break;
    const val = bins[i];
    totalSum += val;
    totalCount++;

    if (hz <= 190) {
      bassSum += val;
      bassCount++;
    } else if (hz >= 300 && hz <= 2900) {
      vocalSum += val;
      vocalCount++;
    } else if (hz >= 4500) {
      airSum += val;
      airCount++;
    }
  }

  const avgTotal = totalCount > 0 ? totalSum / totalCount : 0;
  const avgBass = bassCount > 0 ? bassSum / bassCount : 0;
  const avgVocal = vocalCount > 0 ? vocalSum / vocalCount : 0;
  const avgAir = airCount > 0 ? airSum / airCount : 0;

  if (avgTotal < 7) {
    return {
      rms: avgTotal,
      isSilence: true,
      bassRatio: 0,
      vocalRatio: 0,
      airRatio: 0,
      musicConfidence: 25,
      isLikelySpeech: false,
    };
  }

  const bassRatio = avgBass / Math.max(1, avgVocal);
  const vocalRatio = avgVocal / Math.max(1, avgTotal);
  const airRatio = avgAir / Math.max(1, avgVocal);

  // Music typically has audible low-end bass (>= 0.85x vocal) OR bright hi-hat/air (>= 0.25x vocal).
  // Dry studio DJ speech / radio commentary lacks bass (< 0.55x vocal) AND high air (< 0.14x vocal) while vocal dominates (> 1.75x total).
  let score = 58;
  if (bassRatio >= 1.15) score += 26;
  else if (bassRatio >= 0.82) score += 15;
  else if (bassRatio < 0.50) score -= 22;

  if (airRatio >= 0.34) score += 18;
  else if (airRatio >= 0.22) score += 8;
  else if (airRatio < 0.12) score -= 12;

  if (vocalRatio > 1.85 && bassRatio < 0.68) score -= 22;
  else if (vocalRatio < 1.35) score += 10;

  const musicConfidence = Math.max(0, Math.min(100, Math.round(score)));
  return {
    rms: avgTotal,
    isSilence: false,
    bassRatio,
    vocalRatio,
    airRatio,
    musicConfidence,
    isLikelySpeech: musicConfidence < 34,
  };
}

/**
 * Scores candidate radio stations so Auto-DJ picks where fresh music JUST started and skips DJ talk/ads.
 */
export function scoreCandidateStation(st: RadioStation, now = Date.now(), excludeId?: string): number {
  if (st.id === excludeId) return -9999;
  if (st.state === 'offline' || st.failCount >= 3) return -5000;
  if (st.state === 'talk' || st.state === 'ad') return -3000;
  if (st.cooldownUntil > now) return -2000;

  let score = 0;
  const ageMs = st.trackStartedAt > 0 ? now - st.trackStartedAt : 999_999;

  if (st.state === 'music_started' && ageMs <= 45_000) {
    // Huge preference for stations where a song JUST started!
    score += 140 - Math.round(ageMs / 1000);
  } else if (st.state === 'music') {
    score += 75;
    if (ageMs < 90_000) score += 25;
  } else if (st.state === 'scanning') {
    score += 20;
  }

  if (st.corsAllowed) score += 22;
  if (st.tags.some((t) => /non-?stop|music/i.test(t))) score += 16;
  if (st.distanceKm !== undefined) {
    if (st.distanceKm <= 60) score += 22;
    else if (st.distanceKm <= 160) score += 12;
  }
  if (st.bitrate >= 128) score += 8;
  else if (st.bitrate > 0 && st.bitrate < 64) score -= 10;

  score += Math.min(15, Math.floor((st.musicScore - 50) / 3));
  return score;
}
