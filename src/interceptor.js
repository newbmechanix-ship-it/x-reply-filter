// Runs in the page's own JS world (MAIN) so it can observe X's GraphQL API
// responses. The DOM doesn't say whether someone follows you, but the API
// does — so we pull verification + follow relationship for every user object
// we see and hand it to content.js via window.postMessage.
(() => {
  const SOURCE = 'x-reply-filter';
  const API_RE = /\/i\/api\//;

  function parseUser(u) {
    const legacy = u.legacy || {};
    const handle = (u.core && u.core.screen_name) || legacy.screen_name;
    if (!handle) return null;

    // X has moved these fields around over time; check both shapes.
    const rp = u.relationship_perspectives;
    const relKnown = !!rp || 'following' in legacy || 'followed_by' in legacy;
    const following = !!((rp && rp.following) || legacy.following);
    const followedBy = !!((rp && rp.followed_by) || legacy.followed_by);
    const v = u.verification || {};
    const verified = !!(
      u.is_blue_verified || v.verified || v.verified_type ||
      legacy.verified || legacy.verified_type
    );

    return { handle: handle.toLowerCase(), verified, mutual: following && followedBy, relKnown };
  }

  // Older REST-style user objects (e.g. notifications' globalObjects.users).
  function parseRestUser(n) {
    const relKnown = 'following' in n || 'followed_by' in n;
    return {
      handle: n.screen_name.toLowerCase(),
      verified: !!(n.verified || n.ext_is_blue_verified || n.is_blue_verified || n.verified_type),
      mutual: !!(n.following && n.followed_by),
      relKnown,
    };
  }

  function collectUsers(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 200) return;
    if (Array.isArray(node)) {
      for (const item of node) collectUsers(item, out, depth + 1);
      return;
    }
    const isGqlUser = node.__typename === 'User' && node.rest_id;
    if (isGqlUser) {
      const user = parseUser(node);
      if (user) out.push(user);
    } else if (typeof node.screen_name === 'string' && typeof node.id_str === 'string' && 'followers_count' in node) {
      out.push(parseRestUser(node));
    }
    for (const key in node) {
      if (isGqlUser && key === 'legacy') continue; // already read by parseUser
      const value = node[key];
      if (value && typeof value === 'object') collectUsers(value, out, depth + 1);
    }
  }

  function handleJson(json) {
    const users = [];
    collectUsers(json, users, 0);
    if (users.length) window.postMessage({ source: SOURCE, users }, location.origin);
  }

  // --- fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input && input.url;
      if (url && API_RE.test(url)) {
        res.clone().json().then(handleJson).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  // --- XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__xrfUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__xrfUrl && API_RE.test(this.__xrfUrl)) {
      this.addEventListener('load', () => {
        try {
          let data = null;
          if (this.responseType === 'json') data = this.response;
          else if (this.responseType === '' || this.responseType === 'text') data = JSON.parse(this.responseText);
          if (data) handleJson(data);
        } catch (_) {}
      });
    }
    return origSend.apply(this, args);
  };
})();
