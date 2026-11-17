import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { getLangMeta } from '../i18n/translations';
import { AppSettings, LanguageCode, VoiceStyle } from '../types/navigation';

export interface VoiceChoice {
  index: number;
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  isDefault: boolean;
  isNeuralHint: boolean;
  label: string;
  score: number;
}

export interface VoiceSpeakOptions {
  voiceStyle?: VoiceStyle;
  voiceRate?: number;
  voicePitch?: number;
  voiceUri?: string;
}

const UNIT_EXPANSIONS: Record<LanguageCode, { m: string; km: string; ft: string; mi: string }> = {
  nl: { m: 'meter', km: 'kilometer', ft: 'voet', mi: 'mijl' },
  en: { m: 'meters', km: 'kilometers', ft: 'feet', mi: 'miles' },
  de: { m: 'Meter', km: 'Kilometer', ft: 'Fuß', mi: 'Meilen' },
  fr: { m: 'mètres', km: 'kilomètres', ft: 'pieds', mi: 'miles' },
  es: { m: 'metros', km: 'kilómetros', ft: 'pies', mi: 'millas' },
  pl: { m: 'metrów', km: 'kilometrów', ft: 'stóp', mi: 'mil' },
  tr: { m: 'metre', km: 'kilometre', ft: 'fit', mi: 'mil' },
};

export function naturalizeSpeechText(rawText: string, lang: LanguageCode, style: VoiceStyle = 'smooth'): string {
  const units = UNIT_EXPANSIONS[lang] ?? UNIT_EXPANSIONS.en;
  let s = rawText
    // Strip emojis / dingbats so TTS never reads symbol names aloud
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, ' ')
    // Turn dashes / bullets / slashes into gentle breathing pauses
    .replace(/\s*[—–•]\s*/g, ', ')
    .replace(/\s*\/\s*/g, ', ')
    // Expand abbreviated distance units
    .replace(/\b(\d+)\s*m\b/gi, `$1 ${units.m}`)
    .replace(/\b(\d+(?:[.,]\d+)?)\s*km\b/gi, `$1 ${units.km}`)
    .replace(/\b(\d+)\s*ft\b/gi, `$1 ${units.ft}`)
    .replace(/\b(\d+(?:[.,]\d+)?)\s*mi\b/gi, `$1 ${units.mi}`)
    // Pronounce European road codes cleanly (e.g. A12 -> A 12, E19 -> E 19)
    .replace(/\b([AEN])(\d{1,3})\b/g, '$1 $2')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!s) return '';

  // For smooth / calm cadence, lowercase mid-sentence clause after leading distance comma
  // so Android TTS keeps a continuous warm intonation instead of resetting pitch.
  if (style === 'smooth' || style === 'calm') {
    s = s.replace(/,\s+([A-ZÀ-Ü])([a-zà-ü])/g, (_, first: string, second: string) => `, ${first.toLowerCase()}${second}`);
  }

  if (!/[.!?]$/.test(s)) {
    s += '.';
  }
  return s;
}

export function isNeuralVoiceHint(voiceURI: string, name: string): boolean {
  return /neural|wavenet|natural|studio|journey|enhanced|premium|online|network|google|aria|guy|jenny|sonia|colette|fenna|maarten|sara|emma/i.test(
    `${voiceURI} ${name}`
  );
}

export function scoreVoiceCandidate(
  v: { voiceURI: string; name: string; lang: string; localService?: boolean; default?: boolean },
  targetLocale: string,
  isOnline = true
): number {
  const hay = `${v.voiceURI} ${v.name}`.toLowerCase();
  const targetLang = targetLocale.toLowerCase();
  const targetBase = targetLang.split(/[-_]/)[0];
  const vLang = (v.lang || '').toLowerCase().replace('_', '-');
  const vBase = vLang.split('-')[0];

  if (vBase !== targetBase) return -1000;

  let score = 0;
  if (vLang === targetLang) score += 45;
  else if (vBase === targetBase) score += 20;

  // Reject barebones robotic synthesizers
  if (/espeak|pico|flite|mbrola|robot/.test(hay)) score -= 120;

  // Strong boost for Neural / Natural / WaveNet / Online HD voices
  if (/neural|wavenet|natural|studio|journey|enhanced|premium/.test(hay)) score += 90;
  if (/google|microsoft|samsung/.test(hay)) score += 18;

  // Google Android TTS encodes higher-fidelity voices with "-network"
  if (hay.includes('-network')) {
    score += isOnline ? 65 : -40;
  } else if (hay.includes('-local')) {
    score += isOnline ? 15 : 40;
  }

  if (v.localService === false && !isOnline) {
    score -= 80;
  }
  if (v.default) score += 8;

  // Slightly favor warmer standard NL/BE voices in Google TTS (e.g. dma, bmk, tfb, bec)
  if (/-(dma|bmk|tfb|bec|cfa|cfd)-/.test(hay)) score += 16;

  return score;
}

export function formatVoiceDisplayLabel(v: {
  voiceURI: string;
  name: string;
  lang: string;
  localService?: boolean;
}): string {
  const uri = v.voiceURI || '';
  const codeMatch = uri.match(/^[a-z]{2}-[a-z]{2}-x-([a-z0-9]+)-(local|network)/i);
  const langTag = (v.lang || '').toUpperCase();
  const isNet = /network/i.test(uri) || v.localService === false;
  const tag = isNeuralVoiceHint(uri, v.name) || isNet ? 'HD' : 'Offline';

  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    return `${langTag} • ${code} (${tag})`;
  }
  const cleanName = (v.name || uri)
    .replace(/\s*-\s*(Dutch|English|German|French|Spanish|Polish|Turkish).*$/i, '')
    .trim();
  return `${cleanName || langTag} (${langTag} • ${tag})`;
}

class VoiceNavigator {
  private lastSpokenText = '';
  private lastSpokenAt = 0;
  private cachedVoices: VoiceChoice[] | null = null;

  async getAvailableVoices(lang: LanguageCode): Promise<VoiceChoice[]> {
    const targetLocale = getLangMeta(lang).ttsLocale;
    const targetBase = targetLocale.split('-')[0].toLowerCase();
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

    let rawList: {
      voiceURI: string;
      name: string;
      lang: string;
      localService: boolean;
      default: boolean;
    }[] = [];

    try {
      const res = await TextToSpeech.getSupportedVoices();
      if (Array.isArray(res?.voices) && res.voices.length > 0) {
        rawList = res.voices.map((v) => ({
          voiceURI: v.voiceURI || v.name || '',
          name: v.name || v.voiceURI || '',
          lang: v.lang || '',
          localService: Boolean(v.localService),
          default: Boolean(v.default),
        }));
      }
    } catch {
      // Fallback below
    }

    if (rawList.length === 0 && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const webVoices = window.speechSynthesis.getVoices();
      rawList = webVoices.map((v) => ({
        voiceURI: v.voiceURI || v.name,
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        default: v.default,
      }));
    }

    const mapped: VoiceChoice[] = [];
    rawList.forEach((v, index) => {
      const vBase = (v.lang || '').toLowerCase().split(/[-_]/)[0];
      if (vBase !== targetBase) return;
      mapped.push({
        index,
        voiceURI: v.voiceURI,
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        isDefault: v.default,
        isNeuralHint: isNeuralVoiceHint(v.voiceURI, v.name),
        label: formatVoiceDisplayLabel(v),
        score: scoreVoiceCandidate(v, targetLocale, isOnline),
      });
    });

    mapped.sort((a, b) => b.score - a.score);
    this.cachedVoices = mapped;
    return mapped;
  }

  private async resolveVoiceChoice(lang: LanguageCode, preferredUri?: string): Promise<VoiceChoice | null> {
    const voices = await this.getAvailableVoices(lang);
    if (voices.length === 0) return null;
    if (preferredUri) {
      const exact = voices.find((v) => v.voiceURI === preferredUri);
      if (exact) return exact;
    }
    return voices[0] ?? null;
  }

  async openVoiceInstall(): Promise<boolean> {
    try {
      await TextToSpeech.openInstall();
      this.cachedVoices = null;
      return true;
    } catch {
      return false;
    }
  }

  async speak(
    text: string,
    settingsOrLang: AppSettings | LanguageCode,
    forceOrEnabled?: boolean,
    forceArg = false,
    overrides?: VoiceSpeakOptions
  ): Promise<void> {
    let lang: LanguageCode;
    let enabled: boolean;
    let force: boolean;
    let style: VoiceStyle;
    let rate: number;
    let pitch: number;
    let voiceUri: string;

    if (typeof settingsOrLang === 'string') {
      lang = settingsOrLang;
      enabled = Boolean(forceOrEnabled);
      force = forceArg;
      style = overrides?.voiceStyle ?? 'smooth';
      rate = overrides?.voiceRate ?? 0.91;
      pitch = overrides?.voicePitch ?? 0.90;
      voiceUri = overrides?.voiceUri ?? '';
    } else {
      lang = settingsOrLang.language;
      enabled = settingsOrLang.voiceEnabled;
      force = Boolean(forceOrEnabled);
      style = overrides?.voiceStyle ?? settingsOrLang.voiceStyle ?? 'smooth';
      rate = overrides?.voiceRate ?? settingsOrLang.voiceRate ?? 0.91;
      pitch = overrides?.voicePitch ?? settingsOrLang.voicePitch ?? 0.90;
      voiceUri = overrides?.voiceUri ?? settingsOrLang.voiceUri ?? '';
    }

    if (!enabled || !text.trim()) return;
    const spoken = naturalizeSpeechText(text, lang, style);
    if (!spoken) return;

    const now = Date.now();
    if (!force && spoken === this.lastSpokenText && now - this.lastSpokenAt < 12_000) {
      return;
    }
    this.lastSpokenText = spoken;
    this.lastSpokenAt = now;

    const locale = getLangMeta(lang).ttsLocale;
    const chosen = await this.resolveVoiceChoice(lang, voiceUri);
    const resolvedLang = chosen?.lang || locale;
    const safeRate = Math.max(0.65, Math.min(1.35, rate));
    const safePitch = Math.max(0.65, Math.min(1.35, pitch));

    try {
      await TextToSpeech.stop().catch(() => undefined);
      await TextToSpeech.speak({
        text: spoken,
        lang: resolvedLang,
        rate: safeRate,
        pitch: safePitch,
        volume: 1.0,
        voice: chosen && chosen.index >= 0 ? chosen.index : undefined,
        category: 'ambient',
      });
      return;
    } catch {
      // Fall back to Web Speech API
    }

    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = (): void => {
            if (done) return;
            done = true;
            resolve();
          };
          const utter = new SpeechSynthesisUtterance(spoken);
          utter.lang = resolvedLang;
          utter.rate = safeRate;
          utter.pitch = safePitch;
          if (chosen) {
            const match = window.speechSynthesis.getVoices().find((wv) => wv.voiceURI === chosen.voiceURI || wv.name === chosen.name);
            if (match) utter.voice = match;
          }
          utter.onend = finish;
          utter.onerror = finish;
          if (typeof window.setTimeout === 'function') {
            window.setTimeout(finish, 9000);
          }
          window.speechSynthesis.speak(utter);
        });
      }
    } catch {
      // Ignore if speech synthesis unsupported
    }
  }

  /**
   * Always speaks an interactive voice assistant reply out loud (e.g. acknowledging "zwijg even")
   * using the user's chosen voice style, rate, pitch and device voice, even if turn-by-turn TTS is muted.
   */
  async speakAssistantReply(text: string, settings: AppSettings): Promise<void> {
    if (!text.trim()) return;
    await this.speak(text, settings.language, true, true, {
      voiceStyle: settings.voiceStyle,
      voiceRate: settings.voiceRate,
      voicePitch: settings.voicePitch,
      voiceUri: settings.voiceUri,
    });
  }

  getLastCachedCount(): number {
    return this.cachedVoices?.length ?? 0;
  }

  async stop(): Promise<void> {
    try {
      await TextToSpeech.stop();
    } catch {
      // ignore
    }
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // ignore
    }
  }
}

export const voiceNav = new VoiceNavigator();
