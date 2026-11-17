import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { getLangMeta } from '../i18n/translations';
import { LanguageCode } from '../types/navigation';

class VoiceNavigator {
  private lastSpokenText = '';
  private lastSpokenAt = 0;

  async speak(text: string, lang: LanguageCode, enabled: boolean, force = false): Promise<void> {
    if (!enabled || !text.trim()) return;
    const now = Date.now();
    if (!force && text === this.lastSpokenText && now - this.lastSpokenAt < 12_000) {
      return;
    }
    this.lastSpokenText = text;
    this.lastSpokenAt = now;

    const locale = getLangMeta(lang).ttsLocale;

    try {
      await TextToSpeech.stop().catch(() => undefined);
      await TextToSpeech.speak({
        text,
        lang: locale,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        category: 'ambient',
      });
      return;
    } catch {
      // Fall back to Web Speech API
    }

    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = locale;
        utter.rate = 1.0;
        window.speechSynthesis.speak(utter);
      }
    } catch {
      // Ignore if speech synthesis unsupported
    }
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
