import { digest, emptyHome, https, id, invalid, list, normalize, text, type HomeContent } from './domain.ts';

// Retain saved and wire values for older editors. Rendering uses only frame dimensions.
const legacySizes = ['compact', 'expanded'] as const;
export const cardSpans = [4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const cardColumns = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const cardHeights = [0, ...Array.from({length:39}, (_, index) => 96 + index * 16)];
const alignments = ['left', 'center', 'right'] as const;
const avatarSizes = ['small', 'medium', 'large'] as const;
const avatarPositions = ['edge', 'banner-center'] as const;
const promoCategories = ['Giveaway', 'Support', 'Merch', 'Sponsor', 'Community'] as const;

type LegacySize = typeof legacySizes[number];
type CardSpan = typeof cardSpans[number];
type CardDimensions = { span: CardSpan; minHeight: number; column?: typeof cardColumns[number] };
type CardSettings = CardDimensions & { id: string; size: LegacySize };
type StoredSettings<T extends CardSettings> = Omit<T, keyof CardDimensions> & Partial<CardDimensions> & { width?: 'half' | 'full' };
type IdentitySettings = CardSettings & {
  alignment: typeof alignments[number]; avatarSize: typeof avatarSizes[number];
  avatarPosition: typeof avatarPositions[number]; focalX: number; focalY: number;
};
type ScheduleSettings = CardSettings & { family: 'schedule'; hidden: boolean };
type PromoCard = CardSettings & {
  family: 'promo'; hidden: boolean; category: typeof promoCategories[number]; title: string; url: string; description: string;
};
export type HomeLayout = {
  identity: IdentitySettings;
  spotlight: CardSettings;
  dock: CardSettings;
  dockPosition: number;
  supporting: (ScheduleSettings | PromoCard)[];
};

// Keep the established editor and service field names at the API boundary.
export type EditableHome = HomeContent & { layout: HomeLayout };
type IdentityContent = Pick<HomeContent, 'displayName' | 'intro' | 'game' | 'avatarId' | 'coverId'>;
export type CardHome = {
  schemaVersion: 2;
  skin: HomeContent['theme'];
  identity: StoredSettings<IdentitySettings> & IdentityContent;
  spotlight: StoredSettings<CardSettings> & { url: string };
  dock: StoredSettings<CardSettings> & { links: HomeContent['links'] };
  dockPosition?: number;
  supporting: ((StoredSettings<ScheduleSettings> & Pick<HomeContent, 'sessions' | 'scheduleRemoval'>) | StoredSettings<PromoCard>)[];
  updates: HomeContent['updates'];
};
export type StoredHome = HomeContent | CardHome;

function fixedId(homeId: string, role: string) {
  const hash = digest('linbio:home-card:' + homeId + ':' + role);
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');
}

export function defaultLayout(homeId: string): HomeLayout {
  const fixed = (role: string):CardSettings => ({ id: fixedId(homeId, role), size: 'compact', span: 12, minHeight: 0 });
  return {
    identity: { ...fixed('identity'), alignment: 'left', avatarSize: 'medium', avatarPosition: 'edge', focalX: 50, focalY: 50 },
    spotlight: fixed('spotlight'),
    dock: fixed('dock'),
    dockPosition: 0,
    supporting: [{ ...fixed('schedule'), family: 'schedule', hidden: false }],
  };
}

export function readHome(value: StoredHome, homeId: string): EditableHome {
  if (value.schemaVersion !== 2) return { ...value, layout: defaultLayout(homeId) };

  const { displayName, intro, game, avatarId, coverId, ...identity } = value.identity;
  const { url, ...spotlight } = value.spotlight;
  const { links, ...dock } = value.dock;
  const schedule = value.supporting.find(card => card.family === 'schedule');
  const supporting = value.supporting.map((card):ScheduleSettings | PromoCard => {
    if (card.family === 'promo') return readDimensions(card);
    return readDimensions({family: card.family, id: card.id, size: card.size, hidden: card.hidden,
      span:card.span, minHeight:card.minHeight, width:card.width, column:card.column});
  });
  return {
    schemaVersion: 1, displayName, intro, game, avatarId, coverId, theme: value.skin,
    streamUrl: url, links, sessions: schedule?.sessions ?? [], scheduleRemoval: schedule?.scheduleRemoval,
    updates: value.updates, layout: {
      identity: readDimensions(identity),
      spotlight: readDimensions(spotlight),
      dock: readDimensions(dock),
      dockPosition: value.dockPosition ?? 0, supporting,
    },
  };
}

function readDimensions<T extends { width?: 'half' | 'full'; span?: CardSpan; minHeight?: number }>(card:T) {
  const { width, ...settings } = card;
  return { ...settings, span: card.span ?? (width==='half'?6:12), minHeight: card.minHeight ?? 0 };
}

export function writeHome(value: EditableHome): CardHome {
  const { displayName, intro, game, avatarId, coverId, streamUrl, links, sessions, scheduleRemoval, updates, theme, layout } = value;
  return {
    schemaVersion: 2, skin: theme,
    identity: { ...layout.identity, displayName, intro, game, avatarId, coverId },
    spotlight: { ...layout.spotlight, url: streamUrl },
    dock: { ...layout.dock, links },
    dockPosition: layout.dockPosition,
    supporting: layout.supporting.map(card => card.family === 'schedule' ? { ...card, sessions, scheduleRemoval } : card),
    updates,
  };
}

export function newHome(homeId: string) {
  return writeHome(readHome(emptyHome, homeId));
}

function choice<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw invalid(field, 'Choose a supported option.');
  return value as T[number];
}

function focal(value: unknown, field: string) {
  if (typeof value !== 'number' || ![0, 25, 50, 75, 100].includes(value)) {
    throw invalid(field, 'Choose a supported focal point.');
  }
  return value;
}

function settings(value: any, expected: CardSettings, field: string): CardSettings {
  if (value?.id !== expected.id) throw invalid(field, 'Keep the existing card ID.');
  return {
    id: expected.id,
    size: choice(value.size, legacySizes, field),
    ...normalizeDimensions(value, expected, field),
  };
}

function normalizeDimensions(value:any, previous:CardDimensions|undefined, field:string):CardDimensions {
  let span=value.span;
  if(span===undefined&&value.width!==undefined) span=choice(value.width,['full','half'],field)==='half'?6:12;
  span??=previous?.span??12;
  const minHeight=value.minHeight===undefined?previous?.minHeight??0:value.minHeight;
  if(value.span===null||!cardSpans.includes(span)||!cardHeights.includes(minHeight)) {
    throw invalid(field, 'Choose a valid card width and minimum height.');
  }
  const column=value.column;
  if(column!==undefined&&!cardColumns.includes(column)) throw invalid(field, 'Choose a valid card column.');
  return column===undefined?{span,minHeight}:{span,minHeight,column};
}

export function normalizeHome(value: any, old: EditableHome, now: number, preview = false): EditableHome {
  const content = normalize(value, old, now, preview);
  const input = value.layout === undefined ? old.layout : value.layout;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['identity', 'spotlight', 'dock', 'dockPosition', 'supporting'].includes(key))) {
    throw invalid('layout', 'Use the Home card layout.');
  }
  const identity = {
    ...settings(input.identity, old.layout.identity, 'identity-size'),
    alignment: choice(input.identity.alignment, alignments, 'identity-alignment'),
    avatarSize: choice(input.identity.avatarSize, avatarSizes, 'avatar-size'),
    avatarPosition: choice(input.identity.avatarPosition, avatarPositions, 'avatar-position'),
    focalX: focal(input.identity.focalX, 'cover-x'),
    focalY: focal(input.identity.focalY, 'cover-y'),
  };
  const spotlight = settings(input.spotlight, old.layout.spotlight, 'spotlight-size');
  const dock = settings(input.dock, old.layout.dock, 'dock-size');
  const priorSchedule = old.layout.supporting.find(card => card.family === 'schedule')!;
  const supporting = list(input.supporting, 'supporting', 6).map((card): ScheduleSettings | PromoCard => {
    if (!card || typeof card.hidden !== 'boolean') throw invalid('supporting', 'Choose whether each supporting card is visible.');
    if (card.family === 'schedule') return { family: 'schedule', hidden: card.hidden, ...settings(card, priorSchedule, 'schedule-size') };
    if (card.family !== 'promo') throw invalid('supporting', 'Only Schedule and Promo cards can go here.');
    const cardId = id(card.id, 'supporting');
    const field = 'promo-' + cardId;
    const previous = old.layout.supporting.find(item => item.id === cardId && item.family === 'promo');
    return {
      family: 'promo', id: cardId, hidden: card.hidden, size: choice(card.size, legacySizes, field),
      ...normalizeDimensions(card, previous, field),
      category: choice(card.category, promoCategories, field), title: text(card.title, field, 80, !preview),
      url: https(card.url, field, !preview), description: text(card.description, field, 160),
    };
  });
  const ids = [identity.id, spotlight.id, dock.id, ...supporting.map(card => card.id)];
  if (!supporting.some(card => card.family === 'schedule') || new Set(ids).size !== ids.length) {
    throw invalid('supporting', 'Keep one Schedule card and use a different ID for each card.');
  }
  if (content.links.length + supporting.length - 1 > 5) {
    throw invalid('supporting', 'Use at most five supporting links across the Channel Dock and Promo cards.');
  }
  const dockPosition = input.dockPosition === undefined
    ? Math.min(old.layout.dockPosition, supporting.length)
    : input.dockPosition;
  if (!Number.isInteger(dockPosition) || dockPosition < 0 || dockPosition > supporting.length) {
    throw invalid('layout', 'Place the Channel Dock below Spotlight among the supporting cards.');
  }
  return { ...content, layout: { identity, spotlight, dock, dockPosition, supporting } };
}

export const platforms = {
  twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', kick: 'Kick', instagram: 'Instagram',
} as const;
type Platform = keyof typeof platforms;
const channelHosts: ReadonlyMap<string, [Platform, RegExp]> = new Map([
  ['twitch.tv', ['twitch', /^\/[a-z0-9_]+\/?$/i]],
  ['youtube.com', ['youtube', /^\/(?:@[\w.-]+|(?:channel|c|user)\/[\w.-]+)\/?$/i]],
  ['tiktok.com', ['tiktok', /^\/@[\w.-]+\/?$/i]],
  ['x.com', ['x', /^\/[a-z0-9_]+\/?$/i]],
  ['twitter.com', ['x', /^\/[a-z0-9_]+\/?$/i]],
  ['kick.com', ['kick', /^\/[a-z0-9_]+\/?$/i]],
  ['instagram.com', ['instagram', /^\/[\w.]+\/?$/i]],
]);
const reservedPaths = new Set(['about','browse','clips','directory','discover','explore','following','help',
  'home','i','login','p','privacy','reel','reels','search','settings','signup','stories','terms','videos']);

export function channelPlatform(link: string) {
  const url = new URL(link);
  const host = url.hostname.replace(/^www\./, '');
  const match = channelHosts.get(host);
  if (url.protocol !== 'https:' || url.port || !match?.[1].test(url.pathname) ||
      reservedPaths.has(url.pathname.split('/')[1].toLowerCase())) return undefined;
  return match[0];
}
