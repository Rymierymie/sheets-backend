// =============================================================================
// Google Sheets Backend - Apps Script
// =============================================================================
//
// Deploy this once as a Web App. It handles read/write for ANY public Google
// Sheet, using the sheet ID passed as a parameter.
//
// Setup:
//   1. Go to https://script.google.com and create a new project
//   2. Paste this entire file, replacing any existing code
//   3. Click Deploy > New deployment > Web app
//   4. Set "Execute as" to "Me" and "Who has access" to "Anyone"
//   5. Click Deploy and copy the URL
//
// After updating this code, you must create a NEW deployment for changes to
// take effect. Just saving does not update the live URL.
// =============================================================================

// --- Read ---
// GET ?sheetId=XXXXX
// Returns the latest JSON blob from the last row of the first sheet tab.
function doGet(e) {
  try {
    var sheetId = e.parameter.sheetId;
    if (!sheetId) {
      return jsonResponse({ error: "Missing sheetId parameter" });
    }

    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheets()[0];

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      // No data rows yet (row 1 is header)
      return jsonResponse({});
    }

    var json = sheet.getRange(lastRow, 2).getValue();
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// --- Write ---
// POST with JSON body: { sheetId: "XXXXX", data: { ... } }
// Appends a new row: [timestamp, JSON string]
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var sheetId = body.sheetId;
    var data = body.data;

    if (!sheetId) {
      return jsonResponse({ error: "Missing sheetId in request body" });
    }
    if (data === undefined) {
      return jsonResponse({ error: "Missing data in request body" });
    }

    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheets()[0];

    // Add header row if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "JSON"]);
    }

    var jsonString = JSON.stringify(data);
    sheet.appendRow([new Date(), jsonString]);

    return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// --- Helpers ---
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
