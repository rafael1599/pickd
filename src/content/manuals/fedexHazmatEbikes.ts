import type { ManualContent } from './types.ts';

/**
 * Transcribed from the printed sheet kept at the ship station (its own
 * screenshots are dated 2021-07-02, FedEx Ship Manager).
 *
 * **The figures are drawn, not traced.** The sheet's screenshots are
 * photographs of a creased printout — unreadable on a phone, which is why they
 * were never reproduced. What survived the transcription is every value those
 * windows contain, and the figures below are assembled from exactly that. So
 * they are reliable about *what goes in each box* and about which control ends
 * the step, and approximate about where things sit on the screen. An operator
 * should match the values, not the pixel layout.
 *
 * That boundary is why some steps still have no picture:
 *
 * - **Step 5's print message** has no figure. The sheet records that a message
 *   about printing appears and that you click OK, but not what the window is
 *   called, and a figure needs a title bar it can honestly print.
 * - **Step 8's path to Reports** has no figure, and this one is worth knowing.
 *   The FSM menu bar is verified — it is reproduced from the Dimensions guide,
 *   which is a real screenshot of this same application — and `Reports` is not
 *   on it: File, Databases, Customize, Utilities, Integration, Inbound,
 *   fedex.com, Help. Drawing a menu bar with Reports in it would send somebody
 *   hunting through a menu that does not contain it. Whoever next stands at
 *   that station should record where Shipment Reports actually lives.
 * - **Steps 1, 6 and 9** happen at a printer, a video and a table. Nothing to
 *   draw.
 *
 * Two judgements were made while transcribing, both worth knowing:
 *
 * 1. **The `61 lbs` on the sheet is one shipment's weight, not a rule.** It is
 *    handwritten at the top and printed inside two screenshots, sitting in the
 *    same typeface as the constants around it. The fields say what to enter
 *    rather than reprinting that number, so there is nothing to copy.
 * 2. **Step 6 points at two videos that are not in PickD.** Kept, because
 *    dropping it would silently renumber a procedure people already know, and
 *    its own text says the documents are handled there.
 */
export const fedexHazmatEbikes: ManualContent = {
  intro:
    'Every e-bike ships as hazardous material because of its lithium battery. ' +
    'One label per bike, and one manifest for the whole day before the driver arrives.',
  steps: [
    {
      title: 'Load the Hazmat document paper',
      body: 'Put the Hazmat Document Paper in the printer before you start anything else.',
      fields: [],
      figures: [],
    },
    {
      title: 'Enter the shipment, then click HAZMAT',
      body: 'Fill in the shipping information the way you normally would, then turn on HAZMAT in the Special Services list.',
      screen: 'Shipment details → Shortcuts → Special Services',
      fields: [],
      figures: [
        {
          title: 'FedEx Ship Manager',
          caption: 'The shipment screen — only the two boxes that matter here',
          rows: [
            {
              kind: 'field',
              label: 'Service type',
              value: 'R - FedEx Ground Service',
              input: 'dropdown',
            },
            {
              kind: 'field',
              label: 'Weight',
              value: 'the weight of this bike',
              input: 'text',
            },
            {
              kind: 'checkbox',
              label: 'HAZMAT',
              checked: true,
              mark: { n: 1, text: 'in the Special Services list' },
            },
          ],
        },
      ],
      action: 'HAZMAT',
    },
    {
      title: 'Choose the lithium battery commodity',
      body: 'At the top of the page open the HAZARDOUS MATERIALS ID drop-down and pick Lithium Ion Bat. The rest of the row fills itself in — check it against the picture before you go on.',
      screen: 'Add Hazardous Materials → Enter hazardous materials commodity information',
      fields: [],
      figures: [
        {
          title: 'Add Hazardous Materials',
          caption: 'Enter hazardous materials commodity information',
          rows: [
            {
              kind: 'field',
              label: 'Hazardous materials ID',
              value: 'Lithium Ion Bat',
              input: 'dropdown',
              mark: { n: 1, text: 'pick this — the row below fills itself in' },
            },
            {
              kind: 'table',
              headers: [
                'DOT Identification number',
                'DOT Proper Shipping Name',
                'DOT Label type',
                'Hazard class',
              ],
              rows: [['UN 3481', 'Lithium ion batteries packed with equipment', 'CLASS 9', '9']],
              mark: { n: 2, text: 'packed with — not "contained in", the row underneath' },
            },
            {
              kind: 'field',
              label: 'Commodity Weight',
              value: 'the same weight as the package',
              input: 'text',
            },
            {
              kind: 'buttons',
              items: [{ label: 'Add to Package', mark: { n: 3, text: 'then the package page' } }],
            },
          ],
        },
      ],
      action: 'Add to Package',
    },
    {
      title: 'Fill in the package information',
      body: 'At the bottom of the page enter the packaging, and on the right the offeror and the person signing.',
      screen: 'Add Hazardous Materials → Enter hazardous materials package information',
      fields: [],
      figures: [
        {
          title: 'Add Hazardous Materials',
          caption: 'Enter hazardous materials package information',
          rows: [
            {
              kind: 'field',
              label: 'Number and Type of Packaging',
              value: '1 BOX',
              input: 'text',
            },
            {
              kind: 'field',
              label: 'Emergency contact number',
              value: '(800) 424-9300',
              input: 'text',
            },
            { kind: 'field', label: 'Offeror Name', value: 'CHEMTREC', input: 'text' },
            {
              kind: 'field',
              label: 'Name Of Signatory',
              value: 'TONY BELLO',
              input: 'text',
              mark: { text: 'the person signing off the shipment' },
            },
          ],
        },
      ],
      warning:
        'Do not misspell anything on this screen. If it is wrong they send the bikes back to us.',
    },
    {
      title: 'Ship and print',
      body: 'Click OK, then SHIP. A message about printing appears — click OK there too, and the documents and the label print.',
      fields: [],
      figures: [
        {
          title: 'Add Hazardous Materials',
          rows: [
            {
              kind: 'buttons',
              items: [
                { label: 'OK', mark: { n: 1, text: 'closes the Hazmat pages' } },
                { label: 'Cancel' },
              ],
            },
          ],
        },
        {
          title: 'FedEx Ship Manager',
          caption: 'Back on the shipment screen',
          rows: [
            {
              kind: 'buttons',
              items: [{ label: 'SHIP', mark: { n: 2, text: 'then OK on the printing message' } }],
            },
          ],
        },
      ],
      action: 'OK → SHIP → OK',
    },
    {
      title: 'Handle the printed documents',
      body: 'Follow the 2 videos that explain what to do with the documents once they are printed.',
      fields: [],
      figures: [],
      warning: 'Those videos are not in PickD. Ask the ship station for them.',
    },
    {
      title: 'More than one bike on the same packing slip',
      body: 'Click REPEAT shipment at the bottom of the FedEx application and change only the part number. Click Ship again. Repeat until every bike on the packing slip has its own label.',
      fields: [],
      figures: [
        {
          title: 'FedEx Ship Manager',
          caption: 'One label per bike — the shipment comes back filled in',
          rows: [
            {
              kind: 'buttons',
              items: [{ label: 'REPEAT', mark: { n: 1, text: 'at the bottom of the window' } }],
            },
            {
              kind: 'field',
              label: 'Part number',
              value: 'the next bike on the packing slip',
              input: 'text',
              mark: { n: 2, text: 'the only thing you change' },
            },
            {
              kind: 'buttons',
              items: [{ label: 'SHIP', mark: { n: 3, text: 'then round again' } }],
            },
          ],
        },
      ],
      action: 'REPEAT',
    },
    {
      title: 'Print the manifest at the end of the day',
      body: "Before the driver arrives, print the manifest covering the day's Hazmat labels. Check the date is right, then print.",
      screen: 'Reports → Shipment Reports',
      fields: [],
      figures: [
        {
          title: 'Shipment Reports',
          rows: [
            {
              kind: 'field',
              label: 'Report',
              value: 'FedEx Ground HazMat Certification (OP950)',
              input: 'dropdown',
              mark: { n: 1, text: 'the Hazmat one, not the regular manifest' },
            },
            {
              kind: 'field',
              label: 'Date',
              value: "today's date",
              input: 'text',
              mark: { n: 2, text: 'check it before printing' },
            },
            {
              kind: 'buttons',
              items: [{ label: 'Print', mark: { n: 3, text: 'on regular paper' } }],
            },
          ],
        },
      ],
      warning:
        'Put the regular paper back in the printer first. The manifest does not go on Hazmat paper.',
    },
    {
      title: 'Count everything and bag it',
      body: 'Count the driver documents, then count the manifest, and make sure the two numbers match. Put every document, manifest included, into a manilla envelope and label it.',
      fields: [
        {
          label: 'Write on the envelope',
          value: 'G. Joannou Cycle Co. HAZMAT Documents',
          note: 'Add the date.',
        },
      ],
      figures: [],
    },
  ],
  reference: [],
  warnings: [
    'Every box needs both stickers: the black & white UN3481 label and the Class 9 Freight sticker. Do not cover the serial numbers with them.',
  ],
};
