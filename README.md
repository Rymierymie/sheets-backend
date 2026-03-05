# sheets-backend

Use a Google Sheet as a free JSON backend for static websites. No server, no database, no sign-up - just a Google Sheet and a one-time Apps Script deployment.

Your users own their data. It lives in a spreadsheet they control, and your app is just a UI layer on top.

## How it works

```
Your static HTML / JS app
  |
  |-- localStorage (instant reads/writes for fast UX)
  |
  |-- [Sync] button pushes/pulls to Google Sheet
  |
  '-- Apps Script web app (deployed once, handles all users)
        |
        '-- User's Google Sheet
              '-- Row per save: [Timestamp, JSON blob]
```

- **Reads** are instant from localStorage
- **Writes** go to localStorage immediately, then to the sheet when the user clicks sync
- Each sync appends a new row, so you get **version history for free**
- The **sheet ID in the URL hash** makes links portable across browsers

## Quick start

### 1. Deploy the Apps Script (one time)

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Delete the default code and paste the contents of [`apps-script.js`](apps-script.js)
3. Click **Deploy > New deployment**
4. Click the gear next to "Select type" and choose **Web app**
5. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
6. Click **Deploy** and authorize when prompted
7. Copy the web app URL

> When you update the script code, you must create a **new deployment** (Deploy > New deployment). Just saving does not update the live URL.

### 2. Add to your project

Include the library in your HTML:

```html
<script src="sheets-backend.js"></script>
```

Or copy-paste - it's a single file with no dependencies.

### 3. Use it

```javascript
const db = new SheetsBackend({
  scriptUrl: 'https://script.google.com/macros/s/.../exec',  // from step 1
  localStorageKey: 'my-app',  // namespace for localStorage
});

// Connect to a user's sheet (they paste their sheet URL)
db.connect('https://docs.google.com/spreadsheets/d/1abc.../edit');

// Save data locally (instant)
db.save({ todos: ['buy milk'], settings: { theme: 'dark' } });

// Push to sheet
await db.sync();

// Pull latest from sheet
const fresh = await db.pull();

// Load (tries localStorage first, then sheet)
const loaded = await db.load();
```

### 4. User setup

Each user creates their own Google Sheet:

1. Create a new blank Google Sheet
2. Click **Share > Anyone with the link > Editor**
3. Paste the sheet URL into your app

That's it. No tab renaming, no structure setup. The script uses the first tab automatically.

## API

### `new SheetsBackend(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scriptUrl` | string | `''` | Your deployed Apps Script URL (required) |
| `sheetId` | string | `''` | Google Sheet ID (or set later via `connect()`) |
| `localStorageKey` | string | `'sheets-backend'` | Namespace for localStorage keys |
| `autoLoadSheetId` | boolean | `true` | Auto-read sheetId from URL hash on init |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `connect(urlOrId)` | `string` | Connect to a sheet. Accepts full URL or ID. Saves to localStorage and URL hash. |
| `save(data)` | `object` | Save data to localStorage (instant, no network). |
| `sync()` | `Promise<object>` | Push local state to the sheet. |
| `pull()` | `Promise<object\|null>` | Pull latest from the sheet, replacing local state. Returns null if empty. |
| `load()` | `Promise<object\|null>` | Load data - tries localStorage first, falls back to sheet. |
| `clear()` | `void` | Clear local data. Does not affect the sheet. |
| `disconnect()` | `void` | Remove stored sheetId and clear URL hash. |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `isConnected` | `boolean` | Whether scriptUrl and sheetId are set |
| `isDirty` | `boolean` | Whether local state has unsynced changes |
| `lastSynced` | `string\|null` | ISO timestamp of last sync |
| `shareableUrl` | `string` | Full URL with sheetId in hash |
| `sheetId` | `string` | Current sheet ID |

### Events

```javascript
db.on('connected', ({ sheetId }) => { ... });
db.on('saved', ({ data }) => { ... });
db.on('syncing', ({ direction }) => { ... });   // direction: 'push' or 'pull'
db.on('synced', ({ direction, data }) => { ... });
db.on('error', ({ action, error }) => { ... });
db.on('loaded', ({ source, data }) => { ... }); // source: 'local' or 'sheet'
db.on('cleared', () => { ... });
db.on('disconnected', () => { ... });

// Unsubscribe
const unsub = db.on('synced', handler);
unsub();
```

## Google Apps Script limits

All limits below are per Google account that deployed the script. These are daily limits that reset every 24 hours.

### Free tier (personal @gmail.com)

| Resource | Limit |
|----------|-------|
| Script executions | 5,000 / day |
| Script runtime per call | 6 minutes |
| Simultaneous executions | 30 |
| Spreadsheet read/write calls | 20,000 / day |
| Data payload per request | ~50 MB |
| Spreadsheet size | 10 million cells |

### Google Workspace tier ($7.20/user/month - Business Starter)

| Resource | Limit |
|----------|-------|
| Script executions | 10,000 / day |
| Script runtime per call | 6 minutes (same) |
| Simultaneous executions | 30 (same) |
| Spreadsheet read/write calls | 50,000 / day |

### What happens when you hit the limits

When you exceed a quota, Google Apps Script returns an HTTP error and the specific error message depends on which limit was hit:

- **Daily execution limit exceeded** - returns "Service invoked too many times for one day" error. Requests fail until the quota resets (midnight Pacific Time).
- **Simultaneous execution limit** - returns "Too many simultaneous invocations" error. Retry after a short delay.
- **Script timeout (6 min)** - the script is killed mid-execution. For this use case (reading/writing a single row), you'll never hit this.

The library surfaces these as `error` events, so you can handle them in your UI:

```javascript
db.on('error', ({ error }) => {
  if (error.message.includes('too many times')) {
    showNotice('Daily sync limit reached. Your data is safe in localStorage.');
  }
});
```

Because the app uses localStorage as the primary store, hitting the limit doesn't lose data - users just can't sync until the quota resets.

### Performance

| Operation | Typical latency |
|-----------|----------------|
| localStorage read/write | < 1ms |
| Apps Script cold start (first call) | 2 - 5 seconds |
| Apps Script warm call | 0.5 - 2 seconds |
| Sheet append row | 0.3 - 1 second (included in script time) |

Cold starts happen when the script hasn't been called recently (~15 minutes of inactivity). After the first call, subsequent calls are faster.

### Upgrading

If you outgrow the free tier:

1. **Google Workspace** ($7.20/month) doubles most limits. Deploy the script from a Workspace account instead of a personal Gmail.
2. **Multiple script deployments** - deploy the same script from different Google accounts to multiply the quota. Route users to different endpoints.
3. **Move to a real backend** - the library's API is simple enough to swap the transport layer. Replace `SheetsBackend` with a class that talks to Supabase, Firebase, or any REST API.

## Security model

This is "security through obscurity" - suitable for personal tools, not for sensitive data.

- The **Apps Script URL** is the API endpoint - anyone who has it can read/write to sheets through it
- The **Sheet ID** identifies which sheet to target - anyone with it (and the script URL) can read/write that sheet
- Both values are in the **URL hash fragment**, which is not sent to servers in HTTP requests
- The sheet must be shared as "Anyone with the link can edit"

If you need real auth, you'd need to add Google OAuth to the Apps Script, which adds significant complexity and defeats the "zero setup" goal.

## Package?

This is designed as a single JS file you copy into your project or load from a CDN. No build step, no dependencies, no bundler required. It works equally well as:

- A `<script>` tag pointing to the file
- A copy-pasted file in your project
- An ES module (add `export default SheetsBackend` at the bottom)

If there's demand, it could be published to npm for use in build-tool projects, but the value prop is simplicity - adding a package manager step works against that.

## Examples

See the [`examples/`](examples/) folder:

- **[notes-app.html](examples/notes-app.html)** - A simple notes app demonstrating all features

## License

MIT
