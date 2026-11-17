import { PoiFilterKind } from './geocoding';
import { LanguageCode, TransportMode } from '../types/navigation';

export interface AssistantReplyTemplates {
  muted: string;
  unmuted: string;
  greeting: string;
  thanks: string;
  help: string;
  noActiveRoute: string;
  eta: (duration: string, distance: string, etaTime: string) => string;
  nextTurn: (dist: string, instruction: string) => string;
  repeatNone: string;
  speed: (speed: number, unit: string, limit: number | null, dangerTitle: string | null) => string;
  whereAmI: (place: string) => string;
  poiFound: (count: number, kindLabel: string, closestName?: string, closestDist?: string) => string;
  poiNotFound: (kindLabel: string) => string;
  noSavedHome: string;
  noSavedWork: string;
  navigatingTo: (name: string) => string;
  placeNotFound: (query: string) => string;
  startNavOk: string;
  startNavNeedRoute: string;
  stopNavOk: string;
  recenterOk: string;
  modeChanged: (modeLabel: string) => string;
  themeDay: string;
  themeNight: string;
  radioOn: string;
  radioOff: string;
  radioNext: (stationName?: string) => string;
  radioPlaying: (track: string, station: string) => string;
  radioNothingPlaying: string;
  unknown: (raw: string) => string;
  poiNames: Record<PoiFilterKind, string>;
  modeNames: Record<TransportMode, string>;
}

const NL_REPLIES: AssistantReplyTemplates = {
  muted: 'Oké, ik zwijg even. Zeg praat weer als je me weer nodig hebt.',
  unmuted: 'Ik ben er weer! Spraakbegeleiding staat weer aan.',
  greeting: 'Hallo! Road Mapper luistert. Zeg bijvoorbeeld hoelang nog, zoek diesel, radio aan, of zwijg even.',
  thanks: 'Graag gedaan! Rustige rit verder.',
  help: 'Je kunt zeggen: zwijg even, praat weer, radio aan, radio uit, volgend nummer, hoelang nog, hoe snel rijd ik, waar ben ik, of navigeer naar Antwerpen.',
  noActiveRoute: 'Er is nog geen actieve route. Zeg bijvoorbeeld navigeer naar Brussel, of tik op de kaart.',
  eta: (duration, distance, etaTime) => `Nog ${duration}, dat is ${distance}. Je komt rond ${etaTime} aan.`,
  nextTurn: (dist, instruction) => `Over ${dist}, ${instruction}.`,
  repeatNone: 'Er is nog geen route-instructie om te herhalen.',
  speed: (speed, unit, limit, dangerTitle) => {
    const parts = [`Je rijdt nu ${speed} ${unit}`];
    if (limit !== null) {
      parts.push(`hier mag je maximaal ${limit}`);
    }
    if (dangerTitle) {
      parts.push(`let op, verderop: ${dangerTitle}`);
    }
    return `${parts.join(', ')}.`;
  },
  whereAmI: (place) => `Je bent nu bij ${place}.`,
  poiFound: (count, kindLabel, closestName, closestDist) =>
    closestName && closestDist
      ? `Ik heb ${count} opties voor ${kindLabel} gevonden. De dichtste is ${closestName}, op ${closestDist}.`
      : `Ik heb ${count} opties voor ${kindLabel} op de kaart gezet.`,
  poiNotFound: (kindLabel) => `Ik kon geen ${kindLabel} vinden in de buurt.`,
  noSavedHome: 'Er is nog geen thuisadres ingesteld. Open favorieten om Thuis op te slaan.',
  noSavedWork: 'Er is nog geen werkadres ingesteld. Open favorieten om Werk op te slaan.',
  navigatingTo: (name) => `Route naar ${name} wordt gestart.`,
  placeNotFound: (query) => `Ik kon geen locatie vinden voor ${query}.`,
  startNavOk: 'Navigatie wordt gestart.',
  startNavNeedRoute: 'Kies eerst een bestemming voordat we starten.',
  stopNavOk: 'Oké, navigatie is gestopt.',
  recenterOk: 'Kaart staat weer op jouw locatie.',
  modeChanged: (modeLabel) => `Modus gewijzigd naar ${modeLabel}.`,
  themeDay: 'Dagmodus ingeschakeld.',
  themeNight: 'Nachtmodus ingeschakeld.',
  radioOn: 'Non-stop muziekradio wordt gestart. Ik zoek direct muziek zonder praat.',
  radioOff: 'Radio staat uit.',
  radioNext: (stationName) => (stationName ? `Overgeschakeld naar muziek op ${stationName}.` : 'Op zoek naar het volgende muzieknummer.'),
  radioPlaying: (track, station) => (track ? `Je luistert naar ${track}, via ${station}.` : `Je luistert naar muziek op ${station}.`),
  radioNothingPlaying: 'De radio staat momenteel uit. Zeg radio aan om te starten.',
  unknown: (raw) => `Ik verstond ${raw}, maar ken dat commando niet. Zeg wat kan ik zeggen voor voorbeelden.`,
  poiNames: {
    fuel: 'tanken',
    parking: 'parking',
    ev: 'laadpalen',
    bike: 'fietsenmaker',
    water: 'water of sanitair',
  },
  modeNames: {
    pedestrian: 'te voet',
    bicycle: 'de fiets',
    auto: 'de auto',
    truck: 'vrachtwagen',
  },
};

const EN_REPLIES: AssistantReplyTemplates = {
  muted: 'Okay, going quiet for now. Say talk to me whenever you need guidance again.',
  unmuted: 'I am back! Voice guidance is enabled again.',
  greeting: 'Hello! Road Mapper is listening. Try asking how long left, radio on, find fuel, or be quiet.',
  thanks: 'You are welcome! Have a safe drive.',
  help: 'You can say: be quiet, speak again, radio on, next song, how long left, how fast am I going, where am I, or navigate to London.',
  noActiveRoute: 'There is no active route yet. Say navigate to a city, or tap on the map.',
  eta: (duration, distance, etaTime) => `About ${duration} remaining, ${distance} to go. Estimated arrival at ${etaTime}.`,
  nextTurn: (dist, instruction) => `In ${dist}, ${instruction}.`,
  repeatNone: 'There is no previous turn instruction to repeat yet.',
  speed: (speed, unit, limit, dangerTitle) => {
    const parts = [`You are going ${speed} ${unit}`];
    if (limit !== null) parts.push(`the speed limit here is ${limit}`);
    if (dangerTitle) parts.push(`watch out ahead for ${dangerTitle}`);
    return `${parts.join(', ')}.`;
  },
  whereAmI: (place) => `You are currently near ${place}.`,
  poiFound: (count, kindLabel, closestName, closestDist) =>
    closestName && closestDist
      ? `Found ${count} ${kindLabel} spots nearby. Closest is ${closestName}, ${closestDist} away.`
      : `Found ${count} ${kindLabel} places on your map.`,
  poiNotFound: (kindLabel) => `Sorry, I could not find any ${kindLabel} nearby.`,
  noSavedHome: 'No home address saved yet. Open Favorites to set Home.',
  noSavedWork: 'No work address saved yet. Open Favorites to set Work.',
  navigatingTo: (name) => `Setting route to ${name}.`,
  placeNotFound: (query) => `I could not find a place matching ${query}.`,
  startNavOk: 'Starting navigation now.',
  startNavNeedRoute: 'Pick a destination first before starting navigation.',
  stopNavOk: 'Navigation stopped.',
  recenterOk: 'Map recentered on your location.',
  modeChanged: (modeLabel) => `Switched mode to ${modeLabel}.`,
  themeDay: 'Day mode enabled.',
  themeNight: 'Night mode enabled.',
  radioOn: 'Starting non-stop music radio across nearby stations.',
  radioOff: 'Radio turned off.',
  radioNext: (stationName) => (stationName ? `Switched to fresh music on ${stationName}.` : 'Finding the next song.'),
  radioPlaying: (track, station) => (track ? `Now playing ${track}, on ${station}.` : `Listening to music on ${station}.`),
  radioNothingPlaying: 'The radio is currently off. Say radio on to start.',
  unknown: (raw) => `I heard ${raw}, but did not recognize that command. Say help for examples.`,
  poiNames: {
    fuel: 'fuel',
    parking: 'parking',
    ev: 'EV charging',
    bike: 'bike repair',
    water: 'water or restrooms',
  },
  modeNames: {
    pedestrian: 'walking',
    bicycle: 'bicycle',
    auto: 'car',
    truck: 'truck',
  },
};

const DE_REPLIES: AssistantReplyTemplates = {
  ...EN_REPLIES,
  muted: 'Okay, ich bin still. Sag sprich wieder, wenn du mich wieder brauchst.',
  unmuted: 'Ich bin wieder da! Die Sprachführung ist wieder aktiv.',
  greeting: 'Hallo! Road Mapper hört zu. Frag zum Beispiel wie lange noch, Radio an, tanken suchen, oder sei still.',
  thanks: 'Gern geschehen! Gute Fahrt weiterhin.',
  help: 'Du kannst sagen: sei still, sprich wieder, Radio an, nächstes Lied, wie lange noch, wie schnell, wo bin ich, oder navigiere nach Berlin.',
  noActiveRoute: 'Es ist noch keine Route aktiv.',
  eta: (duration, distance, etaTime) => `Noch ${duration}, das sind ${distance}. Ankunft gegen ${etaTime}.`,
  nextTurn: (dist, instruction) => `In ${dist}, ${instruction}.`,
  repeatNone: 'Keine vorherige Anweisung vorhanden.',
  speed: (speed, unit, limit, dangerTitle) =>
    `Du fährst ${speed} ${unit}${limit !== null ? `, Tempolimit ${limit}` : ''}${dangerTitle ? `, Achtung: ${dangerTitle}` : ''}.`,
  whereAmI: (place) => `Du befindest dich bei ${place}.`,
  poiFound: (count, kindLabel, closestName, closestDist) =>
    closestName && closestDist
      ? `${count} Treffer für ${kindLabel}. Am nächsten ist ${closestName} in ${closestDist}.`
      : `${count} Treffer für ${kindLabel} auf der Karte.`,
  poiNotFound: (kindLabel) => `Keine Treffer für ${kindLabel} in der Nähe.`,
  navigatingTo: (name) => `Route nach ${name} wird gestartet.`,
  stopNavOk: 'Navigation gestoppt.',
  recenterOk: 'Karte auf deinen Standort zentriert.',
  modeChanged: (modeLabel) => `Modus gewechselt zu ${modeLabel}.`,
  themeDay: 'Tagmodus aktiviert.',
  themeNight: 'Nachtmodus aktiviert.',
  radioOn: 'Non-Stop Musikradio startet.',
  radioOff: 'Radio ausgeschaltet.',
  radioNext: (stationName) => (stationName ? `Wechsle zu Musik auf ${stationName}.` : 'Suche nächstes Lied.'),
  radioPlaying: (track, station) => (track ? `Es läuft ${track} auf ${station}.` : `Musik läuft auf ${station}.`),
  radioNothingPlaying: 'Das Radio ist aus.',
  poiNames: {
    fuel: 'Tankstellen',
    parking: 'Parkplätze',
    ev: 'Ladestationen',
    bike: 'Fahrradservice',
    water: 'Wasser oder WC',
  },
  modeNames: {
    pedestrian: 'Zu Fuß',
    bicycle: 'Fahrrad',
    auto: 'Auto',
    truck: 'LKW',
  },
};

const FR_REPLIES: AssistantReplyTemplates = {
  ...EN_REPLIES,
  muted: 'D’accord, je me tais pour le moment. Dites parle encore quand vous voulez.',
  unmuted: 'Me revoilà ! Le guidage vocal est réactivé.',
  greeting: 'Bonjour ! Road Mapper vous écoute.',
  thanks: 'Avec plaisir ! Bonne route.',
  eta: (duration, distance, etaTime) => `Il reste ${duration} et ${distance}. Arrivée vers ${etaTime}.`,
  nextTurn: (dist, instruction) => `Dans ${dist}, ${instruction}.`,
  whereAmI: (place) => `Vous êtes près de ${place}.`,
  navigatingTo: (name) => `Itinéraire vers ${name} en cours.`,
  stopNavOk: 'Navigation arrêtée.',
  modeChanged: (modeLabel) => `Mode réglé sur ${modeLabel}.`,
  themeDay: 'Mode jour activé.',
  themeNight: 'Mode nuit activé.',
};

const ES_REPLIES: AssistantReplyTemplates = {
  ...EN_REPLIES,
  muted: 'Vale, me callo un momento. Di habla otra vez cuando me necesites.',
  unmuted: '¡Ya volví! Guía por voz activada.',
  greeting: '¡Hola! Road Mapper te escucha.',
  thanks: '¡De nada! Buen viaje.',
  eta: (duration, distance, etaTime) => `Faltan ${duration} y ${distance}. Llegada sobre las ${etaTime}.`,
  nextTurn: (dist, instruction) => `En ${dist}, ${instruction}.`,
  whereAmI: (place) => `Estás cerca de ${place}.`,
  navigatingTo: (name) => `Iniciando ruta hacia ${name}.`,
  stopNavOk: 'Navegación detenida.',
  modeChanged: (modeLabel) => `Modo cambiado a ${modeLabel}.`,
  themeDay: 'Modo día activado.',
  themeNight: 'Modo noche activado.',
};

const PL_REPLIES: AssistantReplyTemplates = {
  ...EN_REPLIES,
  muted: 'Dobrze, już milczę. Powiedz mów znowu, gdy mnie będziesz potrzebować.',
  unmuted: 'Wracam! Nawigacja głosowa znów włączona.',
  greeting: 'Cześć! Road Mapper słucha.',
  thanks: 'Proszę bardzo! Szerokiej drogi.',
  eta: (duration, distance, etaTime) => `Pozostało ${duration}, czyli ${distance}. Przyjazd około ${etaTime}.`,
  nextTurn: (dist, instruction) => `Za ${dist}, ${instruction}.`,
  whereAmI: (place) => `Jesteś w pobliżu ${place}.`,
  navigatingTo: (name) => `Ustawiam trasę do ${name}.`,
  stopNavOk: 'Nawigacja zatrzymana.',
  modeChanged: (modeLabel) => `Zmieniono tryb na ${modeLabel}.`,
};

const TR_REPLIES: AssistantReplyTemplates = {
  ...EN_REPLIES,
  muted: 'Tamam, şimdilik susuyorum. Tekrar konuş dediğinde dönerim.',
  unmuted: 'Geri döndüm! Sesli yönlendirme tekrar açık.',
  greeting: 'Merhaba! Road Mapper sizi dinliyor.',
  thanks: 'Rica ederim! İyi yolculuklar.',
  eta: (duration, distance, etaTime) => `Yaklaşık ${duration} ve ${distance} kaldı. Tahmini varış ${etaTime}.`,
  nextTurn: (dist, instruction) => `${dist} sonra, ${instruction}.`,
  whereAmI: (place) => `Şu anda ${place} yakınındasınız.`,
  navigatingTo: (name) => `${name} için rota başlatılıyor.`,
  stopNavOk: 'Navigasyon durduruldu.',
  modeChanged: (modeLabel) => `Mod ${modeLabel} olarak değiştirildi.`,
};

const REPLIES_BY_LANG: Record<LanguageCode, AssistantReplyTemplates> = {
  nl: NL_REPLIES,
  en: EN_REPLIES,
  de: DE_REPLIES,
  fr: FR_REPLIES,
  es: ES_REPLIES,
  pl: PL_REPLIES,
  tr: TR_REPLIES,
};

export function assistantReplies(lang: LanguageCode): AssistantReplyTemplates {
  return REPLIES_BY_LANG[lang] ?? EN_REPLIES;
}
