const {
  getSandboxConfig,
  getSampleInvoicePayload,
  getSampleInvoiceHtml,
} = require("./eInvoicingContent.js");

/** Prevent HTML injection in embedded JSON/code. */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Dark-themed code block. */
function code(json) {
  return `<pre class="code">${esc(json)}</pre>`;
}

/** Tabbed code examples (e.g. Full Paid / Partial Paid). */
function codeSwitch(tabs) {
  const id = `code-switch-${Math.random().toString(36).slice(2, 9)}`;
  const tabBtns = tabs
    .map(
      (t, i) =>
        `<button type="button" class="code-switch__tab${i === 0 ? " is-active" : ""}" data-tab="${esc(t.id)}" role="tab" aria-selected="${i === 0 ? "true" : "false"}">${esc(t.label)}</button>`,
    )
    .join("");
  const panels = tabs
    .map(
      (t, i) =>
        `<div class="code-switch__panel${i === 0 ? " is-active" : ""}" data-panel="${esc(t.id)}" role="tabpanel"${i === 0 ? "" : " hidden"}>
          <button type="button" class="code-switch__copy" aria-label="Copy example" title="Copy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <pre class="code code--switch">${esc(t.code)}</pre>
        </div>`,
    )
    .join("");
  return `<div class="code-switch" id="${id}" data-code-switch>
  <div class="code-switch__tabs" role="tablist">${tabBtns}</div>
  <div class="code-switch__body">${panels}</div>
</div>`;
}

/** Striped data table from row objects. */
function table(headers, rows) {
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const TOC = [
  { id: "introduction", label: "Introduction" },
  { id: "platform-roles", label: "Platform Roles" },
  { id: "how-it-works", label: "How It Works" },
  { id: "system-architecture", label: "System Architecture" },
  { id: "data-flow", label: "Data Flow" },
  { id: "invoice-standardization", label: "Invoice Standardization" },
  { id: "invoice-schema", label: "Invoice Schema" },
  { id: "rendered-invoice", label: "Rendered Invoice" },
  { id: "authentication", label: "Authentication" },
  { id: "api-reference", label: "API Reference" },
  { id: "error-reference", label: "Error Reference" },
  { id: "http-status-codes", label: "HTTP Status Codes" },
  { id: "security-compliance", label: "Security & Compliance" },
];

/**
 * Render complete HTML page for FlowBooks NRS E-Invoicing technical documentation.
 * @param {{ baseUrl?: string }} opts - API base URL (no trailing slash)
 * @returns {string}
 */
function renderEInvoicingDocsPage({ baseUrl = "" } = {}) {
  const cfg = getSandboxConfig();
  const root = baseUrl.replace(/\/$/, "");
  // Base-path prefix (e.g. "/inventria_new") so same-origin doc resources
  // resolve under the mount point instead of the domain root. Without this the
  // favicon/logo/spec links drop the base path and 404 in production.
  let basePrefix = "";
  try {
    basePrefix = root ? new URL(root).pathname.replace(/\/$/, "") : "";
  } catch {
    basePrefix = root.replace(/\/$/, "");
  }
  const sampleJson = JSON.stringify(getSampleInvoicePayload(cfg), null, 2);
  const openapiUrl = `${basePrefix}/e-invoicing-api-docs.json`;
  const postmanUrl = `${basePrefix}/e-invoicing-api-docs/postman.json`;
  const sampleInvoiceUrl = `${basePrefix}/e-invoicing-api-docs/sample-invoice`;
  const assetsUrl = `${basePrefix}/e-invoicing-api-docs/assets`;
  // Embed sample invoice via srcdoc so helmet X-Frame-Options: DENY cannot
  // block the preview (iframes to /sample-invoice were showing "refused to connect").
  const sampleInvoiceSrcdoc = getSampleInvoiceHtml(cfg)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  // Publicly reachable collection URL used by the "Run in Postman" / download buttons.
  const postmanAbsUrl = `${root}/e-invoicing-api-docs/postman.json`;
  // Optional published Postman fork link (app.getpostman.com/run-collection/...).
  // When unset, open Postman's import-from-URL flow against our hosted collection JSON.
  const postmanRunUrl =
    process.env.EINVOICING_POSTMAN_RUN_URL ||
    `https://app.getpostman.com/run-collection/import?url=${encodeURIComponent(postmanAbsUrl)}`;
  const postmanDownloadUrl = postmanAbsUrl;
  const authBaseUrl = (
    process.env.EINVOICING_AUTH_BASE_URL || "https://connect.flowbooks.org"
  ).replace(/\/$/, "");
  const prodApiBaseUrl = "https://server.brainstorm.ng/inventria_new";
  const prodDocsUrl = `${prodApiBaseUrl}/e-invoicing-api-docs`;

  // Sandbox demo credentials for docs curl samples (opt-in — never embed live OAuth secrets).
  const showSandboxCreds =
    process.env.EINVOICING_DOCS_SHOW_SANDBOX_CREDS === "true";
  const liveClientId = process.env.EINVOICING_OAUTH_CLIENT_ID || "";
  const liveClientSecret = process.env.EINVOICING_OAUTH_CLIENT_SECRET || "";
  const docsOnlyClientId = process.env.EINVOICING_DOCS_CLIENT_ID || "";
  const docsOnlyClientSecret = process.env.EINVOICING_DOCS_CLIENT_SECRET || "";
  const docsCredsSafe =
    showSandboxCreds &&
    docsOnlyClientId &&
    docsOnlyClientSecret &&
    docsOnlyClientId !== liveClientId &&
    docsOnlyClientSecret !== liveClientSecret;
  const docsClientId = docsCredsSafe ? docsOnlyClientId : "YOUR_CLIENT_ID";
  const docsClientSecret = docsCredsSafe
    ? docsOnlyClientSecret
    : "YOUR_CLIENT_SECRET";
  const hasRealDocsCreds = docsCredsSafe;

  const tocHtml = TOC.map(
    (item) =>
      `<li><a href="#${item.id}" class="toc-link">${item.label}</a></li>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>FlowBooks NRS E-Invoicing — Technical Documentation</title>
<link rel="icon" type="image/svg+xml" href="${assetsUrl}/flo-blue.svg"/>
<link rel="apple-touch-icon" href="${assetsUrl}/flo-blue.svg"/>
<style>
  :root {
    --bg: #ffffff;
    --fg: #334155;
    --fg-strong: #1e293b;
    --heading: #0f172a;
    --heading-2: #334155;
    --heading-3: #475569;
    --muted: #64748b;
    --panel: #f8fafc;
    --border: #e2e8f0;
    --link: #4267B2;
    --inline-code-bg: #f1f5f9;
    --note-bg: #eff6ff;
    --note-border: #bfdbfe;
    --note-fg: #1e40af;
    --note-code-bg: #dbeafe;
    --toc-title: #94a3b8;
    --toc-link: #475569;
    --top-bg: #ffffff;
  }
  html[data-theme="dark"] {
    --bg: #0b1220;
    --fg: #cbd5e1;
    --fg-strong: #e2e8f0;
    --heading: #f8fafc;
    --heading-2: #e2e8f0;
    --heading-3: #cbd5e1;
    --muted: #94a3b8;
    --panel: #131c2e;
    --border: #24314b;
    --link: #8ab0ff;
    --inline-code-bg: #24314b;
    --note-bg: #14233c;
    --note-border: #24314b;
    --note-fg: #bfdbfe;
    --note-code-bg: #24314b;
    --toc-title: #94a3b8;
    --toc-link: #94a3b8;
    --top-bg: #0b1220;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.65;
    color: var(--fg);
    background: var(--bg);
    transition: background 0.2s ease, color 0.2s ease;
  }
  .top-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--top-bg);
    border-bottom: 1px solid var(--border);
  }
  .top-bar-inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 14px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .top-bar h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--heading);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .brand-logo {
    height: 34px;
    width: auto;
    display: block;
    border-radius: 6px;
  }
  .brand-sep {
    width: 1px;
    height: 22px;
    background: var(--border);
    flex-shrink: 0;
  }
  html[data-theme="dark"] .brand-logo {
    background: #ffffff;
    padding: 3px 7px;
  }
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    line-height: 1;
    transition: border-color 0.15s ease, color 0.15s ease;
  }
  .theme-toggle:hover { border-color: var(--link); color: var(--link); }
  .theme-toggle svg { width: 15px; height: 15px; }
  .layout {
    display: flex;
    max-width: 1180px;
    margin: 0 auto;
    padding: 32px 24px 80px;
    gap: 40px;
    align-items: flex-start;
  }
  .main { flex: 1; min-width: 0; max-width: 900px; }
  .toc {
    position: sticky;
    top: 72px;
    width: 220px;
    flex-shrink: 0;
    font-size: 13px;
    line-height: 1.5;
    border-left: 1px solid var(--border);
    padding-left: 16px;
    max-height: calc(100vh - 88px);
    overflow-y: auto;
  }
  .toc-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--toc-title);
    margin: 0 0 12px -10px;
  }
  .toc ul { list-style: none; margin: 0; padding: 0; }
  .toc li { margin-bottom: 6px; }
  .toc a {
    color: var(--toc-link);
    text-decoration: none;
    display: block;
    padding: 2px 0 2px 12px;
    margin-left: -17px;
    border-left: 2px solid transparent;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .toc a:hover { color: var(--link); }
  .toc a.active {
    color: var(--link);
    font-weight: 600;
    border-left-color: var(--link);
  }
  .env-note {
    background: var(--note-bg);
    border: 1px solid var(--note-border);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 13px;
    color: var(--note-fg);
    margin-bottom: 28px;
  }
  .env-note code { background: var(--note-code-bg); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  section { margin-bottom: 48px; scroll-margin-top: 80px; }
  h2 {
    font-size: 24px;
    font-weight: 700;
    color: var(--heading);
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--border);
  }
  h3 { font-size: 17px; font-weight: 600; color: var(--heading-2); margin: 28px 0 12px; }
  h4 { font-size: 14px; font-weight: 600; color: var(--heading-3); margin: 20px 0 8px; }
  p { margin: 0 0 14px; color: var(--fg); }
  ul, ol { margin: 0 0 16px; padding-left: 22px; color: var(--fg); }
  li { margin-bottom: 6px; }
  a { color: var(--link); }
  strong { color: var(--fg-strong); }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin: 12px 0 20px;
    border: 1px solid var(--border);
  }
  .data-table th {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    color: var(--heading-2);
  }
  .data-table td {
    border: 1px solid var(--border);
    padding: 9px 12px;
    vertical-align: top;
    color: var(--fg);
  }
  .data-table tbody tr:nth-child(even) { background: var(--panel); }
  .data-table code { font-size: 12px; background: var(--inline-code-bg); padding: 1px 4px; border-radius: 3px; }
  p code, li code { background: var(--inline-code-bg); padding: 1px 4px; border-radius: 3px; font-size: 12.5px; }
  pre.code {
    background: #1e293b;
    color: #e2e8f0;
    padding: 16px 18px;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 12.5px;
    line-height: 1.55;
    margin: 12px 0 20px;
    border: 1px solid var(--border);
    font-family: ui-monospace, "Cascadia Code", "Segoe UI Mono", monospace;
  }
  .code-switch {
    margin: 12px 0 20px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    overflow: hidden;
  }
  .code-switch__tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    padding: 0 4px;
  }
  .code-switch__tab {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    padding: 12px 16px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .code-switch__tab:hover { color: var(--fg-strong); }
  .code-switch__tab.is-active {
    color: var(--heading);
    font-weight: 700;
    border-bottom-color: var(--link);
  }
  .code-switch__body { position: relative; }
  .code-switch__panel { display: none; position: relative; }
  .code-switch__panel.is-active { display: block; }
  .code-switch__panel pre.code--switch {
    margin: 0;
    border: none;
    border-radius: 0;
    background: #0f172a;
  }
  .code-switch__copy {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.85);
    color: #cbd5e1;
    cursor: pointer;
  }
  .code-switch__copy:hover { color: #fff; border-color: #94a3b8; }
  .code-switch__copy.is-copied { color: #86efac; border-color: #86efac; }
  .method {
    display: inline-block;
    background: var(--link);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    margin-right: 8px;
    font-family: monospace;
  }
  .endpoint { font-family: monospace; font-size: 14px; font-weight: 600; color: var(--heading); }
  figure.diagram {
    margin: 20px 0 24px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    text-align: center;
  }
  figure.diagram img {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
  }
  figure.diagram figcaption {
    margin-top: 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .invoice-frame {
    width: 100%;
    height: 920px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    margin: 16px 0;
  }
  .callout {
    background: var(--panel);
    border-left: 4px solid var(--link);
    padding: 12px 16px;
    margin: 16px 0;
    font-size: 14px;
    color: var(--fg);
  }
  .badge { font-size: 12px; color: var(--muted); }
  .postman-run-btn {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    background: #ff6c37;
    color: #fff !important;
    font-weight: 600;
    font-size: 15px;
    padding: 12px 22px;
    border-radius: 6px;
    text-decoration: none;
    border: none;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    transition: background 0.15s ease;
  }
  .postman-run-btn:hover { background: #e8592a; text-decoration: none; }
  .postman-run-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
  .postman-run-btn.header { font-size: 13px; padding: 8px 14px; box-shadow: none; }
  .postman-run-btn.header svg { width: 13px; height: 13px; }
  /* Sized to content and right-aligned so it lines up over the TOC column
     ("On this page") without squeezing the button onto two lines. */
  .top-bar-actions {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    flex-wrap: nowrap;
  }
  .top-bar-actions .theme-toggle,
  .top-bar-actions .postman-run-btn { flex-shrink: 0; white-space: nowrap; }
  .postman-download-link {
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    white-space: nowrap;
  }
  .postman-download-link:hover { color: var(--link); text-decoration: underline; }
  .run-postman-wrap { margin: 18px 0 8px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  @media (max-width: 960px) {
    .layout { flex-direction: column; }
    .toc { position: static; width: 100%; border-left: none; border-top: 1px solid var(--border); padding: 16px 0 0; max-height: none; }
    .toc a { margin-left: 0; }
  }
</style>
</head>
<body>

<header class="top-bar">
  <div class="top-bar-inner">
    <div class="brand">
      <img class="brand-logo" src="${assetsUrl}/flowbooks-logo.png" alt="FlowBooks" width="150" height="42"/>
      <span class="brand-sep" aria-hidden="true"></span>
      <h1>NRS E-Invoicing</h1>
    </div>
    <div class="top-bar-actions">
      <button type="button" id="themeToggle" class="theme-toggle" aria-label="Toggle dark mode">
        <span id="themeToggleIcon" aria-hidden="true"></span>
        <span id="themeToggleLabel">Dark</span>
      </button>
      <a class="postman-run-btn header" href="${postmanRunUrl}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
        Run in Postman
      </a>
    </div>
  </div>
</header>

<div class="layout">
<main class="main">

<section id="introduction">
  <h2>Introduction</h2>
  <p>
    The <strong>FlowBooks NRS E-Invoicing Platform</strong> facilitates the secure validation, standardization,
    transmission, and reconciliation of sales invoices between taxpayers and the Nigeria Revenue Service (NRS).
    It enables businesses to integrate their ERP or accounting systems with the NRS e-invoicing infrastructure
    through secure APIs, ensuring invoices comply with NRS standards before transmission.
  </p>
  <p>
    FlowBooks operates as the <strong>System Integrator (SI)</strong> within the e-invoicing ecosystem.
    It extracts, maps, validates, and standardizes invoices from the ERP/accounting system, then submits
    the standardized invoice to a certified <strong>Access Point Provider (APP)</strong> for transmission to NRS.
    This document covers the System Integrator responsibilities and the complete technical integration path,
    including how FlowBooks interacts with the Access Point Provider.
  </p>
  <p class="badge">
  Base URL: <code>${prodApiBaseUrl}</code>
  </p>
  <p class="badge">
  Production documentation:
  <a href="${prodDocsUrl}">${prodDocsUrl}</a>
  </p>
  <div class="run-postman-wrap">
    <a class="postman-run-btn" href="${postmanRunUrl}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
      Run in Postman
    </a>
  </div>
</section>

<section id="platform-roles">
  <h2>Platform Roles</h2>

  <h3>System Integrator (SI) — FlowBooks</h3>
  <p>This is the role FlowBooks fulfils. The System Integrator prepares invoices from within the organisation's ERP or POS system and converts them into the standardized format required by NRS, then hands them to the Access Point Provider for transmission.</p>
  <ul>
    <li>Extract invoice data from ERP/POS systems</li>
    <li>Map local tax codes to NRS tax categories</li>
    <li>Map ERP products/services to NRS product/service codes (HSN / ISIC)</li>
    <li>Generate Invoice Reference Numbers (IRN)</li>
    <li>Validate invoice data against the NRS schema</li>
    <li>Standardize the invoice into the required JSON format</li>
    <li>Generate human-readable invoices for printing</li>
    <li>Submit standardized invoices to the Access Point Provider</li>
  </ul>

  <h3>Access Point Provider (APP)</h3>
  <p>A certified partner provider that FlowBooks submits standardized invoices to. The Access Point Provider transmits those invoices to the NRS platform on behalf of integrated clients.</p>
  <ul>
    <li>Authenticate API clients via OAuth 2.0 client credentials</li>
    <li>Validate invoice payloads against the NRS schema</li>
    <li>Digitally sign invoices before transmission</li>
    <li>Transmit invoices to NRS</li>
    <li>Handle invoice status and payment updates</li>
    <li>Return QR code data for invoice verification</li>
    <li>Manage webhook notifications and audit logging</li>
  </ul>
</section>

<section id="how-it-works">
  <h2>How It Works</h2>
  <p>The end-to-end flow from invoice creation to NRS transmission:</p>
  <ol>
    <li><strong>Invoice Created</strong> — An invoice is created in the ERP or POS system (e.g. FlowBooks ERP).</li>
    <li><strong>Standardization (SI)</strong> — FlowBooks SI middleware extracts invoice data, maps tax codes and product codes to NRS standards, generates an IRN (<code>${esc(cfg.irn)}</code>), validates the payload, and converts it to standardized JSON.</li>
    <li><strong>Transmission (APP)</strong> — The standardized invoice is submitted to the FlowBooks APP API (<code>POST /api/v1/invoice/create</code>), which authenticates the request, validates the payload, digitally signs the invoice, and transmits it to NRS.</li>
    <li><strong>QR Code Response</strong> — NRS returns a signed response. The platform returns <code>qr_code_data</code> which must be stored and printed on the physical invoice to make it NRS-compliant and verifiable.</li>
    <li><strong>Status Updates</strong> — Payment and clearance status can be queried via <code>POST /api/v1/invoice/status</code> or updated via <code>POST /api/v1/invoice/payment/notify</code>.</li>
  </ol>
</section>

<section id="system-architecture">
  <h2>System Architecture</h2>
  <p>
    The diagram below shows the full System Integrator integration path — from client
    channels and the ERP/accounting system, through the Integration Layer and Access Point
    Provider, to the Nigeria Revenue Service (NRSMBS) platform — together with the
    cross-cutting security, storage, and notification concerns.
  </p>
  <figure class="diagram">
    <img src="${assetsUrl}/high-level-architecture.png"
         alt="High-level architecture diagram for NRSMBS e-invoicing integration (System Integrator)"
         loading="lazy"/>
    <figcaption>System architecture and data flow for NRSMBS e-invoicing integration (System Integrator).</figcaption>
  </figure>
</section>

<section id="data-flow">
  <h2>Data Flow</h2>
  <p>
    The e-invoicing data flow moves an invoice from the originating ERP/POS system, through
    the System Integrator standardization layer and the Access Point Provider, to the NRS
    platform — with status, IRN, and QR code responses flowing back to be stored and
    delivered on the compliant invoice.
  </p>
  <ol>
    <li><strong>ERP / POS System</strong> — An invoice is created containing customer, items, tax, and amounts, then sent to the System Integrator as JSON/XML.</li>
    <li><strong>System Integrator Layer</strong> — Extracts and validates the invoice, maps ERP codes to NRS codes, generates the IRN, validates against the NRS schema, and renders the standardized UBL JSON.</li>
    <li><strong>Access Point Provider API</strong> — Authenticates (OAuth 2.0), validates and digitally signs the invoice, and transmits it to the NRS platform, returning an acknowledgement and status.</li>
    <li><strong>NRS Platform (NRSMBS)</strong> — Verifies and validates the invoice, performs fiscalization, generates the IRN, and emits status events and notifications.</li>
    <li><strong>Response</strong> — IRN, status, QR code, and events are returned to the System Integrator, which updates the ERP/POS and delivers the compliant e-invoice (print / PDF / email).</li>
  </ol>
  <figure class="diagram">
    <img src="${assetsUrl}/data-flow.png"
         alt="Data flow for NRS e-invoicing integration (System Integrator)"
         loading="lazy"/>
    <figcaption>End-to-end data flow: ERP/POS → System Integrator → Access Point Provider → NRS Platform.</figcaption>
  </figure>
</section>

<section id="invoice-standardization">
  <h2>Invoice Standardization</h2>
  <p>This section covers the System Integrator role — how raw ERP data is transformed into a NRS-compliant invoice before transmission.</p>

  <h3>Standardization Steps</h3>
  <ol>
    <li>Invoice is created in the ERP/POS system.</li>
    <li>Invoice data is extracted by FlowBooks SI middleware.</li>
    <li>ERP tax codes are mapped to NRS tax categories (e.g. <code>STANDARD_VAT</code>, <code>ZERO_VAT</code>).</li>
    <li>ERP products/services are mapped to NRS HSN or ISIC codes.</li>
    <li>A unique Invoice Reference Number (IRN) is generated.</li>
    <li>Invoice data is validated against the NRS schema.</li>
    <li>The invoice is converted to standardized JSON format.</li>
    <li>A human-readable invoice is generated for printing.</li>
    <li>The standardized invoice is submitted to the FlowBooks APP API.</li>
  </ol>

  <h3>IRN Generation</h3>
  <p>
    <code>irn</code> is a <strong>unique tracking number</strong> assigned to each invoice.
    Duplicate IRNs for the same <code>business_id</code> are <strong>rejected</strong> (HTTP 409).
  </p>
  <p>The Invoice Reference Number is generated using the following format:</p>
  ${code(`IRN = InvoiceNo + "-" + ServiceId + "-" + InvoiceDate(YYYYMMDD)

Example: ${cfg.invoice_no}-${cfg.service_id}-${cfg.issue_date.replace(/-/g, "")}
Current sandbox IRN: ${cfg.irn}`)}
  <div class="callout">Each invoice must use a new unique IRN. Re-submitting create with an existing IRN returns <strong>409 Duplicate IRN</strong> — it will not overwrite the original invoice.</div>

  <h3>ERP Field Mapping</h3>
  <p>The tables below show how data from ERP system tables is mapped to the standardized NRS invoice JSON fields.</p>

  <h4>Invoice Header Mapping</h4>
  ${table(
    ["ERP Field", "Source Table", "Standard Invoice Field", "Notes"],
    [
      ["<code>BusinessId</code>", "TaxPayerTable", "<code>business_id</code>", `NRS merchant UUID — sandbox: ${esc(cfg.business_id)}`],
      ["<code>InvoiceNo</code>", "SalesInvoiceTable", "<code>irn</code> (part)", "Combined with ServiceId and date"],
      ["<code>ServiceId</code>", "TaxPayerTable", "<code>irn</code> (part)", `Sandbox service ID: ${esc(cfg.service_id)}`],
      ["<code>InvoiceDate</code>", "SalesInvoiceTable", "<code>issue_date</code>", "Invoice issue date (YYYY-MM-DD)"],
      ["<code>DueDate</code>", "SalesInvoiceTable", "<code>due_date</code>", "Payment due date"],
      ["<code>DocumentType</code>", "Derived", "<code>invoice_type_code</code>", "381 = Invoice, 380 = Credit Note, 384 = Debit Note"],
      ["<code>CurrencyCode</code>", "SalesInvoiceTable", "<code>document_currency_code</code>", "Invoice currency (NGN)"],
      ["<code>CurrencyCode</code>", "SalesInvoiceTable", "<code>tax_currency_code</code>", "Tax currency (NGN)"],
      ["<code>PaymentStatus</code>", "SalesInvoiceTable", "<code>payment_status</code>", "PENDING, PAID, REJECTED, PARTIAL"],
    ],
  )}

  <h4>Supplier Mapping</h4>
  ${table(
    ["ERP Field", "Standard Invoice Field"],
    [
      ["<code>BusinessName</code>", "<code>accounting_supplier_party.party_name</code>"],
      ["<code>TIN</code>", "<code>accounting_supplier_party.tin</code>"],
      ["<code>Email</code>", "<code>accounting_supplier_party.email</code>"],
      ["<code>PhoneNo</code>", "<code>accounting_supplier_party.telephone</code>"],
      ["<code>Sector</code>", "<code>accounting_supplier_party.business_description</code>"],
      ["<code>Street</code>", "<code>accounting_supplier_party.postal_address.street_name</code>"],
      ["<code>CityName</code>", "<code>accounting_supplier_party.postal_address.city_name</code>"],
      ["<code>PostalZone</code>", "<code>accounting_supplier_party.postal_address.postal_zone</code>"],
      ["<code>Country</code>", "<code>accounting_supplier_party.postal_address.country</code>"],
    ],
  )}

  <h4>Customer Mapping</h4>
  <p>Customer information is included when a Customer TIN is present (B2B / B2G).</p>
  ${table(
    ["ERP Field", "Standard Invoice Field"],
    [
      ["<code>CustomerName</code>", "<code>accounting_customer_party.party_name</code>"],
      ["<code>CustomerTIN</code>", "<code>accounting_customer_party.tin</code>"],
      ["<code>CustomerEmail</code>", "<code>accounting_customer_party.email</code>"],
      ["<code>CustomerPhoneNo</code>", "<code>accounting_customer_party.telephone</code>"],
      ["<code>CustomerStreetName</code>", "<code>accounting_customer_party.postal_address.street_name</code>"],
      ["<code>CustomerCityName</code>", "<code>accounting_customer_party.postal_address.city_name</code>"],
      ["<code>CustomerPostalZone</code>", "<code>accounting_customer_party.postal_address.postal_zone</code>"],
      ["<code>CustomerCountry</code>", "<code>accounting_customer_party.postal_address.country</code>"],
    ],
  )}

  <h4>Invoice Line Mapping</h4>
  ${table(
    ["ERP Field", "Standard Invoice Field"],
    [
      ["<code>HsnCode</code> / <code>IsicCode</code>", "<code>invoice_line[].hsn_code</code> / <code>isic_code</code>"],
      ["<code>ItemName</code>", "<code>invoice_line[].item.name</code>"],
      ["<code>Category</code>", "<code>invoice_line[].product_category</code> / <code>service_category</code>"],
      ["<code>ItemCode</code>", "<code>invoice_line[].item.sellers_item_identification</code>"],
      ["<code>Quantity</code>", "<code>invoice_line[].invoiced_quantity</code>"],
      ["<code>UnitPriceExcl</code>", "<code>invoice_line[].price.price_amount</code>"],
      ["<code>UnitOfMeasure</code>", "<code>invoice_line[].price.price_unit</code>"],
      ["<code>LineAmount</code>", "<code>invoice_line[].line_extension_amount</code>"],
      ["<code>DiscountRate</code>", "<code>invoice_line[].discount_rate</code>"],
      ["<code>DiscountAmount</code>", "<code>invoice_line[].discount_amount</code>"],
    ],
  )}

  <h4>Tax Mapping</h4>
  ${table(
    ["ERP Field", "Standard Invoice Field"],
    [
      ["<code>VATAmount</code>", "<code>tax_total[].tax_amount</code>"],
      ["<code>LineAmount</code>", "<code>tax_subtotal[].taxable_amount</code>"],
      ["<code>VATAmount</code>", "<code>tax_subtotal[].tax_amount</code>"],
      ["<code>TaxTypeCode</code>", "<code>tax_category.id</code>"],
      ["<code>TaxRate</code>", "<code>tax_category.percent</code>"],
    ],
  )}

  <h4>Monetary Total Mapping</h4>
  ${table(
    ["Calculation", "Standard Invoice Field"],
    [
      ["<code>SUM(LineAmount)</code>", "<code>legal_monetary_total.line_extension_amount</code>"],
      ["<code>SUM(LineAmount)</code>", "<code>legal_monetary_total.tax_exclusive_amount</code>"],
      ["<code>SUM(LineAmount + VATAmount)</code>", "<code>legal_monetary_total.tax_inclusive_amount</code>"],
      ["<code>SUM(LineAmount + VATAmount − DiscountAmount)</code>", "<code>legal_monetary_total.payable_amount</code>"],
    ],
  )}
</section>

<section id="invoice-schema">
  <h2>Invoice Schema</h2>
  <p>All invoices must conform to the standardized schema defined by the NRS E-Invoicing platform (aligned with <a href="https://einvoice.firs.gov.ng/docs/introduction?version=1.1" target="_blank" rel="noopener">FIRS e-Invoicing documentation</a>).</p>

  <h3>Invoice Header</h3>
  ${table(
    ["Field", "Description", "Type", "Required", "Max Length"],
    [
      ["<code>business_id</code>", "Business UUID from NRS onboarding", "String", "Yes", "36"],
      ["<code>irn</code>", "Unique tracking number assigned to each invoice (no duplicates)", "String", "Yes", "50"],
      ["<code>invoice_kind</code>", "B2B, B2C, or B2G", "String", "Yes", "3"],
      ["<code>issue_date</code>", "Invoice issue date", "Date (YYYY-MM-DD)", "Yes", "10"],
      ["<code>due_date</code>", "Invoice due date", "Date (YYYY-MM-DD)", "Yes", "10"],
      ["<code>issue_time</code>", "Invoice issue time", "Time (HH:mm:ss)", "Yes", "8"],
      ["<code>invoice_type_code</code>", "381 = Invoice, 380 = Credit, 384 = Debit", "String", "Yes", "10"],
      ["<code>payment_status</code>", "Payment state", "String", "Yes", "—"],
      ["<code>tax_point_date</code>", "Tax point date", "Date (YYYY-MM-DD)", "Yes", "10"],
      ["<code>document_currency_code</code>", "Document currency", "String", "Yes", "3"],
      ["<code>tax_currency_code</code>", "Tax currency", "String", "Yes", "3"],
      ["<code>billing_reference[].irn</code>", "Original invoice IRN (credit/debit notes)", "String", "Conditional", "50"],
      ["<code>billing_reference[].issue_date</code>", "Original invoice date (credit/debit notes)", "Date", "Conditional", "10"],
    ],
  )}

  <h3>Supplier Information (<code>accounting_supplier_party</code>)</h3>
  ${table(
    ["Field", "Description", "Type", "Required", "Max Length"],
    [
      ["<code>party_name</code>", "Supplier name", "String", "Yes", "100"],
      ["<code>tin</code>", "Supplier TIN", "String", "Yes", "20"],
      ["<code>email</code>", "Supplier email", "String", "Yes", "100"],
      ["<code>telephone</code>", "Supplier phone", "String", "Yes", "20"],
      ["<code>business_description</code>", "Business description", "String", "No", "255"],
      ["<code>postal_address.street_name</code>", "Street name", "String", "Yes", "150"],
      ["<code>postal_address.city_name</code>", "City", "String", "Yes", "100"],
      ["<code>postal_address.postal_zone</code>", "Postal code", "String", "No", "20"],
      ["<code>postal_address.country</code>", "Country code (ISO 3166-1 alpha-2)", "String", "Yes", "2"],
    ],
  )}

  <h3>Customer Information (<code>accounting_customer_party</code>)</h3>
  <div class="callout">Customer information is only included in the payload if a Customer TIN is present.</div>
  ${table(
    ["Field", "Description", "Type", "Required", "Max Length"],
    [
      ["<code>party_name</code>", "Customer name", "String", "Yes", "100"],
      ["<code>tin</code>", "Customer TIN (min 5 chars)", "String", "Yes", "20"],
      ["<code>email</code>", "Customer email", "String", "Yes", "100"],
      ["<code>telephone</code>", "Customer phone", "String", "Yes", "20"],
      ["<code>business_description</code>", "Business description", "String", "No", "255"],
      ["<code>postal_address.street_name</code>", "Street name", "String", "No", "150"],
      ["<code>postal_address.city_name</code>", "City", "String", "Yes", "100"],
      ["<code>postal_address.postal_zone</code>", "Postal code", "String", "No", "20"],
      ["<code>postal_address.country</code>", "Country code (ISO 3166-1 alpha-2)", "String", "Yes", "2"],
    ],
  )}

  <h3>Invoice Line Items (<code>invoice_line[]</code>)</h3>
  ${table(
    ["Field", "Description", "Type", "Required"],
    [
      ["<code>hsn_code</code>", "Product classification code (goods)", "String", "Yes*"],
      ["<code>isic_code</code>", "Service classification code (services)", "String", "Yes*"],
      ["<code>product_category</code> / <code>service_category</code>", "Category name", "String", "Yes"],
      ["<code>invoiced_quantity</code>", "Quantity", "Decimal", "Yes"],
      ["<code>line_extension_amount</code>", "Line total amount", "Decimal", "Yes"],
      ["<code>discount_rate</code>", "Discount rate", "Decimal", "No"],
      ["<code>discount_amount</code>", "Discount amount", "Decimal", "No"],
      ["<code>item.name</code>", "Item name", "String", "Yes"],
      ["<code>item.description</code>", "Item description", "String", "Yes"],
      ["<code>item.sellers_item_identification</code>", "Item ID", "String", "Yes"],
      ["<code>price.price_amount</code>", "Unit price", "Decimal", "Yes"],
      ["<code>price.base_quantity</code>", "Base quantity", "Decimal", "Yes"],
      ["<code>price.price_unit</code>", "Price unit (EA, KGM, LTR…)", "String", "Yes"],
    ],
  )}
  <p class="badge">* Each line must include either <code>hsn_code</code> (goods) or <code>isic_code</code> (services).</p>

  <h3>Tax Structure (<code>tax_total[]</code>)</h3>
  ${table(
    ["Field", "Description", "Type", "Required"],
    [
      ["<code>tax_amount</code>", "Total tax amount", "Decimal", "Yes"],
      ["<code>tax_subtotal[].taxable_amount</code>", "Taxable amount", "Decimal", "Yes"],
      ["<code>tax_subtotal[].tax_amount</code>", "Tax amount", "Decimal", "Yes"],
      ["<code>tax_subtotal[].tax_category.id</code>", "e.g. STANDARD_VAT, ZERO_VAT", "String", "Yes"],
      ["<code>tax_subtotal[].tax_category.percent</code>", "Tax rate (%)", "Decimal", "Yes"],
    ],
  )}

  <h3>Monetary Totals (<code>legal_monetary_total</code>)</h3>
  ${table(
    ["Field", "Description", "Type", "Required"],
    [
      ["<code>line_extension_amount</code>", "Sum of all line amounts", "Decimal", "Yes"],
      ["<code>tax_exclusive_amount</code>", "Total before tax", "Decimal", "Yes"],
      ["<code>tax_inclusive_amount</code>", "Total after tax", "Decimal", "Yes"],
      ["<code>payable_amount</code>", "Final payable amount", "Decimal", "Yes"],
    ],
  )}
</section>

<section id="rendered-invoice">
  <h2>Rendered Invoice Example</h2>
  <p>
    The sample below shows a human-readable tax invoice generated by FlowBooks after standardization.
    The Tax Information footer contains the IRN and QR code — both must appear on every printed invoice
    for NRS compliance and verifiability.
  </p>
  <iframe
    class="invoice-frame"
    srcdoc="${sampleInvoiceSrcdoc}"
    title="Sample NRS Tax Invoice"
    loading="lazy"
  ></iframe>
  <p class="badge">
    Full-page sample also available at
    <a href="${sampleInvoiceUrl}" target="_blank" rel="noopener">${esc(sampleInvoiceUrl)}</a>
  </p>
  <h3>Key Elements on the Rendered Invoice</h3>
  <ul>
    <li>Supplier name, TIN, and address</li>
    <li>Customer name and Customer TIN</li>
    <li>Invoice number (<code>${esc(cfg.invoice_no)}</code>) and date</li>
    <li>Line items with HSN/ISIC code, Description, Quantity, Unit Price, Discount, and Amount</li>
    <li>VAT Analysis table showing tax code, goods value, rate, and VAT amount</li>
    <li>Summary totals: Sub Total, Total VAT, and Grand Total</li>
    <li>Tax Information footer containing transmission date, time, IRN (<code>${esc(cfg.irn)}</code>), and QR Code</li>
  </ul>
</section>

<section id="authentication">
  <h2>Authentication</h2>
  <p>
    FlowBooks E-Invoicing uses <strong>standard system-to-system (machine-to-machine) communication</strong>
    aligned with
    <a href="https://einvoice.firs.gov.ng/docs/introduction?version=1.1" target="_blank" rel="noopener">FIRS e-Invoicing documentation</a>.
    Integrator ERP/POS systems authenticate with <strong>OAuth 2.0 client credentials</strong>
    (<code>client_id</code> + <code>client_secret</code>) — not end-user login passwords on invoice APIs.
  </p>
  <p>
    <strong>Access tokens are</strong> short-lived Bearer JWTs issued by the FlowBooks identity service at
    <code>${esc(authBaseUrl)}</code> via
    <code>POST /api/v1/invoice/oauth/token</code>.
    They expire after <code>expires_in</code> seconds (default <strong>3600</strong>), carry scope
    <code>e-invoicing</code>, and must be sent on every invoice request as
    <code>Authorization: Bearer &lt;access_token&gt;</code>.
    Long-lived client secrets are used only to mint tokens — never on create/status/payment calls.
    All API traffic must use <strong>HTTPS</strong>. Requests without a valid access token return
    <code>401 Unauthorized</code>.
  </p>

  <h3>OAuth 2.0 — Client Credentials (system-to-system)</h3>
  <ol>
    <li>Obtain your <code>client_id</code> and <code>client_secret</code> from FlowBooks (per-business credentials / developer console).</li>
    <li>Concatenate as <code>client_id:client_secret</code> and Base64-encode the string.</li>
    <li>Request a token from the identity host <code>${esc(authBaseUrl)}</code> with <code>Authorization: Basic &lt;encoded&gt;</code> and <code>grant_type=client_credentials</code>.</li>
    <li>Use the returned <code>access_token</code> as <code>Authorization: Bearer &lt;access_token&gt;</code> on all invoice endpoints.</li>
    <li>When the token expires, request a new one (do not reuse expired tokens).</li>
  </ol>

  <h3>Step 1 — Get Access Token</h3>
  <p><span class="method">POST</span><span class="endpoint">${esc(authBaseUrl)}/api/v1/invoice/oauth/token</span></p>
  ${
    hasRealDocsCreds
      ? `<div class="callout">
    <strong>Sandbox demo credentials</strong> (system-to-system test):
    <br/>client_id = <code>${esc(docsClientId)}</code>
    <br/>client_secret = <code>${esc(docsClientSecret)}</code>
    <br/>Use these only against the configured identity host. Prefer per-business credentials in production.
  </div>`
      : `<div class="callout">
    Replace <code>YOUR_CLIENT_ID</code> and <code>YOUR_CLIENT_SECRET</code> with values from
    <code>POST /api/v1/invoice/credentials/rotate</code> (logged-in business admin), or set dedicated
    docs-only env vars <code>EINVOICING_DOCS_CLIENT_ID</code> / <code>EINVOICING_DOCS_CLIENT_SECRET</code>
    with <code>EINVOICING_DOCS_SHOW_SANDBOX_CREDS=true</code> for sandbox curl samples.
  </div>`
  }
  <p><strong>cURL (recommended):</strong></p>
  ${code(`curl -X POST '${authBaseUrl}/api/v1/invoice/oauth/token' \\
  -H "Authorization: Basic $(echo -n '${docsClientId}:${docsClientSecret}' | base64)" \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d 'grant_type=client_credentials'`)}
  <p><strong>Alternative — JSON body:</strong></p>
  ${code(`{
  "grant_type": "client_credentials",
  "client_id": "${docsClientId}",
  "client_secret": "${docsClientSecret}"
}`)}
  <p><strong>Successful response:</strong></p>
  ${code(`{
  "access_token": "eyJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "scope": "e-invoicing"
}`)}
  <div class="callout">
    System-to-system only: <code>access_token</code> is a short-lived Bearer credential for ERP ↔ FlowBooks API calls.
    It is not an interactive user session. Refresh by calling the token endpoint again before expiry.
  </div>

  <h3>Step 2 — Call Invoice Endpoints</h3>
  ${code(`curl -X POST '${root}/api/v1/invoice/create' \\
  -H "Authorization: Bearer <access_token>" \\
  -H "Content-Type: application/json" \\
  -d @invoice-payload.json`)}

  <h3>Environment Variables (server)</h3>
  ${table(
    ["Variable", "Description"],
    [
      ["<code>EINVOICING_OAUTH_CLIENT_ID</code>", "Optional global OAuth client ID (prefer per-business credentials)"],
      ["<code>EINVOICING_OAUTH_CLIENT_SECRET</code>", "Optional global OAuth client secret (keep confidential)"],
      ["<code>EINVOICING_OAUTH_TOKEN_TTL</code>", "Access token lifetime in seconds (default 3600)"],
      ["<code>NRS_BUSINESS_ID</code>", "Optional default NRS merchant UUID for sandbox samples"],
    ],
  )}
</section>

<section id="api-reference">
  <h2>API Reference</h2>
  <p>
    This section covers the Access Point Provider role — endpoints used to transmit, query, and reconcile invoices with NRS.
    For hands-on testing, click <a href="${postmanRunUrl}" target="_blank" rel="noopener noreferrer">Run in Postman</a>,
    download the <a href="${postmanUrl}">Postman Collection JSON</a>, or import the
    <a href="${openapiUrl}">OpenAPI JSON</a> specification into Postman.
  </p>

  <h3>Endpoints Summary</h3>
  ${table(
    ["Endpoint", "Method", "Purpose"],
    [
      ["<code>/api/v1/invoice/oauth/token</code>", "POST", "OAuth 2.0 — obtain access token (identity host)"],
      ["<code>/api/v1/invoice/create</code>", "POST", "Submit an invoice to NRS"],
      ["<code>/api/v1/invoice/status</code>", "POST", "Lookup invoice clearance / transmission status"],
      ["<code>/api/v1/invoice/payment/notify</code>", "POST", "Update payment status for a cleared invoice"],
      ["<code>/api/v1/invoice/transmit/{IRN}</code>", "POST", "Manually transmit a specific invoice to NRS by IRN"],
    ],
  )}

  <h3>Post Invoice</h3>
  <p><span class="method">POST</span><span class="endpoint">/api/v1/invoice/create</span></p>
  <p>Submits a standardized invoice to NRS. Credit notes (380) and debit notes (384) require a <code>billing_reference</code> array.</p>
  <p>Sample request (sandbox values from environment):</p>
  ${code(sampleJson)}
  <p>Successful response:</p>
  ${code(`{
  "success": true,
  "message": "Invoice submitted successfully",
  "data": {
    "irn": "${cfg.irn}",
    "issue_date": "${cfg.issue_date}",
    "due_date": "${cfg.due_date}",
    "sync_date": "${cfg.issue_date}",
    "payment_status": "PENDING",
    "transmitted": true,
    "delivered": true,
    "qr_code_data": "Base64EncodedQRCode..."
  }
}`)}

  <h3>Lookup Invoice Status</h3>
  <p><span class="method">POST</span><span class="endpoint">/api/v1/invoice/status</span></p>
  ${code(`{
  "business_id": "${cfg.business_id}",
  "irn": "${cfg.irn}"
}`)}
  <p>Response:</p>
  ${code(`{
  "success": true,
  "data": {
    "irn": "${cfg.irn}",
    "issue_date": "${cfg.issue_date}",
    "due_date": "${cfg.due_date}",
    "payment_status": "PENDING",
    "transmitted": true,
    "delivered": true,
    "qr_code_data": "Base64EncodedQRCode..."
  }
}`)}

  <h3>Update Payment Status</h3>
  <p><span class="method">POST</span><span class="endpoint">/api/v1/invoice/payment/notify</span></p>
  <p>
    <code>payment_status</code> must be one of:
    <code>PENDING</code>, <code>PAID</code>, <code>REJECTED</code>, <code>PARTIAL</code>.
  </p>
  <p>
    For <strong>PARTIAL</strong>, <code>amount</code> is <strong>required</strong> and is
    <em>this payment installment</em> (not the cumulative total). Controls:
  </p>
  <ul>
    <li><code>amount</code> cannot exceed the invoice <code>payable_amount</code></li>
    <li><code>amount</code> cannot exceed the remaining balance
      (<code>payable_amount − amount_paid_total</code>)</li>
    <li>When cumulative payments reach <code>payable_amount</code>, status becomes
      <code>PAID</code> automatically</li>
    <li>Further payments are rejected once the invoice is <code>PAID</code></li>
  </ul>
  ${codeSwitch([
    {
      id: "full-paid",
      label: "Full Paid",
      code: `{
  "business_id": "${cfg.business_id}",
  "irn": "${cfg.irn}",
  "payment_status": "PAID",
  "reference": "payment_reference_or_note"
}`,
    },
    {
      id: "partial-paid",
      label: "Partial Paid",
      code: `{
  "business_id": "${cfg.business_id}",
  "irn": "${cfg.irn}",
  "payment_status": "PARTIAL",
  "amount": 50000.00,
  "reference": "payment_reference_or_note"
}`,
    },
  ])}
  <p>Response:</p>
  ${code(`{
  "success": true,
  "message": "Payment notification sent"
}`)}

  <h3>Transmit Invoice</h3>
  <p><span class="method">POST</span><span class="endpoint">/api/v1/invoice/transmit/{IRN}</span></p>
  <p>
    Manually triggers transmission of a specific invoice to NRS by IRN.
    The invoice must already exist (created via <code>/create</code>).
    Optional <code>business_id</code> in body or query if not bound on the OAuth token.
  </p>
  ${code(`POST /api/v1/invoice/transmit/${cfg.irn}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "business_id": "${cfg.business_id}"
}`)}
  <p>Response:</p>
  ${code(`{
  "code": 200,
  "data": {
    "ok": true
  }
}`)}

  <h3>Invoice Type Codes</h3>
  ${table(
    ["Code", "Description"],
    [
      ["<code>381</code>", "Sales Invoice (default)"],
      ["<code>380</code>", "Credit Note"],
      ["<code>384</code>", "Debit Note"],
    ],
  )}
</section>

<section id="error-reference">
  <h2>Error Reference</h2>
  <p>All errors follow a structured JSON response. The <code>message</code> or <code>details</code> field contains the specific reason for failure.</p>

  <h3>Authentication Error — 401 Unauthorized</h3>
  ${code(`{
  "error": "invalid_client",
  "error_description": "Invalid client credentials."
}`)}

  <h3>Validation Error — 400 Bad Request</h3>
  ${code(`{
  "success": false,
  "message": "Validation Failed",
  "details": "accounting_customer_party.tin is required for B2B invoices."
}`)}

  <h3>Duplicate IRN — 409 Conflict</h3>
  ${code(`{
  "success": false,
  "message": "Duplicate IRN",
  "details": [
    "irn \\"INV-001-6AF0BD-20260716\\" is already assigned to an invoice for this business_id. Each invoice must have a unique IRN."
  ],
  "data": {
    "business_id": "${cfg.business_id}",
    "irn": "${cfg.irn}",
    "existing_payment_status": "PENDING"
  }
}`)}
  <div class="callout">IRN is a unique tracking number per invoice. Duplicate create submissions with the same IRN are rejected and do not update the existing invoice.</div>
</section>

<section id="http-status-codes">
  <h2>HTTP Status Codes</h2>
  ${table(
    ["Status Code", "Meaning", "Typical Scenario"],
    [
      ["<code>200 OK</code>", "Request successful", "Invoice submitted, status retrieved, token generated"],
      ["<code>201 Created</code>", "Resource created", "New invoice record created at NRS"],
      ["<code>400 Bad Request</code>", "Invalid input", "Missing required field, malformed JSON, validation error"],
      ["<code>401 Unauthorized</code>", "Authentication failed", "Invalid or expired OAuth access token"],
      ["<code>403 Forbidden</code>", "Access denied", "Client lacks permission for the resource"],
      ["<code>404 Not Found</code>", "Resource not found", "Invalid endpoint or invoice not found"],
      ["<code>409 Conflict</code>", "Duplicate IRN", "IRN already exists for this business_id"],
      ["<code>422 Unprocessable Entity</code>", "Validation failed", "Schema or business rule validation error"],
      ["<code>429 Too Many Requests</code>", "Rate limit exceeded", "Client exceeded request quota"],
      ["<code>500 Internal Server Error</code>", "Unexpected server error", "Unhandled exception, NRS system offline"],
      ["<code>503 Service Unavailable</code>", "Service temporarily unavailable", "Scheduled downtime or overload"],
    ],
  )}
</section>

<section id="security-compliance">
  <h2>Security &amp; Compliance</h2>
  ${table(
    ["Feature", "Detail"],
    [
      ["Authentication", "OAuth 2.0 client credentials (system-to-system) — POST /api/v1/invoice/oauth/token"],
      ["Data in Transit", "TLS 1.2+ (HTTPS required in production)"],
      ["Data at Rest", "Encrypted database storage for invoice records"],
      ["Invoice Integrity", "Digital signing of invoices at APP layer before NRS transmission"],
      ["Audit", "Full logging of all API calls and invoice lifecycle events"],
      ["NDPC Compliance", "Aligned with Nigeria Data Protection Act (NDPA) / NDPC requirements for personal and business data"],
      ["ISO Standards", "Security practices aligned with ISO/IEC 27001 information security management"],
      ["NRS Compliance", "Invoices validated against NRS e-invoicing regulations before transmission"],
    ],
  )}
  <h3>Security Notes</h3>
  <ul>
    <li>Never expose your <code>client_secret</code> or access tokens in client-side code or public repositories.</li>
    <li>Use environment variables for NRS sandbox credentials (<code>NRS_BUSINESS_ID</code>, <code>NRS_SERVICE_ID</code>, TINs).</li>
    <li>Rotate API passwords and review access logs regularly.</li>
    <li>Production API base: <code>https://server.brainstorm.ng/inventria_new</code></li>
  </ul>
</section>

</main>

<aside class="toc" aria-label="Table of contents">
  <p class="toc-title">On this page</p>
  <ul>${tocHtml}</ul>
</aside>

</div>

<script>
(function () {
  // ---- Dark / light theme toggle (persisted) ----
  var root = document.documentElement;
  var btn = document.getElementById("themeToggle");
  var icon = document.getElementById("themeToggleIcon");
  var label = document.getElementById("themeToggleLabel");
  var SUN = "\\u2600\\uFE0F";
  var MOON = "\\uD83C\\uDF19";

  function applyTheme(theme) {
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
      if (icon) icon.textContent = SUN;
      if (label) label.textContent = "Light";
    } else {
      root.removeAttribute("data-theme");
      if (icon) icon.textContent = MOON;
      if (label) label.textContent = "Dark";
    }
  }

  var stored = null;
  try { stored = localStorage.getItem("fb-einv-theme"); } catch (e) {}
  var prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(stored || (prefersDark ? "dark" : "light"));

  if (btn) {
    btn.addEventListener("click", function () {
      var next =
        root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("fb-einv-theme", next); } catch (e) {}
    });
  }

  // ---- Code example tab switches (Full Paid / Partial Paid, etc.) ----
  document.querySelectorAll("[data-code-switch]").forEach(function (wrap) {
    var tabs = wrap.querySelectorAll(".code-switch__tab");
    var panels = wrap.querySelectorAll(".code-switch__panel");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-tab");
        tabs.forEach(function (t) {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        panels.forEach(function (p) {
          var on = p.getAttribute("data-panel") === id;
          p.classList.toggle("is-active", on);
          if (on) p.removeAttribute("hidden");
          else p.setAttribute("hidden", "");
        });
      });
    });
    wrap.querySelectorAll(".code-switch__copy").forEach(function (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var panel = copyBtn.closest(".code-switch__panel");
        var pre = panel && panel.querySelector("pre");
        if (!pre) return;
        var text = pre.textContent || "";
        function done() {
          copyBtn.classList.add("is-copied");
          setTimeout(function () { copyBtn.classList.remove("is-copied"); }, 1200);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {});
        } else {
          var ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); done(); } catch (e) {}
          document.body.removeChild(ta);
        }
      });
    });
  });

  // ---- Scrollspy: highlight current section in the TOC ----
  var links = Array.prototype.slice.call(
    document.querySelectorAll(".toc-link")
  );
  var map = {};
  links.forEach(function (a) {
    var id = a.getAttribute("href").slice(1);
    var sec = document.getElementById(id);
    if (sec) map[id] = a;
  });
  var sections = Object.keys(map).map(function (id) {
    return document.getElementById(id);
  });

  function setActive(id) {
    links.forEach(function (a) { a.classList.remove("active"); });
    if (map[id]) map[id].classList.add("active");
  }

  if ("IntersectionObserver" in window && sections.length) {
    var visible = {};
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          visible[entry.target.id] = entry.isIntersecting
            ? entry.intersectionRatio
            : 0;
        });
        var bestId = null;
        var bestRatio = 0;
        Object.keys(visible).forEach(function (id) {
          if (visible[id] > bestRatio) {
            bestRatio = visible[id];
            bestId = id;
          }
        });
        if (bestId) setActive(bestId);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    sections.forEach(function (sec) { observer.observe(sec); });
  }
})();
</script>
</body>
</html>`;
}

module.exports = { renderEInvoicingDocsPage };
