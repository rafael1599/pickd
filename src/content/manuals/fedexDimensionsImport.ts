import type { ManualContent } from './types.ts';

/**
 * Loading the box catalogue into Ship Manager's Dimensions database.
 *
 * Transcribed from "FedEx Ship Manager — Dimensions Import", the quick guide
 * kept at the station (FSM v3313, station 869191, Aug 2026). Its page 2 is a
 * set of simplified pictures of each window, which is where the `figures` below
 * come from — an operator matches the picture against the screen rather than
 * reading field names, so the marked control is ringed the same way.
 *
 * **Where a step has a picture, the picture is the instruction.** No field list
 * repeats what the window already shows, and each rule is stated once, at the
 * step where getting it wrong costs something. An earlier draft said "always
 * Replace" five times across the warnings, the fields, the mark, the step and
 * the reference; a procedure nobody finishes reading is not a safer one.
 *
 * ⚠️ One thing this manual does NOT reconcile: step 1 has the operator editing a
 * master CSV by hand on the Desktop, while PickD has a Settings → Exports button
 * that generates this exact file, in this exact format, from `sku_metadata`
 * (see the FedEx section of CLAUDE.md). Both produce "the full catalogue", which
 * is what Replace requires. Nobody has imported the PickD export into FSM yet,
 * so the hand-edited master is still the procedure of record and is what is
 * written here. Deciding which one wins is an operations call, not a
 * transcription one — until it is made, the risk is two catalogues drifting
 * apart with Replace overwriting whichever ran last.
 */
export const fedexDimensionsImport: ManualContent = {
  intro:
    'Ship Manager rates every shipment from the box sizes in its own Dimensions database. ' +
    'Wrong or missing sizes are what cause the FedEx re-measurement charges, and this import ' +
    'is the only way to change them in bulk.',
  steps: [
    {
      title: 'Update the master CSV',
      body: 'On the Desktop, edit the rows that changed and add any new models. Never delete a row unless that box has genuinely stopped shipping.',
      fields: [{ label: 'File', value: 'MASTER-DIMENSIONS.csv' }],
      figures: [],
      warning:
        'The file has to hold the whole catalogue, not only what changed. The import empties ' +
        'Dimensions and refills it from the file, so anything missing from the file is gone.',
    },
    {
      title: 'Close the day — only if something shipped today',
      body: 'Open the Close tab and run both the Express and the Ground close. If nothing shipped today, skip this.',
      screen: 'FedEx Ship Manager → Close',
      fields: [],
      figures: [],
    },
    {
      title: 'Back up first',
      body: 'Tick at least Dimensions, pick a folder for today, and run it. This is what you restore from if the import goes wrong.',
      screen: 'Databases → File Maintenance → Backup',
      fields: [],
      figures: [
        {
          title: 'FedEx Ship Manager',
          caption: 'Getting there — the same path for the import and the restore',
          rows: [
            {
              kind: 'menubar',
              items: [
                'File',
                'Databases',
                'Customize',
                'Utilities',
                'Integration',
                'Inbound',
                'fedex.com',
                'Help',
              ],
              active: 'Databases',
              mark: { n: 1, text: 'Databases' },
            },
            {
              kind: 'menu',
              items: ['Address Book', 'File Maintenance ►', '…'],
              active: 'File Maintenance ►',
              indent: 1,
              mark: { n: 2, text: 'File Maintenance' },
            },
            {
              kind: 'menu',
              items: ['Import', 'Export', 'Templates', 'Backup', 'Restore'],
              active: 'Backup',
              indent: 2,
              mark: { n: 3, text: 'Backup' },
            },
          ],
        },
        {
          title: 'File Maintenance - Backup',
          rows: [
            {
              kind: 'choice',
              options: [
                { label: 'All databases', selected: false },
                {
                  label: 'Backup selected databases',
                  selected: true,
                  mark: { n: 1, text: 'then tick at least ☑ Dimensions' },
                },
              ],
            },
            {
              kind: 'field',
              label: 'Destination',
              value: 'D:\\FSM-Backups\\2026-08-20\\',
              input: 'text',
              button: 'Browse',
              mark: { n: 2, text: "today's folder" },
            },
            {
              kind: 'buttons',
              items: [{ label: 'OK', mark: { n: 3, text: 'run it' } }, { label: 'Cancel' }],
            },
          ],
        },
      ],
    },
    {
      title: 'Import the CSV',
      body: "If the Browse window doesn't list .csv files, change its file-type dropdown.",
      screen: 'Databases → File Maintenance → Import',
      fields: [],
      figures: [
        {
          title: 'File Maintenance - Import',
          rows: [
            {
              kind: 'field',
              label: 'Template name',
              value: 'DIMENTIONS1',
              input: 'dropdown',
              mark: { n: 1, text: 'spelled that way in FSM' },
            },
            {
              kind: 'field',
              label: 'File name',
              value: 'C:\\Users\\FedEx\\Desktop\\MASTER-DIMENSIONS.csv',
              input: 'text',
              button: 'Browse',
              mark: { n: 2, text: 'your CSV' },
            },
            {
              kind: 'choice',
              label: 'Import behavior',
              options: [
                { label: 'Append to current data', selected: false },
                {
                  label: 'Replace current data',
                  selected: true,
                  mark: { n: 3, text: 'always this one' },
                },
                { label: 'Merge data', selected: false },
              ],
            },
            {
              kind: 'checkbox',
              label: 'Auto-assign IDs',
              checked: false,
              mark: { text: 'leave unchecked' },
            },
            {
              kind: 'readout',
              label: 'Record count',
              items: [
                { label: 'Processed', value: '93' },
                { label: 'Errors', value: '0' },
              ],
              mark: { n: 5, text: 'read these after it runs' },
            },
            {
              kind: 'buttons',
              items: [{ label: 'OK', mark: { n: 4, text: 'run it' } }, { label: 'Cancel' }],
            },
          ],
        },
      ],
      warning:
        'Replace is the only behavior that works. Merge silently skips IDs that already exist, ' +
        'so your edits never land, and Append duplicates or errors on them.',
    },
    {
      title: 'Check the numbers before you close it',
      body: 'Processed must equal the number of rows in your file, and Errors must be zero. Then open View Dimensions: the item count has to match too, and spot-check one record you changed.',
      screen: 'Databases → File Maintenance → View Dimensions',
      fields: [],
      figures: [
        {
          title: 'View Dimensions',
          rows: [
            {
              kind: 'table',
              headers: ['Dimension ID', 'Description', 'Dimensions'],
              rows: [
                ['ALLEGROA315', "ALLEGRO A3 15''", '54x31x8'],
                ['DEFCONE117', "DEFCON E1 17''", '56x34x12'],
              ],
            },
            {
              kind: 'field',
              label: 'Number of items',
              value: '93',
              input: 'text',
              mark: { text: 'same as the rows in your CSV' },
            },
          ],
        },
      ],
    },
    {
      title: 'Back up again',
      body: 'Same backup as step 3, so the new state is saved. Note the run in the change log.',
      screen: 'Databases → File Maintenance → Backup',
      fields: [],
      figures: [],
    },
  ],
  reference: [
    {
      title: 'If the import went wrong',
      body: 'Databases → File Maintenance → Restore, pick the backup from step 3, and set the mode to Replace — Append would mix the old data with the new. Check View Dimensions afterwards.',
      bullets: [],
    },
    {
      title: 'How it works',
      bullets: [
        'Ship Manager keeps box presets in its Dimensions database. When a tracking number is rated, the declared size comes from there.',
        'The saved template DIMENTIONS1 expects the field order Description, ID, Height, Length, Width — double-quote delimiter, comma separator, no header row.',
      ],
    },
    {
      title: 'Master CSV — format rules',
      body: 'One line looks like this: "ALLEGRO A3 19\'\'-21\'\'","ALLEGROA31921","8","55","31"',
      bullets: [
        "Sizes of the same model that ship in an identical carton go in ONE record, with the sizes listed in the description (e.g. DXT A3 15''-19''). Never combine different models.",
        'If several cartons of a SKU are on hand, measure more than one and record the largest, rounded up to whole inches. Carriers bill against the biggest measurement.',
        'Save as plain-text .csv — Notepad, or "CSV" in Excel. Not .xlsx.',
      ],
      table: {
        headers: ['#', 'Field', 'Rule'],
        rows: [
          ['1', 'Description', "Max 140 chars. Never use the \" character — write inches as ''"],
          [
            '2',
            'Dimension ID',
            'Max 30 chars, uppercase letters and numbers, unique. Model + size(s), e.g. DEFCONE117, RENEGADES154',
          ],
          ['3', 'Height', 'Thinnest dimension (typically 8–13), whole inches, max 3 digits'],
          ['4', 'Length', 'Longest dimension, whole inches, max 3 digits'],
          ['5', 'Width', 'Middle dimension (typically ~30), whole inches, max 3 digits'],
        ],
      },
    },
    {
      title: 'New models arriving in containers',
      body: 'Measure the carton on the floor, add the row to the master CSV, and run this procedure. Do it as the stock arrives — shipping with missing or default dimensions is what triggers the charges.',
      bullets: [],
    },
    {
      title: 'Troubleshooting',
      bullets: [],
      table: {
        headers: ['Symptom', 'Fix'],
        rows: [
          [
            'Errors > 0 on import',
            'A format problem: missing quote, a " inside a description, wrong field order, a dimension over 3 characters, or a duplicate ID. Fix the CSV and run it again — Replace is safe to repeat.',
          ],
          ['A change did not apply', 'The import ran with Merge. Import again with Replace.'],
          ['CSV not visible in Browse', 'Change the file-type dropdown in the Browse window.'],
        ],
      },
    },
  ],
  warnings: [],
};
