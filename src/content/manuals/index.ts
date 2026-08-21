import type { ManualContent } from './types.ts';
import { fedexHazmatEbikes } from './fedexHazmatEbikes.ts';
import { fedexDimensionsImport } from './fedexDimensionsImport.ts';

/**
 * The manual library. Static content that ships with the build.
 *
 * It lived in a `manuals` table for about a day. That table had one row, no
 * INSERT/UPDATE/DELETE policy, and a migration as its only writer -- a static
 * asset wearing a database costume. Everything the table needed defending
 * against (a malformed row reaching the renderer, content and code deploying
 * out of step, a value changed in Studio with no diff to review) stops existing
 * when the content is a module: `git push` ships the manual and the screen that
 * renders it in the same commit, and the compiler checks the shape.
 *
 * This is settled: manuals are static, permanently. Not "static for now" -- a
 * `manuals` table is not the fallback for any requirement, including someone
 * wanting to edit one from inside the app. A migration that creates one fails
 * the test suite (see __tests__/manuals.test.ts), and that test is not a
 * placeholder to be removed when it becomes inconvenient.
 */
export interface Manual {
  /** Stable id and URL segment. Rename the title freely; never change this. */
  slug: string;
  title: string;
  category: string;
  /** One line under the title in the list. */
  summary: string;
  /** Position inside its category; procedures have a reading order. */
  order: number;
  content: ManualContent;
}

export const MANUALS = [
  {
    slug: 'fedex-hazmat-ebikes',
    title: 'FedEx Hazmat labels — E-Bikes',
    category: 'Shipping',
    summary: 'Lithium battery paperwork for every e-bike shipment, plus the end-of-day manifest.',
    order: 10,
    content: fedexHazmatEbikes,
  },
  {
    slug: 'fedex-dimensions-import',
    title: 'FedEx dimensions import',
    category: 'Shipping',
    summary: 'Moving the carton measurements from Pickd into Ship Manager, on the FedEx machine.',
    order: 20,
    content: fedexDimensionsImport,
  },
] as const satisfies readonly Manual[];

/**
 * Every slug that exists, as a type. This is what makes a deep link from
 * another screen a compile error when it points at nothing -- the failure the
 * title-matching it replaced could only discover at runtime, by quietly
 * dropping the operator on the index.
 */
export type ManualSlug = (typeof MANUALS)[number]['slug'];

export function getManualBySlug(slug: string | undefined): Manual | null {
  if (!slug) return null;
  return MANUALS.find((manual) => manual.slug === slug) ?? null;
}

/** The index — where a link with no manual behind it lands. */
export const MANUALS_INDEX_ROUTE = '/manuals';

/**
 * Route for a manual. Takes the slug rather than the manual because the callers
 * are buttons on other screens that know which procedure they mean and nothing
 * else about it.
 */
export function manualRoute(slug: ManualSlug | null | undefined): string {
  return slug ? `${MANUALS_INDEX_ROUTE}/${slug}` : MANUALS_INDEX_ROUTE;
}

/** Title of a manual, for a caller that labels a link with the real document name. */
export function manualTitleFor(slug: ManualSlug | null | undefined): string | null {
  return getManualBySlug(slug ?? undefined)?.title ?? null;
}

/** Categories in display order, each with its manuals already sorted. */
export function manualsByCategory(manuals: readonly Manual[] = MANUALS): [string, Manual[]][] {
  const map = new Map<string, Manual[]>();
  for (const manual of manuals) {
    const list = map.get(manual.category) ?? [];
    list.push(manual);
    map.set(manual.category, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
