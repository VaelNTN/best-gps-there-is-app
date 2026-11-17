import { AppSettings, LanguageCode, RoadSignItem, RoadSignKind, RoadSignsSnapshot } from '../types/navigation';
import { haversineMeters } from './routing';

interface OverpassElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const SIGN_TITLES: Record<RoadSignKind, Record<LanguageCode, string>> = {
  maxspeed: {
    nl: 'Maximumsnelheid',
    en: 'Speed limit',
    de: 'Höchstgeschwindigkeit',
    fr: 'Limitation de vitesse',
    es: 'Límite de velocidad',
    pl: 'Ograniczenie prędkości',
    tr: 'Hız sınırı',
  },
  maxheight: {
    nl: 'Max. doorrijhoogte',
    en: 'Max height',
    de: 'Max. Durchfahrtshöhe',
    fr: 'Hauteur maximale',
    es: 'Altura máxima',
    pl: 'Maks. wysokość',
    tr: 'Maks. yükseklik',
  },
  maxwidth: {
    nl: 'Max. breedte',
    en: 'Max width',
    de: 'Max. Breite',
    fr: 'Largeur maximale',
    es: 'Anchura máxima',
    pl: 'Maks. szerokość',
    tr: 'Maks. genişlik',
  },
  maxweight: {
    nl: 'Max. totaalgewicht',
    en: 'Max weight',
    de: 'Max. Gesamtgewicht',
    fr: 'Poids maximal',
    es: 'Peso máximo',
    pl: 'Maks. masa',
    tr: 'Maks. ağırlık',
  },
  maxaxleload: {
    nl: 'Max. aslast',
    en: 'Max axle load',
    de: 'Max. Achslast',
    fr: 'Charge max. par essieu',
    es: 'Carga máx. por eje',
    pl: 'Maks. nacisk na oś',
    tr: 'Maks. aks yükü',
  },
  maxlength: {
    nl: 'Max. lengte',
    en: 'Max length',
    de: 'Max. Länge',
    fr: 'Longueur maximale',
    es: 'Longitud máxima',
    pl: 'Maks. długość',
    tr: 'Maks. uzunluk',
  },
  no_hgv: {
    nl: 'Verboden voor vrachtwagens',
    en: 'No trucks / HGV',
    de: 'Durchfahrtverbot LKW',
    fr: 'Interdit aux poids lourds',
    es: 'Prohibido camiones',
    pl: 'Zakaz wjazdu ciężarówek',
    tr: 'Kamyon giremez',
  },
  no_hazmat: {
    nl: 'Verboden voor gevaarlijke stoffen',
    en: 'No hazardous goods (ADR)',
    de: 'Kein Gefahrgut (ADR)',
    fr: 'Matières dangereuses interdites',
    es: 'Prohibido mercancías peligrosas',
    pl: 'Zakaz materiałów niebezpiecznych',
    tr: 'Tehlikeli madde giremez',
  },
  no_entry: {
    nl: 'Verboden in te rijden / gesloten',
    en: 'No entry / closed',
    de: 'Einfahrt verboten',
    fr: 'Sens interdit',
    es: 'Dirección prohibida',
    pl: 'Zakaz wjazdu',
    tr: 'Giriş yasak',
  },
  no_bicycle: {
    nl: 'Verboden voor fietsers',
    en: 'No bicycles',
    de: 'Radfahren verboten',
    fr: 'Interdit aux vélos',
    es: 'Prohibido bicicletas',
    pl: 'Zakaz rowerów',
    tr: 'Bisiklet giremez',
  },
  stop: {
    nl: 'STOP-bord',
    en: 'STOP sign',
    de: 'STOP-Schild',
    fr: 'Panneau STOP',
    es: 'Señal STOP',
    pl: 'Znak STOP',
    tr: 'DUR tabelası',
  },
  give_way: {
    nl: 'Voorrang verlenen',
    en: 'Give way / Yield',
    de: 'Vorfahrt gewähren',
    fr: 'Cédez le passage',
    es: 'Ceda el paso',
    pl: 'Ustąp pierwszeństwa',
    tr: 'Yol ver',
  },
  traffic_signals: {
    nl: 'Verkeerslichten',
    en: 'Traffic signals',
    de: 'Ampel',
    fr: 'Feux de circulation',
    es: 'Semáforo',
    pl: 'Sygnalizacja świetlna',
    tr: 'Trafik ışıkları',
  },
  speed_camera: {
    nl: 'Flitspaal / snelheidscontrole',
    en: 'Speed camera',
    de: 'Blitzer / Radarkontrolle',
    fr: 'Radar de vitesse',
    es: 'Radar de velocidad',
    pl: 'Fotoradar',
    tr: 'Hız kamerası',
  },
  railway_crossing: {
    nl: 'Spoorwegovergang',
    en: 'Railway crossing',
    de: 'Bahnübergang',
    fr: 'Passage à niveau',
    es: 'Paso a nivel',
    pl: 'Przejazd kolejowy',
    tr: 'Hemzemin geçit',
  },
  bump: {
    nl: 'Verkeersdrempel',
    en: 'Speed bump',
    de: 'Bodenwelle / Temposchwelle',
    fr: 'Ralentisseur',
    es: 'Resalto / badén',
    pl: 'Próg zwalniający',
    tr: 'Kasis',
  },
  roundabout: {
    nl: 'Rotonde',
    en: 'Roundabout',
    de: 'Kreisverkehr',
    fr: 'Rond-point',
    es: 'Rotonda',
    pl: 'Rondo',
    tr: 'Dönel kavşak',
  },
  oneway: {
    nl: 'Eenrichtingsweg',
    en: 'One-way street',
    de: 'Einbahnstraße',
    fr: 'Sens unique',
    es: 'Sentido único',
    pl: 'Droga jednokierunkowa',
    tr: 'Tek yön',
  },
  cycleway: {
    nl: 'Verplicht fietspad',
    en: 'Cycleway',
    de: 'Radweg',
    fr: 'Piste cyclable',
    es: 'Carril bici',
    pl: 'Droga dla rowerów',
    tr: 'Bisiklet yolu',
  },
  pedestrian_crossing: {
    nl: 'Voetgangersoversteek',
    en: 'Pedestrian crossing',
    de: 'Fußgängerüberweg',
    fr: 'Passage piéton',
    es: 'Paso de peatones',
    pl: 'Przejście dla pieszych',
    tr: 'Yaya geçidi',
  },
};

export function parseMaxSpeedKmh(raw?: string): number | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v || v === 'none' || v === 'signals' || v === 'variable') return null;
  if (v === 'walk' || v.includes('living_street')) return 15;
  if (v.endsWith(':urban') || v === 'urban') return 50;
  if (v.startsWith('nl:rural')) return 80;
  if (v.startsWith('de:rural')) return 100;
  if (v.includes(':rural')) return 80;
  if (v.includes('motorway')) return 120;
  const mphMatch = v.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mphMatch) return Math.round(Number(mphMatch[1]) * 1.60934);
  const numMatch = v.match(/(\d+)/);
  if (numMatch) {
    const n = Number(numMatch[1]);
    if (n >= 5 && n <= 160) return n;
  }
  return null;
}

export function parseNumericLimit(raw?: string): number | null {
  if (!raw) return null;
  const clean = raw.trim().replace(',', '.');
  const m = clean.match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = Number(m[1]);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderRoadSignSvg(kind: RoadSignKind, label: string, size = 30, danger = false): string {
  const safe = escapeXml(label);
  const ringGlow = danger ? ' filter: drop-shadow(0 0 4px #ef4444);' : '';

  switch (kind) {
    case 'maxspeed': {
      const fontSize = safe.length >= 3 ? 13 : 16;
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#dc2626" stroke-width="4.5"/>
        <text x="20" y="25.5" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="${fontSize}" fill="#0f172a">${safe}</text>
      </svg>`;
    }

    case 'maxheight':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#dc2626" stroke-width="4.2"/>
        <polygon points="20,9 15.5,4.8 24.5,4.8" fill="#0f172a"/>
        <polygon points="20,31 15.5,35.2 24.5,35.2" fill="#0f172a"/>
        <text x="20" y="24" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="11.5" fill="#0f172a">${safe}</text>
      </svg>`;

    case 'maxwidth':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#dc2626" stroke-width="4.2"/>
        <polygon points="10.5,20 5.5,15.5 5.5,24.5" fill="#0f172a"/>
        <polygon points="29.5,20 34.5,15.5 34.5,24.5" fill="#0f172a"/>
        <text x="20" y="23.5" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="11" fill="#0f172a">${safe}</text>
      </svg>`;

    case 'maxweight':
    case 'maxaxleload':
    case 'maxlength':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#dc2626" stroke-width="4.2"/>
        <text x="20" y="16" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="7.5" fill="#475569">${
          kind === 'maxaxleload' ? 'AXLE' : kind === 'maxlength' ? 'LEN' : 'MAX'
        }</text>
        <text x="20" y="27.5" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="11.5" fill="#0f172a">${safe}</text>
      </svg>`;

    case 'no_hgv':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#dc2626" stroke-width="4.2"/>
        <rect x="9" y="15" width="14" height="9" rx="1.5" fill="#0f172a"/>
        <path d="M23 17h5l3 3.5V24h-8z" fill="#0f172a"/>
        <circle cx="13" cy="25.5" r="2.1" fill="#0f172a"/>
        <circle cx="26.5" cy="25.5" r="2.1" fill="#0f172a"/>
        <line x1="8" y1="31" x2="32" y2="9" stroke="#dc2626" stroke-width="3.6" stroke-linecap="round"/>
      </svg>`;

    case 'no_hazmat':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#dc2626" stroke-width="4.2"/>
        <rect x="13" y="13" width="14" height="14" rx="2" transform="rotate(45 20 20)" fill="#f97316" stroke="#0f172a" stroke-width="1.5"/>
        <line x1="8" y1="31" x2="32" y2="9" stroke="#dc2626" stroke-width="3.5" stroke-linecap="round"/>
      </svg>`;

    case 'no_entry':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>
        <rect x="8" y="17" width="24" height="6" rx="1.5" fill="#ffffff"/>
      </svg>`;

    case 'no_bicycle':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;${ringGlow}">
        <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#dc2626" stroke-width="4.2"/>
        <circle cx="13" cy="24" r="4" fill="none" stroke="#0f172a" stroke-width="2"/>
        <circle cx="27" cy="24" r="4" fill="none" stroke="#0f172a" stroke-width="2"/>
        <path d="M13 24l5-8h5l4 8M18 16l2 8" fill="none" stroke="#0f172a" stroke-width="1.8"/>
        <line x1="8" y1="31" x2="32" y2="9" stroke="#dc2626" stroke-width="3.4" stroke-linecap="round"/>
      </svg>`;

    case 'stop':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <polygon points="13,3 27,3 37,13 37,27 27,37 13,37 3,27 3,13" fill="#dc2626" stroke="#ffffff" stroke-width="2.4"/>
        <text x="20" y="23.5" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="10.5" fill="#ffffff">STOP</text>
      </svg>`;

    case 'give_way':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <polygon points="4,7 36,7 20,35" fill="#ffffff" stroke="#dc2626" stroke-width="4.2" stroke-linejoin="round"/>
      </svg>`;

    case 'traffic_signals':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <polygon points="20,4 37,34 3,34" fill="#ffffff" stroke="#dc2626" stroke-width="3.6" stroke-linejoin="round"/>
        <rect x="17" y="13.5" width="6" height="17" rx="2" fill="#0f172a"/>
        <circle cx="20" cy="16.8" r="1.8" fill="#ef4444"/>
        <circle cx="20" cy="22" r="1.8" fill="#f59e0b"/>
        <circle cx="20" cy="27.2" r="1.8" fill="#10b981"/>
      </svg>`;

    case 'speed_camera':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <rect x="4" y="4" width="32" height="32" rx="6" fill="#1d4ed8" stroke="#ffffff" stroke-width="2.5"/>
        <rect x="10" y="14" width="15" height="11" rx="2" fill="#ffffff"/>
        <circle cx="17.5" cy="19.5" r="3.4" fill="#1d4ed8"/>
        <polygon points="25,16 31,13 31,26 25,23" fill="#ffffff"/>
      </svg>`;

    case 'railway_crossing':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <polygon points="20,4 37,34 3,34" fill="#ffffff" stroke="#dc2626" stroke-width="3.6" stroke-linejoin="round"/>
        <line x1="15" y1="16" x2="15" y2="30" stroke="#0f172a" stroke-width="2.2"/>
        <line x1="25" y1="16" x2="25" y2="30" stroke="#0f172a" stroke-width="2.2"/>
        <line x1="12" y1="20" x2="28" y2="20" stroke="#0f172a" stroke-width="2"/>
        <line x1="12" y1="25.5" x2="28" y2="25.5" stroke="#0f172a" stroke-width="2"/>
      </svg>`;

    case 'bump':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <polygon points="20,4 37,34 3,34" fill="#ffffff" stroke="#dc2626" stroke-width="3.6" stroke-linejoin="round"/>
        <path d="M9 29h6c2-5.5 8-5.5 10 0h6" fill="none" stroke="#0f172a" stroke-width="2.8" stroke-linecap="round"/>
      </svg>`;

    case 'roundabout':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <circle cx="20" cy="20" r="18" fill="#1d4ed8" stroke="#ffffff" stroke-width="2.2"/>
        <circle cx="20" cy="20" r="8.5" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-dasharray="12 5"/>
      </svg>`;

    case 'oneway':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <rect x="5" y="5" width="30" height="30" rx="6" fill="#1d4ed8" stroke="#ffffff" stroke-width="2.2"/>
        <polygon points="20,10 29,20 23.5,20 23.5,30 16.5,30 16.5,20 11,20" fill="#ffffff"/>
      </svg>`;

    case 'cycleway':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <circle cx="20" cy="20" r="18" fill="#1d4ed8" stroke="#ffffff" stroke-width="2.2"/>
        <circle cx="13" cy="24" r="4.2" fill="none" stroke="#ffffff" stroke-width="2.2"/>
        <circle cx="27" cy="24" r="4.2" fill="none" stroke="#ffffff" stroke-width="2.2"/>
        <path d="M13 24l5-8h5l4 8M18 16l2 8" fill="none" stroke="#ffffff" stroke-width="2"/>
      </svg>`;

    case 'pedestrian_crossing':
      return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="display:block;">
        <rect x="4" y="4" width="32" height="32" rx="6" fill="#1d4ed8" stroke="#ffffff" stroke-width="2.2"/>
        <polygon points="20,9 32,30 8,30" fill="#ffffff"/>
        <circle cx="20" cy="17.5" r="2" fill="#0f172a"/>
        <path d="M20 20v5.5M17 22l3-1.5 3 2M18 28l2-3 2 3" stroke="#0f172a" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
  }
}

function getTitle(kind: RoadSignKind, lang: LanguageCode, detail?: string): string {
  const base = SIGN_TITLES[kind]?.[lang] ?? SIGN_TITLES[kind]?.en ?? kind;
  return detail ? `${base}: ${detail}` : base;
}

function parseSignFromTags(
  id: string,
  lat: number,
  lon: number,
  tags: Record<string, string>,
  settings: AppSettings
): RoadSignItem[] {
  const out: RoadSignItem[] = [];
  const lang = settings.language;
  const ts = (tags.traffic_sign || '').toUpperCase();

  // 1. Speed limit
  const speedKmh = parseMaxSpeedKmh(tags.maxspeed);
  if (speedKmh !== null) {
    out.push({
      id: `${id}-spd`,
      kind: 'maxspeed',
      label: String(speedKmh),
      title: getTitle('maxspeed', lang, `${speedKmh} km/u`),
      lat,
      lon,
      maxSpeedKmh: speedKmh,
      priority: 4,
    });
  } else if (/A1[-:](\d+)|DE:274[-:](\d+)|FR:B14[-:](\d+)/.test(ts)) {
    const m = ts.match(/(?:A1|DE:274|FR:B14)[-:](\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 5 && n <= 140) {
        out.push({
          id: `${id}-tsspd`,
          kind: 'maxspeed',
          label: String(n),
          title: getTitle('maxspeed', lang, `${n} km/u`),
          lat,
          lon,
          maxSpeedKmh: n,
          priority: 5,
        });
      }
    }
  }

  // 2. Height restriction
  const mh = parseNumericLimit(tags.maxheight);
  if (mh !== null) {
    const danger = settings.mode === 'truck' && mh <= settings.truck.heightM + 0.05;
    out.push({
      id: `${id}-mh`,
      kind: 'maxheight',
      label: `${mh.toFixed(1)}m`,
      title: getTitle('maxheight', lang, `${mh.toFixed(2)} m`),
      lat,
      lon,
      numericValue: mh,
      isDangerForMode: danger,
      priority: danger ? 10 : 7,
    });
  }

  // 3. Width restriction
  const mw = parseNumericLimit(tags.maxwidth);
  if (mw !== null) {
    const danger = settings.mode === 'truck' && mw <= settings.truck.widthM + 0.05;
    out.push({
      id: `${id}-mw`,
      kind: 'maxwidth',
      label: `${mw.toFixed(1)}m`,
      title: getTitle('maxwidth', lang, `${mw.toFixed(2)} m`),
      lat,
      lon,
      numericValue: mw,
      isDangerForMode: danger,
      priority: danger ? 10 : 7,
    });
  }

  // 4. Weight restriction
  const mwt = parseNumericLimit(tags.maxweight || tags.maxweightrating);
  if (mwt !== null) {
    const danger = settings.mode === 'truck' && mwt < settings.truck.weightT;
    out.push({
      id: `${id}-mwt`,
      kind: 'maxweight',
      label: `${mwt}t`,
      title: getTitle('maxweight', lang, `${mwt} t`),
      lat,
      lon,
      numericValue: mwt,
      isDangerForMode: danger,
      priority: danger ? 10 : 7,
    });
  }

  // 5. Axle load restriction
  const maxle = parseNumericLimit(tags.maxaxleload);
  if (maxle !== null) {
    const danger = settings.mode === 'truck' && maxle < settings.truck.axleLoadT;
    out.push({
      id: `${id}-maxle`,
      kind: 'maxaxleload',
      label: `${maxle}t`,
      title: getTitle('maxaxleload', lang, `${maxle} t`),
      lat,
      lon,
      numericValue: maxle,
      isDangerForMode: danger,
      priority: danger ? 10 : 7,
    });
  }

  // 6. Length restriction
  const ml = parseNumericLimit(tags.maxlength);
  if (ml !== null) {
    const danger = settings.mode === 'truck' && ml < settings.truck.lengthM;
    out.push({
      id: `${id}-ml`,
      kind: 'maxlength',
      label: `${ml}m`,
      title: getTitle('maxlength', lang, `${ml} m`),
      lat,
      lon,
      numericValue: ml,
      isDangerForMode: danger,
      priority: danger ? 10 : 7,
    });
  }

  // 7. HGV / Hazmat / Access bans
  if (tags.hgv === 'no' || ts.includes('NL:C7') || ts.includes('DE:253')) {
    const danger = settings.mode === 'truck';
    out.push({
      id: `${id}-nohgv`,
      kind: 'no_hgv',
      label: 'HGV',
      title: getTitle('no_hgv', lang),
      lat,
      lon,
      isDangerForMode: danger,
      priority: danger ? 9 : 5,
    });
  }

  if (tags.hazmat === 'no' || tags['hazmat:water'] === 'no' || ts.includes('NL:C22') || ts.includes('DE:261')) {
    const danger = settings.mode === 'truck' && settings.truck.hazmat;
    out.push({
      id: `${id}-noadr`,
      kind: 'no_hazmat',
      label: 'ADR',
      title: getTitle('no_hazmat', lang),
      lat,
      lon,
      isDangerForMode: danger,
      priority: danger ? 10 : 5,
    });
  }

  if (tags.bicycle === 'no' || ts.includes('NL:C14') || ts.includes('DE:254')) {
    const danger = settings.mode === 'bicycle';
    out.push({
      id: `${id}-nobike`,
      kind: 'no_bicycle',
      label: 'NO',
      title: getTitle('no_bicycle', lang),
      lat,
      lon,
      isDangerForMode: danger,
      priority: danger ? 9 : 3,
    });
  }

  if (ts.includes('NL:C1') || ts.includes('NL:C2') || ts.includes('DE:250') || ts.includes('DE:267')) {
    out.push({
      id: `${id}-noent`,
      kind: 'no_entry',
      label: 'NO',
      title: getTitle('no_entry', lang),
      lat,
      lon,
      priority: 6,
    });
  }

  // 8. Highway & warning signs
  if (tags.highway === 'stop' || ts.includes('NL:B7') || ts.includes('DE:206')) {
    out.push({
      id: `${id}-stop`,
      kind: 'stop',
      label: 'STOP',
      title: getTitle('stop', lang),
      lat,
      lon,
      priority: 8,
    });
  } else if (tags.highway === 'give_way' || ts.includes('NL:B6') || ts.includes('DE:205')) {
    out.push({
      id: `${id}-gw`,
      kind: 'give_way',
      label: 'YIELD',
      title: getTitle('give_way', lang),
      lat,
      lon,
      priority: 6,
    });
  }

  if (tags.highway === 'speed_camera' || tags.enforcement === 'maxspeed') {
    out.push({
      id: `${id}-cam`,
      kind: 'speed_camera',
      label: 'CAM',
      title: getTitle('speed_camera', lang),
      lat,
      lon,
      priority: 9,
    });
  }

  if (tags.highway === 'traffic_signals') {
    out.push({
      id: `${id}-sig`,
      kind: 'traffic_signals',
      label: 'SIG',
      title: getTitle('traffic_signals', lang),
      lat,
      lon,
      priority: 5,
    });
  }

  if (tags.railway === 'level_crossing') {
    out.push({
      id: `${id}-rail`,
      kind: 'railway_crossing',
      label: 'RAIL',
      title: getTitle('railway_crossing', lang),
      lat,
      lon,
      priority: 8,
    });
  }

  if (tags.traffic_calming === 'bump' || tags.traffic_calming === 'hump' || tags.traffic_calming === 'table') {
    out.push({
      id: `${id}-bmp`,
      kind: 'bump',
      label: 'BUMP',
      title: getTitle('bump', lang),
      lat,
      lon,
      priority: 4,
    });
  }

  if (tags.highway === 'crossing' && (tags.crossing === 'zebra' || tags.crossing === 'marked')) {
    out.push({
      id: `${id}-ped`,
      kind: 'pedestrian_crossing',
      label: 'PED',
      title: getTitle('pedestrian_crossing', lang),
      lat,
      lon,
      priority: 3,
    });
  }

  if (ts.includes('NL:G11') || ts.includes('DE:237')) {
    out.push({
      id: `${id}-cyc`,
      kind: 'cycleway',
      label: 'BIKE',
      title: getTitle('cycleway', lang),
      lat,
      lon,
      priority: settings.mode === 'bicycle' ? 6 : 2,
    });
  }

  return out;
}

const signCache = new Map<string, { at: number; data: RoadSignsSnapshot }>();

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function queryOverpass(query: string): Promise<{ elements?: OverpassElement[] } | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 9500);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      if (res.ok) {
        return (await res.json()) as { elements?: OverpassElement[] };
      }
    } catch {
      // Try next mirror
    }
  }
  return null;
}

export async function fetchRoadSignsAround(
  lat: number,
  lon: number,
  settings: AppSettings
): Promise<RoadSignsSnapshot> {
  const cellKey = `${lat.toFixed(3)}:${lon.toFixed(3)}:${settings.mode}:${settings.truck.heightM}:${settings.truck.weightT}:${settings.language}`;
  const cached = signCache.get(cellKey);
  if (cached && Date.now() - cached.at < 90_000) {
    return cached.data;
  }

  const radius = settings.mode === 'truck' || settings.mode === 'auto' ? 1400 : 800;

  // Query 1 block: active road (75m) + traffic sign nodes & critical restriction ways in radius
  const query = `
    [out:json][timeout:10];
    (
      way(around:65,${lat},${lon})["highway"]["maxspeed"];
      way(around:65,${lat},${lon})["highway"]["name"];
      node(around:${radius},${lat},${lon})["traffic_sign"];
      node(around:${radius},${lat},${lon})["highway"~"^(stop|give_way|traffic_signals|speed_camera|crossing)$"];
      node(around:${radius},${lat},${lon})["railway"="level_crossing"];
      node(around:${radius},${lat},${lon})["traffic_calming"~"^(bump|hump|table)$"];
      node(around:${radius},${lat},${lon})["maxheight"];
      node(around:${radius},${lat},${lon})["maxwidth"];
      node(around:${radius},${lat},${lon})["maxweight"];
      way(around:${radius},${lat},${lon})["maxheight"];
      way(around:${radius},${lat},${lon})["maxwidth"];
      way(around:${radius},${lat},${lon})["maxweight"];
      way(around:${radius},${lat},${lon})["maxaxleload"];
      way(around:${radius},${lat},${lon})["maxlength"];
      way(around:${radius},${lat},${lon})["hgv"="no"];
      way(around:${radius},${lat},${lon})["hazmat"="no"];
    );
    out center 140;
  `;

  const json = await queryOverpass(query);
  if (!json?.elements) {
    return { currentMaxSpeedKmh: null, currentRoadName: null, signs: [] };
  }

  let currentMaxSpeedKmh: number | null = null;
  let currentRoadName: string | null = null;
  const rawSigns: RoadSignItem[] = [];

  for (const el of json.elements) {
    const tags = el.tags ?? {};
    const pLat = el.lat ?? el.center?.lat;
    const pLon = el.lon ?? el.center?.lon;
    if (pLat === undefined || pLon === undefined) continue;

    const dist = haversineMeters({ lat, lon }, { lat: pLat, lon: pLon });
    if (el.type === 'way' && dist <= 90) {
      const spd = parseMaxSpeedKmh(tags.maxspeed);
      if (spd !== null && currentMaxSpeedKmh === null) currentMaxSpeedKmh = spd;
      if (tags.name && !currentRoadName) currentRoadName = tags.name;
    }

    const parsed = parseSignFromTags(`${el.type}-${el.id}`, pLat, pLon, tags, settings);
    rawSigns.push(...parsed);
  }

  // Deduplicate nearby identical signs within 45m so intersections stay clean
  const sorted = rawSigns.sort((a, b) => {
    const dA = haversineMeters({ lat, lon }, a) - (a.priority ?? 0) * 18;
    const dB = haversineMeters({ lat, lon }, b) - (b.priority ?? 0) * 18;
    return dA - dB;
  });

  const kept: RoadSignItem[] = [];
  for (const cand of sorted) {
    const dup = kept.some(
      (k) =>
        k.kind === cand.kind &&
        k.label === cand.label &&
        haversineMeters(k, cand) < 55
    );
    if (!dup) {
      kept.push(cand);
    }
    if (kept.length >= 42) break;
  }

  const result: RoadSignsSnapshot = {
    currentMaxSpeedKmh,
    currentRoadName,
    signs: kept,
  };
  signCache.set(cellKey, { at: Date.now(), data: result });
  return result;
}
