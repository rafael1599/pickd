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
 * `value` says what goes in the box, so it is either the literal text
 * (`CHEMTREC`, `UN 3481`) or a description of it (`the weight of this bike`).
 *
 * There used to be a `kind` marking a value as a sample, because the paper
 * original prints one shipment's `61 lbs` in the same typeface as the constants
 * around it. Tagging each one "varies" put that word all over the page and
 * still left a specific number sitting there to be copied. Describing the value
 * removes both problems: nobody types "the weight of this bike" literally.
 */
export const manualFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  /** Only when the value alone would be ambiguous. Most fields need none. */
  note: z.string().optional(),
});

/**
 * The orange marker that points at a control: "◄ ❶ pick the saved template".
 *
 * A mark also *highlights* the control it sits on, which is the whole reason
 * figures beat a list of fields. An operator matching a picture against the
 * screen in front of them does not read labels, they look for the box with the
 * ring around it.
 */
export const figureMarkSchema = z.object({
  /** Order to do them in. Omit for a mark that only labels something. */
  n: z.number().int().positive().optional(),
  text: z.string().min(1),
});

export const figureOptionSchema = z.object({
  label: z.string().min(1),
  selected: z.boolean().default(false),
  mark: figureMarkSchema.optional(),
});

/**
 * One line of a reproduced window. Deliberately a small vocabulary: these are
 * simplified pictures, not a rendering engine. If a real window needs something
 * this cannot say, the honest fix is usually a plainer picture, not a new kind.
 */
export const figureRowSchema = z.discriminatedUnion('kind', [
  /** The application's top menu bar. */
  z.object({
    kind: z.literal('menubar'),
    items: z.array(z.string().min(1)).min(1),
    active: z.string().optional(),
    mark: figureMarkSchema.optional(),
  }),
  /** A dropped-down menu or a fly-out, cascading right as `indent` grows. */
  z.object({
    kind: z.literal('menu'),
    items: z.array(z.string().min(1)).min(1),
    active: z.string().optional(),
    indent: z.number().int().min(0).max(3).default(0),
    mark: figureMarkSchema.optional(),
  }),
  /** A labelled input, optionally with the button that sits beside it. */
  z.object({
    kind: z.literal('field'),
    label: z.string().min(1),
    value: z.string().default(''),
    input: z.enum(['text', 'dropdown']).default('text'),
    button: z.string().optional(),
    mark: figureMarkSchema.optional(),
  }),
  /** A radio group. Exactly which option is filled in is usually the point. */
  z.object({
    kind: z.literal('choice'),
    label: z.string().optional(),
    options: z.array(figureOptionSchema).min(1),
  }),
  z.object({
    kind: z.literal('checkbox'),
    label: z.string().min(1),
    checked: z.boolean().default(false),
    mark: figureMarkSchema.optional(),
  }),
  z.object({
    kind: z.literal('buttons'),
    items: z
      .array(z.object({ label: z.string().min(1), mark: figureMarkSchema.optional() }))
      .min(1),
  }),
  /** Numbers the window reports back, e.g. "Processed 93  Errors 0". */
  z.object({
    kind: z.literal('readout'),
    label: z.string().min(1),
    items: z.array(z.object({ label: z.string().min(1), value: z.string() })).min(1),
    mark: figureMarkSchema.optional(),
  }),
  z.object({
    kind: z.literal('table'),
    headers: z.array(z.string().min(1)).min(1),
    rows: z.array(z.array(z.string())).default([]),
    mark: figureMarkSchema.optional(),
  }),
]);

/** A simplified picture of one window in the other system. */
export const figureSchema = z.object({
  /** The window's own title, as it reads in its title bar. */
  title: z.string().min(1),
  /** What this picture is for, e.g. "Getting to File Maintenance". */
  caption: z.string().optional(),
  rows: z.array(figureRowSchema).min(1),
});

/** A reference block: rules and tables that are not steps to walk through. */
export const manualSectionSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  bullets: z.array(z.string().min(1)).default([]),
  table: z
    .object({
      headers: z.array(z.string().min(1)).min(1),
      rows: z.array(z.array(z.string())).min(1),
    })
    .optional(),
});

export const manualStepSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  /** Where in the other system this happens, e.g. "Shipment details → Shortcuts". */
  screen: z.string().optional(),
  fields: z.array(manualFieldSchema).default([]),
  /** The control to click once the fields are filled, e.g. "Add to Package". */
  action: z.string().optional(),
  /** Consequence of getting this step wrong. Rendered loud, on purpose. */
  warning: z.string().optional(),
  /** Pictures of the windows this step happens in — the path, then the dialog. */
  figures: z.array(figureSchema).default([]),
});

export const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const manualContentSchema = z.object({
  intro: z.string().optional(),
  steps: z.array(manualStepSchema).default([]),
  /** Applies to the whole procedure rather than one step. */
  warnings: z.array(z.string()).default([]),
  /** Rules and lookup tables that are read, not walked through. */
  reference: z.array(manualSectionSchema).default([]),
  faqs: z.array(faqItemSchema).default([]),
});

export type FigureMark = z.infer<typeof figureMarkSchema>;
export type FigureRow = z.infer<typeof figureRowSchema>;
export type Figure = z.infer<typeof figureSchema>;
export type ManualSection = z.infer<typeof manualSectionSchema>;
export type ManualField = z.infer<typeof manualFieldSchema>;
export type ManualStep = z.infer<typeof manualStepSchema>;
export type FaqItem = z.infer<typeof faqItemSchema>;
export type ManualContent = z.infer<typeof manualContentSchema>;

/** Empty but valid — the neutral value for a manual with nothing written yet. */
export const EMPTY_CONTENT: ManualContent = { steps: [], warnings: [], reference: [], faqs: [] };

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
    // Figures carry values that appear nowhere else -- the template name, the
    // menu path, the button. Leaving them out would make the search box quietly
    // wrong about content the reader can plainly see.
    for (const figure of step.figures) {
      parts.push(figure.title);
      if (figure.caption) parts.push(figure.caption);
      for (const row of figure.rows) {
        switch (row.kind) {
          case 'menubar':
          case 'menu':
            parts.push(...row.items);
            break;
          case 'field':
            parts.push(row.label, row.value);
            if (row.button) parts.push(row.button);
            break;
          case 'choice':
            if (row.label) parts.push(row.label);
            parts.push(...row.options.map((o) => o.label));
            break;
          case 'checkbox':
            parts.push(row.label);
            break;
          case 'buttons':
            parts.push(...row.items.map((b) => b.label));
            break;
          case 'readout':
            parts.push(row.label, ...row.items.flatMap((i) => [i.label, i.value]));
            break;
          case 'table':
            parts.push(...row.headers, ...row.rows.flat());
            break;
        }
      }
    }
  }

  for (const section of content.reference) {
    parts.push(section.title);
    if (section.body) parts.push(section.body);
    parts.push(...section.bullets);
    if (section.table) parts.push(...section.table.headers, ...section.table.rows.flat());
  }

  if (content.faqs) {
    for (const faq of content.faqs) {
      parts.push(faq.question, faq.answer);
    }
  }

  parts.push(...content.warnings);
  return parts.filter(Boolean).join(' ');
}
