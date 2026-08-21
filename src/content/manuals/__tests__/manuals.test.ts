import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MANUALS, getManualBySlug, manualRoute, manualTitleFor, manualsByCategory } from '../index';
import { manualContentSchema, manualSearchText, type ManualContent } from '../types';

/**
 * Every labelled value a reader can actually see, wherever it is drawn.
 *
 * The values that matter moved out of `fields` and into the figures when the
 * windows were drawn — a picture is the instruction, and repeating it under the
 * picture is how a procedure stops being read. A check that only walked
 * `fields` would have gone green while the page still showed them, and stayed
 * green the day somebody deleted them. What has to hold is that the operator
 * can see CHEMTREC, not which array it sits in.
 */
function visibleValues(content: ManualContent): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const step of content.steps) {
    for (const field of step.fields) out.push({ label: field.label, value: field.value });
    for (const figure of step.figures) {
      for (const row of figure.rows) {
        if (row.kind === 'field') out.push({ label: row.label, value: row.value });
        // A table's label is its header and its value is the cell underneath —
        // which is where the commodity row lives now that FSM fills it in.
        if (row.kind === 'table') {
          for (const cells of row.rows) {
            row.headers.forEach((header, i) => out.push({ label: header, value: cells[i] ?? '' }));
          }
        }
      }
    }
  }
  return out;
}

// Manuals used to be rows, and a migration was the gate they passed through.
// Now they ship with the build, so this file is that gate: TypeScript catches a
// missing title or a misspelled key, and these catch what types cannot.

describe('the manual library', () => {
  it('has a unique slug for every manual', () => {
    const slugs = MANUALS.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses url-safe slugs, since the slug is the route', () => {
    for (const manual of MANUALS) {
      expect(manual.slug, manual.title).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('validates every manual against the content schema', () => {
    for (const manual of MANUALS) {
      const result = manualContentSchema.safeParse(manual.content);
      expect(result.success, `${manual.slug}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('gives every manual a title, a category and a summary', () => {
    for (const manual of MANUALS) {
      expect(manual.title.trim().length, manual.slug).toBeGreaterThan(0);
      expect(manual.category.trim().length, manual.slug).toBeGreaterThan(0);
      expect(manual.summary.trim().length, manual.slug).toBeGreaterThan(0);
    }
  });

  it('leaves no step without something to do', () => {
    // A step with only a title tells an operator nothing. Catching it here is
    // the point of transcribing into a shape instead of into prose.
    for (const manual of MANUALS) {
      manual.content.steps.forEach((step, i) => {
        const hasSubstance =
          !!step.body || step.fields.length > 0 || !!step.action || step.figures.length > 0;
        expect(hasSubstance, `${manual.slug} step ${i + 1}: "${step.title}"`).toBe(true);
      });
    }
  });
});

describe('lookup', () => {
  it('finds a manual by slug and misses cleanly', () => {
    expect(getManualBySlug('fedex-hazmat-ebikes')?.title).toContain('Hazmat');
    expect(getManualBySlug('does-not-exist')).toBeNull();
    expect(getManualBySlug(undefined)).toBeNull();
  });

  it('routes to the manual, and to the index when there is none', () => {
    expect(manualRoute('fedex-hazmat-ebikes')).toBe('/manuals/fedex-hazmat-ebikes');
    expect(manualRoute(null)).toBe('/manuals');
    expect(manualRoute(undefined)).toBe('/manuals');
  });

  it('reads back a title for a link label', () => {
    expect(manualTitleFor('fedex-hazmat-ebikes')).toBe('FedEx Hazmat labels — E-Bikes');
    expect(manualTitleFor(null)).toBeNull();
  });

  it('groups by category with each group in reading order', () => {
    const grouped = manualsByCategory();
    expect(grouped.length).toBeGreaterThan(0);
    for (const [, items] of grouped) {
      const orders = items.map((m) => m.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
  });
});

describe('the FedEx Hazmat manual', () => {
  const manual = getManualBySlug('fedex-hazmat-ebikes');
  const shown = visibleValues(manual!.content);
  const valueOf = (label: string) => shown.find((f) => f.label === label);

  it('keeps all nine steps from the printed sheet', () => {
    expect(manual!.content.steps).toHaveLength(9);
  });

  it('carries the values that send the bikes back when they are wrong', () => {
    expect(valueOf('Offeror Name')?.value).toBe('CHEMTREC');
    expect(valueOf('DOT Identification number')?.value).toBe('UN 3481');
    expect(valueOf('Number and Type of Packaging')?.value).toBe('1 BOX');
  });

  it('describes the weights instead of reprinting one shipment’s number', () => {
    // The paper original prints 61 lbs, which is one sample shipment. A field
    // that shows a number invites copying it; a field that says what to enter
    // does not.
    expect(shown.some((f) => f.value.includes('61'))).toBe(false);
    expect(valueOf('Weight')?.value).toContain('this bike');
    expect(valueOf('Commodity Weight')?.value).toContain('the package');
  });

  it('keeps the sticker rule global, since it belongs to no single step', () => {
    const warnings = manual!.content.warnings.join(' ');
    expect(warnings).toContain('UN3481');
    expect(warnings).toContain('Class 9');
  });

  it('warns about spelling on the step where it is typed, and only there', () => {
    // It used to be said twice — once here and once again in the closing
    // warnings. A rule repeated is a rule skimmed.
    const packageStep = manual!.content.steps[3];
    expect(packageStep.warning?.toLowerCase()).toContain('misspell');
    expect(manual!.content.warnings.join(' ').toLowerCase()).not.toContain('spelling');
  });

  it('says out loud that the step 6 videos are not in PickD', () => {
    const step = manual!.content.steps[5];
    expect(step.warning).toContain('not in PickD');
  });

  it('is findable by a value someone half-remembers', () => {
    const text = manualSearchText(manual!.content).toLowerCase();
    expect(text).toContain('chemtrec');
    expect(text).toContain('3481');
    expect(text).toContain('op950');
  });
});

describe('manuals stay out of the database', () => {
  // Documented once and written anyway, twice, by different sessions working in
  // this repo at the same time. A rule that only lives in CLAUDE.md is a rule
  // that holds until someone does not read it, so this is the enforcement: a
  // migration that reaches for a `manuals` table fails the suite instead of
  // reaching production, where it would abort against a table that is gone.
  //
  // This is not a temporary guard awaiting a better answer, and it has no
  // agreed exception. Manuals are static, permanently. If you are reading this
  // because it blocked you, the migration is the thing that is wrong: move the
  // content into a module in src/content/manuals and delete the SQL.
  const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

  it('has no migration that touches a manuals table', () => {
    const offenders = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => /\bmanuals\b/i.test(readFileSync(join(MIGRATIONS, file), 'utf8')));

    expect(
      offenders,
      `Manuals are static content in src/content/manuals — they do not live in the database. ` +
        `Move the content into a module there and delete the migration.`
    ).toEqual([]);
  });
});
