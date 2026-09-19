import { getSheetsClient, isGoogleAuthConfigured } from "./googleAuth.js";

// A tiny "database" layer backed directly by a Google Sheet — this is the
// app's actual data store now (no MongoDB), per sir's request to run
// everything on Google. One spreadsheet (GOOGLE_SHEET_ID) holds one tab per
// "table" (Users, Expenses), each with an `id` column as its primary key.
//
// This is deliberately simple, not a real database: every write re-reads or
// re-locates rows by scanning, there's no transaction safety, and heavy
// concurrent use could hit Google Sheets API rate limits. That trade-off is
// intentional for a small internal business tool where Google Workspace
// access matters more than database performance.

const sheetGidCache = new Map(); // `${sheetName}` -> numeric internal sheet ID (needed to delete rows)

export const isSheetsDbConfigured = () => isGoogleAuthConfigured() && !!process.env.GOOGLE_SHEET_ID;

const getSpreadsheetId = () => {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error(
      "GOOGLE_SHEET_ID is not set — the app has no database to talk to. See backend/.env.example for setup steps."
    );
  }
  return id;
};

const requireClient = () => {
  const client = getSheetsClient();
  if (!client) {
    throw new Error("Google Sheets isn't configured on the server yet — set GOOGLE_SERVICE_ACCOUNT_KEY in backend/.env.");
  }
  return client;
};

// 0-based column index -> spreadsheet column letter (A, B, ... Z, AA, ...).
const colLetter = (index) => {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const friendly = async (fn, action) => {
  try {
    return await fn();
  } catch (error) {
    const reason = error?.response?.data?.error?.message || error.message;
    throw new Error(
      `Google Sheets error while ${action}: ${reason}. Make sure the database spreadsheet (GOOGLE_SHEET_ID) is shared with the service account's email as an Editor.`
    );
  }
};

// Creates the tab if it doesn't exist yet, and writes the header row if the
// tab is empty. Safe to call every time the server starts.
//
// Also handles the "we added a new column to an already-live sheet" case:
// if the existing header row is shorter than the `headers` this version of
// the code expects (e.g. adding `vehicleId` to a Sheet that was already
// created with the older, shorter header list), it writes ONLY the missing
// header cells onto the end of row 1 — existing columns, and every row of
// data under them, are left completely untouched.
export const ensureSheetTab = async (sheetName, headers) => {
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();

  await friendly(async () => {
    const meta = await client.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets.find((s) => s.properties.title === sheetName);
    if (!existing) {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });
    } else {
      sheetGidCache.set(sheetName, existing.properties.sheetId);
    }
  }, `preparing the "${sheetName}" tab`);

  const headerRange = `${sheetName}!A1:${colLetter(headers.length - 1)}1`;
  const current = await friendly(
    () => client.spreadsheets.values.get({ spreadsheetId, range: headerRange }),
    `reading the "${sheetName}" header`
  );
  const currentHeaderRow = current.data.values?.[0] || [];

  if (currentHeaderRow.length === 0) {
    // Brand new tab — write the full header row.
    await friendly(
      () =>
        client.spreadsheets.values.update({
          spreadsheetId,
          range: headerRange,
          valueInputOption: "RAW",
          requestBody: { values: [headers] },
        }),
      `writing the "${sheetName}" header`
    );
  } else if (currentHeaderRow.length < headers.length) {
    // Existing tab, but the code now expects more columns than it has —
    // append just the new header names after the existing ones.
    const missingHeaders = headers.slice(currentHeaderRow.length);
    const startCol = colLetter(currentHeaderRow.length);
    const endCol = colLetter(headers.length - 1);
    await friendly(
      () =>
        client.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!${startCol}1:${endCol}1`,
          valueInputOption: "RAW",
          requestBody: { values: [missingHeaders] },
        }),
      `extending the "${sheetName}" header with new columns`
    );
  }
};

const getSheetGid = async (sheetName) => {
  if (sheetGidCache.has(sheetName)) return sheetGidCache.get(sheetName);
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await friendly(() => client.spreadsheets.get({ spreadsheetId }), `looking up the "${sheetName}" tab`);
  const found = meta.data.sheets.find((s) => s.properties.title === sheetName);
  if (!found) throw new Error(`The "${sheetName}" tab doesn't exist in the database spreadsheet yet.`);
  sheetGidCache.set(sheetName, found.properties.sheetId);
  return found.properties.sheetId;
};

// Reads every data row (below the header) into objects keyed by header name,
// plus `_row`: the 1-indexed row number in the actual sheet, needed to
// target that exact row for a later update/delete.
export const getAllRows = async (sheetName, headers) => {
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();
  const range = `${sheetName}!A2:${colLetter(headers.length - 1)}`;
  const res = await friendly(() => client.spreadsheets.values.get({ spreadsheetId, range }), `reading "${sheetName}"`);
  const values = res.data.values || [];
  return values
    .map((row, i) => {
      const obj = { _row: i + 2 };
      headers.forEach((h, idx) => {
        obj[h] = row[idx] ?? "";
      });
      return obj;
    })
    .filter((obj) => headers.some((h) => obj[h] !== "")); // skip fully-blank rows
};

export const appendRow = async (sheetName, headers, rowObject) => appendRows(sheetName, headers, [rowObject]);

export const appendRows = async (sheetName, headers, rowObjects) => {
  if (!rowObjects.length) return;
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();
  const values = rowObjects.map((obj) => headers.map((h) => obj[h] ?? ""));
  await friendly(
    () =>
      client.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      }),
    `adding to "${sheetName}"`
  );
};

// Overwrites one existing row (its sheet row number found earlier via
// getAllRows -> _row) with the given field values.
export const updateRowAt = async (sheetName, headers, rowNumber, rowObject) => {
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();
  const range = `${sheetName}!A${rowNumber}:${colLetter(headers.length - 1)}${rowNumber}`;
  const values = [headers.map((h) => rowObject[h] ?? "")];
  await friendly(
    () => client.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: "RAW", requestBody: { values } }),
    `updating a row in "${sheetName}"`
  );
};

// Updates MANY existing rows in ONE API call.
//
// Why this exists: Google Sheets allows 60 writes per minute, shared across
// every user of this app (one service account). Saving 21 master budgets by
// calling updateRowAt 21 times burns a third of that minute's budget and takes
// seconds. values.batchUpdate sends all of them as a single request, so the
// cost is one write no matter how many rows change.
//
// `updates` is [{ rowNumber, rowObject }], with rowNumber being the 1-indexed
// sheet row from getAllRows' `_row`.
export const updateRowsAt = async (sheetName, headers, updates) => {
  if (!updates.length) return;
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();
  const lastCol = colLetter(headers.length - 1);
  const data = updates.map(({ rowNumber, rowObject }) => ({
    range: `${sheetName}!A${rowNumber}:${lastCol}${rowNumber}`,
    values: [headers.map((h) => rowObject[h] ?? "")],
  }));
  await friendly(
    () =>
      client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      }),
    `updating ${updates.length} rows in "${sheetName}"`
  );
};


// Deletes MANY rows in ONE API call.
//
// The reason this exists: deleting rows one at a time meant TWO Google Sheets
// calls per row — a full sheet read to locate it, then a write to remove it.
// Fifty deletions was a hundred round trips against a 60-writes-per-minute
// quota shared by the whole app, which is why deleting a batch used to crawl
// and then fail outright partway through.
//
// Two details that matter:
//
// 1. DESCENDING ORDER. Google applies the requests in a batch one after
//    another, and deleting row 5 shifts row 6 up into its place. Working from
//    the bottom of the sheet upwards means every index is still correct when
//    its turn comes. Ascending order would delete the wrong rows — silently,
//    with no error.
//
// 2. CONTIGUOUS RUNS ARE MERGED. Rows 8, 9 and 10 become a single range
//    rather than three requests, so deleting a long selection stays small.
export const deleteRowsAt = async (sheetName, rowNumbers) => {
  if (!rowNumbers.length) return;
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();
  const sheetId = await getSheetGid(sheetName);

  const descending = [...new Set(rowNumbers)].sort((a, b) => b - a);
  const ranges = [];
  for (const rowNumber of descending) {
    const last = ranges[ranges.length - 1];
    // `startIndex === rowNumber` means this row sits directly above the range
    // we're already building, so extend it downward instead of starting a new
    // one. (startIndex is 0-based and exclusive-of-header; endIndex is
    // exclusive, hence the off-by-one that makes this comparison work.)
    if (last && last.startIndex === rowNumber) last.startIndex = rowNumber - 1;
    else ranges.push({ startIndex: rowNumber - 1, endIndex: rowNumber });
  }

  await friendly(
    () =>
      client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: ranges.map((r) => ({
            deleteDimension: { range: { sheetId, dimension: "ROWS", ...r } },
          })),
        },
      }),
    `deleting ${descending.length} rows from "${sheetName}"`
  );
};

export const deleteRowAt = async (sheetName, rowNumber) => {
  const client = requireClient();
  const spreadsheetId = getSpreadsheetId();
  const sheetId = await getSheetGid(sheetName);
  await friendly(
    () =>
      client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
              },
            },
          ],
        },
      }),
    `deleting a row from "${sheetName}"`
  );
};

// Convenience: find one row by its `id` column's value.
export const findRowById = async (sheetName, headers, id) => {
  const rows = await getAllRows(sheetName, headers);
  return rows.find((r) => r.id === id) || null;
};
