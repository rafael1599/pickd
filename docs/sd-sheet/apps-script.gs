/**
 * S/D Google Sheet ← PickD (1 Oct 2026). Paste this into the sheet's
 * Extensions → Apps Script. Copied from docs/sd-sheet/apps-script.gs in the
 * PickD repo; if it changes there, change it in the sheet.
 *
 * The tab is a MIRROR: every run rewrites it from PickD (S/D in stock, by #).
 * Anything typed into it by hand is lost on the next minute.
 *
 * One-time setup:
 *   1. Project Settings → Script properties → add SD_SHEET_TOKEN (the secret).
 *   2. Run `setup` once and accept the permissions: it creates the 1-minute
 *      trigger and fills the tab.
 */

const ENDPOINT = 'https://xexkttehzpxtviebglei.supabase.co/functions/v1/sd-sheet';
/** The tab to fill, by its gid (the number after #gid= in the URL). Falls back to the first tab. */
const SHEET_GID = 974932514;

function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncFromPickd')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncFromPickd').timeBased().everyMinutes(1).create();
  syncFromPickd();
}

function syncFromPickd() {
  const token = PropertiesService.getScriptProperties().getProperty('SD_SHEET_TOKEN');
  if (!token) throw new Error('Missing script property SD_SHEET_TOKEN');

  const res = UrlFetchApp.fetch(ENDPOINT, {
    headers: { 'x-sheet-token': token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('PickD answered ' + res.getResponseCode() + ': ' + res.getContentText());
  }
  const body = JSON.parse(res.getContentText());
  const values = [body.columns].concat(body.rows);

  // Nothing changed since the last run: leave the sheet alone (no flicker, no edit history noise).
  const digest = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(values))
  );
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('LAST_DIGEST') === digest) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets().find((s) => s.getSheetId() === SHEET_GID) || ss.getSheets()[0];

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold');
  props.setProperty('LAST_DIGEST', digest);
}
