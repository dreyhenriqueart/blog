/**
 * Persistência de posts.
 * - Local (serve.ps1): POST/DELETE /api/posts + /api/posts/archive + /api/config
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
  const DEFAULT_VERSION = "4.2.1";

  function normalizeVersion(value) {
    const ver = String(value || "").trim();
    return ver || DEFAULT_VERSION;
  }

  function normalizeStore(data) {
    return {
      terminalVersion: normalizeVersion(data && data.terminalVersion),
      posts: Array.isArray(data && data.posts) ? data.posts : []
    };
  }

  function notifyLive(detail) {
    try {
      if (detail && Array.isArray(detail.posts)) {
        localStorage.setItem(
          SNAP_KEY,
          JSON.stringify({
            posts: detail.posts,
            terminalVersion: normalizeVersion(detail.terminalVersion),
            t: Date.now()
          })
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

  function readLiveSnapshotMeta(maxAgeMs) {
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.posts)) return null;
      if (maxAgeMs && Date.now() - Number(data.t || 0) > maxAgeMs) return null;
      return {
        posts: data.posts,
        terminalVersion: normalizeVersion(data.terminalVersion),
        t: Number(data.t || 0)
      };
    } catch {
      return null;
    }
  }

  function readLiveSnapshot(maxAgeMs) {
    const meta = readLiveSnapshotMeta(maxAgeMs);
    return meta ? meta.posts : null;
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
    return `posts.json?t=${Date.now()}`;
  }

  async function fetchStoreRaw(options = {}) {
    const fresh = Boolean(options.fresh);

    if (fresh && !isLocalHost()) {
      const token = await ensureToken();
      const meta = await getFileMeta(token);
      return normalizeStore(decodeContent(meta));
    }

    try {
      const res = await fetch(postsUrl(), { cache: "no-store" });
      if (res.ok) {
        return normalizeStore(await res.json());
      }
    } catch {
      // fallback
    }

    const rawUrl = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${GH_PATH}?t=${Date.now()}`;
    const res = await fetch(rawUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("posts.json unavailable");
    return normalizeStore(await res.json());
  }

  async function fetchStore(options = {}) {
    if (options.preferLive) {
      const snap = readLiveSnapshotMeta(120000);
      if (snap && (snap.posts.length > 0 || options.allowEmpty)) {
        return {
          terminalVersion: snap.terminalVersion,
          posts: snap.posts
            .filter((post) => !post.archived)
            .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))
        };
      }
    }

    const store = await fetchStoreRaw(options);
    return {
      terminalVersion: store.terminalVersion,
      posts: store.posts
        .filter((post) => !post.archived)
        .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))
    };
  }

  async function fetchAllPosts(options = {}) {
    const store = await fetchStoreRaw(options);
    return store.posts;
  }

  async function fetchPublishedPosts(options = {}) {
    const store = await fetchStore(options);
    return store.posts;
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

  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

  function imageExtension(name, mime) {
    const fromName = String(name || "").match(/\.([a-z0-9]+)$/i);
    if (fromName) {
      const ext = fromName[1].toLowerCase();
      if (ext === "jpeg") return "jpg";
      if (["jpg", "png", "webp", "gif"].includes(ext)) return ext;
    }
    const fromMime = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif"
    };
    return fromMime[String(mime || "").toLowerCase()] || "jpg";
  }

  function normalizeImageField(image) {
    if (!image || !image.src) return undefined;
    return {
      src: String(image.src),
      name: String(image.name || "attachment").slice(0, 180)
    };
  }

  async function getPathSha(token, path) {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}&_=${Date.now()}`;
    const res = await ghFetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`
      }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub GET ${res.status}`);
    }
    const meta = await res.json();
    return meta.sha || null;
  }

  async function putRepoFile(token, path, base64Content, message) {
    const sha = await getPathSha(token, path);
    const body = {
      message,
      content: base64Content,
      branch: GH_BRANCH
    };
    if (sha) body.sha = sha;

    const res = await ghFetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
      {
        method: "PUT",
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub PUT media ${res.status}`);
    }
    return res.json();
  }

  async function uploadImageAsset(payload) {
    if (!payload || !payload.imageBase64) return undefined;

    const base64 = String(payload.imageBase64).replace(/\s/g, "");
    if (!base64) return undefined;

    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      throw new Error("imagem acima de 8MB");
    }

    const name = String(payload.imageName || "attachment.jpg");
    const mime = String(payload.imageMime || "image/jpeg");
    const ext = imageExtension(name, mime);
    const safeName = name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120) || `attachment.${ext}`;

    if (isLocalHost()) {
      return {
        imageBase64: base64,
        imageName: safeName,
        imageMime: mime,
        _local: true
      };
    }

    const token = await ensureToken();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `media/${stamp}.${ext}`;
    await putRepoFile(token, path, base64, `attach media ${stamp}`);
    return normalizeImageField({ src: path, name: safeName });
  }

  function inlineImageField(payload) {
    if (!payload || !payload.imageBase64) return undefined;
    const base64 = String(payload.imageBase64).replace(/\s/g, "");
    if (!base64) return undefined;
    const mime = String(payload.imageMime || "image/jpeg");
    const name = String(payload.imageName || "attachment.jpg")
      .replace(/[^\w.\-()+ ]+/g, "_")
      .slice(0, 120) || "attachment.jpg";
    return normalizeImageField({
      src: `data:${mime};base64,${base64}`,
      name
    });
  }

  async function resolvePublishImage(payload) {
    if (!payload) return undefined;
    if (!payload.imageBase64 && !(payload.image && payload.image.src)) {
      return undefined;
    }

    if (payload.imageBase64) {
      const approxBytes = Math.floor(
        (String(payload.imageBase64).replace(/\s/g, "").length * 3) / 4
      );

      // Até ~550KB: grava data URL no posts.json junto com o post (atômico).
      if (approxBytes <= 550000) {
        const inline = inlineImageField(payload);
        if (inline) return inline;
      }

      // Maior: sobe arquivo em media/ e referencia o path.
      try {
        const uploaded = await uploadImageAsset(payload);
        if (uploaded && uploaded.src) return uploaded;
      } catch (err) {
        if (approxBytes <= 900000) {
          const inline = inlineImageField(payload);
          if (inline) return inline;
        }
        throw new Error(err.message || "falha ao gravar anexo");
      }

      throw new Error("anexo não foi gravado");
    }

    return normalizeImageField(payload.image);
  }

  async function mutateRemote(mutator, message) {
    const token = await ensureToken();
    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const meta = await getFileMeta(token);
      const store = normalizeStore(decodeContent(meta));
      const workingPosts = JSON.parse(JSON.stringify(store.posts));
      const result = mutator(workingPosts);

      try {
        const next = {
          terminalVersion: store.terminalVersion,
          posts: workingPosts
        };
        await putPosts(token, next, meta.sha, message);
        notifyLive({
          type: "posts-changed",
          posts: workingPosts,
          terminalVersion: store.terminalVersion
        });
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
      const store = await fetchStoreRaw();
      notifyLive({
        type: "posts-changed",
        posts: store.posts,
        terminalVersion: store.terminalVersion
      });
    } catch {
      notifyLive({ type: "posts-changed" });
    }
  }

  async function setTerminalVersion(version) {
    const terminalVersion = normalizeVersion(version);

    if (isLocalHost()) {
      const res = await fetch("api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminalVersion })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      await notifyAfterLocalMutate();
      return result;
    }

    const token = await ensureToken();
    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const meta = await getFileMeta(token);
      const store = normalizeStore(decodeContent(meta));
      store.terminalVersion = terminalVersion;

      try {
        await putPosts(token, store, meta.sha, `set terminal version ${terminalVersion}`);
        notifyLive({
          type: "posts-changed",
          posts: store.posts,
          terminalVersion
        });
        return { terminalVersion };
      } catch (err) {
        lastError = err;
        if (err.shaConflict && attempt < 3) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error("falha ao gravar versão");
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

    const wantsImage = Boolean(payload.imageBase64 || (payload.image && payload.image.src));
    const image = await resolvePublishImage(payload);

    if (wantsImage && !(image && image.src)) {
      throw new Error("anexo selecionado, mas não foi possível gravar a imagem");
    }

    const created = await mutateRemote((posts) => {
      const next = {
        id: nextId(posts),
        sentAt: payload.sentAt || new Date().toISOString(),
        origin: payload.origin,
        callsign: payload.callsign,
        lines: payload.lines,
        archived: false,
        lost: false
      };
      if (image) next.image = image;
      posts.push(next);
      return next;
    }, `publish transmission ${Date.now()}`);

    if (wantsImage && !(created && created.image && created.image.src)) {
      throw new Error("post publicado sem anexo — tente de novo");
    }

    return created;
  }

  async function updatePost(id, payload) {
    const lines = Array.isArray(payload && payload.lines)
      ? payload.lines.map((line) => String(line)).filter((line) => line.trim().length > 0)
      : [];

    if (!id) throw new Error("id is required");
    if (lines.length === 0) throw new Error("lines are required");

    if (isLocalHost()) {
      const res = await fetch("api/posts/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: String(id), lines })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const updated = await res.json();
      await notifyAfterLocalMutate();
      return updated;
    }

    return mutateRemote((posts) => {
      const post = posts.find((item) => String(item.id) === String(id));
      if (!post) throw new Error("post not found");
      post.lines = lines;
      return post;
    }, `edit transmission ${id}`);
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

  async function purgePosts(ids) {
    if (isLocalHost()) {
      const res = await fetch("api/posts/purge", {
        method: "POST",
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
      const idSet = new Set(ids.map(String));
      const kept = [];
      let purged = 0;
      for (const post of posts) {
        if (idSet.has(String(post.id))) {
          purged++;
        } else {
          kept.push(post);
        }
      }
      posts.length = 0;
      posts.push(...kept);
      return { purged, ids };
    }, `purge transmissions ${ids.join(",")}`);
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
    fetchStore,
    fetchAllPosts,
    fetchPublishedPosts,
    publishPost,
    updatePost,
    deletePosts,
    purgePosts,
    archivePosts,
    setTerminalVersion,
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
