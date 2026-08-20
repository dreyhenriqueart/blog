/**
 * Gate do admin — senha: puzzle
 * Sessão em sessionStorage (fecha a aba = precisa logar de novo).
 */
(function (global) {
  const AUTH_KEY = "spacecomms-admin-auth";
  const PASSWORD = "puzzle";

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

  function mountGate(options) {
    const {
      onReady,
      modeLabel = "ADMIN",
      clockId = "clock"
    } = options;

    if (isAuthed()) {
      document.documentElement.classList.add("is-authed");
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
      setAuthed(true);
      document.documentElement.classList.remove("is-locked");
      document.documentElement.classList.add("is-authed");
      gate.remove();
      if (typeof onReady === "function") onReady();
    });

    return { gate };
  }

  /** Modal terminal para coletar GitHub PAT (produção), sem window.prompt */
  function askGitHubToken() {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById("token-gate");
      if (existing) existing.remove();

      const modal = document.createElement("div");
      modal.id = "token-gate";
      modal.className = "token-gate";
      modal.innerHTML = `
        <div class="token-gate__panel">
          <p class="sys-line">[SYS] uplink key required for production write</p>
          <p class="sys-line">[SYS] GitHub token with Contents: Write on repo blog</p>
          <form id="token-form" class="form-block" autocomplete="off">
            <label for="gh-token">UPLINK KEY</label>
            <input id="gh-token" type="password" required autofocus />
            <div class="actions">
              <button type="submit">COMMS&gt; save key_</button>
              <button type="button" id="token-cancel">COMMS&gt; cancel_</button>
            </div>
            <p id="token-error" class="status-msg error" role="alert"></p>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      const form = modal.querySelector("#token-form");
      const input = modal.querySelector("#gh-token");
      const errorEl = modal.querySelector("#token-error");
      const cancelBtn = modal.querySelector("#token-cancel");

      function close() {
        modal.remove();
      }

      cancelBtn.addEventListener("click", () => {
        close();
        reject(new Error("cancelado"));
      });

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) {
          errorEl.textContent = "[ERR] key required";
          errorEl.classList.add("is-visible");
          return;
        }
        close();
        resolve(value);
      });
    });
  }

  global.SpaceCommsAuth = {
    isAuthed,
    setAuthed,
    checkPassword,
    mountGate,
    askGitHubToken,
    PASSWORD
  };
})(window);
