#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const TARGETS_PATH = path.join(ROOT, "config", "targets.json");
const PUBLIC_DIR = path.join(ROOT, "docs");
const STATUS_PATH = path.join(PUBLIC_DIR, "status.json");
const HISTORY_PATH = path.join(PUBLIC_DIR, "history.json");

const HTTP_TIMEOUT_MS = 12000;
const HISTORY_MAX_POINTS = 7 * 24 * 12; // 7 days @ every 5 minutes

function nowIso() {
  return new Date().toISOString();
}

async function ensurePublicDir() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  // helps GitHub Pages serve files like /_something if you ever add them
  await fs.writeFile(path.join(PUBLIC_DIR, ".nojekyll"), "");
}

async function loadTargets() {
  const raw = await fs.readFile(TARGETS_PATH, "utf-8");
  return JSON.parse(raw);
}

function withTimeout(promise, ms, label = "operation") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, timer, promise };
}

async function httpCheck(url) {
  const started = Date.now();
  let status = null;
  let ok = false;
  let finalUrl = url;
  let error = null;

  try {
    const { controller, timer } = withTimeout(Promise.resolve(), HTTP_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "ptc-status-watch/1.0 (+https://github.com/)"
      }
    }).finally(() => clearTimeout(timer));

    status = res.status;
    finalUrl = res.url || url;
    ok = status >= 200 && status < 400;
  } catch (e) {
    error = String(e?.name || e) + (e?.message ? `: ${e.message}` : "");
    ok = false;
  }

  const ms = Date.now() - started;
  return { ok, status, ms, finalUrl, error };
}

async function dnsMxCheck(host) {
  const started = Date.now();
  let ok = false;
  let records = [];
  let error = null;

  try {
    records = await dns.resolveMx(host);
    ok = Array.isArray(records) && records.length > 0;
  } catch (e) {
    error = String(e?.code || e?.name || e);
    ok = false;
  }

  const ms = Date.now() - started;
  return { ok, ms, records, error };
}

async function dnsTxtCheck(host) {
  const started = Date.now();
  let ok = false;
  let records = [];
  let error = null;

  try {
    records = await dns.resolveTxt(host); // array of arrays
    ok = Array.isArray(records);
  } catch (e) {
    error = String(e?.code || e?.name || e);
    ok = false;
  }

  const ms = Date.now() - started;
  return { ok, ms, records, error };
}

function flattenTxt(records) {
  // records is array of arrays of strings
  return (records || []).map(arr => (arr || []).join("")).filter(Boolean);
}

async function spfCheck(domain) {
  const r = await dnsTxtCheck(domain);
  const txt = flattenTxt(r.records);
  const spf = txt.find(t => t.toLowerCase().includes("v=spf1"));
  return {
    ok: Boolean(spf),
    ms: r.ms,
    spf: spf || null,
    allTxtCount: txt.length,
    error: r.error
  };
}

async function dmarcCheck(domain) {
  const host = `_dmarc.${domain}`;
  const r = await dnsTxtCheck(host);
  const txt = flattenTxt(r.records);
  const dmarc = txt.find(t => t.toLowerCase().includes("v=dmarc1"));
  return {
    ok: Boolean(dmarc),
    ms: r.ms,
    dmarc: dmarc || null,
    error: r.error,
    host
  };
}

async function fetchGoogleWorkspaceIncidents(config) {
  const started = Date.now();
  const out = { ok: false, ms: null, active: [], error: null, source: config?.incidentsUrl || null };

  if (!config?.enabled) return out;

  try {
    const { controller, timer } = withTimeout(Promise.resolve(), HTTP_TIMEOUT_MS);
    const res = await fetch(config.incidentsUrl, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const incidents = await res.json();
    const products = new Set((config.productsOfInterest || []).map(String));

    // Treat incidents without an "end" timestamp as still active
    const active = (incidents || [])
      .filter(i => !i.end)
      .map(i => ({
        id: i.id,
        service_name: i.service_name,
        severity: i.severity,
        begin: i.begin,
        status_impact: i.status_impact,
        uri: i.uri,
        most_recent_status: i?.most_recent_update?.status || null,
        most_recent_when: i?.most_recent_update?.when || null
      }))
      .filter(i => !products.size || products.has(i.service_name));

    out.ok = true;
    out.active = active;
  } catch (e) {
    out.error = String(e?.name || e) + (e?.message ? `: ${e.message}` : "");
    out.ok = false;
  }

  out.ms = Date.now() - started;
  return out;
}

function groupChecks(checks) {
  const groups = {};
  for (const c of checks) {
    const g = c.group || "Other";
    if (!groups[g]) groups[g] = [];
    groups[g].push(c.id);
  }
  return groups;
}

async function run() {
  await ensurePublicDir();
  const targets = await loadTargets();

  const checks = [];
  for (const t of targets.checks || []) {
    const base = {
      id: t.id,
      name: t.name,
      type: t.type,
      group: t.group || "Other",
      target: t.url || t.host || null,
      checkedAt: nowIso()
    };

    if (t.type === "http") {
      const r = await httpCheck(t.url);
      checks.push({ ...base, ...r });
    } else if (t.type === "dns_mx") {
      const r = await dnsMxCheck(t.host);
      checks.push({ ...base, ok: r.ok, ms: r.ms, records: r.records, error: r.error });
    } else if (t.type === "dns_spf") {
      const r = await spfCheck(t.host);
      checks.push({ ...base, ok: r.ok, ms: r.ms, record: r.spf, error: r.error });
    } else if (t.type === "dns_dmarc") {
      const r = await dmarcCheck(t.host);
      checks.push({ ...base, ok: r.ok, ms: r.ms, record: r.dmarc, host: r.host, error: r.error });
    } else {
      checks.push({ ...base, ok: false, error: `Unknown type: ${t.type}` });
    }
  }

  const groups = groupChecks(targets.checks || []);
  const groupStatus = Object.fromEntries(
    Object.entries(groups).map(([g, ids]) => {
      const oks = ids.map(id => checks.find(c => c.id === id)?.ok).filter(v => typeof v === "boolean");
      const ok = oks.length ? oks.every(Boolean) : false;
      return [g, { ok, items: ids }];
    })
  );

  const googleWorkspace = await fetchGoogleWorkspaceIncidents(targets.vendor?.googleWorkspace);

  const payload = {
    generatedAt: nowIso(),
    domain: targets.domain,
    links: targets.links || {},
    groups: groupStatus,
    checks,
    vendor: {
      googleWorkspace
    }
  };

  await fs.writeFile(STATUS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");

  // --- history ---
  let history = [];
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf-8");
    history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }

  const point = {
    t: payload.generatedAt,
    checks: Object.fromEntries(
      checks.map(c => [c.id, { ok: c.ok, ms: c.ms ?? null, status: c.status ?? null }])
    ),
    groups: Object.fromEntries(
      Object.entries(groupStatus).map(([g, v]) => [g, { ok: v.ok }])
    )
  };

  history.push(point);
  if (history.length > HISTORY_MAX_POINTS) {
    history = history.slice(history.length - HISTORY_MAX_POINTS);
  }

  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf-8");

  // Also publish the targets so the UI can render labels consistently
  await fs.writeFile(path.join(PUBLIC_DIR, "targets.json"), JSON.stringify(targets, null, 2) + "\n", "utf-8");

  console.log(`Wrote: ${STATUS_PATH}`);
  console.log(`Wrote: ${HISTORY_PATH} (${history.length} points)`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
