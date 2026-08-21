import type { ManualContent } from './types.ts';

/**
 * Getting Pickd's measurements into Ship Manager's Dimensions table.
 *
 * It exists because the double-check screen asks for it by name: when a FedEx
 * order carries a carton Ship Manager has no dimensions for, that screen offers
 * the measurements form and then asks whether the import has been done, and
 * "Show me how" links here. That link is `slug: 'fedex-dimensions-import'` in
 * `./index.ts` — the slug is the contract, so the title above can be reworded
 * freely without sending anyone to the index.
 *
 * Three things this procedure exists to stop, all of them silent:
 *
 * 1. **Saving in Pickd is not shipping in FedEx.** The measurement lands in
 *    `sku_metadata` immediately and reaches Ship Manager only when someone runs
 *    this. Between the two, the rate is still wrong and nothing says so.
 * 2. **Replace current data empties the table first.** So a stale file does not
 *    merely fail to add the new boxes, it deletes every carton measured since it
 *    was downloaded. That is why step 3 says download it now, on that machine,
 *    and why the whole catalogue is in every export.
 * 3. **The counts are the only proof.** Ship Manager reports Processed and
 *    Errors; the export card already prints the number they have to match. A
 *    truncated import looks exactly like a successful one otherwise.
 *
 * Written from the export as built (see the FedEx section of CLAUDE.md) plus
 * the floor's own instruction to use Firefox on the FedEx machine. The reason
 * for Firefox is not recorded here because it was not given — if it turns out
 * to be "the other browser blocks the download", that belongs in step 2, since
 * a rule with a reason is the one people follow.
 */
export const fedexDimensionsImport: ManualContent = {
  intro:
    'Measuring a box in Pickd does not tell FedEx anything. Ship Manager quotes from its own ' +
    'Dimensions table, and that table only changes when someone imports the file below. ' +
    'Until then FedEx is rating the old carton, or asking somebody to type one in by hand.',
  steps: [
    {
      title: 'Go to the FedEx machine',
      body:
        'Ship Manager imports a file from the computer it runs on, so the file has to be ' +
        'downloaded on that computer. Downloading it on a tablet or at the office desk does not ' +
        'put it anywhere Ship Manager can reach.',
      fields: [],
    },
    {
      title: 'Open Pickd in Firefox',
      body: 'Use Firefox on this machine, not whatever browser is already open.',
      fields: [
        { label: 'Address', value: 'pickd.pages.dev', kind: 'exact' },
        {
          label: 'Sign in as',
          value: 'an admin account',
          kind: 'example',
          note: 'The Exports page does not open for anyone else.',
        },
      ],
    },
    {
      title: 'Download the dimensions file',
      body:
        'Do it now rather than reusing one from earlier. The file always carries the whole ' +
        'catalogue, so a fresh one is the only one that has every box measured since.',
      screen: 'Pickd → Settings → Exports',
      action: 'Export FedEx Dimensions (CSV)',
      fields: [
        {
          label: 'File name',
          value: 'DIMENSIONS_FEDEX_20260821.csv',
          kind: 'example',
          note: 'The date is the day you export.',
        },
        {
          label: 'Records',
          value: '122',
          kind: 'example',
          note: 'Pickd prints this number on the card. Write it down — Ship Manager has to report the same one.',
        },
      ],
      warning:
        'If Settings has no Exports section, the account is not an admin. Get one that is. Do not ' +
        'import an older file that happens to be on the desktop.',
    },
    {
      title: 'Import it into Ship Manager',
      screen: 'FedEx Ship Manager → Databases → File Maintenance → Import',
      action: 'Import',
      fields: [
        {
          label: 'Template',
          value: 'DIMENTIONS1',
          kind: 'exact',
          note: 'Spelled that way in Ship Manager. It is not a typo on this page.',
        },
        { label: 'Mode', value: 'Replace current data', kind: 'exact' },
      ],
      warning:
        'Replace current data empties the Dimensions table before it loads anything. That is safe ' +
        'with the file you just downloaded, because it holds every carton. With any other file it ' +
        'deletes the ones that file is missing.',
    },
    {
      title: 'Check the two numbers before you close it',
      body:
        'Ship Manager reports Processed and Errors when it finishes. Processed has to equal the ' +
        'record count Pickd showed, and Errors has to be 0. If they do not match, the table is now ' +
        'short by the difference — export again and import again before shipping.',
      fields: [
        { label: 'Errors', value: '0', kind: 'exact' },
        { label: 'Processed', value: 'the number Pickd showed', kind: 'example' },
      ],
    },
  ],
  warnings: [
    'A measurement saved in Pickd has not reached FedEx. Until this import runs, Ship Manager is quoting the old carton or none at all.',
    'Never import a file downloaded earlier. Replace current data will delete every box measured after it.',
  ],
};
