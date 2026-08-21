import type { ManualContent } from './types.ts';

/**
 * Transcribed from the printed sheet kept at the ship station (its own
 * screenshots are dated 2021-07-02, FedEx Ship Manager).
 *
 * The screenshots are not reproduced: they are photographs of a creased
 * printout, unreadable on a phone, and every value they carry appears here as
 * a field instead.
 *
 * Two judgements were made while transcribing, both worth knowing:
 *
 * 1. **The `61 lbs` on the sheet is one shipment's weight, not a rule.** It is
 *    handwritten at the top and printed inside two screenshots, sitting in the
 *    same typeface as the constants around it. The fields below say what to
 *    enter rather than reprinting that number, so there is nothing to copy.
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
      fields: [
        { label: 'Service type', value: 'R - FedEx Ground Service' },
        { label: 'Weight', value: 'the weight of this bike' },
      ],
      figures: [],
      action: 'HAZMAT',
    },
    {
      title: 'Choose the lithium battery commodity',
      body: 'At the top of the page open the HAZARDOUS MATERIALS ID drop-down and pick Lithium Ion Bat. The rest of the row fills itself in — check it matches below.',
      screen: 'Add Hazardous Materials → Enter hazardous materials commodity information',
      fields: [
        { label: 'Hazardous materials ID', value: 'Lithium Ion Bat' },
        { label: 'DOT Identification number', value: 'UN 3481' },
        {
          label: 'DOT Proper Shipping Name',
          value: 'Lithium ion batteries packed with equipment',
          note: 'Not "contained in equipment" — that is the row underneath it.',
        },
        { label: 'DOT Label type', value: 'CLASS 9' },
        { label: 'Hazard class or division code', value: '9' },
        { label: 'Commodity Weight', value: 'the same weight as the package' },
      ],
      figures: [],
      action: 'Add to Package',
    },
    {
      title: 'Fill in the package information',
      body: 'At the bottom of the page enter the packaging, and on the right the offeror and the person signing.',
      screen: 'Add Hazardous Materials → Enter hazardous materials package information',
      fields: [
        { label: 'Number and Type of Packaging', value: '1 BOX' },
        { label: 'Emergency contact number', value: '(800) 424-9300' },
        { label: 'Offeror Name', value: 'CHEMTREC' },
        {
          label: 'Name Of Signatory',
          value: 'TONY BELLO',
          note: 'The name of the person signing off the shipment.',
        },
      ],
      figures: [],
      warning:
        'Do not misspell anything on this screen. If it is wrong they send the bikes back to us.',
    },
    {
      title: 'Ship and print',
      body: 'Click OK. Then click SHIP. A message about printing appears — click OK there too, and the documents and the label print.',
      fields: [],
      figures: [],
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
      figures: [],
      action: 'REPEAT',
    },
    {
      title: 'Print the manifest at the end of the day',
      body: "Before the driver arrives, print the manifest covering the day's Hazmat labels. Check the date is right, then print.",
      screen: 'Reports → Shipment Reports',
      fields: [{ label: 'Report', value: 'FedEx Ground HazMat Certification (OP950)' }],
      figures: [],
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
