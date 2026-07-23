#!/usr/bin/env node
/**
 * FIRS / NRS e-Invoicing smoke test (FlowBooks SI sandbox)
 *
 * Usage (API must be running, e.g. npm run dev):
 *   npm run test:firs
 *
 * Optional env:
 *   FIRS_TEST_BASE_URL=http://localhost:42843/inventria_new
 *   EINVOICING_OAUTH_CLIENT_ID / EINVOICING_OAUTH_CLIENT_SECRET
 *   NRS_BUSINESS_ID (defaults to demo facility id)
 *
 * Reference: https://einvoice.firs.gov.ng/docs/introduction?version=1.1
 */

require("dotenv").config();
const {
  getSampleInvoicePayload,
} = require("../swagger/eInvoicingContent");

const BASE = (
  process.env.FIRS_TEST_BASE_URL ||
  `http://localhost:${process.env.PORT || 42843}${process.env.BASE_PATH || "/inventria_new"}`
).replace(/\/$/, "");

const CLIENT_ID =
  process.env.EINVOICING_OAUTH_CLIENT_ID || "fbk_test_client";
const CLIENT_SECRET =
  process.env.EINVOICING_OAUTH_CLIENT_SECRET || "fbk_test_secret";
const BUSINESS_ID =
  process.env.NRS_BUSINESS_ID ||
  "a2381ffd-ea78-40e5-b1d2-2fb5d9412735";

async function httpJson(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const hint =
      `Cannot reach ${BASE}${path}\n` +
      `  → Start the API first in another terminal:\n` +
      `       cd flowbooks_api && npm run dev\n` +
      `  → Wait until you see "App listening", then re-run: npm run test:firs\n` +
      `  → Cause: ${err.cause?.code || err.code || err.message}`;
    throw new Error(hint);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function stampIrn(payload) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const serviceId = process.env.NRS_SERVICE_ID || "6AF0BD";
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    ...payload,
    business_id: BUSINESS_ID,
    irn: `FB-TEST-${stamp}-${serviceId}-${ymd}`,
    issue_date: new Date().toISOString().slice(0, 10),
    tax_point_date: new Date().toISOString().slice(0, 10),
  };
}

function maskSecret(secret = "") {
  const s = String(secret);
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}${"*".repeat(Math.min(12, s.length - 4))}${s.slice(-2)}`;
}

async function main() {
  const showSecret = process.env.FIRS_TEST_SHOW_SECRET === "1";
  console.log("\n=== FlowBooks FIRS e-Invoicing test ===");
  console.log(`Base URL: ${BASE}`);
  console.log(`client_id:     ${CLIENT_ID}`);
  console.log(
    `client_secret: ${showSecret ? CLIENT_SECRET : maskSecret(CLIENT_SECRET)}` +
      (showSecret ? "" : "  (set FIRS_TEST_SHOW_SECRET=1 to print full value)"),
  );
  console.log(`business_id:   ${BUSINESS_ID}`);
  console.log(
    "Source: EINVOICING_OAUTH_CLIENT_ID / EINVOICING_OAUTH_CLIENT_SECRET in .env\n",
  );

  // 1) OAuth token
  console.log("1) POST /api/v1/invoice/oauth/token");
  const tokenRes = await httpJson("POST", "/api/v1/invoice/oauth/token", {
    body: {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    },
  });
  if (tokenRes.status !== 200 || !tokenRes.data.access_token) {
    console.error("FAIL token:", tokenRes.status, tokenRes.data);
    if (tokenRes.status === 401) {
      console.error(
        "\nHint: client_id/client_secret are not accepted on this host.\n" +
          "  → Local: ensure .env has EINVOICING_OAUTH_CLIENT_ID / EINVOICING_OAUTH_CLIENT_SECRET and restart API.\n" +
          "  → Remote (server.brainstorm.ng): deploy the same env vars on the server and restart PM2/service.\n" +
          "  → Or mint per-business credentials via POST /api/v1/invoice/credentials/rotate (user JWT).\n",
      );
    }
    process.exit(1);
  }
  const token = tokenRes.data.access_token;
  console.log("OK  access_token received");
  console.log(`    token_type=${tokenRes.data.token_type} expires_in=${tokenRes.data.expires_in} scope=${tokenRes.data.scope}\n`);

  // 2) Create invoice
  const payload = stampIrn(getSampleInvoicePayload());
  console.log("2) POST /api/v1/invoice/create");
  console.log(`    irn=${payload.irn}`);
  const createRes = await httpJson("POST", "/api/v1/invoice/create", {
    token,
    body: payload,
  });
  if (!createRes.data.success) {
    console.error("FAIL create:", createRes.status, createRes.data);
    process.exit(1);
  }
  console.log("OK ", createRes.data.message);
  console.log("   ", JSON.stringify(createRes.data.data, null, 2), "\n");

  // 3) Status lookup
  console.log("3) POST /api/v1/invoice/status");
  const statusRes = await httpJson("POST", "/api/v1/invoice/status", {
    token,
    body: { business_id: BUSINESS_ID, irn: payload.irn },
  });
  if (!statusRes.data.success) {
    console.error("FAIL status:", statusRes.status, statusRes.data);
    process.exit(1);
  }
  console.log("OK ", JSON.stringify(statusRes.data.data, null, 2), "\n");

  // 4) Payment notify
  console.log("4) POST /api/v1/invoice/payment/notify");
  const payRes = await httpJson("POST", "/api/v1/invoice/payment/notify", {
    token,
    body: {
      business_id: BUSINESS_ID,
      irn: payload.irn,
      payment_status: "PAID",
    },
  });
  if (!payRes.data.success) {
    console.error("FAIL payment notify:", payRes.status, payRes.data);
    process.exit(1);
  }
  console.log("OK ", payRes.data.message);
  console.log("   ", JSON.stringify(payRes.data.data, null, 2), "\n");

  // 5) Transmit invoice (SI sandbox marks TRANSMITTED when no upstream APP is set)
  console.log("5) POST /api/v1/invoice/transmit/:irn");
  const transmitRes = await httpJson(
    "POST",
    `/api/v1/invoice/transmit/${encodeURIComponent(payload.irn)}`,
    {
      token,
      body: { business_id: BUSINESS_ID },
    },
  );
  if (transmitRes.status !== 200 || !transmitRes.data?.data?.ok) {
    console.error("FAIL transmit:", transmitRes.status, transmitRes.data);
    process.exit(1);
  }
  console.log("OK  transmitted");
  console.log("   ", JSON.stringify(transmitRes.data, null, 2), "\n");

  // Confirm transmission_status updated
  const afterTransmit = await httpJson("POST", "/api/v1/invoice/status", {
    token,
    body: { business_id: BUSINESS_ID, irn: payload.irn },
  });
  const txStatus = afterTransmit.data?.data?.transmission_status;
  if (txStatus !== "TRANSMITTED") {
    console.error(
      "FAIL transmit status not updated:",
      txStatus,
      afterTransmit.data,
    );
    process.exit(1);
  }
  console.log(`OK  status.transmission_status=${txStatus}\n`);

  console.log("=== All FIRS sandbox steps passed ===\n");
  console.log("Docs: http://localhost:" + (process.env.PORT || 42843) + (process.env.BASE_PATH || "/inventria_new") + "/e-invoicing-api-docs");
  console.log("FIRS ref: https://einvoice.firs.gov.ng/docs/introduction?version=1.1\n");
}

main().catch((err) => {
  console.error("Test crashed:", err.message || err);
  process.exit(1);
});
