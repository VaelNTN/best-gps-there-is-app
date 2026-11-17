import { LanguageCode, ManeuverKind, TransportMode } from '../types/navigation';

export interface LanguageMeta {
  code: LanguageCode;
  label: string;
  flag: string;
  ttsLocale: string;
  routingLang: string;
}

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱', ttsLocale: 'nl-NL', routingLang: 'nl-NL' },
  { code: 'en', label: 'English', flag: '🇬🇧', ttsLocale: 'en-US', routingLang: 'en-US' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪', ttsLocale: 'de-DE', routingLang: 'de-DE' },
  { code: 'fr', label: 'Français', flag: '🇫🇷', ttsLocale: 'fr-FR', routingLang: 'fr-FR' },
  { code: 'es', label: 'Español', flag: '🇪🇸', ttsLocale: 'es-ES', routingLang: 'es-ES' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱', ttsLocale: 'pl-PL', routingLang: 'pl-PL' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷', ttsLocale: 'tr-TR', routingLang: 'tr-TR' },
];

export interface TranslationBundle {
  appTitle: string;
  searchPlaceholder: string;
  fromMyLocation: string;
  modes: Record<TransportMode, string>;
  modeSubtitles: Record<TransportMode, string>;
  calculatingRoute: string;
  routeReady: string;
  noRouteFound: string;
  startNav: string;
  simulateDrive: string;
  stopNav: string;
  recenter: string;
  altRoute: string;
  primaryRoute: string;
  stepsTitle: string;
  rerouting: string;
  arrived: string;
  offRouteNotice: string;
  gpsActive: string;
  gpsFallbackNotice: string;
  tapMapHint: string;
  setDestination: string;
  setStart: string;
  saveFavorite: string;
  savedPlaces: string;
  home: string;
  work: string;
  favorites: string;
  recents: string;
  setAsHome: string;
  setAsWork: string;
  clearHistory: string;
  vehicleSettings: string;
  truckPresets: string;
  presetVan: string;
  presetBox12: string;
  presetSemi40: string;
  presetLzv60: string;
  presetCamper: string;
  heightM: string;
  widthM: string;
  lengthM: string;
  weightT: string;
  axleLoadT: string;
  hazmatAdr: string;
  avoidTolls: string;
  avoidHighways: string;
  avoidFerries: string;
  avoidHills: string;
  avoidStairs: string;
  shortestRoute: string;
  bikeType: string;
  walkSpeed: string;
  truckWarning: string;
  longTruckFallbackWarning: string;
  settingsTitle: string;
  languageLabel: string;
  themeLabel: string;
  dayTheme: string;
  nightTheme: string;
  unitsLabel: string;
  metricUnits: string;
  imperialUnits: string;
  voiceLabel: string;
  testVoice: string;
  voiceSample: string;
  autoRerouteLabel: string;
  proRoutingTitle: string;
  proRoutingDesc: string;
  orsKeyLabel: string;
  hereKeyLabel: string;
  valhallaUrlLabel: string;
  saveSettings: string;
  poiFuel: string;
  poiParking: string;
  poiEv: string;
  poiBike: string;
  poiWater: string;
  poiLoading: string;
  poiCount: string;
  inDistance: string;
  maneuverPhrases: Record<ManeuverKind, string>;
  speedUnit: string;
  etaLabel: string;
  distanceLabel: string;
  providerLabel: string;
  simSpeed: string;
  roadSignsChip: string;
  signsNearbyLabel: string;
  truckSignDanger: string;
  speedLimitLabel: string;
  chooseModeTitle: string;
  chooseModeSub: string;
  launcherModes: Record<TransportMode, string>;
  quickSetupHint: string;
  quickPickTag: string;
  saveAndGo: string;
  savedReady: string;
  fastestRoute: string;
  avoidBadRoads: string;
  backLabel: string;
  editLabel: string;
  vehiclesTab: string;
  chooseModeTab: string;
  myVehiclesTitle: string;
  addVehicleBtn: string;
  newVehicleTitle: string;
  editVehicleTitle: string;
  vehicleNameLabel: string;
  vehicleNamePlaceholder: string;
  activeBadge: string;
  useVehicleBtn: string;
  deleteLabel: string;
  avoidUnpaved: string;
  vehicleRoutingNote: string;
}

const NL: TranslationBundle = {
  appTitle: 'Best GPS There Is',
  searchPlaceholder: 'Waar wil je heen? (adres, stad, bedrijf...)',
  fromMyLocation: 'Vanaf mijn GPS-locatie',
  modes: {
    pedestrian: 'Te voet',
    bicycle: 'Fiets',
    auto: 'Auto',
    truck: 'Groot / Truck',
  },
  modeSubtitles: {
    pedestrian: 'Voetpaden & oversteek',
    bicycle: 'Fietspaden & veilig',
    auto: 'Snelste autoroute',
    truck: 'Hoogte, gewicht & LZV',
  },
  calculatingRoute: 'Route berekenen...',
  routeReady: 'Route klaar',
  noRouteFound: 'Geen route gevonden tussen deze punten.',
  startNav: 'Start Navigatie',
  simulateDrive: 'Demo Rit',
  stopNav: 'Stop',
  recenter: 'Centreer',
  altRoute: 'Alternatief',
  primaryRoute: 'Aanbevolen',
  stepsTitle: 'Routestappen',
  rerouting: 'Van de route afgeweken — nieuwe route wordt berekend...',
  arrived: 'Bestemming bereikt!',
  offRouteNotice: 'Route herberekend',
  gpsActive: 'GPS actief',
  gpsFallbackNotice: 'Geen GPS-signaal; standaard startlocatie gebruikt (tik op de kaart).',
  tapMapHint: 'Tik ergens op de kaart om een bestemming te kiezen of zoek bovenaan.',
  setDestination: 'Navigeer hierheen',
  setStart: 'Gebruik als startpunt',
  saveFavorite: 'Bewaar favoriet',
  savedPlaces: 'Opgeslagen & Geschiedenis',
  home: 'Thuis',
  work: 'Werk',
  favorites: 'Favorieten',
  recents: 'Recent gezocht',
  setAsHome: 'Instellen als Thuis',
  setAsWork: 'Instellen als Werk',
  clearHistory: 'Geschiedenis wissen',
  vehicleSettings: 'Voertuig & Route-opties',
  truckPresets: 'Kies voertuigtype',
  presetVan: 'Bestelbus (3.5t)',
  presetBox12: 'Bakwagen (12t)',
  presetSemi40: 'Trekker + Oplegger (40t)',
  presetLzv60: 'LZV / Zwaar (60t)',
  presetCamper: 'Camper / Caravan',
  heightM: 'Hoogte (m)',
  widthM: 'Breedte (m)',
  lengthM: 'Lengte (m)',
  weightT: 'Totaal gewicht (ton)',
  axleLoadT: 'Aslast (ton)',
  hazmatAdr: 'Gevaarlijke stoffen (ADR)',
  avoidTolls: 'Tolwegen vermijden',
  avoidHighways: 'Snelwegen vermijden',
  avoidFerries: 'Veerboten vermijden',
  avoidHills: 'Steile hellingen vermijden',
  avoidStairs: 'Trappen vermijden',
  shortestRoute: 'Kortste route (i.p.v. snelste)',
  bikeType: 'Type fiets',
  walkSpeed: 'Loopsnelheid (km/u)',
  truckWarning: 'Let op: volg bij vrachtwagens altijd fysieke hoogte-, breedte- en gewichtsborden langs de weg.',
  longTruckFallbackWarning: 'Lange vrachtwagenroute (>150 km) zonder HERE/ORS-key: extra opletten voor lage bruggen & gewichtsbeperkingen.',
  settingsTitle: 'Talen & Instellingen',
  languageLabel: 'Taal / Language',
  themeLabel: 'Kaartthema',
  dayTheme: 'Dagmodus',
  nightTheme: 'Nachtmodus',
  unitsLabel: 'Eenheden',
  metricUnits: 'Kilometers (km/u)',
  imperialUnits: 'Mijlen (mph)',
  voiceLabel: 'Spraakbegeleiding',
  testVoice: 'Test stem',
  voiceSample: 'Over 200 meter rechtsaf.',
  autoRerouteLabel: 'Automatisch herberekenen',
  proRoutingTitle: 'Optionele Professionele API Keys',
  proRoutingDesc: 'Standaard werkt alles direct gratis via OpenStreetMap/Valhalla. Voor officiële truckdata >150 km kun je een gratis OpenRouteService- of HERE-sleutel invullen.',
  orsKeyLabel: 'OpenRouteService API Key (optioneel)',
  hereKeyLabel: 'HERE Routing v8 API Key (optioneel)',
  valhallaUrlLabel: 'Valhalla Server URL',
  saveSettings: 'Opslaan & Sluiten',
  poiFuel: 'Brandstof / Diesel',
  poiParking: 'Parking / Truckstop',
  poiEv: 'Laadpalen',
  poiBike: 'Fiets & Reparatie',
  poiWater: 'Water & Sanitair',
  poiLoading: 'Plekken laden...',
  poiCount: 'gevonden in de buurt',
  inDistance: 'Over',
  maneuverPhrases: {
    start: 'Vertrek',
    straight: 'Rijd rechtdoor',
    slight_left: 'Houd links aan',
    left: 'Sla linksaf',
    sharp_left: 'Scherp linksaf',
    slight_right: 'Houd rechts aan',
    right: 'Sla rechtsaf',
    sharp_right: 'Scherp rechtsaf',
    uturn: 'Keer om',
    roundabout: 'Neem de rotonde',
    ramp_left: 'Neem de linker afslag',
    ramp_right: 'Neem de rechter afslag',
    ferry: 'Neem de veerboot',
    arrive: 'U bent gearriveerd',
  },
  speedUnit: 'km/u',
  etaLabel: 'Aankomst',
  distanceLabel: 'Afstand',
  providerLabel: 'Engine',
  simSpeed: 'Demosnelheid',
  roadSignsChip: 'Borden',
  signsNearbyLabel: 'Borden op weg',
  truckSignDanger: 'Let op: beperking voor jouw voertuig!',
  speedLimitLabel: 'Max',
  chooseModeTitle: 'Hoe ga je op pad?',
  chooseModeSub: 'Kies snel — je instellingen worden per keuze onthouden.',
  launcherModes: {
    pedestrian: 'Te voet',
    bicycle: 'Met de fiets',
    auto: 'Met de auto',
    truck: 'Met zwaar verkeer',
  },
  quickSetupHint: 'Eenmalig snel kiezen — volgende keer open je dit deel meteen!',
  quickPickTag: 'Snelle keuze',
  saveAndGo: 'Onthoud & Start',
  savedReady: 'Onthouden',
  fastestRoute: 'Snelste route',
  avoidBadRoads: 'Slechte wegen vermijden',
  backLabel: 'Terug',
  editLabel: 'Wijzig',
  vehiclesTab: 'Voertuigen',
  chooseModeTab: 'Kies modus',
  myVehiclesTitle: 'Mijn Voertuigen & Trucks',
  addVehicleBtn: 'Nieuw voertuig',
  newVehicleTitle: 'Nieuw voertuig toevoegen',
  editVehicleTitle: 'Voertuig aanpassen',
  vehicleNameLabel: 'Naam voertuig / truck',
  vehicleNamePlaceholder: 'Bijv. Mijn DAF XF 40t of Bakwagen',
  activeBadge: 'Actief',
  useVehicleBtn: 'Gebruik in navigatie',
  deleteLabel: 'Verwijder',
  avoidUnpaved: 'Onverharde wegen vermijden',
  vehicleRoutingNote: 'Route & verkeersborden (hoogte, breedte, gewicht, aslast, lengte & ADR) houden direct rekening met dit voertuig.',
};

const EN: TranslationBundle = {
  appTitle: 'Best GPS There Is',
  searchPlaceholder: 'Where to? (address, city, company...)',
  fromMyLocation: 'From my GPS location',
  modes: {
    pedestrian: 'Walk',
    bicycle: 'Bicycle',
    auto: 'Car',
    truck: 'Heavy / Truck',
  },
  modeSubtitles: {
    pedestrian: 'Footpaths & crossings',
    bicycle: 'Bike lanes & safe',
    auto: 'Fastest car route',
    truck: 'Height, weight & HGV',
  },
  calculatingRoute: 'Calculating route...',
  routeReady: 'Route ready',
  noRouteFound: 'No route found between these points.',
  startNav: 'Start Navigation',
  simulateDrive: 'Demo Drive',
  stopNav: 'Stop',
  recenter: 'Recenter',
  altRoute: 'Alternative',
  primaryRoute: 'Recommended',
  stepsTitle: 'Turn-by-turn steps',
  rerouting: 'Off route — recalculating...',
  arrived: 'You have arrived!',
  offRouteNotice: 'Route recalculated',
  gpsActive: 'GPS active',
  gpsFallbackNotice: 'No GPS signal; using default start location (tap map to move).',
  tapMapHint: 'Tap anywhere on the map to pick a destination or search above.',
  setDestination: 'Navigate here',
  setStart: 'Set as start',
  saveFavorite: 'Save favorite',
  savedPlaces: 'Saved & History',
  home: 'Home',
  work: 'Work',
  favorites: 'Favorites',
  recents: 'Recent searches',
  setAsHome: 'Set as Home',
  setAsWork: 'Set as Work',
  clearHistory: 'Clear history',
  vehicleSettings: 'Vehicle & Route Options',
  truckPresets: 'Select vehicle preset',
  presetVan: 'Cargo Van (3.5t)',
  presetBox12: 'Box Truck (12t)',
  presetSemi40: 'Semi-Trailer (40t)',
  presetLzv60: 'Heavy / Mega (60t)',
  presetCamper: 'RV / Caravan',
  heightM: 'Height (m)',
  widthM: 'Width (m)',
  lengthM: 'Length (m)',
  weightT: 'Total weight (t)',
  axleLoadT: 'Axle load (t)',
  hazmatAdr: 'Hazardous goods (ADR)',
  avoidTolls: 'Avoid toll roads',
  avoidHighways: 'Avoid highways',
  avoidFerries: 'Avoid ferries',
  avoidHills: 'Avoid steep hills',
  avoidStairs: 'Avoid stairs',
  shortestRoute: 'Shortest route (instead of fastest)',
  bikeType: 'Bicycle type',
  walkSpeed: 'Walking speed (km/h)',
  truckWarning: 'Notice: truck drivers must always obey physical bridge height, width, and weight road signs.',
  longTruckFallbackWarning: 'Long truck route (>150 km) without HERE/ORS key: watch carefully for low bridges & weight limits.',
  settingsTitle: 'Languages & Settings',
  languageLabel: 'Language',
  themeLabel: 'Map theme',
  dayTheme: 'Day mode',
  nightTheme: 'Night mode',
  unitsLabel: 'Units',
  metricUnits: 'Kilometers (km/h)',
  imperialUnits: 'Miles (mph)',
  voiceLabel: 'Voice guidance',
  testVoice: 'Test voice',
  voiceSample: 'In 200 meters, turn right.',
  autoRerouteLabel: 'Automatic rerouting',
  proRoutingTitle: 'Optional Pro Routing API Keys',
  proRoutingDesc: 'Everything works free out of the box via OpenStreetMap/Valhalla. For >150 km HGV or official commercial truck restrictions, optionally add an OpenRouteService or HERE key.',
  orsKeyLabel: 'OpenRouteService API Key (optional)',
  hereKeyLabel: 'HERE Routing v8 API Key (optional)',
  valhallaUrlLabel: 'Valhalla Server URL',
  saveSettings: 'Save & Close',
  poiFuel: 'Fuel / Diesel',
  poiParking: 'Parking / Truck Stop',
  poiEv: 'EV Chargers',
  poiBike: 'Bike & Repair',
  poiWater: 'Water & Restrooms',
  poiLoading: 'Loading places...',
  poiCount: 'found nearby',
  inDistance: 'In',
  maneuverPhrases: {
    start: 'Head out',
    straight: 'Continue straight',
    slight_left: 'Keep left',
    left: 'Turn left',
    sharp_left: 'Turn sharp left',
    slight_right: 'Keep right',
    right: 'Turn right',
    sharp_right: 'Turn sharp right',
    uturn: 'Make a U-turn',
    roundabout: 'Enter roundabout',
    ramp_left: 'Take left ramp',
    ramp_right: 'Take right ramp',
    ferry: 'Board ferry',
    arrive: 'Arrive at destination',
  },
  speedUnit: 'km/h',
  etaLabel: 'Arrival',
  distanceLabel: 'Distance',
  providerLabel: 'Engine',
  simSpeed: 'Demo speed',
  roadSignsChip: 'Signs',
  signsNearbyLabel: 'Road signs nearby',
  truckSignDanger: 'Warning: restriction for your vehicle!',
  speedLimitLabel: 'Max',
  chooseModeTitle: 'How are you traveling?',
  chooseModeSub: 'Pick fast — your choices are remembered per mode.',
  launcherModes: {
    pedestrian: 'On foot',
    bicycle: 'By bicycle',
    auto: 'By car',
    truck: 'Heavy / Truck',
  },
  quickSetupHint: 'Quick one-time setup — next time you open straight into GPS!',
  quickPickTag: 'Quick setup',
  saveAndGo: 'Save & Go',
  savedReady: 'Saved',
  fastestRoute: 'Fastest route',
  avoidBadRoads: 'Avoid bad roads',
  backLabel: 'Back',
  editLabel: 'Edit',
  vehiclesTab: 'Vehicles',
  chooseModeTab: 'Choose mode',
  myVehiclesTitle: 'My Vehicles & Trucks',
  addVehicleBtn: 'Add vehicle',
  newVehicleTitle: 'Add custom vehicle',
  editVehicleTitle: 'Edit vehicle',
  vehicleNameLabel: 'Vehicle / truck name',
  vehicleNamePlaceholder: 'e.g. My DAF XF 40t or Box Truck',
  activeBadge: 'Active',
  useVehicleBtn: 'Use in navigation',
  deleteLabel: 'Delete',
  avoidUnpaved: 'Avoid unpaved roads',
  vehicleRoutingNote: 'Routing & road sign warnings (height, width, weight, axle load, length & ADR) automatically use this vehicle.',
};

const DE: TranslationBundle = {
  ...EN,
  searchPlaceholder: 'Wohin möchtest du? (Adresse, Stadt, Firma...)',
  fromMyLocation: 'Von meinem GPS-Standort',
  modes: {
    pedestrian: 'Zu Fuß',
    bicycle: 'Fahrrad',
    auto: 'Auto',
    truck: 'LKW / Schwer',
  },
  modeSubtitles: {
    pedestrian: 'Fußwege & Zebrastreifen',
    bicycle: 'Radwege & sicher',
    auto: 'Schnellste Autoroute',
    truck: 'Höhe, Gewicht & LKW',
  },
  calculatingRoute: 'Route wird berechnet...',
  routeReady: 'Route bereit',
  noRouteFound: 'Keine Route zwischen diesen Punkten gefunden.',
  startNav: 'Navigation starten',
  simulateDrive: 'Demo-Fahrt',
  stopNav: 'Stopp',
  recenter: 'Zentrieren',
  altRoute: 'Alternative',
  primaryRoute: 'Empfohlen',
  stepsTitle: 'Abbiegehinweise',
  rerouting: 'Route verlassen — wird neu berechnet...',
  arrived: 'Ziel erreicht!',
  offRouteNotice: 'Route neu berechnet',
  gpsActive: 'GPS aktiv',
  setDestination: 'Hierher navigieren',
  setStart: 'Als Start festlegen',
  saveFavorite: 'Favorit speichern',
  savedPlaces: 'Gespeichert & Verlauf',
  home: 'Zuhause',
  work: 'Arbeit',
  favorites: 'Favoriten',
  recents: 'Letzte Suchen',
  setAsHome: 'Als Zuhause setzen',
  setAsWork: 'Als Arbeit setzen',
  clearHistory: 'Verlauf löschen',
  vehicleSettings: 'Fahrzeug & Routenoptionen',
  truckPresets: 'Fahrzeugtyp wählen',
  presetVan: 'Transporter (3,5t)',
  presetBox12: 'Koffer-LKW (12t)',
  presetSemi40: 'Sattelzug (40t)',
  presetLzv60: 'Gigant / Schwer (60t)',
  presetCamper: 'Wohnmobil / Caravan',
  heightM: 'Höhe (m)',
  widthM: 'Breite (m)',
  lengthM: 'Länge (m)',
  weightT: 'Gesamtgewicht (t)',
  axleLoadT: 'Achslast (t)',
  hazmatAdr: 'Gefahrgut (ADR)',
  avoidTolls: 'Mautstraßen meiden',
  avoidHighways: 'Autobahnen meiden',
  avoidFerries: 'Fähren meiden',
  avoidHills: 'Steigungen meiden',
  avoidStairs: 'Treppen meiden',
  shortestRoute: 'Kürzeste Route',
  bikeType: 'Fahrradtyp',
  walkSpeed: 'Gehgeschwindigkeit (km/h)',
  truckWarning: 'Hinweis: LKW-Fahrer müssen immer die örtlichen Höhen-, Breiten- und Gewichtszeichen beachten.',
  settingsTitle: 'Sprache & Einstellungen',
  languageLabel: 'Sprache',
  themeLabel: 'Kartenmodus',
  dayTheme: 'Tagmodus',
  nightTheme: 'Nachtmodus',
  unitsLabel: 'Einheiten',
  voiceLabel: 'Sprachführung',
  testVoice: 'Stimme testen',
  voiceSample: 'In 200 Metern rechts abbiegen.',
  autoRerouteLabel: 'Automatische Neuberechnung',
  saveSettings: 'Speichern & Schließen',
  poiFuel: 'Tanken / Diesel',
  poiParking: 'Parken / Autohof',
  poiEv: 'Ladestationen',
  poiBike: 'Fahrrad & Service',
  poiWater: 'Wasser & WC',
  inDistance: 'In',
  maneuverPhrases: {
    start: 'Losfahren',
    straight: 'Geradeaus weiter',
    slight_left: 'Links halten',
    left: 'Links abbiegen',
    sharp_left: 'Scharf links',
    slight_right: 'Rechts halten',
    right: 'Rechts abbiegen',
    sharp_right: 'Scharf rechts',
    uturn: 'Bitte wenden',
    roundabout: 'In den Kreisverkehr',
    ramp_left: 'Linke Ausfahrt nehmen',
    ramp_right: 'Rechte Ausfahrt nehmen',
    ferry: 'Auf die Fähre fahren',
    arrive: 'Ziel erreicht',
  },
  etaLabel: 'Ankunft',
  distanceLabel: 'Entfernung',
  roadSignsChip: 'Schilder',
  signsNearbyLabel: 'Schilder in der Nähe',
  truckSignDanger: 'Achtung: Beschränkung für dein Fahrzeug!',
  chooseModeTitle: 'Wie bist du unterwegs?',
  chooseModeSub: 'Schnell wählen — wird pro Modus gemerkt.',
  launcherModes: {
    pedestrian: 'Zu Fuß',
    bicycle: 'Mit dem Fahrrad',
    auto: 'Mit dem Auto',
    truck: 'Schwerlast / LKW',
  },
  quickSetupHint: 'Einmal schnell wählen — beim nächsten Mal geht es direkt los!',
  quickPickTag: 'Schnellwahl',
  saveAndGo: 'Merken & Start',
  savedReady: 'Gemerkt',
  fastestRoute: 'Schnellste Route',
  avoidBadRoads: 'Schlechte Wege meiden',
  backLabel: 'Zurück',
  editLabel: 'Ändern',
  vehiclesTab: 'Fahrzeuge',
  chooseModeTab: 'Modus wählen',
  myVehiclesTitle: 'Meine Fahrzeuge & LKW',
  addVehicleBtn: 'Neues Fahrzeug',
  newVehicleTitle: 'Fahrzeug hinzufügen',
  editVehicleTitle: 'Fahrzeug bearbeiten',
  vehicleNameLabel: 'Fahrzeug- / LKW-Name',
  vehicleNamePlaceholder: 'z.B. Mein MAN TGX 40t',
  activeBadge: 'Aktiv',
  useVehicleBtn: 'Für Navigation nutzen',
  deleteLabel: 'Löschen',
  avoidUnpaved: 'Unbefestigte Straßen meiden',
  vehicleRoutingNote: 'Route & Verkehrsschilder (Höhe, Breite, Gewicht, Achslast, Länge & ADR) berücksichtigen dieses Fahrzeug sofort.',
};

const FR: TranslationBundle = {
  ...EN,
  searchPlaceholder: 'Où aller ? (adresse, ville, entreprise...)',
  fromMyLocation: 'Depuis ma position GPS',
  modes: {
    pedestrian: 'À pied',
    bicycle: 'Vélo',
    auto: 'Voiture',
    truck: 'Poids lourd',
  },
  modeSubtitles: {
    pedestrian: 'Sentiers & passages',
    bicycle: 'Pistes cyclables',
    auto: 'Itinéraire voiture rapide',
    truck: 'Hauteur, poids & gabarit',
  },
  calculatingRoute: 'Calcul de l’itinéraire...',
  routeReady: 'Itinéraire prêt',
  noRouteFound: 'Aucun itinéraire trouvé.',
  startNav: 'Démarrer',
  simulateDrive: 'Simulation',
  stopNav: 'Arrêter',
  recenter: 'Centrer',
  altRoute: 'Alternatif',
  primaryRoute: 'Recommandé',
  stepsTitle: 'Étapes',
  rerouting: 'Hors itinéraire — recalcul en cours...',
  arrived: 'Vous êtes arrivé !',
  setDestination: 'Aller ici',
  setStart: 'Définir comme départ',
  saveFavorite: 'Favori',
  savedPlaces: 'Enregistrés & Historique',
  home: 'Domicile',
  work: 'Travail',
  favorites: 'Favoris',
  recents: 'Récents',
  vehicleSettings: 'Véhicule & Options',
  heightM: 'Hauteur (m)',
  widthM: 'Largeur (m)',
  lengthM: 'Longueur (m)',
  weightT: 'Poids total (t)',
  axleLoadT: 'Charge par essieu (t)',
  hazmatAdr: 'Matières dangereuses (ADR)',
  avoidTolls: 'Éviter les péages',
  avoidHighways: 'Éviter les autoroutes',
  avoidFerries: 'Éviter les ferries',
  truckWarning: 'Attention : respectez toujours la signalisation physique de hauteur, largeur et tonnage.',
  settingsTitle: 'Langues & Paramètres',
  languageLabel: 'Langue',
  themeLabel: 'Thème de carte',
  dayTheme: 'Mode jour',
  nightTheme: 'Mode nuit',
  voiceLabel: 'Guidage vocal',
  testVoice: 'Tester la voix',
  voiceSample: 'Dans 200 mètres, tournez à droite.',
  saveSettings: 'Enregistrer',
  inDistance: 'Dans',
  maneuverPhrases: {
    start: 'Départ',
    straight: 'Continuez tout droit',
    slight_left: 'Serrez à gauche',
    left: 'Tournez à gauche',
    sharp_left: 'Tournez fortement à gauche',
    slight_right: 'Serrez à droite',
    right: 'Tournez à droite',
    sharp_right: 'Tournez fortement à droite',
    uturn: 'Faites demi-tour',
    roundabout: 'Prenez le rond-point',
    ramp_left: 'Prenez la bretelle à gauche',
    ramp_right: 'Prenez la bretelle à droite',
    ferry: 'Prenez le ferry',
    arrive: 'Vous êtes arrivé',
  },
  etaLabel: 'Arrivée',
  distanceLabel: 'Distance',
  roadSignsChip: 'Panneaux',
  signsNearbyLabel: 'Panneaux à proximité',
  truckSignDanger: 'Attention : restriction pour votre véhicule !',
  chooseModeTitle: 'Comment voyagez-vous ?',
  chooseModeSub: 'Choix rapide — mémorisé pour la prochaine fois.',
  launcherModes: {
    pedestrian: 'À pied',
    bicycle: 'À vélo',
    auto: 'En voiture',
    truck: 'Poids lourd',
  },
  quickSetupHint: 'Réglage rapide unique — accès direct la prochaine fois !',
  quickPickTag: 'Choix rapide',
  saveAndGo: 'Mémoriser & Go',
  savedReady: 'Mémorisé',
  fastestRoute: 'Itinéraire le plus rapide',
  avoidBadRoads: 'Éviter mauvaises routes',
  backLabel: 'Retour',
  editLabel: 'Modifier',
  vehiclesTab: 'Véhicules',
  chooseModeTab: 'Choisir mode',
  myVehiclesTitle: 'Mes Véhicules & Camions',
  addVehicleBtn: 'Nouveau véhicule',
  newVehicleTitle: 'Ajouter un véhicule',
  editVehicleTitle: 'Modifier le véhicule',
  vehicleNameLabel: 'Nom du véhicule',
  vehicleNamePlaceholder: 'Ex: Mon Scania 40t',
  activeBadge: 'Actif',
  useVehicleBtn: 'Utiliser pour naviguer',
  deleteLabel: 'Supprimer',
  avoidUnpaved: 'Éviter routes non revêtues',
  vehicleRoutingNote: 'L’itinéraire et les alertes panneaux (hauteur, largeur, poids, essieu, longueur, ADR) utilisent ce véhicule.',
};

const ES: TranslationBundle = {
  ...EN,
  searchPlaceholder: '¿A dónde vas? (dirección, ciudad...)',
  fromMyLocation: 'Desde mi ubicación GPS',
  modes: {
    pedestrian: 'A pie',
    bicycle: 'Bicicleta',
    auto: 'Coche',
    truck: 'Camión / Pesado',
  },
  modeSubtitles: {
    pedestrian: 'Senderos y pasos',
    bicycle: 'Carriles bici',
    auto: 'Ruta rápida en coche',
    truck: 'Altura, peso y ancho',
  },
  calculatingRoute: 'Calculando ruta...',
  startNav: 'Iniciar navegación',
  simulateDrive: 'Simular ruta',
  stopNav: 'Parar',
  recenter: 'Centrar',
  arrived: '¡Has llegado!',
  setDestination: 'Ir aquí',
  vehicleSettings: 'Vehículo y opciones',
  heightM: 'Altura (m)',
  widthM: 'Ancho (m)',
  lengthM: 'Longitud (m)',
  weightT: 'Peso total (t)',
  axleLoadT: 'Carga por eje (t)',
  hazmatAdr: 'Mercancías peligrosas (ADR)',
  settingsTitle: 'Idiomas y ajustes',
  languageLabel: 'Idioma',
  dayTheme: 'Modo día',
  nightTheme: 'Modo noche',
  voiceLabel: 'Voz de navegación',
  testVoice: 'Probar voz',
  voiceSample: 'En 200 metros, gira a la derecha.',
  saveSettings: 'Guardar',
  inDistance: 'En',
  maneuverPhrases: {
    start: 'Salir',
    straight: 'Sigue recto',
    slight_left: 'Mantente a la izquierda',
    left: 'Gira a la izquierda',
    sharp_left: 'Giro cerrado a la izquierda',
    slight_right: 'Mantente a la derecha',
    right: 'Gira a la derecha',
    sharp_right: 'Giro cerrado a la derecha',
    uturn: 'Haz un cambio de sentido',
    roundabout: 'Entra en la rotonda',
    ramp_left: 'Salida a la izquierda',
    ramp_right: 'Salida a la derecha',
    ferry: 'Toma el ferry',
    arrive: 'Destino alcanzado',
  },
  etaLabel: 'Llegada',
  distanceLabel: 'Distancia',
  roadSignsChip: 'Señales',
  signsNearbyLabel: 'Señales cercanas',
  truckSignDanger: '¡Atención: restricción para tu vehículo!',
  chooseModeTitle: '¿Cómo te desplazas?',
  chooseModeSub: 'Elige rápido — se guarda para la próxima vez.',
  launcherModes: {
    pedestrian: 'A pie',
    bicycle: 'En bicicleta',
    auto: 'En coche',
    truck: 'Vehículo pesado',
  },
  quickSetupHint: 'Ajuste rápido una sola vez — ¡luego entras directo!',
  quickPickTag: 'Ajuste rápido',
  saveAndGo: 'Guardar e ir',
  savedReady: 'Guardado',
  fastestRoute: 'Ruta más rápida',
  avoidBadRoads: 'Evitar malos caminos',
  backLabel: 'Atrás',
  editLabel: 'Editar',
  vehiclesTab: 'Vehículos',
  chooseModeTab: 'Elegir modo',
  myVehiclesTitle: 'Mis Vehículos y Camiones',
  addVehicleBtn: 'Nuevo vehículo',
  newVehicleTitle: 'Añadir vehículo',
  editVehicleTitle: 'Editar vehículo',
  vehicleNameLabel: 'Nombre del vehículo',
  vehicleNamePlaceholder: 'Ej. Mi camión 40t',
  activeBadge: 'Activo',
  useVehicleBtn: 'Usar en navegación',
  deleteLabel: 'Eliminar',
  avoidUnpaved: 'Evitar vías sin asfaltar',
  vehicleRoutingNote: 'La ruta y las alertas de señales (altura, ancho, peso, eje, longitud y ADR) usan este vehículo.',
};

const PL: TranslationBundle = {
  ...EN,
  searchPlaceholder: 'Dokąd jedziesz? (adres, miasto...)',
  fromMyLocation: 'Z mojej pozycji GPS',
  modes: {
    pedestrian: 'Pieszo',
    bicycle: 'Rower',
    auto: 'Auto',
    truck: 'Ciężarówka / TIR',
  },
  modeSubtitles: {
    pedestrian: 'Chodniki i ścieżki',
    bicycle: 'Ścieżki rowerowe',
    auto: 'Szybka trasa autem',
    truck: 'Wysokość, tonaż, ADR',
  },
  calculatingRoute: 'Wyznaczanie trasy...',
  startNav: 'Rozpocznij nawigację',
  simulateDrive: 'Symulacja',
  stopNav: 'Stop',
  recenter: 'Wyśrodkuj',
  arrived: 'Dotarłeś do celu!',
  setDestination: 'Nawiguj tutaj',
  vehicleSettings: 'Pojazd i opcje trasy',
  heightM: 'Wysokość (m)',
  widthM: 'Szerokość (m)',
  lengthM: 'Długość (m)',
  weightT: 'Masa całkowita (t)',
  axleLoadT: 'Nacisk na oś (t)',
  hazmatAdr: 'Towary niebezpieczne (ADR)',
  settingsTitle: 'Język i ustawienia',
  languageLabel: 'Język',
  voiceLabel: 'Nawigacja głosowa',
  testVoice: 'Test głosu',
  voiceSample: 'Za 200 metrów skręć w prawo.',
  saveSettings: 'Zapisz',
  inDistance: 'Za',
  maneuverPhrases: {
    start: 'Ruszaj',
    straight: 'Jedź prosto',
    slight_left: 'Trzymaj się lewej',
    left: 'Skręć w lewo',
    sharp_left: 'Ostro w lewo',
    slight_right: 'Trzymaj się prawej',
    right: 'Skręć w prawo',
    sharp_right: 'Ostro w prawo',
    uturn: 'Zawróć',
    roundabout: 'Wjedź na rondo',
    ramp_left: 'Zjazd w lewo',
    ramp_right: 'Zjazd w prawo',
    ferry: 'Wjedź na prom',
    arrive: 'Jesteś u celu',
  },
  etaLabel: 'Przyjazd',
  distanceLabel: 'Dystans',
  roadSignsChip: 'Znaki',
  signsNearbyLabel: 'Znaki w pobliżu',
  truckSignDanger: 'Uwaga: ograniczenie dla Twojego pojazdu!',
  chooseModeTitle: 'Jak podróżujesz?',
  chooseModeSub: 'Wybierz szybko — aplikacja zapamięta ustawienia.',
  launcherModes: {
    pedestrian: 'Pieszo',
    bicycle: 'Rowerem',
    auto: 'Samochodem',
    truck: 'Ciężki / TIR',
  },
  quickSetupHint: 'Jednorazowy szybki wybór — następnym razem wejdziesz od razu!',
  quickPickTag: 'Szybki wybór',
  saveAndGo: 'Zapamiętaj i start',
  savedReady: 'Zapamiętane',
  fastestRoute: 'Najszybsza trasa',
  avoidBadRoads: 'Omijaj złe drogi',
  backLabel: 'Wstecz',
  editLabel: 'Zmień',
  vehiclesTab: 'Pojazdy',
  chooseModeTab: 'Wybierz tryb',
  myVehiclesTitle: 'Moje Pojazdy i Ciężarówki',
  addVehicleBtn: 'Nowy pojazd',
  newVehicleTitle: 'Dodaj pojazd',
  editVehicleTitle: 'Edytuj pojazd',
  vehicleNameLabel: 'Nazwa pojazdu / TIR',
  vehicleNamePlaceholder: 'Np. Mój DAF 40t',
  activeBadge: 'Aktywny',
  useVehicleBtn: 'Użyj w nawigacji',
  deleteLabel: 'Usuń',
  avoidUnpaved: 'Omijaj drogi nieutwardzone',
  vehicleRoutingNote: 'Trasa i ostrzeżenia o znakach (wysokość, szerokość, tonaż, oś, długość, ADR) używają tego pojazdu.',
};

const TR: TranslationBundle = {
  ...EN,
  searchPlaceholder: 'Nereye gidiyorsun? (adres, şehir...)',
  fromMyLocation: 'GPS konumumdan',
  modes: {
    pedestrian: 'Yürüyerek',
    bicycle: 'Bisiklet',
    auto: 'Araba',
    truck: 'Tır / Ağır Vasıta',
  },
  modeSubtitles: {
    pedestrian: 'Yaya yolları',
    bicycle: 'Bisiklet yolları',
    auto: 'Hızlı araba rotası',
    truck: 'Yükseklik, ağırlık, ADR',
  },
  calculatingRoute: 'Rota hesaplanıyor...',
  startNav: 'Navigasyonu Başlat',
  simulateDrive: 'Demo Sürüş',
  stopNav: 'Durdur',
  recenter: 'Ortala',
  arrived: 'Hedefe ulaştınız!',
  setDestination: 'Buraya git',
  vehicleSettings: 'Araç ve Rota Ayarları',
  heightM: 'Yükseklik (m)',
  widthM: 'Genişlik (m)',
  lengthM: 'Uzunluk (m)',
  weightT: 'Toplam ağırlık (t)',
  axleLoadT: 'Aks yükü (t)',
  hazmatAdr: 'Tehlikeli madde (ADR)',
  settingsTitle: 'Dil ve Ayarlar',
  languageLabel: 'Dil',
  voiceLabel: 'Sesli yönlendirme',
  testVoice: 'Sesi test et',
  voiceSample: '200 metre sonra sağa dönün.',
  saveSettings: 'Kaydet',
  inDistance: 'Sonra:',
  maneuverPhrases: {
    start: 'Yola çıkın',
    straight: 'Düz devam edin',
    slight_left: 'Soldan devam edin',
    left: 'Sola dönün',
    sharp_left: 'Keskin sola dönün',
    slight_right: 'Sağdan devam edin',
    right: 'Sağa dönün',
    sharp_right: 'Keskin sağa dönün',
    uturn: 'U dönüşü yapın',
    roundabout: 'Döner kavşağa girin',
    ramp_left: 'Sol çıkışa girin',
    ramp_right: 'Sağ çıkışa girin',
    ferry: 'Feribota binin',
    arrive: 'Hedefe ulaştınız',
  },
  etaLabel: 'Varış',
  distanceLabel: 'Mesafe',
  roadSignsChip: 'Tabelalar',
  signsNearbyLabel: 'Yakındaki tabelalar',
  truckSignDanger: 'Dikkat: aracınız için kısıtlama!',
  chooseModeTitle: 'Nasıl yola çıkıyorsun?',
  chooseModeSub: 'Hızlıca seç — ayarların her mod için hatırlanır.',
  launcherModes: {
    pedestrian: 'Yürüyerek',
    bicycle: 'Bisikletle',
    auto: 'Arabayla',
    truck: 'Ağır Vasıta',
  },
  quickSetupHint: 'Tek seferlik hızlı seçim — bir dahaki sefere doğrudan açılır!',
  quickPickTag: 'Hızlı seçim',
  saveAndGo: 'Kaydet ve Başlat',
  savedReady: 'Hatırlandı',
  fastestRoute: 'En hızlı rota',
  avoidBadRoads: 'Kötü yollardan kaçın',
  backLabel: 'Geri',
  editLabel: 'Düzenle',
  vehiclesTab: 'Araçlar',
  chooseModeTab: 'Mod seç',
  myVehiclesTitle: 'Araçlarım ve Tırlarım',
  addVehicleBtn: 'Yeni araç',
  newVehicleTitle: 'Yeni araç ekle',
  editVehicleTitle: 'Aracı düzenle',
  vehicleNameLabel: 'Araç / Tır adı',
  vehicleNamePlaceholder: 'Örn. Benim 40t Tırım',
  activeBadge: 'Aktif',
  useVehicleBtn: 'Navigasyonda kullan',
  deleteLabel: 'Sil',
  avoidUnpaved: 'Toprak yollardan kaçın',
  vehicleRoutingNote: 'Rota ve tabela uyarıları (yükseklik, genişlik, ağırlık, aks, uzunluk ve ADR) bu aracı doğrudan dikkate alır.',
};

const DICTIONARIES: Record<LanguageCode, TranslationBundle> = { nl: NL, en: EN, de: DE, fr: FR, es: ES, pl: PL, tr: TR };

export function detectInitialLanguage(): LanguageCode {
  const raw = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
  if (raw === 'nl' || raw === 'de' || raw === 'fr' || raw === 'es' || raw === 'pl' || raw === 'tr') {
    return raw;
  }
  return 'en';
}

export function t(lang: LanguageCode): TranslationBundle {
  return DICTIONARIES[lang] ?? EN;
}

export function getLangMeta(lang: LanguageCode): LanguageMeta {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang) ?? SUPPORTED_LANGUAGES[0];
}
