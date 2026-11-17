export type TransportMode = 'pedestrian' | 'bicycle' | 'auto' | 'truck';

export type LanguageCode = 'nl' | 'en' | 'de' | 'fr' | 'es' | 'pl' | 'tr';

export type UnitSystem = 'metric' | 'imperial';

export type MapTheme = 'day' | 'night';

export type TruckPresetId = 'van' | 'box12' | 'semi40' | 'lzv60' | 'camper' | 'custom';

export interface TruckProfile {
  presetId: TruckPresetId;
  heightM: number;
  widthM: number;
  lengthM: number;
  weightT: number;
  axleLoadT: number;
  hazmat: boolean;
  avoidUnpaved: boolean;
  avoidTolls: boolean;
  avoidFerries: boolean;
}

export interface CarOptions {
  shortest: boolean;
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
}

export interface BikeOptions {
  bicycleType: 'City' | 'Hybrid' | 'Road' | 'Mountain';
  useHills: number; // 0 = avoid hills, 1 = neutral
  avoidBadRoads: boolean;
}

export interface WalkOptions {
  walkingSpeedKmh: number;
  avoidStairs: boolean;
}

export interface LatLng {
  lat: number;
  lon: number;
}

export interface GeocodedPlace {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  category?: string;
}

export interface SavedPlace extends GeocodedPlace {
  kind: 'home' | 'work' | 'favorite' | 'recent';
  savedAt: number;
}

export interface PoiItem {
  id: string;
  name: string;
  category: string;
  emoji: string;
  lat: number;
  lon: number;
  extra?: string;
}

export type ManeuverKind =
  | 'start'
  | 'straight'
  | 'slight_left'
  | 'left'
  | 'sharp_left'
  | 'slight_right'
  | 'right'
  | 'sharp_right'
  | 'uturn'
  | 'roundabout'
  | 'ramp_left'
  | 'ramp_right'
  | 'ferry'
  | 'arrive';

export interface RouteStep {
  instruction: string;
  streetName: string;
  distanceMeters: number;
  durationSeconds: number;
  maneuver: ManeuverKind;
  coordIndex: number;
  lat: number;
  lon: number;
  roundaboutExit?: number;
}

export interface RouteOption {
  id: string;
  provider: 'Valhalla' | 'OpenRouteService' | 'HERE' | 'OSRM';
  mode: TransportMode;
  coordinates: [number, number][]; // [lon, lat] GeoJSON order
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  summaryLabel: string;
  hasTolls?: boolean;
  hasFerries?: boolean;
  fallbackNotice?: string;
}

export type RoadSignKind =
  | 'maxspeed'
  | 'maxheight'
  | 'maxwidth'
  | 'maxweight'
  | 'maxaxleload'
  | 'maxlength'
  | 'no_hgv'
  | 'no_hazmat'
  | 'no_entry'
  | 'no_bicycle'
  | 'stop'
  | 'give_way'
  | 'traffic_signals'
  | 'speed_camera'
  | 'railway_crossing'
  | 'bump'
  | 'roundabout'
  | 'oneway'
  | 'cycleway'
  | 'pedestrian_crossing';

export interface RoadSignItem {
  id: string;
  kind: RoadSignKind;
  label: string;
  title: string;
  lat: number;
  lon: number;
  maxSpeedKmh?: number;
  numericValue?: number;
  isDangerForMode?: boolean;
  priority?: number;
}

export interface RoadSignsSnapshot {
  currentMaxSpeedKmh: number | null;
  currentRoadName: string | null;
  signs: RoadSignItem[];
}

export interface AppSettings {
  language: LanguageCode;
  mode: TransportMode;
  units: UnitSystem;
  mapTheme: MapTheme;
  voiceEnabled: boolean;
  autoReroute: boolean;
  showRoadSigns: boolean;
  truck: TruckProfile;
  car: CarOptions;
  bike: BikeOptions;
  walk: WalkOptions;
  orsApiKey: string;
  hereApiKey: string;
  customValhallaUrl: string;
  homePlace: SavedPlace | null;
  workPlace: SavedPlace | null;
  favorites: SavedPlace[];
  recents: SavedPlace[];
}

export interface GpsFix {
  lat: number;
  lon: number;
  heading: number | null;
  speedKmh: number;
  accuracyM: number;
  timestamp: number;
  isSimulated?: boolean;
}
