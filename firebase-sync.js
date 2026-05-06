/**
 * firebase-sync.js — Centralized Firebase sync for all DarkAbode modules.
 *
 * Usage in each module:
 *   FBSync.init(appName, getDataFn, setDataFn);
 *   // Call FBSync.schedulePush() after every local save.
 *
 * Requires Firebase compat SDK (app + auth + database) loaded before this file.
 */

(function (global) {
  'use strict';

  const CONFIG_KEY  = 'abode_firebase_config';
  const SYNC_KEY_PFX = 'abode_fb_sync_';

  const S = {
    _appName : '',
    _getData : null,
    _setData : null,
    _auth    : null,
    _db      : null,
    _user    : null,
    _timer   : null,
    _ready   : false,
  };

  const FBSync = {};

  // ── Config helpers ──────────────────────────────────────────────────

  FBSync.getConfig = function () {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch { return null; }
  };

  FBSync.saveConfig = function (cfg) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  };

  FBSync.clearConfig = function () {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(SYNC_KEY_PFX + S._appName);
  };

  // ── Init ────────────────────────────────────────────────────────────

  /**
   * @param {string}   appName   - Unique key for this app (e.g. 'nutrily')
   * @param {Function} getDataFn - async () => serialisable data object / array
   * @param {Function} setDataFn - async (data) => void  (restore data, reload UI)
   */
  FBSync.init = function (appName, getDataFn, setDataFn) {
    S._appName = appName;
    S._getData = getDataFn;
    S._setData = setDataFn;

    const cfg = FBSync.getConfig();
    if (!cfg) { _updateUI(); return; }

    try {
      const app = !firebase.apps.length
        ? firebase.initializeApp(cfg)
        : firebase.app();
      S._auth = firebase.auth(app);
      S._db   = firebase.database(app);
      S._ready = true;

      S._auth.onAuthStateChanged(function (user) {
        S._user = user;
        _updateUI();
        if (user) FBSync.pull();
      });
    } catch (e) {
      console.error('[FBSync] init error:', e);
      _updateUI();
    }
  };

  // ── Auth ────────────────────────────────────────────────────────────

  FBSync.signIn = function () {
    if (!S._auth) { alert('Firebase not configured yet.\nTap "Firebase Config" to set it up.'); return; }
    S._auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .catch(function (e) { alert('Sign-in failed: ' + e.message); });
  };

  FBSync.signOut = function () {
    if (S._auth) S._auth.signOut();
  };

  // ── Push / Pull ─────────────────────────────────────────────────────

  FBSync.push = async function () {
    if (!S._user || !S._db || !S._getData) return;
    try {
      const data = await Promise.resolve(S._getData());
      const ts   = Date.now();
      await S._db.ref('users/' + S._user.uid + '/' + S._appName).set({ data: data, ts: ts });
      localStorage.setItem(SYNC_KEY_PFX + S._appName, ts);
      _updateUI();
      _toast('☁ Synced');
    } catch (e) {
      console.error('[FBSync] push error:', e);
      _toast('⚠ Sync failed');
    }
  };

  FBSync.pull = async function () {
    if (!S._user || !S._db || !S._setData) return;
    try {
      const snap = await S._db.ref('users/' + S._user.uid + '/' + S._appName).get();
      if (snap.exists()) {
        const remote = snap.val();
        await Promise.resolve(S._setData(remote.data));
        localStorage.setItem(SYNC_KEY_PFX + S._appName, remote.ts);
        _updateUI();
      }
    } catch (e) {
      console.error('[FBSync] pull error:', e);
    }
  };

  /** Debounced push — call this after every local save. */
  FBSync.schedulePush = function () {
    clearTimeout(S._timer);
    S._timer = setTimeout(FBSync.push, 2000);
  };

  // ── UI ──────────────────────────────────────────────────────────────

  /**
   * Renders sync controls into element with id="fbSyncPanel".
   * Each app must place <div id="fbSyncPanel"></div> in its settings area.
   */
  function _updateUI() {
    const el = document.getElementById('fbSyncPanel');
    if (!el) return;

    const cfg = FBSync.getConfig();
    const u   = S._user;
    const ts  = localStorage.getItem(SYNC_KEY_PFX + S._appName);
    const ago = ts ? _timeAgo(+ts) : null;

    const secStyle = [
      'font-size:10.5px;color:var(--muted);text-transform:uppercase;',
      'letter-spacing:.07em;margin:18px 0 10px'
    ].join('');

    const btnPrimary = [
      'width:100%;padding:12px;background:var(--text);color:#fff;border:none;',
      'border-radius:var(--rs,14px);font-family:inherit;font-size:13.5px;',
      'font-weight:500;cursor:pointer;transition:opacity .15s;margin-bottom:8px;',
      'display:flex;align-items:center;justify-content:center;gap:8px'
    ].join('');

    const btnGhost = [
      'width:100%;padding:11px;background:transparent;',
      'border:1.5px solid var(--bdr,#e4ddd3);border-radius:var(--rs,14px);',
      'font-family:inherit;font-size:13px;font-weight:500;',
      'color:var(--text,#1a1714);cursor:pointer;transition:background .15s;margin-bottom:6px'
    ].join('');

    const btnMuted = btnGhost.replace('color:var(--text,#1a1714)', 'color:var(--muted,#9a9189)');

    if (!cfg) {
      el.innerHTML =
        '<div style="' + secStyle + '">☁ Cloud Sync</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">' +
          'Sync your data across devices with Firebase.' +
        '</div>' +
        '<button style="' + btnPrimary + '" onclick="FBSync.openSetup()">' +
          '⚙ Set up Firebase' +
        '</button>';
      return;
    }

    if (!u) {
      el.innerHTML =
        '<div style="' + secStyle + '">☁ Cloud Sync</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">' +
          'Sign in to sync across devices.' +
        '</div>' +
        '<button style="' + btnPrimary + '" onclick="FBSync.signIn()">🔑 Sign in with Google</button>' +
        '<button style="' + btnMuted + '" onclick="FBSync.openSetup()">⚙ Firebase Config</button>';
      return;
    }

    el.innerHTML =
      '<div style="' + secStyle + '">☁ Cloud Sync</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">' +
        'Signed in as <strong style="color:var(--text)">' + _esc(u.email) + '</strong><br>' +
        '<span style="font-size:11px">' + (ago ? 'Last synced ' + ago : 'Not yet synced') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px">' +
        '<button onclick="FBSync.push()" style="flex:1;padding:11px;background:var(--text);color:#fff;' +
          'border:none;border-radius:var(--rs,14px);font-family:inherit;font-size:13px;' +
          'font-weight:500;cursor:pointer;transition:opacity .15s">⬆ Push</button>' +
        '<button onclick="FBSync.pull()" style="flex:1;padding:11px;background:var(--bg,#ede8e0);' +
          'border:1.5px solid var(--bdr,#e4ddd3);border-radius:var(--rs,14px);font-family:inherit;' +
          'font-size:13px;font-weight:500;color:var(--text);cursor:pointer">⬇ Pull</button>' +
      '</div>' +
      '<button onclick="FBSync.signOut()" style="' + btnMuted + '">Sign out</button>';
  }

  // ── Setup modal ─────────────────────────────────────────────────────

  FBSync.openSetup = function () {
    const cfg = FBSync.getConfig() || {};
    const fields = [
      { k: 'apiKey',            label: 'API Key',             full: true  },
      { k: 'authDomain',        label: 'Auth Domain',         full: true  },
      { k: 'databaseURL',       label: 'Database URL',        full: true  },
      { k: 'projectId',         label: 'Project ID',          full: false },
      { k: 'storageBucket',     label: 'Storage Bucket',      full: false },
      { k: 'messagingSenderId', label: 'Messaging Sender ID', full: false },
      { k: 'appId',             label: 'App ID',              full: false },
    ];

    const inputStyle = [
      'width:100%;padding:10px 12px;background:var(--bg,#ede8e0);',
      'border:1.5px solid var(--bdr,#e4ddd3);border-radius:var(--rs,14px);',
      'font-family:inherit;font-size:13px;color:var(--text,#1a1714);',
      'outline:none;box-sizing:border-box'
    ].join('');

    const fullFields  = fields.filter(f =>  f.full).map(f => _cfgField(f, cfg, inputStyle)).join('');
    const halfFields  = fields.filter(f => !f.full);
    const halfGrid    = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
      halfFields.map(f => _cfgField(f, cfg, inputStyle)).join('') + '</div>';

    const html =
      '<div id="fbSetupOv" style="position:fixed;inset:0;z-index:9999;' +
        'background:rgba(26,23,20,.4);backdrop-filter:blur(3px);' +
        'display:flex;align-items:flex-end;justify-content:center"' +
        ' onclick="if(event.target===this)document.getElementById(\'fbSetupOv\').remove()">' +
        '<div style="background:var(--card,#fff);border-radius:24px 24px 0 0;width:100%;' +
          'max-width:430px;max-height:88dvh;display:flex;flex-direction:column;' +
          'animation:su .26s cubic-bezier(.4,0,.2,1);padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))">' +
          '<div style="width:36px;height:4px;background:var(--bdr,#e4ddd3);border-radius:4px;margin:12px auto 0"></div>' +
          '<div style="padding:16px 22px 0;display:flex;align-items:flex-start;justify-content:space-between">' +
            '<div>' +
              '<div style="font-family:\'Playfair Display\',serif;font-size:20px;font-weight:600">Firebase Config</div>' +
              '<div style="font-size:12px;color:var(--muted);margin-top:2px">' +
                'Find these at console.firebase.google.com → Project Settings → Your apps' +
              '</div>' +
            '</div>' +
            '<button onclick="document.getElementById(\'fbSetupOv\').remove()" ' +
              'style="background:var(--bg,#ede8e0);border:none;border-radius:50%;width:28px;height:28px;' +
              'cursor:pointer;font-size:14px;color:var(--muted);display:flex;align-items:center;justify-content:center">✕</button>' +
          '</div>' +
          '<div style="padding:16px 22px;overflow-y:auto;flex:1">' +
            '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6;' +
              'background:var(--bg,#ede8e0);border-radius:12px;padding:12px">' +
              '<strong style="color:var(--text)">Setup:</strong> Create a Firebase project → ' +
              'Enable <em>Realtime Database</em> + <em>Google Sign-in</em> under Authentication → ' +
              'Add <strong>*.github.io</strong> (or your domain) to authorised domains.' +
            '</div>' +
            fullFields +
            halfGrid +
            '<button onclick="FBSync._saveSetup()" style="width:100%;padding:13px;' +
              'background:var(--text,#1a1714);color:#fff;border:none;' +
              'border-radius:var(--rs,14px);font-family:inherit;font-size:14px;' +
              'font-weight:500;cursor:pointer;margin-bottom:8px">Save & Reconnect</button>' +
            '<button onclick="FBSync._clearSetup()" style="width:100%;padding:11px;' +
              'background:transparent;border:1.5px solid var(--bdr,#e4ddd3);' +
              'border-radius:var(--rs,14px);font-family:inherit;font-size:12.5px;' +
              'color:var(--red,#b85c44);cursor:pointer">Clear config &amp; sign out</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  };

  function _cfgField(f, cfg, inputStyle) {
    return (
      '<div style="margin-bottom:10px">' +
        '<div style="font-size:11.5px;color:var(--muted);margin-bottom:4px">' + f.label + '</div>' +
        '<input id="fbCfg_' + f.k + '" value="' + _esc(cfg[f.k] || '') + '" ' +
          'placeholder="' + f.k + '" style="' + inputStyle + '">' +
      '</div>'
    );
  }

  FBSync._saveSetup = function () {
    const required = ['apiKey', 'authDomain', 'databaseURL', 'projectId'];
    const all = ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'];
    const cfg = {};
    let ok = true;
    all.forEach(function (k) {
      const v = (document.getElementById('fbCfg_' + k)?.value || '').trim();
      if (v) cfg[k] = v;
      if (required.includes(k) && !v) ok = false;
    });
    if (!ok) { alert('Please fill in at least: apiKey, authDomain, databaseURL, projectId'); return; }
    FBSync.saveConfig(cfg);
    document.getElementById('fbSetupOv')?.remove();
    location.reload();
  };

  FBSync._clearSetup = function () {
    if (!confirm('Clear Firebase config and sign out?')) return;
    if (S._auth) { S._auth.signOut().catch(function(){}); }
    FBSync.clearConfig();
    document.getElementById('fbSetupOv')?.remove();
    location.reload();
  };

  // ── Helpers ─────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60)  return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function _toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    setTimeout(function () { el.classList.remove('on'); }, 2200);
  }

  global.FBSync = FBSync;
})(window);
