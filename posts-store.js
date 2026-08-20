/**
 * Persistência de posts.
 * - Local (serve.ps1): POST/DELETE /api/posts + /api/posts/archive
 * - Produção (GitHub Pages): GitHub Contents API (requer PAT com contents:write)
 */
(function (global) {
  const GH_OWNER = "dreyhenriqueart";
  const GH_REPO = "blog";
  const GH_BRANCH = "main";
  const GH_PATH = "posts.json";
  const TOKEN_KEY = "spacecomms-gh-token";
  const BUS_NAME = "spacecomms-live";
  const SNAP_KEY = "spacecomms-posts-snap";

  function notifyLive(detail) {
    try {
      if (detail && Array.isArray(detail.posts)) {
        localStorage.setItem(
          SNAP_KEY,
          JSON.stringify({ posts: detail.posts, t: Date.now() })
        );
      }
      localStorage.setItem("spacecomms-live-ping", String(Date.now()));
      const bus = new BroadcastChannel(BUS_NAME);
      bus.postMessage(detail || { type: "posts-changed" });
      bus.close();
    } catch {
      // ignore
    }
  }

  function readLiveSnapshot(maxAgeMs) {
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.posts)) return null;
      if (maxAgeMs && Date.now() - Number(data.t || 0) > maxAgeMs) return null;
      return data.posts;
    } catch {
      return null;
    }
  }

  function onLiveChange(handler) {
    try {
      const bus = new BroadcastChannel(BUS_NAME);
      bus.onmessage = (event) => handler(event.data || { type: "posts-changed" });
    } catch {
      // ignore
    }
    window.addEventListener("storage", (event) => {
      if (event.key === "spacecomms-live-ping" || event.key === SNAP_KEY) {
        handler({ type: "posts-changed" });
      }
    });
  }

  function isLocalHost() {
    const h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "";
  }

  function postsUrl() {
    if (isLocalHost()) {
      return `posts.json?t=${Date.now()}`;
    }
    return `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${GH_PATH}?t=${Date.now()}`;
  }

  async function fetchAllPosts(options = {}) {
    const fresh = Boolean(options.fresh);

    // Admin: lê direto da API (sem cache do raw.githubusercontent)
    if (fresh && !isLocalHost()) {
      const token = await ensureToken();
      const meta = await getFileMeta(token);
      const data = decodeContent(meta);
      return Array.isArray(data.posts) ? data.posts : [];
    }

    const res = await fetch(postsUrl(), { cache: "no-store" });
    if (!res.ok) throw new Error("posts.json unavailable");
    const data = await res.json();
    return Array.isArray(data.posts) ? data.posts : [];
  }

  async function fetchPublishedPosts(options = {}) {
    if (options.preferLive) {
      const snap = readLiveSnapshot(120000);
      if (snap) {
        return snap
          .filter((post) => !post.archived)
          .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
      }
    }

    return (await fetchAllPosts())
      .filter((post) => !post.archived)
      .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) sessionStorage.setItem(TOKEN_KEY, token.trim());
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  async function ensureToken() {
    if (isLocalHost()) return "";

    let token = getToken();
    if (token) return token;

    if (global.SpaceCommsAuth && typeof global.SpaceCommsAuth.unlockUplink === "function") {
      global.SpaceCommsAuth.unlockUplink();
      token = getToken();
    }

    if (!token) {
      throw new Error("faça login no admin (senha) para gravar");
    }

    return token;
  }

  function nextId(posts) {
    let max = 0;
    for (const post of posts) {
      if (/^\d+$/.test(String(post.id))) {
        const n = parseInt(post.id, 10);
        if (n > max) max = n;
      }
    }
    return String(max + 1).padStart(3, "0");
  }

  async function ghFetch(url, options = {}) {
    try {
      return await fetch(url, options);
    } catch {
      throw new Error("falha de rede ao falar com o GitHub (CORS/rede). Tente de novo.");
    }
  }

  async function getFileMeta(token) {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}&_=${Date.now()}`;
    const res = await ghFetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub GET ${res.status}`);
    }
    return res.json();
  }

  function decodeContent(meta) {
    const bin = atob(String(meta.content || "").replace(/\s/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function encodeContent(data) {
    const json = JSON.stringify(data, null, 2);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async function putPosts(token, data, sha, message) {
    const content = encodeContent(data);
    const res = await ghFetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`,
      {
        method: "PUT",
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          content,
          sha,
          branch: GH_BRANCH
        })
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.message || `GitHub PUT ${res.status}`;
      const error = new Error(msg);
      error.status = res.status;
      error.shaConflict = /does not match/i.test(msg) || res.status === 409;
      throw error;
    }
    return res.json();
  }

  async function mutateRemote(mutator, message) {
    const token = await ensureToken();
    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const meta = await getFileMeta(token);
      const data = decodeContent(meta);
      if (!Array.isArray(data.posts)) data.posts = [];

      // Cópia para o mutator não corromper retry com dados pela metade
      const working = JSON.parse(JSON.stringify(data.posts));
      const result = mutator(working);

      try {
        await putPosts(token, { posts: working }, meta.sha, message);
        notifyLive({ type: "posts-changed", posts: working });
        return result;
      } catch (err) {
        lastError = err;
        if (err.shaConflict && attempt < 3) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error("falha ao gravar posts.json");
  }

  async function notifyAfterLocalMutate() {
    try {
      const posts = await fetchAllPosts();
      notifyLive({ type: "posts-changed", posts });
    } catch {
      notifyLive({ type: "posts-changed" });
    }
  }

  async function publishPost(payload) {
    if (isLocalHost()) {
      const res = await fetch("api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const created = await res.json();
      await notifyAfterLocalMutate();
      return created;
    }

    return mutateRemote((posts) => {
      const created = {
        id: nextId(posts),
        sentAt: payload.sentAt || new Date().toISOString(),
        origin: payload.origin,
        callsign: payload.callsign,
        lines: payload.lines,
        archived: false,
        lost: false
      };
      posts.push(created);
      return created;
    }, `publish transmission ${Date.now()}`);
  }

  async function deletePosts(ids) {
    if (isLocalHost()) {
      const res = await fetch("api/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      await notifyAfterLocalMutate();
      return result;
    }

    return mutateRemote((posts) => {
      let updated = 0;
      const idSet = new Set(ids.map(String));
      for (const post of posts) {
        if (idSet.has(String(post.id)) && !post.lost) {
          post.lost = true;
          updated++;
        }
      }
      return { removed: updated, ids };
    }, `signal lost ${ids.join(",")}`);
  }

  async function archivePosts(ids, archived) {
    if (isLocalHost()) {
      const res = await fetch("api/posts/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, archived })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      await notifyAfterLocalMutate();
      return result;
    }

    return mutateRemote((posts) => {
      let updated = 0;
      const idSet = new Set(ids.map(String));
      for (const post of posts) {
        if (idSet.has(String(post.id))) {
          post.archived = Boolean(archived);
          updated++;
        }
      }
      return { updated, ids, archived: Boolean(archived) };
    }, `${archived ? "archive" : "restore"} transmissions ${ids.join(",")}`);
  }

  global.SpaceCommsStore = {
    isLocalHost,
    postsUrl,
    fetchAllPosts,
    fetchPublishedPosts,
    publishPost,
    deletePosts,
    archivePosts,
    getToken,
    setToken,
    ensureToken,
    onLiveChange,
    notifyLive,
    readLiveSnapshot,
    GH_OWNER,
    GH_REPO
  };
})(window);
