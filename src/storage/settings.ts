import { detectInitialLanguage } from '../i18n/translations';
import { AppSettings, GeocodedPlace, SavedPlace, TruckPresetId, TruckProfile } from '../types/navigation';

const STORAGE_KEY = 'best_gps_there_is_settings_v1';

export const TRUCK_PRESETS: Record<TruckPresetId, Omit<TruckProfile, 'presetId' | 'avoidUnpaved' | 'avoidTolls' | 'avoidFerries'>> = {
  van: { heightM: 2.6, widthM: 2.1, lengthM: 6.0, weightT: 3.5, axleLoadT: 2.0, hazmat: false },
  box12: { heightM: 3.4, widthM: 2.45, lengthM: 8.5, weightT: 12.0, axleLoadT: 7.5, hazmat: false },
  semi40: { heightM: 4.0, widthM: 2.55, lengthM: 16.5, weightT: 40.0, axleLoadT: 11.5, hazmat: false },
  lzv60: { heightM: 4.0, widthM: 2.55, lengthM: 25.25, weightT: 60.0, axleLoadT: 11.5, hazmat: false },
  camper: { heightM: 3.1, widthM: 2.35, lengthM: 7.5, weightT: 3.5, axleLoadT: 2.0, hazmat: false },
  custom: { heightM: 4.0, widthM: 2.55, lengthM: 16.5, weightT: 40.0, axleLoadT: 11.5, hazmat: false },
};

export function createDefaultSettings(): AppSettings {
  return {
    language: detectInitialLanguage(),
    mode: 'auto',
    units: 'metric',
    mapTheme: 'night',
    voiceEnabled: true,
    autoReroute: true,
    showRoadSigns: true,
    truck: {
      presetId: 'semi40',
      ...TRUCK_PRESETS.semi40,
      avoidUnpaved: true,
      avoidTolls: false,
      avoidFerries: false,
    },
    car: {
      shortest: false,
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false,
    },
    bike: {
      bicycleType: 'City',
      useHills: 0.2,
      avoidBadRoads: true,
    },
    walk: {
      walkingSpeedKmh: 5.1,
      avoidStairs: false,
    },
    orsApiKey: '',
    hereApiKey: '',
    customValhallaUrl: 'https://valhalla1.openstreetmap.de/route',
    homePlace: null,
    workPlace: null,
    favorites: [],
    recents: [],
  };
}

export function loadSettings(): AppSettings {
  const defaults = createDefaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaults,
      ...parsed,
      truck: { ...defaults.truck, ...(parsed.truck ?? {}) },
      car: { ...defaults.car, ...(parsed.car ?? {}) },
      bike: { ...defaults.bike, ...(parsed.bike ?? {}) },
      walk: { ...defaults.walk, ...(parsed.walk ?? {}) },
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      recents: Array.isArray(parsed.recents) ? parsed.recents : [],
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function addRecentPlace(settings: AppSettings, place: GeocodedPlace): void {
  const entry: SavedPlace = { ...place, kind: 'recent', savedAt: Date.now() };
  settings.recents = [
    entry,
    ...settings.recents.filter((p) => p.id !== place.id && Math.hypot(p.lat - place.lat, p.lon - place.lon) > 0.0004),
  ].slice(0, 12);
  saveSettings(settings);
}

export function toggleFavoritePlace(settings: AppSettings, place: GeocodedPlace): boolean {
  const exists = settings.favorites.some(
    (f) => f.id === place.id || Math.hypot(f.lat - place.lat, f.lon - place.lon) < 0.0004
  );
  if (exists) {
    settings.favorites = settings.favorites.filter(
      (f) => f.id !== place.id && Math.hypot(f.lat - place.lat, f.lon - place.lon) >= 0.0004
    );
    saveSettings(settings);
    return false;
  }
  settings.favorites = [{ ...place, kind: 'favorite' as const, savedAt: Date.now() }, ...settings.favorites].slice(0, 30);
  saveSettings(settings);
  return true;
}
