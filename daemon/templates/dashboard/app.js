"use strict";
/* trace2e dashboard — vanilla JS, hash-routed views: #login, #traces, #edit/<id>, #admin.
   Auth: password login exchanges for the user's static API token (same bearer token the
   extension/client use), stored in localStorage. Legacy single-token paste still works. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const token = () => localStorage.getItem("trace2e_token") || "";
const setToken = (t) => (t ? localStorage.setItem("trace2e_token", t) : localStorage.removeItem("trace2e_token"));

let me = null;           // { id, username, role }
let projects = [];       // [{ id, name, createdAt }]
let filter = "";         // "" = all, "none" = unassigned, else project id
let selected = null;     // selected trace id in #traces

function setStatus(msg, err) {
  const s = $("status");
  s.textContent = msg || "";
  s.style.color = err ? "var(--danger)" : "var(--muted)";
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    setToken("");
    me = null;
    go("#login");
    throw new Error("session expired — log in again");
  }
  return res;
}

// ---------------------------------------------------------------------------
// Router

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener("hashchange", render);

async function whoami() {
  if (!token()) return false;
  try {
    const res = await fetch("/auth/me", { headers: { Authorization: "Bearer " + token() } });
    if (!res.ok) return false;
    me = await res.json();
    return true;
  } catch {
    return false;
  }
}

async function render() {
  const h = location.hash || "#traces";
  if (h === "#login") {
    renderNav();
    return viewLogin();
  }
  if (!me && !(await whoami())) return go("#login");
  renderNav();
  if (h.startsWith("#edit/")) return viewEdit(decodeURIComponent(h.slice(6)));
  if (h === "#admin" && me.role === "admin") return viewAdmin();
  return viewTraces();
}

function renderNav() {
  const nav = $("nav");
  if (!me) {
    nav.innerHTML = "";
    return;
  }
  const h = location.hash || "#traces";
  nav.innerHTML =
    '<a href="#traces" class="' + (h.startsWith("#admin") ? "" : "active") + '">Traces</a>' +
    (me.role === "admin" ? '<a href="#admin" class="' + (h === "#admin" ? "active" : "") + '">Admin</a>' : "") +
    '<span class="chip">' + esc(me.username) + " · " + esc(me.role) + "</span>" +
    '<button class="mini" id="copyTok" title="Copy my API token (for the extension / client)">Copy token</button>' +
    '<button class="mini" id="logout">Log out</button>';
  $("copyTok").onclick = async () => {
    await navigator.clipboard.writeText(token());
    setStatus("token copied");
  };
  $("logout").onclick = () => {
    setToken("");
    me = null;
    go("#login");
  };
}

// ---------------------------------------------------------------------------
// #login

function viewLogin(registering) {
  setStatus("");
  $("view").innerHTML =
    '<form class="card login" id="loginForm">' +
    "<h2>" + (registering ? "Create account" : "Sign in") + "</h2>" +
    '<input id="lu" placeholder="username (lowercase)" autocomplete="username" />' +
    '<input id="lp" type="password" placeholder="password (min 8 chars)" autocomplete="' + (registering ? "new-password" : "current-password") + '" />' +
    (registering ? '<input id="lp2" type="password" placeholder="repeat password" autocomplete="new-password" />' : "") +
    '<button class="primary" type="submit">' + (registering ? "Create account" : "Log in") + "</button>" +
    '<div class="error" id="lerr"></div>' +
    '<a href="javascript:void 0" id="swap">' + (registering ? "Already have an account? Sign in" : "No account? Create one") + "</a>" +
    (registering
      ? ""
      : '<details class="alt"><summary>…or paste an API token directly</summary>' +
        '<input id="lt" type="password" placeholder="access token" />' +
        '<button class="mini" type="button" id="ltgo">Use token</button>' +
        "</details>") +
    "</form>";
  $("swap").onclick = () => viewLogin(!registering);
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $("lerr").textContent = "";
    if (registering && $("lp").value !== $("lp2").value) {
      $("lerr").textContent = "passwords don't match";
      return;
    }
    try {
      const res = await fetch(registering ? "/auth/register" : "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: $("lu").value.trim().toLowerCase(), password: $("lp").value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || (registering ? "registration failed" : "login failed"));
      setToken(body.token);
      me = body.user;
      go("#traces");
    } catch (err) {
      $("lerr").textContent = err.message.replace(/^bad request: /, "");
    }
  };
  if (!registering)
    $("ltgo").onclick = async () => {
      setToken($("lt").value.trim());
      if (await whoami()) go("#traces");
      else {
        setToken("");
        $("lerr").textContent = "token rejected";
      }
    };
}

// ---------------------------------------------------------------------------
// #traces — projects sidebar + list + detail

async function loadProjects() {
  try {
    projects = await (await api("/projects")).json();
  } catch {
    projects = [];
  }
}

const projectName = (id) => (projects.find((p) => p.id === id) || {}).name || null;

async function viewTraces() {
  $("view").innerHTML =
    '<div class="grid">' +
    '<div class="card side" id="side"></div>' +
    '<div class="card list" id="list"><div class="empty">loading…</div></div>' +
    '<div class="card detail" id="detail"><div class="empty">Select a trace.</div></div>' +
    "</div>";
  await loadProjects();
  renderSide();
  await loadList();
}

function renderSide() {
  const el = $("side");
  const item = (id, name, extra) =>
    '<div class="row' + (filter === id ? " sel" : "") + '" data-proj="' + esc(id) + '"><span class="name">' + name + "</span>" + (extra || "") + "</div>";
  el.innerHTML =
    item("", "All traces") +
    item("none", "Unassigned") +
    projects
      .map((p) =>
        item(
          p.id,
          esc(p.name),
          '<span class="actions"><button class="mini" data-ren="' + esc(p.id) + '" title="Rename">✎</button>' +
            '<button class="mini danger" data-delp="' + esc(p.id) + '" title="Delete">✕</button></span>',
        ),
      )
      .join("") +
    '<div class="add"><input id="npName" placeholder="new project" /><button class="mini" id="npAdd">+</button></div>';
  el.querySelectorAll("[data-proj]").forEach((row) => {
    row.onclick = () => {
      filter = row.dataset.proj;
      selected = null;
      renderSide();
      loadList();
      $("detail").innerHTML = '<div class="empty">Select a trace.</div>';
    };
  });
  el.querySelectorAll("[data-ren]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const p = projects.find((x) => x.id === b.dataset.ren);
      const name = prompt("Rename project", p.name);
      if (!name || name === p.name) return;
      const res = await api("/projects/" + p.id, { method: "PUT", body: JSON.stringify({ name }) });
      if (!res.ok) return setStatus((await res.json()).error, true);
      await loadProjects();
      renderSide();
      loadList();
    };
  });
  el.querySelectorAll("[data-delp]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const p = projects.find((x) => x.id === b.dataset.delp);
      if (!confirm('Delete project "' + p.name + '"? Its traces become Unassigned.')) return;
      await api("/projects/" + p.id, { method: "DELETE" });
      if (filter === p.id) filter = "";
      await loadProjects();
      renderSide();
      loadList();
    };
  });
  $("npAdd").onclick = async () => {
    const name = $("npName").value.trim();
    if (!name) return;
    const res = await api("/projects", { method: "POST", body: JSON.stringify({ name }) });
    if (!res.ok) return setStatus((await res.json()).error, true);
    $("npName").value = "";
    await loadProjects();
    renderSide();
  };
}

async function loadList() {
  const el = $("list");
  try {
    const res = await api("/traces" + (filter ? "?project=" + encodeURIComponent(filter) : ""));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const traces = await res.json();
    setStatus(traces.length + " trace(s)");
    if (!traces.length) {
      el.innerHTML = '<div class="empty">No traces here. Record one in the extension and upload.</div>';
      return;
    }
    el.innerHTML = "";
    for (const t of traces) {
      const row = document.createElement("div");
      row.className = "row" + (t.id === selected ? " sel" : "");
      const proj = t.projectId ? projectName(t.projectId) : null;
      row.innerHTML =
        '<div class="name">' + esc(t.name) + "</div>" +
        '<div class="meta">' + new Date(t.createdAt).toLocaleString() + " · " + t.stepCount + " steps" +
        (t.createdBy ? " · " + esc(t.createdBy) : "") +
        (proj ? ' · <span class="chip proj">' + esc(proj) + "</span>" : "") +
        "</div>";
      row.onclick = () => showDetail(t.id);
      el.appendChild(row);
    }
  } catch (e) {
    el.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
  }
}

function describe(step) {
  switch (step.type) {
    case "navigate": return "→ " + esc(step.url);
    case "click": return esc(step.target?.primary || "");
    case "fill": return esc(step.target?.primary || "") + " = " + (step.variableRef ? '<span class="var">{{' + esc(step.variableRef) + "}}</span>" : esc(JSON.stringify(step.value ?? "")));
    case "press": return "key " + esc(step.key);
    case "select": return esc(step.target?.primary || "") + " = " + esc(step.label ?? step.value);
    case "waitFor": return "wait " + esc(step.url ?? step.target?.primary ?? step.state ?? "");
    case "assert": return "expect " + esc(step.target?.primary ?? "url") + " " + esc(step.kind) + " " + esc(JSON.stringify(step.expected ?? ""));
    case "delay": return "delay " + esc(step.ms) + " ms";
    case "customJs": return "evaluate: " + esc((step.code || "").slice(0, 80));
    case "hook": return esc(step.phase) + " hook: " + esc((step.code || "").slice(0, 70));
    default: return esc(step.type);
  }
}

async function showDetail(id) {
  selected = id;
  document.querySelectorAll("#list .row").forEach((r) => r.classList.remove("sel"));
  const d = $("detail");
  d.innerHTML = '<div class="empty">loading…</div>';
  try {
    const t = await (await api("/traces/" + id)).json();
    const proj = t.projectId ? projectName(t.projectId) : null;
    const vars = (t.variables || [])
      .map((v) => '<span class="chip ' + (v.kind === "secret" ? "secret" : "") + '">{{' + esc(v.name) + "}} · " + esc(v.kind) + "/" + esc(v.source) + "</span>")
      .join("");
    const steps = (t.steps || []).map((s) => '<li><span class="type">' + esc(s.type) + "</span> <code>" + describe(s) + "</code></li>").join("");
    d.innerHTML =
      '<div class="bar"><b>' + esc(t.name) + "</b>" +
      '<button id="edit" class="primary">Edit</button>' +
      '<button id="dl">Download JSON</button>' +
      '<button id="del" class="danger">Delete</button>' +
      '<span class="muted">' + esc(t.startUrl || "") + "</span></div>" +
      '<div class="chips">' +
      (proj ? '<span class="chip proj">' + esc(proj) + "</span>" : '<span class="chip">Unassigned</span>') +
      (t.createdBy ? '<span class="chip">by ' + esc(t.createdBy) + "</span>" : "") +
      "</div>" +
      (vars ? '<div class="chips">' + vars + "</div>" : "") +
      '<ol class="steps">' + steps + "</ol>" +
      '<div id="shots"></div>';
    $("edit").onclick = () => go("#edit/" + t.id);
    $("dl").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: "application/json" }));
      a.download = t.name + ".json";
      a.click();
    };
    $("del").onclick = async () => {
      if (!confirm("Delete “" + t.name + "”?")) return;
      await api("/traces/" + id, { method: "DELETE" });
      selected = null;
      d.innerHTML = '<div class="empty">Deleted.</div>';
      loadList();
    };
    const shots = await (await api("/traces/" + id + "/screenshots")).json();
    const keys = Object.keys(shots || {});
    if (keys.length) $("shots").innerHTML = "<h4>Screenshots</h4>" + keys.map((k) => '<img class="shot" alt="' + esc(k) + '" src="data:image/png;base64,' + shots[k] + '">').join("");
  } catch (e) {
    d.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
  }
}

// ---------------------------------------------------------------------------
// #edit/<id> — structured editor + raw JSON mode

let ed = null; // working copy of the trace being edited
let rawMode = false;

async function viewEdit(id) {
  const res = await api("/traces/" + id);
  if (!res.ok) {
    $("view").innerHTML = '<div class="empty">Trace not found.</div>';
    return;
  }
  ed = await res.json();
  rawMode = false;
  await loadProjects();
  drawEditor();
}

function field(label, html) {
  return "<label>" + esc(label) + " " + html + "</label>";
}

function inp(step, i, fieldName, value, placeholder) {
  return '<input data-step="' + i + '" data-field="' + fieldName + '" value="' + esc(value ?? "") + '" placeholder="' + esc(placeholder || "") + '" />';
}

function stepBody(s, i) {
  const target = (name) => field(name || "locator", inp(s, i, "target.primary", s.target?.primary));
  switch (s.type) {
    case "navigate": return field("url", inp(s, i, "url", s.url));
    case "click": return target();
    case "fill":
      return '<div class="frow">' + target() +
        (s.variableRef
          ? field("value", '<span class="chip secret">{{' + esc(s.variableRef) + "}} (variable — not editable here)</span>")
          : field("value", inp(s, i, "value", s.value))) +
        "</div>";
    case "press": return '<div class="frow">' + field("key", inp(s, i, "key", s.key)) + target("locator (optional)") + "</div>";
    case "select": return '<div class="frow">' + target() + field("value", inp(s, i, "value", s.value)) + field("label", inp(s, i, "label", s.label)) + "</div>";
    case "upload": return '<div class="frow">' + target() + field("files (comma-separated)", inp(s, i, "files", (s.files || []).join(", "))) + "</div>";
    case "waitFor":
      return '<div class="frow">' + target("locator (optional)") + field("url (optional)", inp(s, i, "url", s.url)) +
        field("state", '<select data-step="' + i + '" data-field="state">' +
          ["", "visible", "hidden", "attached", "detached"].map((v) => '<option value="' + v + '"' + ((s.state ?? "") === v ? " selected" : "") + ">" + (v || "—") + "</option>").join("") +
          "</select>") + "</div>";
    case "assert":
      return '<div class="frow">' +
        field("kind", '<select data-step="' + i + '" data-field="kind">' +
          ["text", "visible", "hidden", "url", "value", "count"].map((v) => '<option value="' + v + '"' + (s.kind === v ? " selected" : "") + ">" + v + "</option>").join("") +
          "</select>") +
        target("locator (optional)") + field("expected", inp(s, i, "expected", s.expected)) + "</div>";
    case "delay": return field("ms", '<input type="number" min="0" data-step="' + i + '" data-field="ms" value="' + esc(s.ms ?? 0) + '" />');
    case "customJs": return field("code", '<textarea rows="3" data-step="' + i + '" data-field="code">' + esc(s.code || "") + "</textarea>");
    case "hook":
      return field("phase", '<select data-step="' + i + '" data-field="phase">' +
        ["before", "after"].map((v) => '<option value="' + v + '"' + (s.phase === v ? " selected" : "") + ">" + v + "</option>").join("") +
        "</select>") +
        field("code", '<textarea rows="3" data-step="' + i + '" data-field="code">' + esc(s.code || "") + "</textarea>");
    default: return '<span class="muted">no editable fields</span>';
  }
}

function drawEditor() {
  const view = $("view");
  if (rawMode) {
    view.innerHTML =
      '<div class="editor">' +
      '<div class="bar"><b>Edit: ' + esc(ed.name) + "</b>" +
      '<button id="modeBtn">Structured editor</button>' +
      '<button id="saveBtn" class="primary">Save</button>' +
      '<button id="cancelBtn">Cancel</button></div>' +
      '<div class="error" id="edErr"></div>' +
      '<textarea id="rawTa" rows="30">' + esc(JSON.stringify(ed, null, 2)) + "</textarea>" +
      "</div>";
    $("modeBtn").onclick = () => {
      try {
        ed = JSON.parse($("rawTa").value);
        rawMode = false;
        drawEditor();
      } catch (e) {
        $("edErr").textContent = "invalid JSON: " + e.message;
      }
    };
    wireSaveCancel(() => JSON.parse($("rawTa").value));
    return;
  }

  const projOpts =
    '<option value="">(unassigned)</option>' +
    projects.map((p) => '<option value="' + esc(p.id) + '"' + (ed.projectId === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("");
  const varRows = (ed.variables || [])
    .map(
      (v, i) =>
        "<tr>" +
        '<td><input data-var="' + i + '" data-vfield="name" value="' + esc(v.name) + '" /></td>' +
        '<td><select data-var="' + i + '" data-vfield="kind">' + ["secret", "data"].map((k) => '<option' + (v.kind === k ? " selected" : "") + ">" + k + "</option>").join("") + "</select></td>" +
        '<td><select data-var="' + i + '" data-vfield="source">' + ["env", "fixture", "generated"].map((k) => '<option' + (v.source === k ? " selected" : "") + ">" + k + "</option>").join("") + "</select></td>" +
        '<td><input data-var="' + i + '" data-vfield="note" value="' + esc(v.note ?? "") + '" /></td>' +
        '<td><button class="mini danger" data-delvar="' + i + '">✕</button></td></tr>',
    )
    .join("");
  const stepCards = (ed.steps || [])
    .map(
      (s, i) =>
        '<div class="step-card">' +
        '<div class="step-head"><span class="n">' + (i + 1) + '</span><span class="type">' + esc(s.type) + '</span><span class="spacer"></span>' +
        '<button class="mini" data-up="' + i + '" title="Move up">↑</button>' +
        '<button class="mini" data-down="' + i + '" title="Move down">↓</button>' +
        '<button class="mini danger" data-delstep="' + i + '" title="Delete step">✕</button></div>' +
        stepBody(s, i) +
        "</div>",
    )
    .join("");

  view.innerHTML =
    '<div class="editor">' +
    '<div class="bar"><b>Edit: ' + esc(ed.name) + "</b>" +
    '<button id="modeBtn">Raw JSON</button>' +
    '<button id="saveBtn" class="primary">Save</button>' +
    '<button id="cancelBtn">Cancel</button></div>' +
    '<div class="error" id="edErr"></div>' +
    '<div class="card"><div class="frow">' +
    field("name", '<input data-meta="name" value="' + esc(ed.name) + '" />') +
    field("project", '<select data-meta="projectId">' + projOpts + "</select>") +
    field("start url", '<input data-meta="startUrl" value="' + esc(ed.startUrl || "") + '" />') +
    "</div></div>" +
    '<div class="card"><h4 style="margin:0 0 8px">Variables</h4>' +
    '<table class="vars"><tr><th>name</th><th>kind</th><th>source</th><th>note</th><th></th></tr>' + varRows + "</table>" +
    '<div style="margin-top:8px"><button class="mini" id="addVar">+ variable</button></div></div>' +
    '<div class="card"><h4 style="margin:0 0 8px">Steps</h4>' + stepCards + "</div>" +
    "</div>";

  const root = view.firstElementChild;

  // Value edits: mutate the working copy in place (no redraw needed).
  root.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.meta) {
      if (el.dataset.meta === "projectId") {
        if (el.value) ed.projectId = el.value;
        else delete ed.projectId;
      } else ed[el.dataset.meta] = el.value;
      return;
    }
    if (el.dataset.var !== undefined) {
      const v = ed.variables[Number(el.dataset.var)];
      if (el.value) v[el.dataset.vfield] = el.value;
      else if (el.dataset.vfield === "note") delete v.note;
      else v[el.dataset.vfield] = el.value;
      return;
    }
    if (el.dataset.step !== undefined) {
      const s = ed.steps[Number(el.dataset.step)];
      const f = el.dataset.field;
      if (f === "target.primary") {
        s.target = s.target || { primary: "", fallbacks: [] };
        s.target.primary = el.value;
      } else if (f === "ms") s.ms = Number(el.value);
      else if (f === "files") s.files = el.value.split(",").map((x) => x.trim()).filter(Boolean);
      else if (f === "state") {
        if (el.value) s.state = el.value;
        else delete s.state;
      } else if (el.value === "" && (f === "url" || f === "label" || f === "expected")) delete s[f];
      else s[f] = el.value;
    }
  });

  // Structural edits: mutate + redraw.
  root.addEventListener("click", (e) => {
    const el = e.target;
    if (el.id === "addVar") {
      ed.variables = ed.variables || [];
      ed.variables.push({ name: "NEW_VAR", kind: "data", source: "fixture" });
      drawEditor();
    } else if (el.dataset.delvar !== undefined) {
      ed.variables.splice(Number(el.dataset.delvar), 1);
      drawEditor();
    } else if (el.dataset.delstep !== undefined) {
      ed.steps.splice(Number(el.dataset.delstep), 1);
      drawEditor();
    } else if (el.dataset.up !== undefined) {
      const i = Number(el.dataset.up);
      if (i > 0) {
        [ed.steps[i - 1], ed.steps[i]] = [ed.steps[i], ed.steps[i - 1]];
        drawEditor();
      }
    } else if (el.dataset.down !== undefined) {
      const i = Number(el.dataset.down);
      if (i < ed.steps.length - 1) {
        [ed.steps[i], ed.steps[i + 1]] = [ed.steps[i + 1], ed.steps[i]];
        drawEditor();
      }
    }
  });

  $("modeBtn").onclick = () => {
    rawMode = true;
    drawEditor();
  };
  wireSaveCancel(() => ed);
}

function wireSaveCancel(getTrace) {
  $("cancelBtn").onclick = () => go("#traces");
  $("saveBtn").onclick = async () => {
    let body;
    try {
      body = getTrace();
    } catch (e) {
      $("edErr").textContent = "invalid JSON: " + e.message;
      return;
    }
    const res = await api("/traces/" + ed.id, { method: "PUT", body: JSON.stringify(body) });
    const out = await res.json();
    if (res.status === 422) {
      $("edErr").innerHTML = "invalid trace:<br>" + (out.details || []).map(esc).join("<br>");
      return;
    }
    if (!res.ok) {
      $("edErr").textContent = out.error || "save failed";
      return;
    }
    setStatus("saved");
    selected = out.id;
    go("#traces");
  };
}

// ---------------------------------------------------------------------------
// #admin — user management

async function viewAdmin() {
  const view = $("view");
  view.innerHTML = '<div class="editor"><div class="card" id="userCard"><div class="empty">loading…</div></div></div>';
  await drawUsers();
}

async function drawUsers(freshToken, freshTokenUser) {
  const card = $("userCard");
  const res = await api("/users");
  if (!res.ok) {
    card.innerHTML = '<div class="empty">' + esc((await res.json()).error || "failed") + "</div>";
    return;
  }
  const users = await res.json();
  card.innerHTML =
    '<h4 style="margin:0 0 8px">Users</h4>' +
    (freshToken
      ? '<div class="tokenbox">Token for <b>' + esc(freshTokenUser) + "</b> (copy now — it is not shown again):<br>" + esc(freshToken) + "</div>"
      : "") +
    '<table class="users"><tr><th>username</th><th>role</th><th>created</th><th></th></tr>' +
    users
      .map(
        (u) =>
          "<tr><td>" + esc(u.username) + (u.disabled ? ' <span class="muted">(disabled)</span>' : "") + "</td>" +
          "<td>" + esc(u.role) + "</td>" +
          "<td>" + new Date(u.createdAt).toLocaleDateString() + "</td>" +
          '<td style="text-align:right">' +
          '<button class="mini" data-rtok="' + esc(u.id) + '" data-un="' + esc(u.username) + '">Reset token</button> ' +
          '<button class="mini" data-pw="' + esc(u.id) + '">Set password</button> ' +
          '<button class="mini danger" data-delu="' + esc(u.id) + '" data-un="' + esc(u.username) + '">Delete</button></td></tr>',
      )
      .join("") +
    "</table>" +
    '<h4 style="margin:16px 0 8px">New user</h4>' +
    '<div class="frow">' +
    '<input id="nuName" placeholder="username" />' +
    '<input id="nuPass" type="password" placeholder="password (min 8)" />' +
    '<select id="nuRole"><option value="user">user</option><option value="admin">admin</option></select>' +
    '<button class="primary" id="nuAdd">Create</button></div>' +
    '<div class="error" id="uerr"></div>';

  $("nuAdd").onclick = async () => {
    $("uerr").textContent = "";
    const res = await api("/users", {
      method: "POST",
      body: JSON.stringify({ username: $("nuName").value.trim(), password: $("nuPass").value, role: $("nuRole").value }),
    });
    const body = await res.json();
    if (!res.ok) {
      $("uerr").textContent = body.error || "failed";
      return;
    }
    await drawUsers(body.token, body.username);
  };
  card.querySelectorAll("[data-rtok]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Reset the API token for " + b.dataset.un + "? The old token stops working.")) return;
      const body = await (await api("/users/" + b.dataset.rtok + "/reset-token", { method: "POST" })).json();
      await drawUsers(body.token, b.dataset.un);
    };
  });
  card.querySelectorAll("[data-pw]").forEach((b) => {
    b.onclick = async () => {
      const password = prompt("New password (min 8 chars):");
      if (!password) return;
      const res = await api("/users/" + b.dataset.pw + "/password", { method: "PUT", body: JSON.stringify({ password }) });
      if (!res.ok) setStatus((await res.json()).error, true);
      else setStatus("password updated");
    };
  });
  card.querySelectorAll("[data-delu]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Delete user " + b.dataset.un + "?")) return;
      const res = await api("/users/" + b.dataset.delu, { method: "DELETE" });
      if (!res.ok) setStatus((await res.json()).error, true);
      await drawUsers();
    };
  });
}

// ---------------------------------------------------------------------------

render();
