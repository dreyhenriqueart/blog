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

  async function fetchAllPosts() {
    const res = await fetch(postsUrl(), { cache: "no-store" });
    if (!res.ok) throw new Error("posts.json unavailable");
    const data = await res.json();
    return Array.isArray(data.posts) ? data.posts : [];
  }

  async function fetchPublishedPosts() {
    return (await fetchAllPosts())
      .filter((post) => !post.archived)
      .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  }

  function ensureToken() {
    let token = getToken();
    if (token) return token;
    token = window.prompt(
      "Cole um GitHub Personal Access Token (classic) com permissão Contents: Write no repo blog.\n\n" +
        "Crie em: GitHub → Settings → Developer settings → Personal access tokens"
    );
    if (!token || !token.trim()) throw new Error("token necessário para publicar");
    setToken(token.trim());
    return getToken();
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

  async function getFileMeta(token) {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`;
    const res = await fetch(url, {
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
    const bin = atob(meta.content.replace(/\n/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function putPosts(token, data, sha, message) {
    const json = JSON.stringify(data, null, 2);
    const content = btoa(unescape(encodeURIComponent(json)));
    const res = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`,
      {
        method: "PUT",
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
      throw new Error(err.message || `GitHub PUT ${res.status}`);
    }
    return res.json();
  }

  async function mutateRemote(mutator, message) {
    const token = ensureToken();
    const meta = await getFileMeta(token);
    const data = decodeContent(meta);
    if (!Array.isArray(data.posts)) data.posts = [];
    const result = mutator(data.posts);
    await putPosts(token, { posts: data.posts }, meta.sha, message);
    return result;
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
      return res.json();
    }

    return mutateRemote((posts) => {
      const created = {
        id: nextId(posts),
        sentAt: payload.sentAt || new Date().toISOString(),
        origin: payload.origin,
        callsign: payload.callsign,
        lines: payload.lines,
        archived: false
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
      return res.json();
    }

    return mutateRemote((posts) => {
      const before = posts.length;
      const keep = posts.filter((p) => !ids.includes(String(p.id)));
      posts.length = 0;
      posts.push(...keep);
      return { removed: before - keep.length, ids };
    }, `delete transmissions ${ids.join(",")}`);
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
      return res.json();
    }

    return mutateRemote((posts) => {
      let updated = 0;
      for (const post of posts) {
        if (ids.includes(String(post.id))) {
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
    GH_OWNER,
    GH_REPO
  };
})(window);
