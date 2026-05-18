(function () {
  'use strict';

  var BASE = 'https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Zm1jeW1hcmJrcmp6YXFhcHV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDQyMzMsImV4cCI6MjA5NDE4MDIzM30.LKDGO75T-ph4tKrSDMA7uXBSgcFgXAlAZzlENmDHQk8';

  var SK_KEY    = 'rfs_chat_sk';
  var NAME_KEY  = 'rfs_chat_name';
  var EMAIL_KEY = 'rfs_chat_email';
  var MSGS_KEY  = 'rfs_chat_msgs';

  var sessionKey   = localStorage.getItem(SK_KEY);
  var visitorName  = localStorage.getItem(NAME_KEY) || '';
  var visitorEmail = localStorage.getItem(EMAIL_KEY) || '';
  var isOpen       = false;
  var pollTimer    = null;
  var bgTimer      = null;
  var renderedIds  = {};
  var storedMsgs   = [];
  var unread       = 0;

  try {
    storedMsgs = JSON.parse(localStorage.getItem(MSGS_KEY) || '[]');
    storedMsgs.forEach(function (m) { renderedIds[m.id] = true; });
  } catch (e) { storedMsgs = []; }

  // ── Styles ───────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    '#rfs-cb{position:fixed;bottom:28px;right:28px;z-index:9998;width:56px;height:56px;',
    'border-radius:50%;background:#C9A84C;border:none;cursor:pointer;display:flex;',
    'align-items:center;justify-content:center;',
    'box-shadow:0 4px 24px rgba(201,168,76,.45);transition:transform .2s,box-shadow .2s;}',
    '#rfs-cb:hover{transform:scale(1.07);box-shadow:0 6px 32px rgba(201,168,76,.6);}',
    '#rfs-cb svg{width:24px;height:24px;fill:#0A0A0A;pointer-events:none;}',
    '#rfs-badge{position:absolute;top:-4px;right:-4px;width:20px;height:20px;border-radius:50%;',
    'background:#E8C97A;border:2px solid #0A0A0A;display:none;align-items:center;',
    'justify-content:center;font-size:10px;font-weight:700;color:#0A0A0A;font-family:sans-serif;}',
    '#rfs-panel{position:fixed;bottom:96px;right:28px;z-index:9998;width:360px;',
    'background:#111111;border:1px solid rgba(201,168,76,.18);display:flex;flex-direction:column;',
    'max-height:560px;transform:translateY(16px) scale(.97);opacity:0;pointer-events:none;',
    'transition:transform .2s ease,opacity .2s ease;',
    'box-shadow:0 20px 70px rgba(0,0,0,.7);font-family:"DM Sans",sans-serif;}',
    '#rfs-panel.open{transform:translateY(0) scale(1);opacity:1;pointer-events:all;}',
    '.rcp-head{padding:14px 16px;background:#0A0A0A;border-bottom:1px solid rgba(201,168,76,.12);',
    'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}',
    '.rcp-av{width:34px;height:34px;border-radius:50%;background:rgba(201,168,76,.1);',
    'border:1px solid rgba(201,168,76,.25);display:flex;align-items:center;justify-content:center;',
    'font-family:"Cormorant Garamond",Georgia,serif;font-size:16px;font-weight:700;color:#C9A84C;flex-shrink:0;}',
    '.rcp-hl{display:flex;flex-direction:column;margin-left:10px;}',
    '.rcp-name{font-size:13px;font-weight:600;color:#FFF;letter-spacing:.02em;}',
    '.rcp-status{display:flex;align-items:center;gap:5px;margin-top:2px;}',
    '.rcp-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;flex-shrink:0;}',
    '.rcp-status span{font-size:10px;color:#AAAAAA;letter-spacing:.04em;}',
    '.rcp-close{background:none;border:none;color:#777;cursor:pointer;font-size:20px;',
    'line-height:1;padding:2px 4px;transition:color .2s;}',
    '.rcp-close:hover{color:#E8C97A;}',
    '.rcp-msgs{flex:1;overflow-y:auto;padding:16px 12px;display:flex;flex-direction:column;gap:10px;',
    'scrollbar-width:thin;scrollbar-color:rgba(201,168,76,.15) transparent;}',
    '.rcp-msgs::-webkit-scrollbar{width:3px;}',
    '.rcp-msgs::-webkit-scrollbar-thumb{background:rgba(201,168,76,.2);}',
    '.rcp-intro{margin:0;padding:14px 12px;background:rgba(201,168,76,.04);',
    'border-bottom:1px solid rgba(201,168,76,.08);flex-shrink:0;}',
    '.rcp-intro strong{display:block;font-size:13px;font-weight:600;color:#E0E0E0;margin-bottom:4px;}',
    '.rcp-intro p{font-size:12px;color:#AAAAAA;line-height:1.6;margin:0;}',
    '.rcp-fields{display:flex;flex-direction:column;gap:8px;padding:10px 12px;',
    'border-bottom:1px solid rgba(201,168,76,.08);flex-shrink:0;}',
    '.rcp-field{background:#0A0A0A;border:1px solid rgba(201,168,76,.15);color:#FFF;',
    'font-family:"DM Sans",sans-serif;font-size:12px;padding:8px 10px;outline:none;',
    'transition:border-color .2s;width:100%;box-sizing:border-box;}',
    '.rcp-field::placeholder{color:#555;}',
    '.rcp-field:focus{border-color:rgba(201,168,76,.4);}',
    '.rcp-field.err{border-color:#ff6b6b;}',
    '.rcp-bar{display:flex;align-items:center;padding:10px 12px;',
    'border-top:1px solid rgba(201,168,76,.1);flex-shrink:0;gap:8px;}',
    '.rcp-input{flex:1;background:none;border:none;outline:none;color:#FFF;',
    'font-family:"DM Sans",sans-serif;font-size:13px;}',
    '.rcp-input::placeholder{color:#555;}',
    '.rcp-send{background:none;border:none;cursor:pointer;color:#C9A84C;padding:4px;',
    'display:flex;align-items:center;transition:color .2s,opacity .2s;}',
    '.rcp-send:hover{color:#E8C97A;}',
    '.rcp-send svg{width:20px;height:20px;fill:currentColor;}',
    '.rcp-msg{display:flex;flex-direction:column;max-width:85%;}',
    '.rcp-msg.visitor{align-self:flex-end;align-items:flex-end;}',
    '.rcp-msg.agent{align-self:flex-start;align-items:flex-start;}',
    '.rcp-bubble{padding:9px 12px;font-size:13px;line-height:1.55;word-break:break-word;}',
    '.rcp-msg.visitor .rcp-bubble{background:#C9A84C;color:#0A0A0A;}',
    '.rcp-msg.agent .rcp-bubble{background:#1A1A1A;color:#E0E0E0;',
    'border:1px solid rgba(255,255,255,.06);}',
    '.rcp-ts{font-size:10px;color:#555;margin-top:3px;}',
    '.rcp-foot{padding:6px 12px 8px;font-size:9px;color:rgba(255,255,255,.2);',
    'text-align:center;letter-spacing:.06em;flex-shrink:0;}',
    '@media(max-width:480px){',
    '#rfs-panel{width:calc(100vw - 20px);right:10px;bottom:80px;max-height:calc(100vh - 100px);}',
    '#rfs-cb{bottom:16px;right:16px;}}',
  ].join('');
  document.head.appendChild(css);

  // ── Bubble ───────────────────────────────────────────────
  var bubble = document.createElement('button');
  bubble.id = 'rfs-cb';
  bubble.setAttribute('aria-label', 'Open chat');
  bubble.setAttribute('aria-expanded', 'false');
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>'
                  + '<div id="rfs-badge"></div>';
  document.body.appendChild(bubble);

  // ── Panel ────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = 'rfs-panel';
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = [
    '<div class="rcp-head">',
    '  <div style="display:flex;align-items:center;">',
    '    <div class="rcp-av">R</div>',
    '    <div class="rcp-hl">',
    '      <div class="rcp-name">RealtyFlow Systems</div>',
    '      <div class="rcp-status"><div class="rcp-dot"></div><span>Usually replies in minutes</span></div>',
    '    </div>',
    '  </div>',
    '  <button class="rcp-close" id="rfs-close" aria-label="Close">&times;</button>',
    '</div>',
    '<div id="rfs-intro" class="rcp-intro" style="display:none;">',
    '  <strong>Hey there 👋</strong>',
    '  <p>Ask a question or tell us what you\'re working on — Erics will get back to you shortly.</p>',
    '</div>',
    '<div class="rcp-msgs" id="rfs-msgs"></div>',
    '<div class="rcp-fields" id="rfs-fields" style="display:none;">',
    '  <input class="rcp-field" id="rfs-name" type="text" placeholder="Your name" maxlength="80" autocomplete="name"/>',
    '  <input class="rcp-field" id="rfs-email" type="email" placeholder="Email (so we can follow up)" autocomplete="email"/>',
    '</div>',
    '<div class="rcp-bar">',
    '  <input class="rcp-input" id="rfs-input" type="text" placeholder="Type a message..." maxlength="500" autocomplete="off"/>',
    '  <button class="rcp-send" id="rfs-send" aria-label="Send">',
    '    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    '  </button>',
    '</div>',
    '<div class="rcp-foot">REALTYFLOW SYSTEMS &bull; GREATER BOSTON</div>',
  ].join('');
  document.body.appendChild(panel);

  var msgsEl   = document.getElementById('rfs-msgs');
  var inputEl  = document.getElementById('rfs-input');
  var sendEl   = document.getElementById('rfs-send');
  var closeEl  = document.getElementById('rfs-close');
  var fieldsEl = document.getElementById('rfs-fields');
  var introEl  = document.getElementById('rfs-intro');
  var nameEl   = document.getElementById('rfs-name');
  var emailEl  = document.getElementById('rfs-email');
  var badgeEl  = document.getElementById('rfs-badge');

  // ── Helpers ──────────────────────────────────────────────
  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  }

  function renderMsgs(msgs) {
    var added = 0;
    msgs.forEach(function (m) {
      if (renderedIds[m.id]) return;
      renderedIds[m.id] = true;
      added++;
      var div = document.createElement('div');
      div.className = 'rcp-msg ' + m.sender;
      div.innerHTML = '<div class="rcp-bubble">' + esc(m.body) + '</div>'
                    + '<div class="rcp-ts">' + fmtTime(m.created_at) + '</div>';
      msgsEl.appendChild(div);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
    // Merge into stored cache (keep last 60)
    storedMsgs = storedMsgs.concat(
      msgs.filter(function (m) { return !storedMsgs.find(function (s) { return s.id === m.id; }); })
    ).slice(-60);
    try { localStorage.setItem(MSGS_KEY, JSON.stringify(storedMsgs)); } catch(e) {}
    return added;
  }

  function showBadge(n) {
    unread += n;
    if (unread > 0) {
      badgeEl.textContent = unread;
      badgeEl.style.display = 'flex';
    }
  }
  function clearBadge() {
    unread = 0;
    badgeEl.style.display = 'none';
  }

  // ── Init UI ──────────────────────────────────────────────
  function initUI() {
    if (storedMsgs.length > 0) {
      renderMsgs(storedMsgs);
    } else if (!sessionKey) {
      introEl.style.display = 'block';
      fieldsEl.style.display = 'flex';
    }
  }

  // ── Send ─────────────────────────────────────────────────
  function doSend() {
    var text = inputEl.value.trim();
    if (!text) return;

    if (!sessionKey) {
      var nm = nameEl ? nameEl.value.trim() : '';
      if (!nm) {
        nameEl && nameEl.classList.add('err');
        nameEl && nameEl.focus();
        return;
      }
      visitorName  = nm;
      visitorEmail = emailEl ? emailEl.value.trim() : '';
      try {
        localStorage.setItem(NAME_KEY, visitorName);
        localStorage.setItem(EMAIL_KEY, visitorEmail);
      } catch(e) {}
    }

    inputEl.value = '';
    sendEl.style.opacity = '.3';
    sendEl.disabled = true;

    // Optimistic bubble
    var tempId = 'tmp-' + Date.now();
    renderMsgs([{ id: tempId, sender: 'visitor', body: text, created_at: new Date().toISOString() }]);

    var payload = { message: text };
    if (sessionKey) {
      payload.session_key = sessionKey;
    } else {
      payload.name  = visitorName;
      payload.email = visitorEmail;
    }

    fetch(BASE + '/chat-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON },
      body: JSON.stringify(payload),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) throw new Error(data.error);

      if (!sessionKey && data.session_key) {
        sessionKey = data.session_key;
        try { localStorage.setItem(SK_KEY, sessionKey); } catch(e) {}
        introEl.style.display = 'none';
        fieldsEl.style.display = 'none';
        startPolling();
        startBgPoll();
      }

      // Replace optimistic with confirmed messages
      delete renderedIds[tempId];
      storedMsgs = storedMsgs.filter(function (m) { return m.id !== tempId; });
      var existing = msgsEl.querySelector('[data-tmp="' + tempId + '"]');
      if (existing) existing.remove();
      // Remove the optimistic bubble (last child with visitor class)
      var bubbles = msgsEl.querySelectorAll('.rcp-msg.visitor');
      if (bubbles.length) {
        var last = bubbles[bubbles.length - 1];
        if (last.querySelector('.rcp-bubble') &&
            last.querySelector('.rcp-bubble').textContent === text) {
          last.remove();
          delete renderedIds[tempId];
          storedMsgs = storedMsgs.filter(function (m) { return m.id !== tempId; });
        }
      }
      if (data.messages) renderMsgs(data.messages);
    })
    .catch(function (e) {
      console.error('[RFS Chat]', e);
      inputEl.value = text;
    })
    .finally(function () {
      sendEl.style.opacity = '';
      sendEl.disabled = false;
    });
  }

  // ── Polling ──────────────────────────────────────────────
  function poll() {
    if (!sessionKey) return;
    fetch(BASE + '/chat-send?session_key=' + encodeURIComponent(sessionKey), {
      headers: { 'apikey': ANON },
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.messages) return;
      var added = renderMsgs(data.messages);
      if (added > 0 && !isOpen) showBadge(added);
    })
    .catch(function () {});
  }

  function startPolling() {
    if (pollTimer || !sessionKey) return;
    pollTimer = setInterval(poll, 3000);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function startBgPoll() {
    if (bgTimer || !sessionKey) return;
    bgTimer = setInterval(poll, 15000);
  }

  // ── Open / Close ─────────────────────────────────────────
  function openChat() {
    isOpen = true;
    panel.classList.add('open');
    bubble.setAttribute('aria-expanded', 'true');
    clearBadge();
    msgsEl.scrollTop = msgsEl.scrollHeight;
    if (sessionKey) startPolling();
    setTimeout(function () { inputEl.focus(); }, 200);
  }
  function closeChat() {
    isOpen = false;
    panel.classList.remove('open');
    bubble.setAttribute('aria-expanded', 'false');
    stopPolling();
  }

  // ── Events ───────────────────────────────────────────────
  bubble.addEventListener('click', function () { isOpen ? closeChat() : openChat(); });
  closeEl.addEventListener('click', closeChat);
  sendEl.addEventListener('click', doSend);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  if (nameEl) {
    nameEl.addEventListener('input', function () { nameEl.classList.remove('err'); });
  }

  // ── Boot ─────────────────────────────────────────────────
  initUI();
  if (sessionKey) startBgPoll();
})();
