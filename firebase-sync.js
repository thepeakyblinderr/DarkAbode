/**
 * firebase-sync.js — Centralized Firebase sync for all DarkAbode modules.
 *
 * Usage in each module:
 *   FBSync.init(appName, getDataFn, setDataFn);
 *   FBSync.schedulePush();   // call after every local save for auto-push
 *
 * Requires Firebase compat SDK (app + auth + database) loaded before this file.
 *
 * Sync model:
 *   - Real-time pull: onValue listener fires immediately when another device pushes.
 *   - Auto-push: modules call FBSync.schedulePush() after saves (2s debounce).
 *   - Manual push: ↺ button in the sync panel for immediate upload.
 *   - No manual Pull needed — the listener handles it automatically.
 */

(function (global) {
  'use strict';

  const CONFIG_KEY   = 'abode_firebase_config';
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
    _listener: null,   // holds the off() function for the active onValue listener
  };

  const FBSync = {};

  // ── Config ──────────────────────────────────────────────────────────────────

  FBSync.getConfig = function () {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch (_) { return null; }
  };
  FBSync.saveConfig  = function (cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); };
  FBSync.clearConfig = function () {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(SYNC_KEY_PFX + S._appName);
  };

  // ── Init ────────────────────────────────────────────────────────────────────

  FBSync.init = function (appName, getDataFn, setDataFn) {
    S._appName = appName;
    S._getData = getDataFn;
    S._setData = setDataFn;

    const cfg = FBSync.getConfig();
    if (!cfg) { _updateUI(); return; }

    try {
      const app = !firebase.apps.length ? firebase.initializeApp(cfg) : firebase.app();
      S._auth  = firebase.auth(app);
      S._db    = firebase.database(app);
      S._ready = true;

      S._auth.onAuthStateChanged(function (user) {
        // Tear down any existing listener before switching users
        if (S._listener) { S._listener(); S._listener = null; }
        S._user = user;
        _updateUI();
        if (user) _startListener();
      });
    } catch (e) {
      console.error('[FBSync] init error:', e);
      _updateUI();
    }
  };

  // ── Real-time listener (replaces manual Pull) ────────────────────────────────

  function _startListener() {
    const ref = S._db.ref('users/' + S._user.uid + '/' + S._appName);

    function onSnap(snap) {
      if (!snap.exists()) { _updateUI(); return; }
      const remote  = snap.val();
      const localTs = parseInt(localStorage.getItem(SYNC_KEY_PFX + S._appName) || '0', 10);

      // Only apply if the cloud has newer data than we last synced.
      // This means our own push (which sets localTs = remote.ts) won't re-apply.
      if (remote.ts > localTs) {
        Promise.resolve(S._setData(remote.data)).then(function () {
          localStorage.setItem(SYNC_KEY_PFX + S._appName, String(remote.ts));
          _updateUI();
          _toast('☁ Synced from cloud');
        }).catch(function (e) {
          console.error('[FBSync] setData error:', e);
        });
      } else {
        _updateUI(); // refresh "last synced" timestamp display
      }
    }

    ref.on('value', onSnap, function (err) {
      console.error('[FBSync] listener error:', err);
    });

    // Store a cleanup function so we can detach when user signs out
    S._listener = function () { ref.off('value', onSnap); };
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  FBSync.signIn = function () {
    if (!S._auth) { alert('Firebase not configured.\nTap "Firebase Config" to set it up.'); return; }
    S._auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .catch(function (e) { alert('Sign-in failed: ' + e.message); });
  };

  FBSync.signOut = function () {
    if (S._auth) S._auth.signOut();
  };

  // ── Push ────────────────────────────────────────────────────────────────────

  FBSync.push = async function () {
    if (!S._user || !S._db || !S._getData) return;
    try {
      const data = await Promise.resolve(S._getData());
      const ts   = Date.now();
      await S._db.ref('users/' + S._user.uid + '/' + S._appName).set({ data: data, ts: ts });
      // Set localTs = remote.ts so the onValue listener skips this change on this device
      localStorage.setItem(SYNC_KEY_PFX + S._appName, String(ts));
      _updateUI();
      _toast('☁ Synced');
    } catch (e) {
      console.error('[FBSync] push error:', e);
      _toast('⚠ Sync failed');
    }
  };

  /** Debounced push — call after every local save. */
  FBSync.schedulePush = function () {
    clearTimeout(S._timer);
    S._timer = setTimeout(FBSync.push, 2000);
  };

  // ── UI ──────────────────────────────────────────────────────────────────────

  function _updateUI() {
    const el = document.getElementById('fbSyncPanel');
    if (!el) return;

    const cfg = FBSync.getConfig();
    const u   = S._user;
    const ts  = localStorage.getItem(SYNC_KEY_PFX + S._appName);
    const ago = ts ? _timeAgo(+ts) : null;

    const btnPrimary = [
      'width:100%;padding:12px;background:var(--text,#0a0a0a);color:#fff;',
      'border:none;border-radius:var(--rs,14px);font-family:inherit;',
      'font-size:13.5px;font-weight:500;cursor:pointer;margin-bottom:8px;',
      'display:flex;align-items:center;justify-content:center;gap:8px'
    ].join('');

    const btnGhost = [
      'width:100%;padding:11px;background:transparent;',
      'border:1.5px solid var(--bdr,#e4e4e0);border-radius:var(--rs,14px);',
      'font-family:inherit;font-size:13px;font-weight:500;',
      'color:var(--text,#0a0a0a);cursor:pointer;margin-bottom:6px'
    ].join('');

    const btnMuted = btnGhost.replace('color:var(--text,#0a0a0a)', 'color:var(--muted,#6a6a60)');

    const hdr = '<div style="font-size:10px;color:var(--muted,#6a6a60);text-transform:uppercase;' +
                'letter-spacing:.08em;font-weight:600;margin-bottom:10px">☁ Cloud Sync</div>';

    if (!cfg) {
      el.innerHTML = hdr +
        '<div style="font-size:12px;color:var(--muted,#6a6a60);margin-bottom:10px;line-height:1.6">' +
          'Sync your data across devices with Firebase.' +
        '</div>' +
        '<button style="' + btnPrimary + '" onclick="FBSync.openSetup()">⚙ Set up Firebase</button>';
      return;
    }

    if (!u) {
      el.innerHTML = hdr +
        '<div style="font-size:12px;color:var(--muted,#6a6a60);margin-bottom:10px;line-height:1.6">' +
          'Sign in to sync across devices.' +
        '</div>' +
        '<button style="' + btnPrimary + '" onclick="FBSync.signIn()">Sign in with Google</button>' +
        '<button style="' + btnMuted + '" onclick="FBSync.openSetup()">⚙ Firebase Config</button>';
      return;
    }

    // Signed in — show auto-sync status
    el.innerHTML = hdr +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<div style="min-width:0;flex:1;padding-right:8px">' +
          '<div style="font-size:12px;font-weight:600;color:var(--text,#0a0a0a);' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(u.email) + '</div>' +
          '<div style="display:flex;align-items:center;gap:5px;margin-top:3px">' +
            '<span style="width:6px;height:6px;border-radius:50%;background:#2ea878;' +
              'display:inline-block;flex-shrink:0"></span>' +
            '<span style="font-size:11px;color:var(--muted,#6a6a60)">' +
              'Auto-sync · ' + (ago ? 'last ' + ago : 'not yet synced') +
            '</span>' +
          '</div>' +
        '</div>' +
        '<button onclick="FBSync.push()" title="Sync now" style="' +
          'flex-shrink:0;background:var(--bg,#f5f5f3);border:1px solid var(--bdr,#e4e4e0);' +
          'border-radius:8px;padding:6px 12px;font-size:14px;cursor:pointer;' +
          'color:var(--muted,#6a6a60);transition:background .15s">↺</button>' +
      '</div>' +
      '<button style="' + btnMuted + 'margin-bottom:4px" onclick="FBSync.signOut()">Sign out</button>' +
      '<button style="font-size:10px;color:var(--muted,#6a6a60);background:none;border:none;' +
        'cursor:pointer;padding:2px 0;letter-spacing:.04em;display:block" ' +
        'onclick="FBSync.openSetup()">⚙ Firebase Config</button>';
  }

  // ── Setup modal ─────────────────────────────────────────────────────────────

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
      'width:100%;padding:10px 12px;background:var(--bg,#f5f5f3);',
      'border:1.5px solid var(--bdr,#e4e4e0);border-radius:var(--rs,14px);',
      'font-family:inherit;font-size:13px;color:var(--text,#0a0a0a);',
      'outline:none;box-sizing:border-box'
    ].join('');

    const fullFields = fields.filter(f =>  f.full).map(f => _cfgField(f, cfg, inputStyle)).join('');
    const halfGrid   =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
      fields.filter(f => !f.full).map(f => _cfgField(f, cfg, inputStyle)).join('') +
      '</div>';

    const html =
      '<div id="fbSetupOv" style="position:fixed;inset:0;z-index:9999;' +
        'background:rgba(0,0,0,.45);backdrop-filter:blur(3px);' +
        'display:flex;align-items:flex-end;justify-content:center"' +
        ' onclick="if(event.target===this)document.getElementById(\'fbSetupOv\').remove()">' +
        '<div style="background:var(--card,var(--surface,#fff));border-radius:24px 24px 0 0;' +
          'width:100%;max-width:430px;max-height:88dvh;display:flex;flex-direction:column;' +
          'padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))">' +
          '<div style="width:36px;height:4px;background:var(--bdr,#e4e4e0);border-radius:4px;' +
            'margin:12px auto 0"></div>' +
          '<div style="padding:16px 22px 0;display:flex;align-items:flex-start;' +
            'justify-content:space-between">' +
            '<div>' +
              '<div style="font-family:var(--sans,system-ui);font-size:18px;font-weight:800;' +
                'color:var(--text,#0a0a0a)">Firebase Config</div>' +
              '<div style="font-size:12px;color:var(--muted,#6a6a60);margin-top:2px">' +
                'console.firebase.google.com → Project Settings → Your apps' +
              '</div>' +
            '</div>' +
            '<button onclick="document.getElementById(\'fbSetupOv\').remove()" ' +
              'style="background:var(--bg,#f5f5f3);border:none;border-radius:50%;width:28px;' +
              'height:28px;cursor:pointer;font-size:14px;color:var(--muted,#6a6a60);' +
              'display:flex;align-items:center;justify-content:center">✕</button>' +
          '</div>' +
          '<div style="padding:16px 22px;overflow-y:auto;flex:1">' +
            '<div style="font-size:12px;color:var(--muted,#6a6a60);margin-bottom:14px;' +
              'line-height:1.6;background:var(--bg,#f5f5f3);border-radius:12px;padding:12px">' +
              '<strong style="color:var(--text,#0a0a0a)">Setup:</strong> Create a Firebase project → ' +
              'Enable <em>Realtime Database</em> + <em>Google Sign-in</em> → ' +
              'Add your domain to authorised domains.' +
            '</div>' +
            fullFields +
            halfGrid +
            '<button onclick="FBSync._saveSetup()" style="width:100%;padding:13px;' +
              'background:var(--text,#0a0a0a);color:#fff;border:none;' +
              'border-radius:var(--rs,14px);font-family:inherit;font-size:14px;' +
              'font-weight:500;cursor:pointer;margin-bottom:8px">Save &amp; Reconnect</button>' +
            '<button onclick="FBSync._clearSetup()" style="width:100%;padding:11px;' +
              'background:transparent;border:1.5px solid var(--bdr,#e4e4e0);' +
              'border-radius:var(--rs,14px);font-family:inherit;font-size:12.5px;' +
              'color:var(--red,#c0392b);cursor:pointer">Clear config &amp; sign out</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  };

  function _cfgField(f, cfg, inputStyle) {
    return (
      '<div style="margin-bottom:10px">' +
        '<div style="font-size:11.5px;color:var(--muted,#6a6a60);margin-bottom:4px">' + f.label + '</div>' +
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
    if (S._auth) S._auth.signOut().catch(function () {});
    FBSync.clearConfig();
    document.getElementById('fbSetupOv')?.remove();
    location.reload();
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function _toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._fbT);
    el._fbT = setTimeout(function () {
      el.style.transform = 'translateX(-50%) translateY(80px)';
    }, 2200);
  }

  global.FBSync = FBSync;
})(window);
