"use strict";

const FACILITY = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const BASE = "http://127.0.0.1:42844";

let pass = 0;
let fail = 0;

function ok(name, detail = "") {
  pass += 1;
  console.log(`PASS: ${name}${detail ? " — " + detail : ""}`);
}
function bad(name, detail = "") {
  fail += 1;
  console.log(`FAIL: ${name} — ${detail}`);
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { success: false, error: text.slice(0, 200), http: res.status };
  }
  return { status: res.status, json };
}

async function expectOk(name, method, path, body, assertFn) {
  try {
    const { status, json } = await req(method, path, body);
    if (status >= 400) {
      bad(name, `HTTP ${status} ${json.error || ""}`);
      return null;
    }
    if (json.success === false) {
      bad(name, json.error || "success false");
      return null;
    }
    if (assertFn) assertFn(json);
    ok(name);
    return json;
  } catch (e) {
    bad(name, e.message);
    return null;
  }
}

(async () => {
  console.log(`===== CRM API E2E (${FACILITY}) =====`);

  await expectOk(
    "dashboard",
    "GET",
    `/api/v1/crm/dashboard?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (typeof j.results?.totalCustomers !== "number") {
        throw new Error("missing totalCustomers");
      }
    },
  );

  const list = await expectOk(
    "customers list",
    "GET",
    `/api/v1/crm/customers?facilityId=${FACILITY}&limit=10`,
    null,
    (j) => {
      if (!Array.isArray(j.results) || !j.results.length) {
        throw new Error("empty list");
      }
    },
  );
  const customerNo =
    list?.results?.find((r) => Number(r.invoice_count) > 0)?.customer_no ||
    list?.results?.[0]?.customer_no;
  console.log(`  using customer ${customerNo}`);

  await expectOk(
    "customer 360",
    "GET",
    `/api/v1/crm/customers/${encodeURIComponent(customerNo)}?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (!j.results?.customer) throw new Error("no customer");
    },
  );

  await expectOk(
    "timeline",
    "GET",
    `/api/v1/crm/customers/${encodeURIComponent(customerNo)}/timeline?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (!Array.isArray(j.results)) throw new Error("no events");
    },
  );

  const act = await expectOk(
    "create activity",
    "POST",
    `/api/v1/crm/activities`,
    {
      facilityId: FACILITY,
      customer_no: customerNo,
      activity_type: "call",
      subject: "E2E call",
      body: "end-to-end test call",
    },
    (j) => {
      if (!j.results?.id) throw new Error("no id");
    },
  );
  const actId = act?.results?.id;

  await expectOk(
    "list activities",
    "GET",
    `/api/v1/crm/activities?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (!j.results?.some((a) => a.id === actId)) {
        throw new Error("activity missing");
      }
    },
  );

  const fu = await expectOk(
    "create followup",
    "POST",
    `/api/v1/crm/followups`,
    {
      facilityId: FACILITY,
      customer_no: customerNo,
      title: "E2E follow-up",
      due_at: "2026-08-20T09:00:00",
      notes: "e2e",
    },
    (j) => {
      if (!j.results?.id) throw new Error("no id");
    },
  );
  const fuId = fu?.results?.id;

  await expectOk(
    "complete followup",
    "PUT",
    `/api/v1/crm/followups/${fuId}?facilityId=${FACILITY}`,
    { facilityId: FACILITY, status: "done" },
    (j) => {
      if (j.results?.status !== "done") throw new Error(j.results?.status);
    },
  );

  await expectOk(
    "list segments",
    "GET",
    `/api/v1/crm/segments?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (!j.results?.length) throw new Error("no segments");
    },
  );

  const seg = await expectOk(
    "create segment",
    "POST",
    `/api/v1/crm/segments`,
    {
      facilityId: FACILITY,
      name: "E2E Segment",
      description: "test segment",
    },
    (j) => {
      if (!j.results?.segment_key) throw new Error("no key");
    },
  );
  const segKey = seg?.results?.segment_key;
  const segId = seg?.results?.id;

  await expectOk(
    "bulk assign segment",
    "POST",
    `/api/v1/crm/customers/bulk-meta`,
    {
      facilityId: FACILITY,
      customerNos: [customerNo],
      segment_key: segKey,
    },
    (j) => {
      if (!j.updated) throw new Error("not updated");
    },
  );

  await expectOk(
    "get settings",
    "GET",
    `/api/v1/crm/settings?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (!j.results?.dormant_days) throw new Error("no settings");
    },
  );

  await expectOk(
    "put settings",
    "PUT",
    `/api/v1/crm/settings?facilityId=${FACILITY}`,
    { facilityId: FACILITY, vip_min_sales: 100000, dormant_days: 90 },
    (j) => {
      if (Number(j.results?.vip_min_sales) !== 100000) {
        throw new Error("vip not set");
      }
    },
  );

  const cl = await expectOk(
    "classify",
    "POST",
    `/api/v1/crm/classify`,
    { facilityId: FACILITY },
    (j) => {
      if (typeof j.results?.total !== "number") throw new Error("no total");
    },
  );
  if (cl) {
    console.log(
      `  classify: ${cl.results.total} customers, ${cl.results.updated} updated`,
    );
  }

  const dash2 = await expectOk(
    "dashboard after classify",
    "GET",
    `/api/v1/crm/dashboard?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (!j.results?.byStatus) throw new Error("no byStatus");
    },
  );
  if (dash2) {
    console.log(`  status mix: ${JSON.stringify(dash2.results.byStatus)}`);
  }

  const tp = await expectOk(
    "create template",
    "POST",
    `/api/v1/crm/sms/templates`,
    {
      facilityId: FACILITY,
      name: "E2E Template",
      body: "Hi {{customer_name}} ({{customer_no}}), E2E test.",
    },
    (j) => {
      if (!j.results?.id) throw new Error("no id");
    },
  );
  const tpId = tp?.results?.id;

  await expectOk(
    "sms dry-run",
    "POST",
    `/api/v1/crm/sms/send`,
    {
      facilityId: FACILITY,
      dry_run: true,
      template_id: tpId,
      recipients: [
        {
          customer_no: customerNo,
          customer_name: "Test Cust",
          phone: "08031112222",
        },
      ],
    },
    (j) => {
      if (!j.dry_run || j.count !== 1) throw new Error(JSON.stringify(j));
      if (!String(j.preview?.[0]?.message || "").includes("Test Cust")) {
        throw new Error("personalization failed");
      }
    },
  );

  await expectOk(
    "timeline has activity",
    "GET",
    `/api/v1/crm/customers/${encodeURIComponent(customerNo)}/timeline?facilityId=${FACILITY}`,
    null,
    (j) => {
      if (
        !j.results?.some(
          (e) => e.type === "activity" && String(e.title || "").includes("E2E"),
        )
      ) {
        throw new Error("activity not in timeline");
      }
    },
  );

  await expectOk(
    "filter VIP customers",
    "GET",
    `/api/v1/crm/customers?facilityId=${FACILITY}&crm_status=VIP`,
  );

  const rb = await fetch(
    `${BASE}/api/v1/rebate-ledger/rules?facilityId=${FACILITY}`,
  );
  if (rb.status === 200) ok("rebate ledger still 200");
  else bad("rebate ledger", `HTTP ${rb.status}`);

  if (segId) {
    await req("DELETE", `/api/v1/crm/segments/${segId}?facilityId=${FACILITY}`);
  }

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
