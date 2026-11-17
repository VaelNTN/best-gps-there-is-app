import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { getLangMeta } from '../i18n/translations';
import { LanguageCode, TransportMode } from '../types/navigation';
import { PoiFilterKind } from './geocoding';

export type ParsedVoiceCommand =
  | { kind: 'mute' }
  | { kind: 'unmute' }
  | { kind: 'eta' }
  | { kind: 'next_turn' }
  | { kind: 'repeat' }
  | { kind: 'speed' }
  | { kind: 'where_am_i' }
  | { kind: 'poi'; poiKind: PoiFilterKind }
  | { kind: 'go_home' }
  | { kind: 'go_work' }
  | { kind: 'navigate'; query: string }
  | { kind: 'start_nav' }
  | { kind: 'stop_nav' }
  | { kind: 'recenter' }
  | { kind: 'set_mode'; mode: TransportMode }
  | { kind: 'set_theme'; theme: 'day' | 'night' }
  | { kind: 'radio_on' }
  | { kind: 'radio_off' }
  | { kind: 'radio_next' }
  | { kind: 'radio_what_playing' }
  | { kind: 'help' }
  | { kind: 'greeting' }
  | { kind: 'thanks' }
  | { kind: 'unknown'; raw: string };

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[?!.,;:"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVoiceCommand(transcript: string, _lang: LanguageCode = 'nl'): ParsedVoiceCommand {
  const raw = transcript.trim();
  const s = norm(raw);
  if (!s) return { kind: 'unknown', raw };

  // 1. Mute / Shut up ("zwijg even", "stil", "shut up", "be quiet", etc.)
  if (
    /\b(zwijg(\s+even|\s+maar|\s+nou)?|wees\s+stil|hou\s+je\s+mond|mond\s+dicht|kop\s+dicht|ssst+|stilte|niet\s+praten|stop\s+met\s+praten|spraak\s+uit|stem\s+uit|geluid\s+uit|shut\s+up|be\s+quiet|mute|voice\s+off|stop\s+talking|hush|sei\s+still|halt\s+den\s+mund|ruhe|stumm|tais\s*toi|silence|chut|coupe\s+la\s+voix|callate|silencio|cicho|zamknij\s+sie|wycisz|sus|sessiz\s+ol|sesi\s+kapat)\b/.test(
      s
    ) ||
    s === 'stil' ||
    s === 'quiet'
  ) {
    return { kind: 'mute' };
  }

  // 2. Unmute ("praat weer", "stem aan", "speak again")
  if (
    /\b(praat\s+weer|spreek\s+weer|zeg\s+maar|stem\s+aan|spraak\s+aan|geluid\s+aan|word\s+wakker|unmute|speak\s+again|voice\s+on|talk\s+to\s+me|sound\s+on|sprich\s+wieder|ton\s+an|parle\s+encore|active\s+la\s+voix|habla\s+otra\s+vez|mow\s+znowu|wlacz\s+glos|tekrar\s+konus|sesi\s+ac)\b/.test(
      s
    )
  ) {
    return { kind: 'unmute' };
  }

  // 3. Greetings & small talk
  if (/^(hallo|hoi|hey|he|goedemorgen|goeiemorgen|goedemiddag|goedenavond|hello|hi|good\s+morning|bonjour|salut|hola|czesc|merhaba|selam)(\s|$)/.test(s)) {
    return { kind: 'greeting' };
  }
  if (/\b(dank\s*je|bedankt|merci|thanks|thank\s+you|danke|gracias|dziekuje|tesekkur)\b/.test(s)) {
    return { kind: 'thanks' };
  }
  if (
    /\b(wat\s+kan\s+ik\s+zeggen|wat\s+kun\s+je|help|commando|commands|was\s+kann\s+ich\s+sagen|que\s+puis\s+je\s+dire|que\s+puedo\s+decir)\b/.test(
      s
    )
  ) {
    return { kind: 'help' };
  }

  // 4. Repeat / Next turn
  if (/\b(herhaal|wat\s+zei\s+je|opnieuw|repeat|say\s+again|nochmal|repete|repite|powtorz|tekrarla)\b/.test(s)) {
    return { kind: 'repeat' };
  }
  if (
    /\b(volgende\s+(afslag|bocht|stap|instructie)|waar\s+moet\s+ik\s+heen|next\s+(turn|step|exit)|naechste\s+ausfahrt|prochaine\s+sortie|siguiente\s+giro)\b/.test(
      s
    )
  ) {
    return { kind: 'next_turn' };
  }

  // 5. ETA / Duration / Distance remaining
  if (
    /\b(hoe\s*lang|hoe\s*laat|aankomst|hoe\s*ver|nog\s+ver|resterend|wanneer\s+zijn\s+we\s+er|how\s+long|how\s+far|when\s+do\s+we\s+arrive|eta|arrival|time\s+left|distance\s+left|wie\s+lange|wie\s+weit|ankunft|combien\s+de\s+temps|arrivee|cuanto\s+falta|llegada|ile\s+jeszcze|kiedy\s+bedziemy|ne\s+kadar\s+kaldi)\b/.test(
      s
    )
  ) {
    return { kind: 'eta' };
  }

  // 6. Speed / Speed limit / Road signs
  if (
    /\b(hoe\s*snel|hoe\s*hard|snelheid|maximumsnelheid|max\s*snelheid|mag\s+ik\s+hier|limiet|verkeersbord|borden|speed\s+limit|how\s+fast|my\s+speed|road\s+signs|signs|wie\s+schnell|tempolimit|schilder|quelle\s+vitesse|panneaux|velocidad|predkosc|hiz)\b/.test(
      s
    )
  ) {
    return { kind: 'speed' };
  }

  // 7. Where am I?
  if (/\b(waar\s+ben\s+ik|welke\s+straat|welke\s+stad|where\s+am\s+i|wo\s+bin\s+ich|ou\s+suis\s+je|donde\s+estoy|gdzie\s+jestem|neredeyim)\b/.test(s)) {
    return { kind: 'where_am_i' };
  }

  // 8. Theme switch
  if (/\b(nachtmodus|donkere\s+kaart|night\s+mode|dark\s+mode|nachtmodus)\b/.test(s)) {
    return { kind: 'set_theme', theme: 'night' };
  }
  if (/\b(dagmodus|lichte\s+kaart|day\s+mode|light\s+mode|tagmodus)\b/.test(s)) {
    return { kind: 'set_theme', theme: 'day' };
  }

  // 9. POI search ("waar kan ik tanken", "zoek diesel", "zoek parking", "laadpaal", "water")
  if (/\b(tanken|tankstation|diesel|benzine|brandstof|pomp|fuel|gas\s+station|petrol|tanke)\b/.test(s)) {
    return { kind: 'poi', poiKind: 'fuel' };
  }
  if (/\b(parkeer|parking|truckstop|truck\s+stop|rustplaats|rest\s+area|parkplatz)\b/.test(s)) {
    return { kind: 'poi', poiKind: 'parking' };
  }
  if (/\b(laadpaal|opladen|snellader|charger|charging|ev)\b/.test(s)) {
    return { kind: 'poi', poiKind: 'ev' };
  }
  if (/\b(fietsenmaker|fiets\s*reparatie|bike\s+repair|fahrrad)\b/.test(s)) {
    return { kind: 'poi', poiKind: 'bike' };
  }
  if (/\b(water|sanitair|toilet|wc|drinkwater|restroom)\b/.test(s)) {
    return { kind: 'poi', poiKind: 'water' };
  }

  // 10. Start / Stop / Recenter navigation
  if (/\b(stop\s+(de\s+)?(navigatie|route|rit)|annuleer\s+route|stop\s+navigation|end\s+route|cancel\s+route)\b/.test(s)) {
    return { kind: 'stop_nav' };
  }
  if (/\b(start\s+(de\s+)?(navigatie|route)|begin\s+(de\s+)?rit|start\s+navigation|start\s+route)\b/.test(s)) {
    return { kind: 'start_nav' };
  }
  if (/\b(centreer|recenter|center\s+map)\b/.test(s)) {
    return { kind: 'recenter' };
  }

  // 11. Mode switches
  if (/\b(schakel\s+naar|zet\s+op|modus|mode|ik\s+ga\s+met|ik\s+ben\s+met)?\s*(vrachtwagen|truck|zwaar\s+verkeer|lkw|camion)\b/.test(s)) {
    return { kind: 'set_mode', mode: 'truck' };
  }
  if (/\b(schakel\s+naar|zet\s+op|ik\s+ga\s+met)?\s*(de\s+)?(auto|car|wagen)\b/.test(s) && !s.includes('navigeer')) {
    return { kind: 'set_mode', mode: 'auto' };
  }
  if (/\b(schakel\s+naar|zet\s+op|ik\s+ga\s+met)?\s*(de\s+)?(fiets|bicycle|bike|fahrrad|velo)\b/.test(s)) {
    return { kind: 'set_mode', mode: 'bicycle' };
  }
  if (/\b(schakel\s+naar|zet\s+op|ik\s+ga)?\s*(te\s+voet|lopen|wandelen|walk|on\s+foot|zu\s+fuss|a\s+pied)\b/.test(s)) {
    return { kind: 'set_mode', mode: 'pedestrian' };
  }

  // 11b. Radio control ("radio aan", "radio uit", "volgend nummer", "welk nummer is dit")
  if (
    /\b(radio\s+uit|muziek\s+uit|zet\s+(de\s+)?(radio|muziek)\s+uit|stop\s+(de\s+)?(radio|muziek)|radio\s+off|stop\s+music|music\s+off|radio\s+aus|arrete\s+la\s+radio)\b/.test(
      s
    )
  ) {
    return { kind: 'radio_off' };
  }
  if (
    /\b(radio\s+aan|muziek\s+aan|zet\s+(de\s+)?(radio|muziek)\s+aan|speel\s+muziek|start\s+(de\s+)?(radio|muziek)|play\s+music|radio\s+on|start\s+radio|radio\s+an|mets\s+la\s+radio)\b/.test(
      s
    )
  ) {
    return { kind: 'radio_on' };
  }
  if (
    /\b(volgend\s+nummer|volgende\s+zender|ander\s+nummer|andere\s+zender|sla\s+over|next\s+song|next\s+track|next\s+station|skip\s+song|naechstes\s+lied|chanson\s+suivante)\b/.test(
      s
    )
  ) {
    return { kind: 'radio_next' };
  }
  if (/\b(welk\s+nummer|wat\s+speelt\s+er|wie\s+zingt|what\s+song|whats\s+playing|what\s+is\s+playing|welches\s+lied|quelle\s+chanson)\b/.test(s)) {
    return { kind: 'radio_what_playing' };
  }

  // 12. Home & Work
  if (/\b(naar\s+huis|breng\s+me\s+naar\s+huis|rijd\s+naar\s+huis|go\s+home|take\s+me\s+home|drive\s+home|nach\s+hause|a\s+la\s+maison|a\s+casa)\b/.test(s)) {
    return { kind: 'go_home' };
  }
  if (/\b(naar\s+(het\s+)?werk|breng\s+me\s+naar\s+(het\s+)?werk|go\s+to\s+work|drive\s+to\s+work|zur\s+arbeit|au\s+travail|al\s+trabajo)\b/.test(s)) {
    return { kind: 'go_work' };
  }

  // 13. Navigate to destination ("navigeer naar X", "breng me naar X", "zoek X")
  const navMatch = raw.match(
    /^(?:navigeer\s+naar|breng\s+me\s+naar|rijd\s+naar|ga\s+naar|bestemming|zoek|navigate\s+to|take\s+me\s+to|drive\s+to|go\s+to|search\s+for|find|navigiere\s+zu|fahre\s+nach|va\s+a|emmen[eé]-moi\s+a|navega\s+a|ll[eé]vame\s+a|jedz\s+do|nawiguj\s+do)\s+(.+)$/i
  );
  if (navMatch?.[1]) {
    const q = navMatch[1].trim();
    if (q.length >= 2) return { kind: 'navigate', query: q };
  }

  return { kind: 'unknown', raw };
}

export interface ListenOnceResult {
  transcript: string | null;
  reason?: 'no-match' | 'denied' | 'unavailable' | 'aborted';
}

interface WebSpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((ev: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

class VoiceListenerService {
  private webRec: WebSpeechRecognitionInstance | null = null;
  private isNative(): boolean {
    return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
  }

  async isAvailable(): Promise<boolean> {
    if (this.isNative()) {
      try {
        const res = await SpeechRecognition.available();
        return Boolean(res?.available);
      } catch {
        return false;
      }
    }
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
    }
    return false;
  }

  async hasPermission(): Promise<boolean> {
    if (!this.isNative()) return true;
    try {
      const st = await SpeechRecognition.checkPermissions();
      return st.speechRecognition === 'granted';
    } catch {
      return false;
    }
  }

  async ensurePermission(): Promise<boolean> {
    if (!this.isNative()) return true;
    try {
      const st = await SpeechRecognition.checkPermissions();
      if (st.speechRecognition === 'granted') return true;
      const req = await SpeechRecognition.requestPermissions();
      return req.speechRecognition === 'granted';
    } catch {
      return false;
    }
  }

  async listenOnce(lang: LanguageCode): Promise<ListenOnceResult> {
    const locale = getLangMeta(lang).ttsLocale;

    if (this.isNative()) {
      const avail = await this.isAvailable();
      if (!avail) return { transcript: null, reason: 'unavailable' };
      const ok = await this.ensurePermission();
      if (!ok) return { transcript: null, reason: 'denied' };

      try {
        const res = await SpeechRecognition.start({
          language: locale,
          maxResults: 3,
          partialResults: false,
          popup: false,
        });
        const first = res?.matches?.[0]?.trim() || '';
        return first ? { transcript: first } : { transcript: null, reason: 'no-match' };
      } catch (err) {
        const msg = String(err || '').toLowerCase();
        if (msg.includes('permission')) return { transcript: null, reason: 'denied' };
        if (msg.includes('not_available') || msg.includes('unavailable')) {
          return { transcript: null, reason: 'unavailable' };
        }
        return { transcript: null, reason: 'no-match' };
      }
    }

    // Browser / WebView SpeechRecognition fallback
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => WebSpeechRecognitionInstance) | undefined;
    if (!Ctor) return { transcript: null, reason: 'unavailable' };

    return new Promise<ListenOnceResult>((resolve) => {
      let settled = false;
      const done = (r: ListenOnceResult): void => {
        if (settled) return;
        settled = true;
        this.webRec = null;
        resolve(r);
      };

      try {
        const rec = new Ctor();
        this.webRec = rec;
        rec.lang = locale;
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.continuous = false;

        rec.onresult = (ev) => {
          const t = ev.results?.[0]?.[0]?.transcript?.trim() || '';
          done(t ? { transcript: t } : { transcript: null, reason: 'no-match' });
        };
        rec.onerror = (ev) => {
          const e = String(ev?.error || '');
          if (e === 'not-allowed' || e === 'service-not-allowed') done({ transcript: null, reason: 'denied' });
          else if (e === 'aborted') done({ transcript: null, reason: 'aborted' });
          else done({ transcript: null, reason: 'no-match' });
        };
        rec.onend = () => {
          done({ transcript: null, reason: 'no-match' });
        };
        rec.start();
      } catch {
        done({ transcript: null, reason: 'unavailable' });
      }
    });
  }

  stop(): void {
    if (this.isNative()) {
      // Note: Android plugin stop() does not call call.resolve(), so do not await it.
      void SpeechRecognition.stop().catch(() => undefined);
    }
    if (this.webRec) {
      try {
        this.webRec.abort();
      } catch {
        // ignore
      }
      this.webRec = null;
    }
  }
}

export const voiceListener = new VoiceListenerService();
