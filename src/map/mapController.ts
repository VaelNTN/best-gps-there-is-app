import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { renderRoadSignSvg } from '../services/roadSigns';
import { GpsFix, LatLng, MapTheme, PoiItem, RoadSignItem, RouteOption, TransportMode } from '../types/navigation';

const RASTER_FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
};

function getStyleUrl(theme: MapTheme): string {
  return theme === 'night'
    ? 'https://tiles.openfreemap.org/styles/dark'
    : 'https://tiles.openfreemap.org/styles/liberty';
}

function modeRouteColor(mode: TransportMode): string {
  if (mode === 'pedestrian') return '#10b981';
  if (mode === 'bicycle') return '#06b6d4';
  if (mode === 'truck') return '#f59e0b';
  return '#3b82f6';
}

export class MapController {
  private map: maplibregl.Map;
  private isLoaded = false;
  private theme: MapTheme;
  private gpsMarker: maplibregl.Marker | null = null;
  private destMarker: maplibregl.Marker | null = null;
  private startMarker: maplibregl.Marker | null = null;
  private poiMarkers: maplibregl.Marker[] = [];
  private signMarkers: maplibregl.Marker[] = [];
  private lastRoutes: RouteOption[] = [];
  private lastSelectedIdx = 0;
  private onMapTap: (latlng: LatLng) => void;
  private onPoiTap: (poi: PoiItem) => void;
  private onSignTap: (sign: RoadSignItem) => void;
  private fallbackApplied = false;

  constructor(
    container: HTMLElement,
    initialCenter: LatLng,
    theme: MapTheme,
    onMapTap: (latlng: LatLng) => void,
    onPoiTap: (poi: PoiItem) => void,
    onSignTap: (sign: RoadSignItem) => void = () => undefined
  ) {
    this.theme = theme;
    this.onMapTap = onMapTap;
    this.onPoiTap = onPoiTap;
    this.onSignTap = onSignTap;

    this.map = new maplibregl.Map({
      container,
      style: getStyleUrl(theme),
      center: [initialCenter.lon, initialCenter.lat],
      zoom: 13.5,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    this.map.on('load', () => {
      this.isLoaded = true;
      this.ensureRouteLayers();
      if (this.lastRoutes.length > 0) {
        this.renderRoutes(this.lastRoutes, this.lastSelectedIdx);
      }
    });

    this.map.on('style.load', () => {
      this.isLoaded = true;
      this.ensureRouteLayers();
      if (this.lastRoutes.length > 0) {
        this.renderRoutes(this.lastRoutes, this.lastSelectedIdx);
      }
    });

    this.map.on('error', () => {
      if (!this.fallbackApplied && !this.isLoaded) {
        this.fallbackApplied = true;
        this.map.setStyle(RASTER_FALLBACK_STYLE);
      }
    });

    this.map.on('click', (e) => {
      this.onMapTap({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
  }

  setTheme(theme: MapTheme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.fallbackApplied = false;
    this.isLoaded = false;
    this.map.setStyle(getStyleUrl(theme));
  }

  private ensureRouteLayers(): void {
    if (!this.map.getSource('alt-route-src')) {
      this.map.addSource('alt-route-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      this.map.addLayer({
        id: 'alt-route-line',
        type: 'line',
        source: 'alt-route-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#64748b',
          'line-width': 6,
          'line-opacity': 0.65,
          'line-dasharray': [1.5, 1.2],
        },
      });
    }

    if (!this.map.getSource('main-route-src')) {
      this.map.addSource('main-route-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      this.map.addLayer({
        id: 'main-route-casing',
        type: 'line',
        source: 'main-route-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#0f172a',
          'line-width': 11,
          'line-opacity': 0.65,
        },
      });
      this.map.addLayer({
        id: 'main-route-line',
        type: 'line',
        source: 'main-route-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#3b82f6',
          'line-width': 7,
          'line-opacity': 0.96,
        },
      });
    }
  }

  renderRoutes(routes: RouteOption[], selectedIdx = 0): void {
    this.lastRoutes = routes;
    this.lastSelectedIdx = selectedIdx;
    if (!this.isLoaded) return;
    this.ensureRouteLayers();

    const main = routes[selectedIdx];
    const alts = routes.filter((_, i) => i !== selectedIdx);

    const altSrc = this.map.getSource('alt-route-src') as maplibregl.GeoJSONSource | undefined;
    if (altSrc) {
      altSrc.setData({
        type: 'FeatureCollection',
        features: alts.map((r) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: r.coordinates },
        })),
      });
    }

    const mainSrc = this.map.getSource('main-route-src') as maplibregl.GeoJSONSource | undefined;
    if (mainSrc) {
      if (main) {
        this.map.setPaintProperty('main-route-line', 'line-color', modeRouteColor(main.mode));
        mainSrc.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: main.coordinates },
            },
          ],
        });
      } else {
        mainSrc.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }

  fitRoute(route: RouteOption): void {
    if (route.coordinates.length < 2) return;
    const bounds = new maplibregl.LngLatBounds(route.coordinates[0], route.coordinates[0]);
    for (let i = 1; i < route.coordinates.length; i += Math.max(1, Math.floor(route.coordinates.length / 80))) {
      bounds.extend(route.coordinates[i]);
    }
    bounds.extend(route.coordinates[route.coordinates.length - 1]);
    this.map.fitBounds(bounds, { padding: { top: 120, bottom: 230, left: 36, right: 64 }, maxZoom: 15, pitch: 0 });
  }

  setStartPin(pos: LatLng | null): void {
    this.startMarker?.remove();
    this.startMarker = null;
    if (!pos) return;
    const el = document.createElement('div');
    el.className = 'map-pin-start';
    el.textContent = 'A';
    this.startMarker = new maplibregl.Marker({ element: el }).setLngLat([pos.lon, pos.lat]).addTo(this.map);
  }

  setDestinationPin(pos: LatLng | null): void {
    this.destMarker?.remove();
    this.destMarker = null;
    if (!pos) return;
    const el = document.createElement('div');
    el.className = 'map-pin-dest';
    el.textContent = '📍';
    this.destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([pos.lon, pos.lat])
      .addTo(this.map);
  }

  updateGpsFix(fix: GpsFix, followInNav: boolean): void {
    if (!this.gpsMarker) {
      const el = document.createElement('div');
      el.className = 'gps-puck';
      el.innerHTML = `<div class="gps-cone"></div><div class="gps-dot"></div>`;
      this.gpsMarker = new maplibregl.Marker({ element: el }).setLngLat([fix.lon, fix.lat]).addTo(this.map);
    } else {
      this.gpsMarker.setLngLat([fix.lon, fix.lat]);
    }

    const puckEl = this.gpsMarker.getElement();
    puckEl.classList.toggle('snapped', Boolean(fix.snappedToRoad));

    const cone = puckEl.querySelector<HTMLElement>('.gps-cone');
    if (cone && fix.heading !== null) {
      const relativeRot = followInNav ? 0 : fix.heading - this.map.getBearing();
      cone.style.transform = `translate(-50%, -85%) rotate(${relativeRot}deg)`;
      cone.style.opacity = '1';
    } else if (cone) {
      cone.style.opacity = '0.35';
    }

    if (followInNav) {
      this.map.easeTo({
        center: [fix.lon, fix.lat],
        zoom: 16.4,
        pitch: 52,
        bearing: fix.heading ?? this.map.getBearing(),
        duration: fix.isSimulated ? 130 : 380,
        easing: (x) => x,
      });
    }
  }

  flyTo(pos: LatLng, zoom = 14.5, pitch = 0): void {
    this.map.easeTo({ center: [pos.lon, pos.lat], zoom, pitch, bearing: 0, duration: 600 });
  }

  setPois(pois: PoiItem[]): void {
    this.poiMarkers.forEach((m) => m.remove());
    this.poiMarkers = pois.map((poi) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'poi-marker';
      el.textContent = poi.emoji;
      el.title = poi.name;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onPoiTap(poi);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([poi.lon, poi.lat]).addTo(this.map);
    });
  }

  clearPois(): void {
    this.poiMarkers.forEach((m) => m.remove());
    this.poiMarkers = [];
  }

  setRoadSigns(signs: RoadSignItem[]): void {
    this.signMarkers.forEach((m) => m.remove());
    this.signMarkers = signs.map((sign) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `road-sign-marker ${sign.isDangerForMode ? 'danger' : ''}`;
      el.title = sign.title;
      el.innerHTML = renderRoadSignSvg(sign.kind, sign.label, sign.isDangerForMode ? 32 : 26, Boolean(sign.isDangerForMode));
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onSignTap(sign);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([sign.lon, sign.lat]).addTo(this.map);
    });
  }

  clearRoadSigns(): void {
    this.signMarkers.forEach((m) => m.remove());
    this.signMarkers = [];
  }

  resize(): void {
    this.map.resize();
  }
}
