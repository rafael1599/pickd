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
 *
 * Each run compares PickD with what the tab holds right now, so a row deleted
 * or edited by hand is put back within a minute.
 */

const ENDPOINT = 'https://xexkttehzpxtviebglei.supabase.co/functions/v1/sd-sheet';
/** The tab to fill, by its gid (the number after #gid= in the URL while that tab is open). */
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

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets().find((s) => s.getSheetId() === SHEET_GID);
  // Never fall back to another tab: the mirror clears what it writes over.
  if (!sheet) {
    const tabs = ss.getSheets().map((s) => s.getName() + ' = ' + s.getSheetId()).join(', ');
    throw new Error('No tab with gid ' + SHEET_GID + '. Set SHEET_GID to one of: ' + tabs);
  }

  // Compared against what the tab holds NOW, not against the last run: a row
  // deleted or typed over by hand comes back on the next minute. Equal means
  // nothing to do (no flicker, no edit-history noise).
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const current =
    lastRow > 0 && lastCol > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  const norm = (rows) => JSON.stringify(rows.map((r) => r.map((v) => String(v))));
  if (lastCol === values[0].length && norm(current) === norm(values)) return;

  sheet.clearContents();
  // Everything but SD # as plain text, so Sheets doesn't turn a serial like
  // 0123 into 123 (or a SKU into a date) and the comparison above stays true.
  sheet.getRange(1, 2, values.length, values[0].length - 1).setNumberFormat('@');
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold');
}
