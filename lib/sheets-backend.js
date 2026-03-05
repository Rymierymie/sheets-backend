/**
 * SheetsBackend - Use Google Sheets as a read/write JSON backend for static sites.
 *
 * Usage:
 *   const db = new SheetsBackend({
 *     scriptUrl: 'https://script.google.com/macros/s/.../exec',
 *     sheetId: '1abc...',              // Google Sheet ID
 *     localStorageKey: 'my-app-data',  // optional, defaults to 'sheets-backend'
 *     autoLoadSheetId: true,           // optional, read sheetId from URL hash
 *   });
 *
 *   // Load data (localStorage first, then sheet)
 *   const data = await db.load();
 *
 *   // Save locally (instant)
 *   db.save({ notes: [...] });
 *
 *   // Sync to sheet (network call)
 *   const result = await db.sync();
 *
 *   // Pull latest from sheet
 *   const fresh = await db.pull();
 */
class SheetsBackend {
  constructor(options = {}) {
    this.scriptUrl = options.scriptUrl || '';
    this.sheetId = options.sheetId || '';
    this.localStorageKey = options.localStorageKey || 'sheets-backend';
    this._state = null;
    this._lastSynced = null;
    this._dirty = false;
    this._listeners = {};

    // Auto-detect sheetId from URL hash
    if (options.autoLoadSheetId !== false) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const hashId = params.get('sheetId');
      if (hashId) this.sheetId = hashId;
    }

    // Fall back to localStorage for sheetId
    if (!this.sheetId) {
      const saved = localStorage.getItem(this.localStorageKey + ':sheetId');
      if (saved) this.sheetId = saved;
    }
  }

  // --- Public API ---

  /**
   * Connect to a sheet. Accepts a full Google Sheets URL or just the ID.
   * Saves the sheetId to localStorage and updates the URL hash.
   */
  connect(sheetUrlOrId) {
    this.sheetId = this._extractSheetId(sheetUrlOrId);
    localStorage.setItem(this.localStorageKey + ':sheetId', this.sheetId);
    window.location.hash = 'sheetId=' + encodeURIComponent(this.sheetId);
    this._emit('connected', { sheetId: this.sheetId });
    return this.sheetId;
  }

  /**
   * Whether a sheet is connected.
   */
  get isConnected() {
    return Boolean(this.scriptUrl && this.sheetId);
  }

  /**
   * Whether local state has unsynced changes.
   */
  get isDirty() {
    return this._dirty;
  }

  /**
   * Timestamp of last successful sync to/from sheet.
   */
  get lastSynced() {
    return this._lastSynced;
  }

  /**
   * Get a shareable URL that includes the sheetId in the hash.
   */
  get shareableUrl() {
    const url = new URL(window.location.href);
    url.hash = 'sheetId=' + encodeURIComponent(this.sheetId);
    return url.toString();
  }

  /**
   * Load data. Tries localStorage first for speed. Returns the data object.
   * If localStorage is empty and a sheet is connected, pulls from the sheet.
   */
  async load() {
    // Try localStorage first
    const saved = localStorage.getItem(this.localStorageKey + ':data');
    if (saved) {
      try {
        this._state = JSON.parse(saved);
        this._emit('loaded', { source: 'local', data: this._state });
        return this._state;
      } catch (e) {
        // Corrupted localStorage, fall through to sheet
      }
    }

    // Fall back to sheet
    if (this.isConnected) {
      return this.pull();
    }

    return null;
  }

  /**
   * Save data to localStorage (instant, no network).
   * Call sync() to push to the sheet.
   */
  save(data) {
    this._state = data;
    this._dirty = true;
    localStorage.setItem(this.localStorageKey + ':data', JSON.stringify(data));
    this._emit('saved', { data });
    return data;
  }

  /**
   * Push current local state to the Google Sheet.
   * Returns { status, timestamp } on success, throws on failure.
   */
  async sync() {
    if (!this.isConnected) throw new Error('Not connected to a sheet');
    if (!this._state) throw new Error('No data to sync - call save() first');

    this._emit('syncing', { direction: 'push' });

    const response = await fetch(this.scriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        sheetId: this.sheetId,
        data: this._state,
      }),
    });

    // Apps Script redirects on POST - fetch follows it and returns the response
    const result = await response.json();

    if (result.error) {
      const err = new Error(result.error);
      this._emit('error', { action: 'sync', error: err });
      throw err;
    }

    this._lastSynced = new Date().toISOString();
    this._dirty = false;
    this._emit('synced', { direction: 'push', timestamp: this._lastSynced });
    return result;
  }

  /**
   * Pull the latest state from the Google Sheet, replacing local state.
   * Returns the data object, or null if the sheet is empty.
   */
  async pull() {
    if (!this.isConnected) throw new Error('Not connected to a sheet');

    this._emit('syncing', { direction: 'pull' });

    const url = this.scriptUrl + '?sheetId=' + encodeURIComponent(this.sheetId);
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      const err = new Error(data.error);
      this._emit('error', { action: 'pull', error: err });
      throw err;
    }

    // Empty sheet returns {}
    if (Object.keys(data).length === 0) {
      this._emit('synced', { direction: 'pull', data: null });
      return null;
    }

    this._state = data;
    this._lastSynced = new Date().toISOString();
    this._dirty = false;
    localStorage.setItem(this.localStorageKey + ':data', JSON.stringify(data));
    this._emit('synced', { direction: 'pull', data, timestamp: this._lastSynced });
    return data;
  }

  /**
   * Clear all local data (localStorage). Does not affect the sheet.
   */
  clear() {
    this._state = null;
    this._dirty = false;
    localStorage.removeItem(this.localStorageKey + ':data');
    this._emit('cleared');
  }

  /**
   * Disconnect - clear the stored sheetId and remove hash.
   */
  disconnect() {
    this.sheetId = '';
    localStorage.removeItem(this.localStorageKey + ':sheetId');
    window.location.hash = '';
    this._emit('disconnected');
  }

  // --- Events ---

  /**
   * Listen for events: 'connected', 'loaded', 'saved', 'syncing', 'synced', 'error', 'cleared', 'disconnected'
   */
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  // --- Private ---

  _emit(event, detail = {}) {
    (this._listeners[event] || []).forEach(cb => cb(detail));
  }

  _extractSheetId(input) {
    if (!input) return '';
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input.trim();
  }
}
