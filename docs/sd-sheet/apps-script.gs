/**
 * S/D Google Sheet ⇄ PickD. Paste this into the sheet's Extensions → Apps
 * Script. Copied from docs/sd-sheet/apps-script.gs in the PickD repo; if it
 * changes there, change it in the sheet.
 *
 * PickD → sheet (1 Oct 2026): every minute the tab is compared with PickD (S/D
 * in stock, by #) and rewritten if it differs, so a row deleted, sorted or
 * typed over by hand is put back within a minute.
 *
 * Sheet → PickD (2 Oct 2026): editing ONE cell of Category, Condition,
 * Condition description, Serial, Internal note or PDF link sends that change to
 * PickD. PickD holds every rule — lists, the value the cell had, 30 edits/min,
 * 300/hour, an audit of every attempt — and answers ok or why not. Refused, the
 * cell goes back and gets a note saying why. A pasted block, a cleared range or
 * a blank never reaches PickD; the mirror restores them.
 *
 * One-time setup:
 *   1. Project Settings → Script properties: SD_SHEET_TOKEN (reading) and
 *      SD_SHEET_WRITE_TOKEN (writing; leave it out and the sheet stays read-only).
 *   2. Run `setup` once and accept the permissions: it creates the 1-minute
 *      trigger, the on-edit trigger, and fills the tab.
 */

const ENDPOINT = 'https://xexkttehzpxtviebglei.supabase.co/functions/v1/sd-sheet';
/**
 * The spreadsheet, by the ID in its URL (/d/<ID>/edit). By ID rather than
 * "the file this script is attached to": a script made from the old .xlsx, or
 * from script.google.com, wrote nowhere and said nothing (1 Oct 2026).
 */
const SPREADSHEET_ID = '1wH9E_gEl3-uj4HSWzxHPLYR5_SAJEpo_Nts_eO6_ve8';
/** The tab to fill, by its gid (the number after #gid= in the URL while that tab is open). */
const SHEET_GID = 974932514;

function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => ['syncFromPickd', 'onSheetEdit'].includes(t.getHandlerFunction()))
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncFromPickd').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SPREADSHEET_ID).onEdit().create();
  syncFromPickd();
}

function targetSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find((s) => s.getSheetId() === SHEET_GID);
  // Never fall back to another tab: the mirror clears what it writes over.
  if (!sheet) {
    const tabs = ss.getSheets().map((s) => s.getName() + ' = ' + s.getSheetId()).join(', ');
    throw new Error('No tab with gid ' + SHEET_GID + '. Set SHEET_GID to one of: ' + tabs);
  }
  return sheet;
}

function syncFromPickd() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SD_SHEET_TOKEN');
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
  props.setProperty('COLUMNS', JSON.stringify(body.columns));
  if (body.options) props.setProperty('OPTIONS', JSON.stringify(body.options));

  // An edit being sent waits for this run, and this run for it.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = targetSheet_();
    // Compared against what the tab holds NOW, not against the last run.
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const current =
      lastRow > 0 && lastCol > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
    const norm = (rows) => JSON.stringify(rows.map((r) => r.map((v) => String(v))));
    if (lastCol === values[0].length && norm(current) === norm(values)) {
      console.log('Up to date: ' + body.rows.length + ' S/D in "' + sheet.getName() + '"');
      return;
    }

    sheet.clearContents();
    sheet.clearNotes();
    // Everything but SD # as plain text, so Sheets doesn't turn a serial like
    // 0123 into 123 (or a SKU into a date) and the comparison above stays true.
    sheet.getRange(1, 2, values.length, values[0].length - 1).setNumberFormat('@');
    sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, values[0].length).setFontWeight('bold');
    applyDropdowns_(sheet, body.columns, body.rows.length, body.options);
    console.log('Wrote ' + body.rows.length + ' S/D to "' + sheet.getName() + '"');
  } finally {
    lock.releaseLock();
  }
}

/** Category and Condition offer PickD's lists, so a typo can't even be typed. */
function applyDropdowns_(sheet, columns, rowCount, options) {
  if (!options || rowCount === 0) return;
  ['Category', 'Condition'].forEach((name) => {
    const col = columns.indexOf(name) + 1;
    if (col === 0 || !options[name]) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(options[name], true)
      .setAllowInvalid(true) // legacy values (used, new) still show; PickD refuses them on edit
      .build();
    sheet.getRange(2, col, rowCount, 1).setDataValidation(rule);
  });
}

/** Installable on-edit trigger (a simple onEdit can't call PickD). */
function onSheetEdit(e) {
  const range = e.range;
  const sheet = range.getSheet();
  if (sheet.getSheetId() !== SHEET_GID) return;

  const props = PropertiesService.getScriptProperties();
  const writeToken = props.getProperty('SD_SHEET_WRITE_TOKEN');
  const columns = JSON.parse(props.getProperty('COLUMNS') || '[]');
  const editable = (JSON.parse(props.getProperty('OPTIONS') || '{}').editable || []);

  // A block, a cleared range, a deleted row, the header row, or a sheet whose
  // headers moved: nothing goes to PickD — put PickD back now.
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const headersOk = JSON.stringify(header.map(String)) === JSON.stringify(columns);
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1 || range.getRow() === 1 || !headersOk) {
    SpreadsheetApp.getActive().toast('Edit one cell at a time — PickD restores the sheet.', 'PickD', 5);
    syncFromPickd();
    return;
  }

  const column = columns[range.getColumn() - 1];
  const oldValue = e.oldValue === undefined ? '' : String(e.oldValue);
  const newValue = e.value === undefined ? '' : String(e.value);
  const refuse = (reason) => {
    range.setValue(oldValue);
    range.setNote('Not saved in PickD: ' + reason);
  };

  if (!writeToken) return refuse('editing from the sheet is not enabled');
  if (!editable.includes(column)) return refuse('read-only column — change it in PickD');

  const sku = String(sheet.getRange(range.getRow(), columns.indexOf('SKU') + 1).getValue());
  const editor = (e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const res = UrlFetchApp.fetch(ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sheet-token': props.getProperty('SD_SHEET_TOKEN'), 'x-sheet-write-token': writeToken },
      payload: JSON.stringify({ sku: sku, column: column, old: oldValue, new: newValue, editor: editor }),
      muteHttpExceptions: true,
    });
    let answer;
    try {
      answer = JSON.parse(res.getContentText());
    } catch (err) {
      answer = { ok: false, reason: 'PickD answered ' + res.getResponseCode() };
    }
    if (answer.ok) {
      range.setValue(answer.value); // what PickD stored, normalised
      range.clearNote();
    } else {
      refuse(answer.reason || 'PickD answered ' + res.getResponseCode());
    }
  } finally {
    lock.releaseLock();
  }
}
