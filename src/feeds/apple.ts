/**
 * Podcast search and charts from Apple's public directory (no account or key). Requests go
 * straight from the phone to Apple; nothing about the user is sent beyond the search words.
 */

import { fetchWithTimeout } from '@/lib/http';

export type DirectoryPodcast = {
  /** Apple's id; for Podcast Index results "pi" and its id (they always have a feed). */
  appleId: string;
  source?: 'apple' | 'podcastindex';
  title: string;
  author: string;
  artworkUrl: string | null;
  /** Missing in chart results until looked up. */
  feedUrl: string | null;
};

type AppleResult = {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  feedUrl?: string;
};

const toPodcast = (r: AppleResult): DirectoryPodcast | null =>
  r.collectionId && r.collectionName
    ? {
        appleId: String(r.collectionId),
        title: r.collectionName,
        author: r.artistName ?? '',
        artworkUrl: r.artworkUrl600 ?? r.artworkUrl100 ?? null,
        feedUrl: r.feedUrl ?? null,
      }
    : null;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {},
    15_000,
    'Apple’s podcast directory didn’t answer. Try again in a moment.',
  );
  // Apple turns away phones that search a lot in a short time.
  if (response.status === 403 || response.status === 429) {
    throw new Error('Apple’s podcast directory is busy. Try again in a minute.');
  }
  if (!response.ok) throw new Error(`The podcast directory answered ${response.status}.`);
  return (await response.json()) as T;
}

export async function searchPodcasts(term: string, country = 'us'): Promise<DirectoryPodcast[]> {
  const q = encodeURIComponent(term.trim());
  const data = await getJson<{ results: AppleResult[] }>(
    `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=40&country=${country}&term=${q}`,
  );
  return data.results.map(toPodcast).filter((p): p is DirectoryPodcast => !!p?.feedUrl);
}

export async function lookupPodcasts(appleIds: string[]): Promise<DirectoryPodcast[]> {
  if (appleIds.length === 0) return [];
  const data = await getJson<{ results: AppleResult[] }>(
    `https://itunes.apple.com/lookup?entity=podcast&id=${appleIds.join(',')}`,
  );
  return data.results.map(toPodcast).filter((p): p is DirectoryPodcast => !!p);
}

type ChartEntry = {
  'im:name': { label: string };
  'im:artist'?: { label: string };
  'im:image'?: { label: string }[];
  id: { attributes: { 'im:id': string } };
};

/** One of Apple's charts: every show, or one category (feed URLs come from a later lookup). */
async function chart(
  country: string,
  categoryId: string | null,
  limit: number,
): Promise<DirectoryPodcast[]> {
  const genre = categoryId ? `/genre=${categoryId}` : '';
  const data = await getJson<{ feed: { entry?: ChartEntry[] | ChartEntry } }>(
    `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}${genre}/json`,
  );
  // A list of one comes back as a single entry, not a list.
  const entries = data.feed.entry ? [data.feed.entry].flat() : [];
  return entries.map((e) => ({
    appleId: e.id.attributes['im:id'],
    title: e['im:name'].label,
    author: e['im:artist']?.label ?? '',
    // Ask Apple's image server for a bigger square than the small default.
    artworkUrl:
      e['im:image']?.at(-1)?.label.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, '/600x600bb.$2') ??
      null,
    feedUrl: null,
  }));
}

/**
 * Apple's top shows for a country. From the same address as the category charts: Apple's newer
 * one for the overall chart (rss.marketingtools.apple.com) often doesn't answer at all, so Top
 * shows sat loading and then gave up.
 */
export function topPodcasts(country = 'us', limit = 50): Promise<DirectoryPodcast[]> {
  return chart(country, null, limit);
}

/** Apple's top shows in one category (Comedy is "1303"; see feeds/categories.ts). */
export function topInCategory(
  country: string,
  categoryId: string,
  limit = 50,
): Promise<DirectoryPodcast[]> {
  return chart(country, categoryId, limit);
}

/**
 * Fills in the feed addresses chart results leave out, in one request for the whole list, so
 * tapping a show doesn't have to ask Apple first. Shows it can't find stay as they were.
 */
export async function withFeedUrls(items: DirectoryPodcast[]): Promise<DirectoryPodcast[]> {
  const missing = items.filter((p) => !p.feedUrl && p.source !== 'podcastindex');
  if (missing.length === 0) return items;
  const found = new Map(
    (await lookupPodcasts(missing.map((p) => p.appleId))).map((p) => [p.appleId, p.feedUrl]),
  );
  return items.map((p) => (p.feedUrl ? p : { ...p, feedUrl: found.get(p.appleId) ?? null }));
}

/** The Apple id in a podcasts.apple.com link ("…/id1234567890"), or null. */
export function appleIdFromLink(text: string): string | null {
  const m = /podcasts\.apple\.com\/.*\bid(\d{5,})/i.exec(text.trim());
  return m ? m[1] : null;
}

/** What the user typed into the add box: a feed address, an Apple link, or search words. */
export function classifyQuery(
  text: string,
): { kind: 'apple'; id: string } | { kind: 'url'; url: string } | { kind: 'search'; term: string } {
  const trimmed = text.trim();
  const appleId = appleIdFromLink(trimmed);
  if (appleId) return { kind: 'apple', id: appleId };
  if (/^(https?|feed|itpc|pcast|podcast):\/\//i.test(trimmed)) {
    return { kind: 'url', url: trimmed.replace(/^(feed|itpc|pcast|podcast):\/\//i, 'https://') };
  }
  if (/^[\w-]+(\.[\w-]+)+\/\S*$/.test(trimmed)) return { kind: 'url', url: `https://${trimmed}` };
  return { kind: 'search', term: trimmed };
}

/** Two-letter country for charts and search, from the phone's region; US if unknown. */
export function deviceCountry(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = /[-_]([A-Z]{2})\b/.exec(locale)?.[1];
    return region ? region.toLowerCase() : 'us';
  } catch {
    return 'us';
  }
}
