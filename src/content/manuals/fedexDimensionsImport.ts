import type { ManualContent } from './types.ts';

/**
 * Loading the box catalogue into Ship Manager's Dimensions database.
 *
 * Transcribed from "FedEx Ship Manager — Dimensions Import", the quick guide
 * kept at the station (FSM v3313, station 869191, Aug 2026). Its page 2 is a
 * set of simplified pictures of each window, which is where the `figure` blocks
 * below come from — an operator matches the picture against the screen rather
 * than reading field names, so the marked control is ringed the same way.
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
    'Ship Manager rates a shipment from the box sizes in its own Dimensions database. ' +
    'Wrong or missing sizes are what cause FedEx re-measurement adjustment charges, and the ' +
    'only way to change them in bulk is the import below.',
  steps: [
    {
      title: 'Update the master CSV',
      body:
        'On the Desktop, update the rows that changed and add any new models. Keep the format ' +
        'exactly — the rules are at the end of this manual. Never delete a row unless that box ' +
        'genuinely no longer ships.',
      fields: [
        {
          label: 'File',
          value: 'C:\\Users\\FedEx\\Desktop\\MASTER-DIMENSIONS.csv',
          kind: 'example',
          note: 'Wherever the master is kept on that machine.',
        },
      ],
      warning:
        'The file has to hold the FULL catalogue, not just what changed. Replace deletes ' +
        'everything already in Dimensions and loads only what is in the file.',
    },
    {
      title: 'Close the day — only if anything shipped today',
      body:
        'Open the Close tab in the top bar and run both the FedEx Express and the Ground close. ' +
        'If nothing was shipped today, skip this step entirely.',
      screen: 'FedEx Ship Manager → Close',
      fields: [],
    },
    {
      title: 'Back up before importing',
      body:
        'Select the databases to save — at minimum Dimensions — Browse to the backup folder and ' +
        'run it. This backup is what a restore uses if the import goes wrong.',
      screen: 'Databases → File Maintenance → Backup',
      fields: [],
      figure: {
        title: 'FedEx Ship Manager',
        caption: 'Getting to File Maintenance — used again in steps 4 and 6',
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
            mark: { n: 1, text: 'click the Databases menu' },
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
            mark: { n: 3, text: 'pick Backup, Import or Restore' },
          },
        ],
      },
    },
    {
      title: 'Run the backup',
      screen: 'File Maintenance – Backup',
      fields: [
        {
          label: 'Destination',
          value: 'D:\\FSM-Backups\\2026-08-20\\',
          kind: 'example',
          note: 'A folder for today. Keep the pre-import copy separate from the post-import one.',
        },
      ],
      figure: {
        title: 'File Maintenance - Backup',
        rows: [
          {
            kind: 'choice',
            options: [
              { label: 'All databases', selected: false },
              {
                label: 'Backup selected databases',
                selected: true,
                mark: { n: 1, text: 'select, then tick at least ☑ Dimensions' },
              },
            ],
          },
          {
            kind: 'field',
            label: 'Destination',
            value: 'D:\\FSM-Backups\\2026-08-20\\',
            input: 'text',
            button: 'Browse',
            mark: { n: 2, text: 'backup folder' },
          },
          {
            kind: 'buttons',
            items: [{ label: 'OK', mark: { n: 3, text: 'run the backup' } }, { label: 'Cancel' }],
          },
        ],
      },
    },
    {
      title: 'Import the CSV',
      body:
        'Pick the saved template, browse to the master CSV, and set the import behavior before ' +
        'running it. If .csv files do not show up in the Browse window, change its file-type ' +
        'dropdown.',
      screen: 'Databases → File Maintenance → Import',
      fields: [
        {
          label: 'Template name',
          value: 'DIMENTIONS1',
          kind: 'exact',
          note: 'Spelled that way in Ship Manager. It is not a typo on this page.',
        },
        { label: 'Import behavior', value: 'Replace current data', kind: 'exact' },
        { label: 'Auto-assign IDs', value: 'unchecked', kind: 'exact' },
      ],
      figure: {
        title: 'File Maintenance - Import',
        rows: [
          {
            kind: 'field',
            label: 'Template name',
            value: 'DIMENTIONS1',
            input: 'dropdown',
            mark: { n: 1, text: 'pick the saved template' },
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
                mark: { n: 3, text: 'ALWAYS this one' },
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
            mark: { n: 5, text: 'check after import' },
          },
          {
            kind: 'buttons',
            items: [{ label: 'OK', mark: { n: 4, text: 'run the import' } }, { label: 'Cancel' }],
          },
        ],
      },
      warning:
        'Always Replace. In this version Merge only adds new IDs and silently skips the ones ' +
        'that already exist, so edits never land; Append duplicates or errors on existing IDs.',
    },
    {
      title: 'Verify before you close the window',
      body:
        'Record count has to show Processed equal to the number of rows in the file, and Errors ' +
        'at zero. Then open View Dimensions: "Number of items" must equal the same row count, ' +
        'and spot-check one record you changed.',
      screen: 'Databases → File Maintenance → View Dimensions',
      fields: [
        { label: 'Errors', value: '0', kind: 'exact' },
        {
          label: 'Processed',
          value: 'the number of rows in the CSV',
          kind: 'example',
        },
      ],
      figure: {
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
            mark: { text: 'must equal the rows in your CSV' },
          },
        ],
      },
    },
    {
      title: 'Back up again, and write it down',
      body:
        'Run the same backup as step 3 so the newest good state is saved, and record the run in ' +
        'the change log.',
      screen: 'Databases → File Maintenance → Backup',
      fields: [],
    },
  ],
  reference: [
    {
      title: 'If something went wrong',
      body:
        'Restore the pre-import backup: Databases → File Maintenance → Restore, pick the backup ' +
        'taken in step 3, and set the mode to Replace. Append would mix the old data with the ' +
        'new. Check View Dimensions afterwards.',
      bullets: [],
    },
    {
      title: 'How it works',
      bullets: [
        'Ship Manager stores box presets in its Dimensions database. When a tracking number is rated, the declared box size comes from there — wrong or missing sizes are what cause the re-measurement adjustment charges.',
        'Bulk updates go in through Databases → File Maintenance → Import with the saved template DIMENTIONS1: field order Description, ID, Height, Length, Width; double-quote delimiter; comma separator; no header row.',
        'Replace loads the file exactly as it is, which is why the master CSV must always be the complete catalogue.',
      ],
    },
    {
      title: 'Master CSV — format rules',
      body: 'One line looks like this: "ALLEGRO A3 19\'\'-21\'\'","ALLEGROA31921","8","55","31"',
      bullets: [
        "Grouping: sizes of the same model that ship in an identical carton go in ONE record, with the sizes listed in the description (e.g. DXT A3 15''-19''). Never combine different models.",
        'Measuring: if several cartons of a SKU are on hand, measure more than one and record the largest, rounded up to whole inches. Carriers bill against the biggest measurement.',
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
      body:
        'When a container brings a model that is not in the system: measure the carton on the ' +
        'floor, add the row to the master CSV, and run this procedure. Do it as the stock ' +
        'arrives — shipping with missing or default dimensions is what triggers the charges.',
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
          [
            'Bad data loaded, need to undo',
            'Databases → File Maintenance → Restore → pick the pre-import backup → mode Replace. Verify View Dimensions after.',
          ],
        ],
      },
    },
  ],
  warnings: [
    'Always import with Replace current data. Merge does not update existing records.',
    'The CSV must always contain the full catalogue — every dimension, not only the changed ones.',
  ],
};
