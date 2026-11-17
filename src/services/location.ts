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

function haversineQuickMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

function toFix(pos: Position | GeolocationPosition): GpsFix {
  const c = pos.coords as Position['coords'];
  const speedMs = typeof c.speed === 'number' && !Number.isNaN(c.speed) && c.speed >= 0 ? c.speed : 0;

  // Prefer actual GNSS course of travel when moving >= 1.2 m/s so sideways phone mounts stay accurate
  const rawCourse =
    typeof c.course === 'number' && !Number.isNaN(c.course) && c.course >= 0 ? c.course : null;
  const rawHeading =
    typeof c.heading === 'number' && !Number.isNaN(c.heading) && c.heading >= 0 ? c.heading : null;
  const heading = speedMs >= 1.2 && rawCourse !== null ? rawCourse : (rawHeading ?? rawCourse);

  return {
    lat: c.latitude,
    lon: c.longitude,
    heading,
    speedKmh: Math.round(speedMs * 3.6),
    accuracyM: Math.max(1, Math.round(c.accuracy || 15)),
    timestamp: pos.timestamp || Date.now(),
  };
}

/**
 * Filters noisy/coarse cell-tower jumps, impossible teleport spikes, and stationary micro-drift
 * while preserving 0-lag precision for clean GNSS fixes (accuracy <= 14m).
 */
export function filterGpsFix(raw: GpsFix, prev: GpsFix | null): GpsFix | null {
  if (raw.isSimulated || !prev || prev.accuracyM >= 80) {
    return raw;
  }

  const dtSec = Math.max(0.05, (raw.timestamp - prev.timestamp) / 1000);
  const distM = haversineQuickMeters(prev, raw);

  // Reject degraded cell/Wi-Fi bounce while a fresh accurate GNSS fix is active
  if (prev.accuracyM <= 22 && dtSec < 12 && raw.accuracyM > 45 && raw.accuracyM > prev.accuracyM * 2.5) {
    return null;
  }

  // Reject physically impossible GPS teleport (> 75 m/s = 270 km/h over a short jump)
  if (dtSec <= 6 && distM > 140 && distM / dtSec > 75 && raw.accuracyM > 10) {
    return null;
  }

  // Stationary drift suppression (stop puck wobble at traffic lights)
  if (raw.speedKmh <= 1 && distM < 3.2 && raw.accuracyM > 6) {
    return {
      ...raw,
      lat: prev.lat,
      lon: prev.lon,
      heading: raw.heading ?? prev.heading,
      speedKmh: 0,
    };
  }

  // Moderate-accuracy adaptive Kalman-like blend; exact raw pass-through for sharp <= 14m GNSS locks
  if (raw.accuracyM > 14 && distM < 80) {
    const w = Math.max(0.55, Math.min(0.88, 16 / raw.accuracyM));
    return {
      ...raw,
      lat: prev.lat * (1 - w) + raw.lat * w,
      lon: prev.lon * (1 - w) + raw.lon * w,
    };
  }

  return raw;
}

export async function requestInitialGpsFix(): Promise<{ fix: GpsFix; hasLiveGps: boolean }> {
  try {
    const perms = await Geolocation.checkPermissions();
    if (perms.location !== 'granted' && perms.coarseLocation !== 'granted') {
      await Geolocation.requestPermissions().catch(() => undefined);
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8500,
      maximumAge: 0,
    });
    return { fix: toFix(pos), hasLiveGps: true };
  } catch {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const webPos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 6500,
            maximumAge: 0,
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
        {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
          minimumUpdateInterval: 500,
          interval: 1000,
          enableLocationFallback: true,
        },
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
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
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
