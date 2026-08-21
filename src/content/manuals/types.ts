import { z } from 'zod';

// The shape of a manual's body.
//
// Manuals are static content that ships with the build, not rows, so TypeScript
// already rejects a missing `title` or a misspelled key at compile time. This
// schema exists for the part types cannot express -- an empty string, an
// unknown field kind -- and is run over every registered manual by the test
// suite, which is the gate that content passes through now that no migration
// stands between writing one and shipping it.

/**
 * A value the operator has to put into another system.
 *
 * `exact` vs `example` is the whole reason this is structured data. On the
 * paper original both look identical -- typed into the same FedEx form, printed
 * in the same screenshot -- but `UN 3481` must be entered character for
 * character every single time, while the `61 lbs` beside it came from one
 * sample shipment and changes with every bike. Rendering them the same way is
 * how someone ends up declaring 61 lbs for a 40 lb bike.
 */
export const manualFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  kind: z.enum(['exact', 'example']).default('exact'),
  /** Short qualifier shown under the value, e.g. where the number comes from. */
  note: z.string().optional(),
});

export const manualStepSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  /** Where in the other system this happens, e.g. "Shipment details → Shortcuts". */
  screen: z.string().optional(),
  fields: z.array(manualFieldSchema).default([]),
  /** The control to click once the fields are filled, e.g. "Add to Package". */
  action: z.string().optional(),
  /** Consequence of getting this step wrong. Rendered loud, on purpose. */
  warning: z.string().optional(),
});

export const manualContentSchema = z.object({
  intro: z.string().optional(),
  steps: z.array(manualStepSchema).default([]),
  /** Applies to the whole procedure rather than one step. */
  warnings: z.array(z.string()).default([]),
});

export type ManualField = z.infer<typeof manualFieldSchema>;
export type ManualStep = z.infer<typeof manualStepSchema>;
export type ManualContent = z.infer<typeof manualContentSchema>;

/** Empty but valid — the neutral value for a manual with nothing written yet. */
export const EMPTY_CONTENT: ManualContent = { steps: [], warnings: [] };

/**
 * Everything a reader can see, flattened for search. A procedure is found by a
 * value someone half-remembers -- "3481", "chemtrec" -- far more often than by
 * its title, so the field values have to be in here.
 */
export function manualSearchText(content: ManualContent): string {
  const parts: string[] = [];
  if (content.intro) parts.push(content.intro);

  for (const step of content.steps) {
    parts.push(step.title);
    if (step.body) parts.push(step.body);
    if (step.screen) parts.push(step.screen);
    if (step.action) parts.push(step.action);
    if (step.warning) parts.push(step.warning);
    for (const field of step.fields) {
      parts.push(field.label, field.value);
      if (field.note) parts.push(field.note);
    }
  }

  parts.push(...content.warnings);
  return parts.join(' ');
}
