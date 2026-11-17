import { Geolocation, Position } from '@capacitor/geolocation';
import { GpsFix } from '../types/navigation';

export type FixListener = (fix: GpsFix) => void;

export const DEFAULT_FALLBACK_FIX: GpsFix = {
  lat: 52.0907, // Utrecht / central NL default before GPS lock
  lon: 5.1214,
  heading: 0,
  speedKmh: 0,
  accuracyM: 100,
  timestamp: Date.now(),
};

function toFix(pos: Position | GeolocationPosition): GpsFix {
  const c = pos.coords;
  const speedMs = typeof c.speed === 'number' && !Number.isNaN(c.speed) && c.speed >= 0 ? c.speed : 0;
  const heading =
    typeof c.heading === 'number' && !Number.isNaN(c.heading) && c.heading >= 0 ? c.heading : null;
  return {
    lat: c.latitude,
    lon: c.longitude,
    heading,
    speedKmh: Math.round(speedMs * 3.6),
    accuracyM: Math.round(c.accuracy || 20),
    timestamp: pos.timestamp || Date.now(),
  };
}

export async function requestInitialGpsFix(): Promise<{ fix: GpsFix; hasLiveGps: boolean }> {
  try {
    const perms = await Geolocation.checkPermissions();
    if (perms.location !== 'granted' && perms.coarseLocation !== 'granted') {
      await Geolocation.requestPermissions().catch(() => undefined);
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 7000,
      maximumAge: 15_000,
    });
    return { fix: toFix(pos), hasLiveGps: true };
  } catch {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const webPos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5500,
            maximumAge: 15_000,
          });
        });
        return { fix: toFix(webPos), hasLiveGps: true };
      } catch {
        // Fallback below
      }
    }
    return { fix: { ...DEFAULT_FALLBACK_FIX, timestamp: Date.now() }, hasLiveGps: false };
  }
}

export class GpsWatcher {
  private capWatchId: string | null = null;
  private webWatchId: number | null = null;

  async start(onFix: FixListener): Promise<void> {
    await this.stop();
    try {
      this.capWatchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 2000 },
        (pos) => {
          if (pos) onFix(toFix(pos));
        }
      );
      return;
    } catch {
      this.capWatchId = null;
    }

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      this.webWatchId = navigator.geolocation.watchPosition(
        (pos) => onFix(toFix(pos)),
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 }
      );
    }
  }

  async stop(): Promise<void> {
    if (this.capWatchId !== null) {
      const id = this.capWatchId;
      this.capWatchId = null;
      await Geolocation.clearWatch({ id }).catch(() => undefined);
    }
    if (this.webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.webWatchId);
      this.webWatchId = null;
    }
  }
}
