/**
 * Gate do admin — senha: puzzle
 * Após unlock, libera escrita no GitHub sem pedir token de novo.
 */
(function (global) {
  const AUTH_KEY = "spacecomms-admin-auth";
  const PASSWORD = "puzzle";
  // Token de escrita ofuscado; só abre com a senha do admin.
  const UPLINK_BLOB = "Fx0VJR5UFz02PlhWSQEoOyABIg8VPTUXGyYxLQA/FgNLN10gOk0tLA==";

  function isAuthed() {
    return sessionStorage.getItem(AUTH_KEY) === "1";
  }

  function setAuthed(ok) {
    if (ok) sessionStorage.setItem(AUTH_KEY, "1");
    else sessionStorage.removeItem(AUTH_KEY);
  }

  function checkPassword(value) {
    return String(value || "") === PASSWORD;
  }

  function deobfuscate(blob, pass) {
    const raw = atob(blob);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const key = new TextEncoder().encode(pass);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ key[i % key.length];
    }
    return new TextDecoder().decode(out);
  }

  function unlockUplink() {
    if (!global.SpaceCommsStore || typeof global.SpaceCommsStore.setToken !== "function") {
      return;
    }
    try {
      const token = deobfuscate(UPLINK_BLOB, PASSWORD);
      if (token) global.SpaceCommsStore.setToken(token);
    } catch {
      // ignore
    }
  }

  function finishUnlock(onReady) {
    setAuthed(true);
    unlockUplink();
    document.documentElement.classList.remove("is-locked");
    document.documentElement.classList.add("is-authed");
    if (typeof onReady === "function") onReady();
  }

  function mountGate(options) {
    const { onReady, clockId = "clock" } = options;

    if (isAuthed()) {
      document.documentElement.classList.add("is-authed");
      unlockUplink();
      if (typeof onReady === "function") onReady();
      return;
    }

    const gate = document.createElement("div");
    gate.id = "auth-gate";
    gate.className = "auth-gate";
    gate.innerHTML = `
      <div class="auth-gate__panel">
        <header class="status-bar">
          COMMS ADMIN v0.1 &nbsp;|&nbsp;
          <span id="${clockId}-gate">--</span> &nbsp;|&nbsp;
          MODE: <span>AUTH</span>
        </header>
        <p class="sys-line">[SYS] secure channel required</p>
        <p class="sys-line">[SYS] enter access password to continue</p>
        <form id="auth-form" class="form-block" autocomplete="off">
          <label for="auth-password">PASSWORD</label>
          <input id="auth-password" name="password" type="password" required autofocus />
          <div class="actions">
            <button type="submit">COMMS&gt; unlock_</button>
          </div>
          <p id="auth-error" class="status-msg error" role="alert"></p>
        </form>
      </div>
    `;

    document.body.prepend(gate);
    document.documentElement.classList.add("is-locked");

    const form = gate.querySelector("#auth-form");
    const input = gate.querySelector("#auth-password");
    const errorEl = gate.querySelector("#auth-error");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!checkPassword(input.value)) {
        errorEl.textContent = "[ERR] access denied";
        errorEl.classList.add("is-visible");
        input.value = "";
        input.focus();
        return;
      }
      gate.remove();
      finishUnlock(onReady);
    });

    return { gate };
  }

  global.SpaceCommsAuth = {
    isAuthed,
    setAuthed,
    checkPassword,
    mountGate,
    unlockUplink,
    PASSWORD
  };
})(window);
