// Isolated-world content script: decides which replies to hide on
// conversation pages (x.com/<user>/status/<id>) and applies/removes the hiding.
(() => {
  const SOURCE = 'x-reply-filter';
  const DEFAULTS = { enabled: true, showOP: true, mode: 'collapse' };

  let settings = { ...DEFAULTS };
  const known = new Map();        // handle -> { verified, mutual, relKnown }
  let cachedMutuals = new Set();  // persisted across sessions in chrome.storage.local
  const revealed = new Set();     // tweet keys the user clicked to show
  let nonReplies = new Set();     // ancestor / "Discover more" tweet ids for the current conversation
  let nonRepliesFor = null;
  let selfHandle = null;

  // ---------- storage ----------

  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    schedule();
  });

  chrome.storage.local.get({ mutuals: [] }, ({ mutuals }) => {
    for (const h of mutuals) {
      const k = known.get(h);
      if (!(k && k.relKnown && !k.mutual)) cachedMutuals.add(h);
    }
    schedule();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      for (const key in changes) if (key in DEFAULTS) settings[key] = changes[key].newValue;
      schedule();
    } else if (area === 'local' && changes.mutuals) {
      cachedMutuals = new Set(changes.mutuals.newValue || []);
      schedule();
    }
  });

  let persistTimer = null;
  function persistMutuals() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      chrome.storage.local.set({ mutuals: [...cachedMutuals] });
    }, 1000);
  }

  // ---------- data from interceptor.js ----------

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SOURCE) return;
    let cacheChanged = false;

    for (const u of e.data.users) {
      const prev = known.get(u.handle);
      // A user object without relationship fields shouldn't erase a known mutual.
      const mutual = u.relKnown ? u.mutual : (u.mutual || !!(prev && prev.mutual));
      known.set(u.handle, {
        verified: u.verified || !!(prev && prev.verified),
        mutual,
        relKnown: u.relKnown || !!(prev && prev.relKnown),
      });

      if (mutual && !cachedMutuals.has(u.handle)) {
        cachedMutuals.add(u.handle);
        cacheChanged = true;
      } else if (u.relKnown && !u.mutual && cachedMutuals.has(u.handle)) {
        cachedMutuals.delete(u.handle);
        cacheChanged = true;
      }
    }

    if (cacheChanged) persistMutuals();
    schedule();
  });

  // ---------- DOM helpers ----------

  // Pages we filter: a conversation (x.com/<user>/status/<id>) and Notifications/Mentions.
  function pageContext() {
    const m = /^\/(\w{1,15})\/status\/(\d+)/.exec(location.pathname);
    if (m) return { kind: 'status', op: m[1].toLowerCase(), id: m[2] };
    if (/^\/notifications(\/|$)/.test(location.pathname)) return { kind: 'notifications', op: null, id: 'notifications' };
    return null;
  }

  function readSelfHandle() {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const m = link && /^\/(\w{1,15})$/.exec(link.getAttribute('href') || '');
    return m ? m[1].toLowerCase() : null;
  }

  function readTweet(article) {
    // First User-Name in the article is the author (a quoted tweet's comes later).
    const name = article.querySelector('[data-testid="User-Name"]');
    if (!name) return null;

    let handle = null;
    for (const a of name.querySelectorAll('a[href^="/"]')) {
      const m = /^\/(\w{1,15})$/.exec(a.getAttribute('href'));
      if (m) { handle = m[1].toLowerCase(); break; }
    }
    if (!handle) return null;

    const verified = !!name.querySelector('[data-testid="icon-verified"]');
    const time = article.querySelector('a[href*="/status/"] time');
    const idMatch = time && /\/status\/(\d+)/.exec(time.closest('a').getAttribute('href'));
    return { handle, verified, key: idMatch ? idMatch[1] : 'h:' + handle };
  }

  function findFocal(articles, id) {
    // The tweet the page is about is rendered with tabindex="-1".
    const byTab = articles.filter((a) => a.getAttribute('tabindex') === '-1');
    if (byTab.length === 1) return byTab[0];
    return articles.find((a) => a.querySelector(`a[href*="/status/${id}"] time`)) || null;
  }

  // The "Discover more" section after the replies starts with a heading cell.
  function findSectionBoundary(focal) {
    for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      if (cell.querySelector('article')) continue;
      if (!cell.querySelector('h2, [role="heading"]')) continue;
      if (focal && !(focal.compareDocumentPosition(cell) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      return cell;
    }
    return null;
  }

  function shouldHide(info, ctx) {
    const h = info.handle;
    if (h === selfHandle) return false;
    if (settings.showOP && h === ctx.op) return false;
    if (info.verified) return false;
    const k = known.get(h);
    if (k && (k.verified || k.mutual)) return false;
    if (cachedMutuals.has(h)) return false;
    return true;
  }

  function hide(cell, info) {
    cell.setAttribute('data-xrf-hidden', '');
    cell.setAttribute('data-xrf-key', info.key);
    cell.setAttribute('data-xrf-label', `Reply from @${info.handle} hidden (not verified, not a mutual) · click to show`);
  }

  function unhide(cell) {
    if (cell.hasAttribute('data-xrf-hidden')) cell.removeAttribute('data-xrf-hidden');
  }

  function clearAll() {
    for (const cell of document.querySelectorAll('[data-xrf-hidden]')) unhide(cell);
  }

  // ---------- main pass ----------

  function processAll() {
    scheduled = false;
    document.documentElement.setAttribute('data-xrf-mode', settings.mode);

    const ctx = pageContext();
    if (!ctx || !settings.enabled) { clearAll(); return; }

    if (ctx.id !== nonRepliesFor) { nonReplies = new Set(); nonRepliesFor = ctx.id; }
    if (!selfHandle) selfHandle = readSelfHandle();

    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    // On Notifications every tweet shown is a reply, mention or quote of you.
    const isStatus = ctx.kind === 'status';
    const focal = isStatus ? findFocal(articles, ctx.id) : null;
    const boundary = isStatus ? findSectionBoundary(focal) : null;

    for (const article of articles) {
      const cell = article.closest('[data-testid="cellInnerDiv"]');
      if (!cell) continue;
      const info = readTweet(article);
      if (!info) continue;

      let isReply;
      if (article === focal) {
        isReply = false;
      } else if (focal && (focal.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_PRECEDING)) {
        isReply = false; // parent tweets above the focal tweet
        nonReplies.add(info.key);
      } else if (boundary && (boundary.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        isReply = false; // "Discover more" recommendations
        nonReplies.add(info.key);
      } else {
        isReply = !nonReplies.has(info.key);
      }

      if (isReply && !revealed.has(info.key) && shouldHide(info, ctx)) hide(cell, info);
      else unhide(cell);
    }
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(processAll);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

  // Click a collapsed reply to reveal it.
  document.addEventListener('click', (e) => {
    const cell = e.target;
    if (!(cell instanceof Element) || !cell.hasAttribute('data-xrf-hidden')) return;
    e.preventDefault();
    e.stopPropagation();
    revealed.add(cell.getAttribute('data-xrf-key'));
    unhide(cell);
  }, true);

  // Stats for the popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'xrf-stats') {
      sendResponse({
        active: !!pageContext(),
        hidden: document.querySelectorAll('[data-xrf-hidden]').length,
        known: known.size,
        mutuals: cachedMutuals.size,
      });
    }
  });
})();
