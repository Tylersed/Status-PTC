const $ = (sel) => document.querySelector(sel);

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusPill(ok, labelUp = "UP", labelDown = "DOWN") {
  const el = document.createElement("span");
  el.className = `pill ${ok ? "good" : "bad"}`;
  el.textContent = ok ? labelUp : labelDown;
  return el;
}

function dot(ok) {
  const el = document.createElement("span");
  el.className = `dot ${ok ? "good" : "bad"}`;
  return el;
}

function computeUptime(history, checkId, points = 288) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const slice = history.slice(Math.max(0, history.length - points));
  const total = slice.length;
  const up = slice.filter(p => p?.checks?.[checkId]?.ok === true).length;
  return total ? (up / total) * 100 : null;
}

function buildSpark(uptimePct) {
  const outer = document.createElement("span");
  outer.className = "spark";
  const inner = document.createElement("i");
  const pct = Math.max(0, Math.min(100, uptimePct ?? 0));
  inner.style.width = `${pct}%`;
  outer.appendChild(inner);
  if (pct < 99) outer.classList.add("bad");
  return outer;
}

function groupOverall(group, status) {
  // status.groups[group].ok already computed server-side, but be defensive
  const g = status.groups?.[group];
  if (g?.ok !== undefined) return g.ok;
  const ids = g?.items || [];
  return ids.every(id => status.checks.find(c => c.id === id)?.ok === true);
}

function card(title, ok, subtitle) {
  const el = document.createElement("section");
  el.className = "card";

  const head = document.createElement("div");
  head.className = "cardHead";

  const h2 = document.createElement("h2");
  h2.textContent = title;

  const right = document.createElement("div");
  right.appendChild(statusPill(ok));

  head.appendChild(h2);
  head.appendChild(right);

  el.appendChild(head);

  if (subtitle) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = subtitle;
    el.appendChild(p);
  }

  return el;
}

function renderSummary(status, history, targets) {
  const container = $("#summary");
  container.innerHTML = "";

  const groups = Object.keys(status.groups || {});
  for (const g of groups) {
    const ok = groupOverall(g, status);
    const c = card(g, ok, ok ? "All checks look good." : "One or more checks are failing.");
    container.appendChild(c);
  }

  // Add quick links
  const linkCard = document.createElement("section");
  linkCard.className = "card";
  linkCard.innerHTML = `
    <div class="cardHead">
      <h2>Quick links</h2>
      <div class="muted">Official vendor pages</div>
    </div>
    <div class="table">
      <div class="row">
        <div class="left"><span class="dot good"></span><div><div class="name">PTC Website</div><div class="meta"><a href="${targets?.links?.ptcWebsite || "#"}" target="_blank" rel="noreferrer">Open</a></div></div></div>
        <div class="right"></div>
      </div>
      <div class="row">
        <div class="left"><span class="dot good"></span><div><div class="name">Microsoft 365 status</div><div class="meta"><a href="${targets?.links?.microsoftStatus || "#"}" target="_blank" rel="noreferrer">Open</a></div></div></div>
        <div class="right"></div>
      </div>
      <div class="row">
        <div class="left"><span class="dot good"></span><div><div class="name">Google Workspace status</div><div class="meta"><a href="${targets?.links?.googleWorkspaceStatus || "#"}" target="_blank" rel="noreferrer">Open</a></div></div></div>
        <div class="right"></div>
      </div>
    </div>
  `;
  container.appendChild(linkCard);
}

function renderDetails(status, history, targets) {
  const el = $("#details");
  el.innerHTML = "";

  const groups = {};
  for (const check of status.checks || []) {
    const g = check.group || "Other";
    if (!groups[g]) groups[g] = [];
    groups[g].push(check);
  }

  const points24h = 24 * 12; // 24h @ 5min
  $("#uptimeNote").textContent = `Uptime is calculated from the last ${Math.min(points24h, history?.length || 0)} checks (max 24h window).`;

  for (const [group, checks] of Object.entries(groups)) {
    const section = document.createElement("div");
    section.className = "card";
    section.style.marginBottom = "14px";

    const head = document.createElement("div");
    head.className = "cardHead";
    const h2 = document.createElement("h2");
    h2.textContent = group;

    const gOk = groupOverall(group, status);
    const right = document.createElement("div");
    right.appendChild(statusPill(gOk));

    head.appendChild(h2);
    head.appendChild(right);
    section.appendChild(head);

    const table = document.createElement("div");
    table.className = "table";

    for (const c of checks) {
      const row = document.createElement("div");
      row.className = "row";

      const left = document.createElement("div");
      left.className = "left";
      left.appendChild(dot(c.ok));

      const title = document.createElement("div");
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = c.name;

      const meta = document.createElement("div");
      meta.className = "meta";
      const target = c.finalUrl || c.target || "";
      meta.textContent = target;

      title.appendChild(name);
      title.appendChild(meta);
      left.appendChild(title);

      const right2 = document.createElement("div");
      right2.className = "right";
      right2.appendChild(statusPill(c.ok));

      // response time
      const msPill = document.createElement("span");
      msPill.className = "pill";
      msPill.textContent = fmtMs(c.ms);
      right2.appendChild(msPill);

      // uptime spark
      const uptime = computeUptime(history, c.id, points24h);
      if (uptime !== null) {
        const sparkWrap = document.createElement("span");
        sparkWrap.className = "pill";
        sparkWrap.title = `Uptime (24h): ${uptime.toFixed(2)}%`;
        sparkWrap.appendChild(buildSpark(uptime));
        right2.appendChild(sparkWrap);
      }

      // errors
      if (!c.ok && c.error) {
        const err = document.createElement("span");
        err.className = "pill warn";
        err.textContent = "error";
        err.title = c.error;
        right2.appendChild(err);
      }

      row.appendChild(left);
      row.appendChild(right2);
      table.appendChild(row);
    }

    section.appendChild(table);
    el.appendChild(section);
  }
}

function renderVendor(status, targets) {
  const el = $("#vendor");
  el.innerHTML = "";

  // Google Workspace incidents (official JSON)
  const gw = status.vendor?.googleWorkspace;
  const wrap = document.createElement("div");
  wrap.className = "table";

  const gwRow = document.createElement("div");
  gwRow.className = "row";

  const left = document.createElement("div");
  left.className = "left";

  const activeCount = Array.isArray(gw?.active) ? gw.active.length : null;
  const ok = gw?.ok === true && (activeCount === 0);

  left.appendChild(dot(ok));
  const title = document.createElement("div");
  title.innerHTML = `
    <div class="name">Google Workspace incidents (official)</div>
    <div class="meta">${gw?.source ? gw.source : ""}</div>
  `;
  left.appendChild(title);

  const right = document.createElement("div");
  right.className = "right";
  right.appendChild(statusPill(ok, "NO INCIDENTS", "INCIDENTS"));
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = gw?.ok ? `${activeCount ?? 0} active` : "unavailable";
  right.appendChild(pill);

  gwRow.appendChild(left);
  gwRow.appendChild(right);
  wrap.appendChild(gwRow);

  if (gw?.ok && Array.isArray(gw.active) && gw.active.length) {
    for (const inc of gw.active.slice(0, 5)) {
      const r = document.createElement("div");
      r.className = "row";
      r.innerHTML = `
        <div class="left">
          <span class="dot bad"></span>
          <div>
            <div class="name">${inc.service_name}</div>
            <div class="meta">Severity: ${inc.severity || "n/a"} • Started: ${inc.begin ? fmtTime(inc.begin) : "n/a"}</div>
          </div>
        </div>
        <div class="right">
          <span class="pill bad">${inc.status_impact || "INCIDENT"}</span>
        </div>
      `;
      wrap.appendChild(r);
    }
  }

  // Microsoft note
  const msRow = document.createElement("div");
  msRow.className = "row";
  msRow.innerHTML = `
    <div class="left">
      <span class="dot warn"></span>
      <div>
        <div class="name">Microsoft 365: official incident detail is tenant-only</div>
        <div class="meta">
          We do synthetic checks publicly. For official health, use
          <a href="${targets?.links?.microsoftStatus || "#"}" target="_blank" rel="noreferrer">Microsoft 365 status</a>
          or your Admin Center (Health → Service health).
        </div>
      </div>
    </div>
    <div class="right">
      <span class="pill warn">info</span>
    </div>
  `;
  wrap.appendChild(msRow);

  el.appendChild(wrap);
}

async function loadJson(url, bust = true) {
  const u = bust ? `${url}?_=${Date.now()}` : url;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function boot() {
  try {
    const [status, history, targets] = await Promise.all([
      loadJson("./status.json"),
      loadJson("./history.json"),
      loadJson("./targets.json")
    ]);

    $("#lastUpdated").textContent = `Last updated: ${fmtTime(status.generatedAt)}`;

    renderSummary(status, history, targets);
    renderDetails(status, history, targets);
    renderVendor(status, targets);

  } catch (e) {
    $("#lastUpdated").textContent = "Failed to load status data.";
    $("#summary").innerHTML = `<section class="card"><h2>Error</h2><div class="muted">${String(e)}</div></section>`;
  }
}

$("#refreshBtn").addEventListener("click", boot);
boot();
