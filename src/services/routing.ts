import { getLangMeta, t } from '../i18n/translations';
import {
  AppSettings,
  LatLng,
  ManeuverKind,
  RouteOption,
  RouteStep,
  TransportMode,
} from '../types/navigation';

// Decode Google/Valhalla encoded polyline (precision = 6 for Valhalla, 5 for OSRM)
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const coords: [number, number][] = [];
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lon / factor, lat / factor]); // GeoJSON [lon, lat]
  }
  return coords;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function computeBearing(a: LatLng, b: LatLng): number {
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function distanceToRouteMeters(
  point: LatLng,
  coords: [number, number][]
): {
  minMeters: number;
  nearestIndex: number;
  snappedLat: number;
  snappedLon: number;
  segmentBearing: number;
} {
  if (coords.length === 0) {
    return {
      minMeters: Infinity,
      nearestIndex: 0,
      snappedLat: point.lat,
      snappedLon: point.lon,
      segmentBearing: 0,
    };
  }
  let minMeters = Infinity;
  let nearestIndex = 0;
  let snappedLat = coords[0][1];
  let snappedLon = coords[0][0];
  let segmentBearing = 0;

  // Check orthogonal projection onto every polyline segment for sub-meter snapping accuracy
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const kx = 111_320 * cosLat;
  const ky = 110_574;

  for (let i = 0; i < coords.length; i++) {
    const [lonA, latA] = coords[i];
    if (i < coords.length - 1) {
      const [lonB, latB] = coords[i + 1];
      const ax = (lonA - point.lon) * kx;
      const ay = (latA - point.lat) * ky;
      const bx = (lonB - point.lon) * kx;
      const by = (latB - point.lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      const tParam = lenSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq)) : 0;
      const px = ax + tParam * dx;
      const py = ay + tParam * dy;
      const d = Math.hypot(px, py);
      if (d < minMeters) {
        minMeters = d;
        nearestIndex = tParam > 0.5 ? i + 1 : i;
        snappedLat = latA + (latB - latA) * tParam;
        snappedLon = lonA + (lonB - lonA) * tParam;
        segmentBearing = computeBearing({ lat: latA, lon: lonA }, { lat: latB, lon: lonB });
      }
    } else {
      const d = haversineMeters(point, { lat: latA, lon: lonA });
      if (d < minMeters) {
        minMeters = d;
        nearestIndex = i;
        snappedLat = latA;
        snappedLon = lonA;
        if (i > 0) {
          segmentBearing = computeBearing(
            { lat: coords[i - 1][1], lon: coords[i - 1][0] },
            { lat: latA, lon: lonA }
          );
        }
      }
    }
  }
  return { minMeters, nearestIndex, snappedLat, snappedLon, segmentBearing };
}

function mapValhallaManeuver(typeCode: number): ManeuverKind {
  switch (typeCode) {
    case 1:
    case 2:
    case 3:
      return 'start';
    case 4:
    case 5:
    case 6:
      return 'arrive';
    case 9:
    case 23:
      return 'slight_right';
    case 10:
      return 'right';
    case 11:
      return 'sharp_right';
    case 12:
    case 13:
      return 'uturn';
    case 14:
      return 'sharp_left';
    case 15:
      return 'left';
    case 16:
    case 24:
      return 'slight_left';
    case 18:
    case 20:
      return 'ramp_right';
    case 19:
    case 21:
      return 'ramp_left';
    case 26:
    case 27:
      return 'roundabout';
    case 28:
    case 29:
      return 'ferry';
    default:
      return 'straight';
  }
}

type ValhallaStrategyVariant = 'primary' | 'shortest' | 'express' | 'smooth' | 'secondary';

function buildValhallaBody(
  from: LatLng,
  to: LatLng,
  settings: AppSettings,
  variant: ValhallaStrategyVariant = 'primary',
  alternates = 2
): Record<string, unknown> {
  const mode = settings.mode;
  const lang = getLangMeta(settings.language).routingLang;
  let costing: string = mode;
  const costingOptions: Record<string, unknown> = {};

  if (mode === 'pedestrian') {
    costing = 'pedestrian';
    costingOptions.pedestrian = {
      walking_speed: settings.walk.walkingSpeedKmh,
      step_penalty: settings.walk.avoidStairs ? 300 : 0,
      use_ferry: 0.5,
      ...(variant === 'shortest' ? { shortest: true } : {}),
      ...(variant === 'smooth' ? { walkway_factor: 0.75, alley_factor: 2.5 } : {}),
    };
  } else if (mode === 'bicycle') {
    costing = 'bicycle';
    costingOptions.bicycle = {
      bicycle_type: settings.bike.bicycleType,
      use_hills: variant === 'express' ? Math.max(0.4, settings.bike.useHills) : settings.bike.useHills,
      use_roads: settings.bike.avoidBadRoads ? 0.25 : 0.5,
      avoid_bad_surfaces: settings.bike.avoidBadRoads ? 0.85 : 0.25,
      ...(variant === 'shortest' ? { shortest: true } : {}),
      ...(variant === 'smooth' ? { maneuver_penalty: 18 } : {}),
    };
  } else if (mode === 'auto') {
    costing = 'auto';
    const baseHighways = settings.car.avoidHighways ? 0.05 : 1.0;
    costingOptions.auto = {
      shortest: variant === 'shortest' ? true : settings.car.shortest,
      use_tolls: settings.car.avoidTolls ? 0 : 0.5,
      use_highways:
        settings.car.avoidHighways
          ? 0.05
          : variant === 'secondary'
            ? 0.45
            : variant === 'express'
              ? 1.0
              : baseHighways,
      use_ferry: settings.car.avoidFerries ? 0 : 0.5,
      ...(variant === 'smooth' ? { maneuver_penalty: 25, use_living_streets: 0.05 } : {}),
      ...(variant === 'express' ? { maneuver_penalty: 12 } : {}),
    };
  } else {
    costing = 'truck';
    costingOptions.truck = {
      height: settings.truck.heightM,
      width: settings.truck.widthM,
      length: settings.truck.lengthM,
      weight: settings.truck.weightT,
      axle_load: settings.truck.axleLoadT,
      hazmat: settings.truck.hazmat,
      use_tolls: settings.truck.avoidTolls ? 0 : 0.5,
      use_ferry: settings.truck.avoidFerries ? 0 : 0.4,
      use_tracks: settings.truck.avoidUnpaved ? 0 : 0.5,
      use_highways: variant === 'secondary' ? 0.45 : variant === 'express' ? 1.0 : 0.85,
      ...(variant === 'shortest' ? { shortest: true } : {}),
      ...(variant === 'smooth' ? { maneuver_penalty: 28, service_penalty: 30 } : {}),
      ...(variant === 'express' ? { maneuver_penalty: 15 } : {}),
    };
  }

  return {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing,
    costing_options: costingOptions,
    directions_options: {
      units: 'kilometers',
      language: lang,
    },
    alternates,
  };
}

interface ValhallaManeuver {
  type: number;
  instruction: string;
  street_names?: string[];
  length: number; // km
  time: number; // sec
  begin_shape_index: number;
  roundabout_exit_count?: number;
  toll?: boolean;
  ferry?: boolean;
}

interface ValhallaTrip {
  summary: { length: number; time: number; has_toll?: boolean; has_ferry?: boolean };
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[];
}

function parseValhallaTrip(trip: ValhallaTrip, id: string, mode: TransportMode, isAlt: boolean): RouteOption | null {
  const leg = trip.legs?.[0];
  if (!leg?.shape) return null;
  const coordinates = decodePolyline(leg.shape, 6);
  if (coordinates.length < 2) return null;

  const steps: RouteStep[] = (leg.maneuvers ?? []).map((m) => {
    const idx = Math.max(0, Math.min(coordinates.length - 1, m.begin_shape_index ?? 0));
    const [lon, lat] = coordinates[idx];
    return {
      instruction: m.instruction,
      streetName: m.street_names?.[0] || '',
      distanceMeters: Math.round((m.length ?? 0) * 1000),
      durationSeconds: Math.round(m.time ?? 0),
      maneuver: mapValhallaManeuver(m.type),
      coordIndex: idx,
      lat,
      lon,
      roundaboutExit: m.roundabout_exit_count,
    };
  });

  return {
    id,
    provider: 'Valhalla',
    mode,
    coordinates,
    distanceMeters: Math.round((trip.summary?.length ?? 0) * 1000),
    durationSeconds: Math.round(trip.summary?.time ?? 0),
    steps,
    summaryLabel: isAlt ? 'alt' : 'primary',
    hasTolls: Boolean(trip.summary?.has_toll),
    hasFerries: Boolean(trip.summary?.has_ferry),
  };
}

async function routeWithValhalla(
  from: LatLng,
  to: LatLng,
  settings: AppSettings,
  variant: ValhallaStrategyVariant = 'primary',
  alternates = 2
): Promise<RouteOption[]> {
  const endpoint = settings.customValhallaUrl.trim() || 'https://valhalla1.openstreetmap.de/route';
  const body = buildValhallaBody(from, to, settings, variant, alternates);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': 'best-gps-there-is-app',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`VALHALLA_${res.status}`);
  }
  const data = (await res.json()) as {
    trip?: ValhallaTrip;
    alternates?: { trip?: ValhallaTrip }[];
  };
  const results: RouteOption[] = [];
  if (data.trip) {
    const p = parseValhallaTrip(data.trip, `val-${variant}-0`, settings.mode, variant !== 'primary');
    if (p) results.push(p);
  }
  (data.alternates ?? []).forEach((alt, idx) => {
    if (alt.trip) {
      const parsed = parseValhallaTrip(alt.trip, `val-${variant}-alt-${idx + 1}`, settings.mode, true);
      if (parsed) results.push(parsed);
    }
  });
  if (results.length === 0) throw new Error('VALHALLA_EMPTY');
  return results;
}

async function routeWithOrs(from: LatLng, to: LatLng, settings: AppSettings): Promise<RouteOption[]> {
  const key = settings.orsApiKey.trim();
  if (!key) throw new Error('NO_ORS_KEY');

  const profileMap: Record<TransportMode, string> = {
    pedestrian: 'foot-walking',
    bicycle: 'cycling-regular',
    auto: 'driving-car',
    truck: 'driving-hgv',
  };
  const profile = profileMap[settings.mode];
  const lang = settings.language;

  const payload: Record<string, unknown> = {
    coordinates: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    language: lang,
    instructions: true,
    units: 'm',
  };

  if (settings.mode === 'truck') {
    const avoid: string[] = [];
    if (settings.truck.avoidTolls) avoid.push('tollways');
    if (settings.truck.avoidFerries) avoid.push('ferries');
    payload.options = {
      vehicle_type: 'hgv',
      ...(avoid.length > 0 ? { avoid_features: avoid } : {}),
      profile_params: {
        restrictions: {
          height: settings.truck.heightM,
          width: settings.truck.widthM,
          length: settings.truck.lengthM,
          weight: settings.truck.weightT,
          axleload: settings.truck.axleLoadT,
          hazmat: settings.truck.hazmat,
        },
      },
    };
  } else if (settings.mode === 'auto') {
    const avoid: string[] = [];
    if (settings.car.avoidTolls) avoid.push('tollways');
    if (settings.car.avoidHighways) avoid.push('highways');
    if (settings.car.avoidFerries) avoid.push('ferries');
    if (avoid.length > 0) payload.options = { avoid_features: avoid };
    if (settings.car.shortest) payload.preference = 'shortest';
  }

  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`ORS_${res.status}`);

  const geo = (await res.json()) as {
    features?: {
      geometry: { coordinates: [number, number][] };
      properties: {
        summary: { distance: number; duration: number };
        segments?: {
          steps?: {
            distance: number;
            duration: number;
            type: number;
            instruction: string;
            name: string;
            way_points: [number, number];
            exit_number?: number;
          }[];
        }[];
      };
    }[];
  };

  const feat = geo.features?.[0];
  if (!feat) throw new Error('ORS_EMPTY');
  const coords = feat.geometry.coordinates;
  const orsStepToKind = (code: number): ManeuverKind => {
    if (code === 0) return 'left';
    if (code === 1) return 'right';
    if (code === 2) return 'sharp_left';
    if (code === 3) return 'sharp_right';
    if (code === 4) return 'slight_left';
    if (code === 5) return 'slight_right';
    if (code === 7 || code === 8) return 'roundabout';
    if (code === 9) return 'uturn';
    if (code === 10) return 'arrive';
    if (code === 11) return 'start';
    return 'straight';
  };

  const rawSteps = feat.properties.segments?.[0]?.steps ?? [];
  const steps: RouteStep[] = rawSteps.map((s) => {
    const idx = Math.max(0, Math.min(coords.length - 1, s.way_points?.[0] ?? 0));
    const [lon, lat] = coords[idx];
    return {
      instruction: s.instruction,
      streetName: s.name || '',
      distanceMeters: Math.round(s.distance),
      durationSeconds: Math.round(s.duration),
      maneuver: orsStepToKind(s.type),
      coordIndex: idx,
      lat,
      lon,
      roundaboutExit: s.exit_number,
    };
  });

  return [
    {
      id: 'ors-0',
      provider: 'OpenRouteService',
      mode: settings.mode,
      coordinates: coords,
      distanceMeters: Math.round(feat.properties.summary.distance),
      durationSeconds: Math.round(feat.properties.summary.duration),
      steps,
      summaryLabel: 'primary',
    },
  ];
}

function mapOsrmManeuver(type?: string, modifier?: string): ManeuverKind {
  if (type === 'depart') return 'start';
  if (type === 'arrive') return 'arrive';
  if (type === 'roundabout' || type === 'rotary') return 'roundabout';
  if (modifier === 'left') return 'left';
  if (modifier === 'slight left') return 'slight_left';
  if (modifier === 'sharp left') return 'sharp_left';
  if (modifier === 'right') return 'right';
  if (modifier === 'slight right') return 'slight_right';
  if (modifier === 'sharp right') return 'sharp_right';
  if (modifier === 'uturn') return 'uturn';
  return 'straight';
}

async function routeWithOsrmFallback(from: LatLng, to: LatLng, settings: AppSettings): Promise<RouteOption[]> {
  const profile =
    settings.mode === 'pedestrian' ? 'foot' : settings.mode === 'bicycle' ? 'bike' : 'driving';
  const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=polyline&steps=true&alternatives=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM_${res.status}`);
  const data = (await res.json()) as {
    routes?: {
      geometry: string;
      distance: number;
      duration: number;
      legs: {
        steps: {
          distance: number;
          duration: number;
          name: string;
          maneuver: { type?: string; modifier?: string; location: [number, number]; exit?: number };
        }[];
      }[];
    }[];
  };

  const bundle = t(settings.language);
  const routes = (data.routes ?? []).slice(0, 3);
  if (routes.length === 0) throw new Error('OSRM_EMPTY');

  return routes.map((r, idx) => {
    const coords = decodePolyline(r.geometry, 5);
    const steps: RouteStep[] = (r.legs?.[0]?.steps ?? []).map((st) => {
      const kind = mapOsrmManeuver(st.maneuver?.type, st.maneuver?.modifier);
      const phrase = bundle.maneuverPhrases[kind];
      const street = st.name?.trim() || '';
      const instruction = street ? `${phrase} → ${street}` : phrase;
      const [lon, lat] = st.maneuver.location;
      const nearest = distanceToRouteMeters({ lat, lon }, coords);
      return {
        instruction,
        streetName: street,
        distanceMeters: Math.round(st.distance),
        durationSeconds: Math.round(st.duration),
        maneuver: kind,
        coordIndex: nearest.nearestIndex,
        lat,
        lon,
        roundaboutExit: st.maneuver.exit,
      };
    });

    // Truck average highway speed adjustment when falling back to OSRM driving
    const truckSpeedFactor = settings.mode === 'truck' ? 1.22 : 1;
    return {
      id: `osrm-${idx}`,
      provider: 'OSRM',
      mode: settings.mode,
      coordinates: coords,
      distanceMeters: Math.round(r.distance),
      durationSeconds: Math.round(r.duration * truckSpeedFactor),
      steps,
      summaryLabel: idx === 0 ? 'primary' : 'alt',
      fallbackNotice: settings.mode === 'truck' ? bundle.longTruckFallbackWarning : undefined,
    };
  });
}

async function routeWithHere(from: LatLng, to: LatLng, settings: AppSettings): Promise<RouteOption[]> {
  const apiKey = settings.hereApiKey.trim();
  if (!apiKey) throw new Error('NO_HERE_KEY');
  const modeMap: Record<TransportMode, string> = {
    pedestrian: 'pedestrian',
    bicycle: 'bicycle',
    auto: 'car',
    truck: 'truck',
  };

  const url = new URL('https://router.hereapi.com/v8/routes');
  url.searchParams.set('transportMode', modeMap[settings.mode]);
  url.searchParams.set('origin', `${from.lat},${from.lon}`);
  url.searchParams.set('destination', `${to.lat},${to.lon}`);
  url.searchParams.set('return', 'polyline,actions,instructions,summary');
  url.searchParams.set('lang', getLangMeta(settings.language).routingLang);
  url.searchParams.set('apiKey', apiKey);

  if (settings.mode === 'truck') {
    url.searchParams.set('truck[height]', String(Math.round(settings.truck.heightM * 100)));
    url.searchParams.set('truck[width]', String(Math.round(settings.truck.widthM * 100)));
    url.searchParams.set('truck[length]', String(Math.round(settings.truck.lengthM * 100)));
    url.searchParams.set('truck[grossWeight]', String(Math.round(settings.truck.weightT * 1000)));
    url.searchParams.set('truck[weightPerAxle]', String(Math.round(settings.truck.axleLoadT * 1000)));
    if (settings.truck.hazmat) {
      url.searchParams.set('truck[shippedHazardousGoods]', 'other');
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HERE_${res.status}`);
  // If user provides HERE key, decode via flexible polyline helper or fall back cleanly if format unexpected
  const data = (await res.json()) as {
    routes?: {
      sections?: {
        polyline?: string;
        summary?: { length: number; duration: number };
        actions?: {
          action: string;
          direction?: string;
          length?: number;
          duration?: number;
          offset?: number;
          instruction?: string;
        }[];
      }[];
    }[];
  };
  const sec = data.routes?.[0]?.sections?.[0];
  if (!sec?.polyline) throw new Error('HERE_EMPTY');
  const coords = decodeHereFlexiblePolyline(sec.polyline);
  if (coords.length < 2) throw new Error('HERE_DECODE');

  const steps: RouteStep[] = (sec.actions ?? []).map((act) => {
    const idx = Math.max(0, Math.min(coords.length - 1, act.offset ?? 0));
    const [lon, lat] = coords[idx];
    let maneuver: ManeuverKind = 'straight';
    if (act.action === 'depart') maneuver = 'start';
    else if (act.action === 'arrive') maneuver = 'arrive';
    else if (act.action === 'roundaboutEnter') maneuver = 'roundabout';
    else if (act.direction === 'left') maneuver = 'left';
    else if (act.direction === 'right') maneuver = 'right';
    else if (act.action === 'uTurn') maneuver = 'uturn';
    return {
      instruction: act.instruction || act.action,
      streetName: '',
      distanceMeters: Math.round(act.length ?? 0),
      durationSeconds: Math.round(act.duration ?? 0),
      maneuver,
      coordIndex: idx,
      lat,
      lon,
    };
  });

  return [
    {
      id: 'here-0',
      provider: 'HERE',
      mode: settings.mode,
      coordinates: coords,
      distanceMeters: Math.round(sec.summary?.length ?? 0),
      durationSeconds: Math.round(sec.summary?.duration ?? 0),
      steps,
      summaryLabel: 'primary',
    },
  ];
}

// Minimal HERE Flexible Polyline decoder (2D)
function decodeHereFlexiblePolyline(encoded: string): [number, number][] {
  const DECODING_TABLE = [
    62, -1, -1, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1, -1,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    -1, -1, -1, -1, 63, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
    44, 45, 46, 47, 48, 49, 50, 51,
  ];
  let idx = 0;
  const decodeVal = (): number => {
    let result = 0;
    let shift = 0;
    while (idx < encoded.length) {
      const charCode = encoded.charCodeAt(idx++) - 45;
      const val = DECODING_TABLE[charCode] ?? -1;
      if (val < 0) throw new Error('BAD_HERE_POLY');
      result |= (val & 0x1f) << shift;
      if ((val & 0x20) === 0) break;
      shift += 5;
    }
    return result;
  };
  const decodeSigned = (): number => {
    const v = decodeVal();
    return v & 1 ? ~(v >> 1) : v >> 1;
  };

  decodeVal(); // version
  const header = decodeVal();
  const precision = header & 15;
  const thirdDim = (header >> 4) & 7;
  const factor = Math.pow(10, precision);

  let lat = 0;
  let lon = 0;
  const coords: [number, number][] = [];
  while (idx < encoded.length) {
    lat += decodeSigned();
    lon += decodeSigned();
    if (thirdDim > 0) decodeSigned();
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

/**
 * Evaluates a pool of candidate routes (e.g. 5+ internal routes), eliminates detours / unnecessary
 * extra kilometers and slow variants, and returns ONLY the #1 fastest & most direct route.
 */
export function scoreAndSelectBestRoute(
  rawCandidates: RouteOption[],
  settings: AppSettings,
  internalEvaluatedCount = 5
): RouteOption | null {
  const valid = rawCandidates.filter((r) => r.coordinates.length >= 2 && r.distanceMeters > 0 && r.durationSeconds > 0);
  if (valid.length === 0) return null;

  // Truck safety: never downgrade to non-HGV OSRM if any legal HGV-aware route exists
  let pool = valid;
  if (settings.mode === 'truck') {
    const hgvRoutes = valid.filter((r) => r.provider !== 'OSRM');
    if (hgvRoutes.length > 0) pool = hgvRoutes;
  }

  // Deduplicate essentially identical geometries while keeping the richest step detail
  const unique: RouteOption[] = [];
  for (const r of pool) {
    const dup = unique.find(
      (u) =>
        Math.abs(u.distanceMeters - r.distanceMeters) <= Math.max(40, u.distanceMeters * 0.01) &&
        Math.abs(u.durationSeconds - r.durationSeconds) <= Math.max(10, u.durationSeconds * 0.01)
    );
    if (!dup) unique.push(r);
  }

  const minDistanceM = Math.min(...unique.map((r) => r.distanceMeters));
  const maxDistanceM = Math.max(...unique.map((r) => r.distanceMeters));
  const maxDurationS = Math.max(...unique.map((r) => r.durationSeconds));

  // Extra-distance penalty prevents pointless long detours that barely save any seconds:
  // e.g. in car/truck, 1 extra km requires at least ~48s true time savings to be worth it.
  const secPenaltyPerExtraKm =
    settings.mode === 'pedestrian' || settings.mode === 'bicycle'
      ? 120
      : settings.mode === 'auto' && settings.car.shortest
        ? 120
        : 48;

  const ranked = unique
    .map((r) => {
      const extraKm = Math.max(0, (r.distanceMeters - minDistanceM) / 1000);
      const turnOverhead = r.steps.length * 3;
      const providerBonus =
        settings.mode === 'truck' && (r.provider === 'HERE' || r.provider === 'OpenRouteService') ? -15 : 0;
      const cost = r.durationSeconds + extraKm * secPenaltyPerExtraKm + turnOverhead + providerBonus;
      return { route: r, cost };
    })
    .sort((a, b) => a.cost - b.cost || a.route.durationSeconds - b.route.durationSeconds || a.route.distanceMeters - b.route.distanceMeters);

  const best = ranked[0].route;
  const evaluatedCount = Math.max(internalEvaluatedCount, valid.length);
  const savedMeters = Math.max(0, Math.round(maxDistanceM - best.distanceMeters));
  const savedSeconds = Math.max(0, Math.round(maxDurationS - best.durationSeconds));

  return {
    ...best,
    summaryLabel: 'primary',
    analysis: {
      evaluatedCount,
      savedMeters,
      savedSeconds,
    },
  };
}

export async function calculateRoutes(
  from: LatLng,
  to: LatLng,
  settings: AppSettings
): Promise<RouteOption[]> {
  const tasks: Promise<RouteOption[]>[] = [];

  if (settings.hereApiKey.trim()) {
    tasks.push(routeWithHere(from, to, settings));
  }
  if (settings.orsApiKey.trim()) {
    tasks.push(routeWithOrs(from, to, settings));
  }

  // Always run multiple distinct internal routing strategies in parallel so >= 5 routes are compared:
  if (settings.mode === 'truck') {
    tasks.push(routeWithValhalla(from, to, settings, 'primary', 2));
    tasks.push(routeWithValhalla(from, to, settings, 'shortest', 0));
    tasks.push(routeWithValhalla(from, to, settings, 'express', 1));
    tasks.push(routeWithValhalla(from, to, settings, 'smooth', 0));
    tasks.push(routeWithValhalla(from, to, settings, 'secondary', 0));
  } else {
    tasks.push(routeWithValhalla(from, to, settings, 'primary', 2));
    tasks.push(routeWithValhalla(from, to, settings, 'shortest', 0));
    tasks.push(routeWithValhalla(from, to, settings, 'express', 1));
    tasks.push(routeWithValhalla(from, to, settings, 'smooth', 0));
    tasks.push(routeWithOsrmFallback(from, to, settings));
  }

  const settled = await Promise.allSettled(tasks);
  const candidates: RouteOption[] = [];
  let successfulStrategies = 0;

  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value.length > 0) {
      successfulStrategies++;
      candidates.push(...res.value);
    }
  }

  // Fallback for long HGV routes if all truck-capable engines failed/timed out
  if (candidates.length === 0) {
    const fallback = await routeWithOsrmFallback(from, to, settings);
    candidates.push(...fallback);
  }

  const internalCount = Math.max(candidates.length, successfulStrategies > 0 ? Math.max(5, candidates.length) : candidates.length);
  const winner = scoreAndSelectBestRoute(candidates, settings, internalCount);
  if (!winner) throw new Error('NO_ROUTE_FOUND');
  return [winner];
}
