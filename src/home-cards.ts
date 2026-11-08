import { digest, emptyHome, https, id, invalid, list, normalize, text, type HomeContent } from './domain.ts';

const sizes = ['compact', 'expanded'] as const;
const alignments = ['left', 'center', 'right'] as const;
const avatarSizes = ['small', 'medium', 'large'] as const;
const avatarPositions = ['edge', 'banner-center'] as const;
const promoCategories = ['Giveaway', 'Support', 'Merch', 'Sponsor', 'Community'] as const;

type CardSize = typeof sizes[number];
type CardSettings = { id: string; size: CardSize };
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
  supporting: (ScheduleSettings | PromoCard)[];
};

// Keep the established editor and service field names at the API boundary.
export type EditableHome = HomeContent & { layout: HomeLayout };
type IdentityContent = Pick<HomeContent, 'displayName' | 'intro' | 'game' | 'avatarId' | 'coverId'>;
export type CardHome = {
  schemaVersion: 2;
  skin: HomeContent['theme'];
  identity: IdentitySettings & IdentityContent;
  spotlight: CardSettings & { url: string };
  dock: CardSettings & { links: HomeContent['links'] };
  supporting: ((ScheduleSettings & Pick<HomeContent, 'sessions' | 'scheduleRemoval'>) | PromoCard)[];
  updates: HomeContent['updates'];
};
export type StoredHome = HomeContent | CardHome;

function fixedId(homeId: string, role: string) {
  const hash = digest('linbio:home-card:' + homeId + ':' + role);
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');
}

export function defaultLayout(homeId: string): HomeLayout {
  const fixed = (role: string) => ({ id: fixedId(homeId, role), size: 'compact' as const });
  return {
    identity: { ...fixed('identity'), alignment: 'left', avatarSize: 'medium', avatarPosition: 'edge', focalX: 50, focalY: 50 },
    spotlight: fixed('spotlight'),
    dock: fixed('dock'),
    supporting: [{ ...fixed('schedule'), family: 'schedule', hidden: false }],
  };
}

export function readHome(value: StoredHome, homeId: string): EditableHome {
  if (value.schemaVersion !== 2) return { ...value, layout: defaultLayout(homeId) };

  const { displayName, intro, game, avatarId, coverId, ...identity } = value.identity;
  const { url, ...spotlight } = value.spotlight;
  const { links, ...dock } = value.dock;
  const schedule = value.supporting.find(card => card.family === 'schedule');
  const supporting = value.supporting.map(card => {
    if (card.family === 'promo') return card;
    return { family: card.family, id: card.id, size: card.size, hidden: card.hidden };
  });
  return {
    schemaVersion: 1, displayName, intro, game, avatarId, coverId, theme: value.skin,
    streamUrl: url, links, sessions: schedule?.sessions ?? [], scheduleRemoval: schedule?.scheduleRemoval,
    updates: value.updates, layout: { identity, spotlight, dock, supporting },
  };
}

export function writeHome(value: EditableHome): CardHome {
  const { displayName, intro, game, avatarId, coverId, streamUrl, links, sessions, scheduleRemoval, updates, theme, layout } = value;
  return {
    schemaVersion: 2, skin: theme,
    identity: { ...layout.identity, displayName, intro, game, avatarId, coverId },
    spotlight: { ...layout.spotlight, url: streamUrl },
    dock: { ...layout.dock, links },
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
  if (value?.id !== expected.id) throw invalid(field, 'Keep the fixed card in its position.');
  return { id: expected.id, size: choice(value.size, sizes, field) };
}

export function normalizeHome(value: any, old: EditableHome, now: number, preview = false): EditableHome {
  const content = normalize(value, old, now, preview);
  const input = value.layout === undefined ? old.layout : value.layout;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['identity', 'spotlight', 'dock', 'supporting'].includes(key))) {
    throw invalid('layout', 'Use the fixed Home positions and the supporting card list.');
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
    return {
      family: 'promo', id: cardId, hidden: card.hidden, size: choice(card.size, sizes, field),
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
  return { ...content, layout: { identity, spotlight, dock, supporting } };
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
