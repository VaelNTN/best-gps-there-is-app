import { GeocodedPlace, LanguageCode, PoiItem, TransportMode } from '../types/navigation';

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    osm_value?: string;
  };
}

function photonLang(lang: LanguageCode): string {
  // Photon demo server supports en, de, fr, it, default
  if (lang === 'de' || lang === 'fr' || lang === 'en') return lang;
  return 'default';
}

function formatPhotonFeature(f: PhotonFeature, idx: number): GeocodedPlace | null {
  const coords = f.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const p = f.properties ?? {};
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(' ').trim();
  const city = p.city || p.town || p.village || '';
  const name = p.name || streetLine || city || `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`;
  const subParts = [
    p.name && streetLine ? streetLine : '',
    [p.postcode, city].filter(Boolean).join(' ').trim(),
    p.state && p.state !== city ? p.state : '',
    p.country || '',
  ].filter(Boolean);

  return {
    id: `ph-${p.osm_id ?? idx}-${coords[1].toFixed(5)}-${coords[0].toFixed(5)}`,
    name,
    subtitle: subParts.join(', '),
    lon: coords[0],
    lat: coords[1],
    category: p.osm_value,
  };
}

export async function searchPlaces(
  query: string,
  biasLat?: number,
  biasLon?: number,
  lang: LanguageCode = 'en'
): Promise<GeocodedPlace[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // Try Komoot Photon first (fast autocomplete with location bias)
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    url.searchParams.set('lang', photonLang(lang));
    if (biasLat !== undefined && biasLon !== undefined) {
      url.searchParams.set('lat', biasLat.toFixed(4));
      url.searchParams.set('lon', biasLon.toFixed(4));
    }
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = (await res.json()) as { features?: PhotonFeature[] };
      const list = (data.features ?? [])
        .map((f, i) => formatPhotonFeature(f, i))
        .filter((x): x is GeocodedPlace => x !== null);
      if (list.length > 0) return list;
    }
  } catch {
    // Fall back to Nominatim below
  }

  // Fallback: OpenStreetMap Nominatim
  try {
    const nom = new URL('https://nominatim.openstreetmap.org/search');
    nom.searchParams.set('q', q);
    nom.searchParams.set('format', 'jsonv2');
    nom.searchParams.set('limit', '7');
    nom.searchParams.set('accept-language', lang);
    const res = await fetch(nom.toString());
    if (res.ok) {
      const rows = (await res.json()) as {
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
        type?: string;
      }[];
      return rows.map((r) => {
        const parts = r.display_name.split(',').map((s) => s.trim());
        return {
          id: `nom-${r.place_id}`,
          name: parts[0] || r.display_name,
          subtitle: parts.slice(1, 4).join(', '),
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          category: r.type,
        };
      });
    }
  } catch {
    // Ignore network error
  }

  return [];
}

export async function reverseGeocode(lat: number, lon: number, lang: LanguageCode = 'en'): Promise<GeocodedPlace> {
  try {
    const url = new URL('https://photon.komoot.io/reverse');
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lon', lon.toFixed(6));
    url.searchParams.set('lang', photonLang(lang));
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = (await res.json()) as { features?: PhotonFeature[] };
      const first = data.features?.[0] ? formatPhotonFeature(data.features[0], 0) : null;
      if (first) {
        return { ...first, lat, lon };
      }
    }
  } catch {
    // Fall back to coordinates label
  }

  try {
    const nom = new URL('https://nominatim.openstreetmap.org/reverse');
    nom.searchParams.set('lat', lat.toFixed(6));
    nom.searchParams.set('lon', lon.toFixed(6));
    nom.searchParams.set('format', 'jsonv2');
    nom.searchParams.set('accept-language', lang);
    const res = await fetch(nom.toString());
    if (res.ok) {
      const r = (await res.json()) as { display_name?: string; name?: string };
      if (r.display_name) {
        const parts = r.display_name.split(',').map((s) => s.trim());
        return {
          id: `rev-${lat.toFixed(5)}-${lon.toFixed(5)}`,
          name: r.name || parts[0] || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          subtitle: parts.slice(1, 4).join(', '),
          lat,
          lon,
        };
      }
    }
  } catch {
    // Fallback
  }

  return {
    id: `pin-${lat.toFixed(5)}-${lon.toFixed(5)}`,
    name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    subtitle: 'GPS Pin',
    lat,
    lon,
  };
}

export type PoiFilterKind = 'fuel' | 'parking' | 'ev' | 'bike' | 'water';

export async function fetchNearbyPois(
  lat: number,
  lon: number,
  kind: PoiFilterKind,
  mode: TransportMode
): Promise<PoiItem[]> {
  const radiusM = mode === 'truck' || mode === 'auto' ? 9000 : 3000;
  let filter = '';
  let emoji = '📍';

  if (kind === 'fuel') {
    emoji = mode === 'truck' ? '🚛⛽' : '⛽';
    filter =
      mode === 'truck'
        ? `node["amenity"="fuel"]["hgv"!="no"](around:${radiusM},${lat},${lon});way["amenity"="fuel"]["hgv"!="no"](around:${radiusM},${lat},${lon});`
        : `node["amenity"="fuel"](around:${radiusM},${lat},${lon});`;
  } else if (kind === 'parking') {
    emoji = mode === 'truck' ? '🚛🅿️' : '🅿️';
    filter =
      mode === 'truck'
        ? `node["amenity"="parking"]["hgv"~"yes|designated"](around:${radiusM},${lat},${lon});way["amenity"="parking"]["hgv"~"yes|designated"](around:${radiusM},${lat},${lon});node["highway"="services"](around:${radiusM},${lat},${lon});node["highway"="rest_area"](around:${radiusM},${lat},${lon});`
        : `node["amenity"="parking"](around:${radiusM},${lat},${lon});`;
  } else if (kind === 'ev') {
    emoji = '⚡';
    filter = `node["amenity"="charging_station"](around:${radiusM},${lat},${lon});`;
  } else if (kind === 'bike') {
    emoji = '🚲';
    filter = `node["shop"="bicycle"](around:${radiusM},${lat},${lon});node["amenity"="bicycle_repair_station"](around:${radiusM},${lat},${lon});node["amenity"="bicycle_parking"](around:${radiusM},${lat},${lon});`;
  } else {
    emoji = '🚰';
    filter = `node["amenity"="drinking_water"](around:${radiusM},${lat},${lon});node["amenity"="toilets"](around:${radiusM},${lat},${lon});`;
  }

  const query = `[out:json][timeout:12];(${filter});out center 25;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      elements?: {
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }[];
    };
    const items: PoiItem[] = [];
    for (const el of json.elements ?? []) {
      const pLat = el.lat ?? el.center?.lat;
      const pLon = el.lon ?? el.center?.lon;
      if (pLat === undefined || pLon === undefined) continue;
      const tags = el.tags ?? {};
      const name =
        tags.name ||
        tags.brand ||
        tags.operator ||
        (tags.amenity || tags.highway || tags.shop || kind).replace(/_/g, ' ');
      const extra = [
        tags.fuel_hgv_diesel === 'yes' || tags['fuel:diesel'] === 'yes' ? 'Diesel' : '',
        tags['fuel:adblue'] === 'yes' ? 'AdBlue' : '',
        tags.hgv === 'designated' ? 'HGV/Truck OK' : '',
        tags.opening_hours || '',
      ]
        .filter(Boolean)
        .join(' • ');
      items.push({
        id: `poi-${el.id}`,
        name,
        category: kind,
        emoji,
        lat: pLat,
        lon: pLon,
        extra: extra || undefined,
      });
    }
    return items.slice(0, 25);
  } catch {
    return [];
  }
}
