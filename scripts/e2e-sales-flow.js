/**
 * End-to-end sales process test: create → pay/approve → separate → warehouse → done
 * + special invoice treatment + sales reports.
 *
 * Run: node scripts/e2e-sales-flow.js
 */
const mysql = require("mysql2/promise");

const API = "http://localhost:42844";
const FACILITY = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const EMAIL = "admin@gmail.com";
const PASSWORD = "Ashiru@2026";

const results = [];
function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`✅ PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ ok: false, name, detail });
  console.log(`❌ FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}
function info(msg) {
  console.log(`   … ${msg}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: token } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

function assert(cond, name, detail) {
  if (cond) pass(name, detail);
  else fail(name, detail);
  return cond;
}

(async () => {
  console.log("\n=== AA ERP E2E Sales Flow Test ===\n");

  // ── 1. Login ──────────────────────────────────────────────
  const login = await api("POST", "/api/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!assert(login.json.success && login.json.token, "Auth login", login.json.message)) {
    console.log(JSON.stringify(login.json, null, 2));
    process.exit(1);
  }
  const token = login.json.token;
  const userId = login.json.user?.id || login.json.user?.user_id || 4;
  const business = (login.json.businessesList || []).find((b) => b.id === FACILITY)
    || login.json.business
    || {};
  info(`user=${userId} business=${business.business_name || FACILITY}`);

  // ── 2. Load masters from DB ───────────────────────────────
  const conn = await mysql.createConnection({
    host: "127.0.0.1",
    user: "root",
    password: "",
    database: "aa_erp_db",
  });

  const [customers] = await conn.query(
    `SELECT customerNo, fullname AS nm, receivable_code
     FROM customers WHERE facilityId=? AND LOWER(status)='active' LIMIT 10`,
    [FACILITY],
  );
  let stock = [];
  try {
    const [s] = await conn.query(
      `SELECT se.product_id, se.branchId, se.branch_name, se.source,
              SUM(COALESCE(se.qty_in,0) - COALESCE(se.qty_out,0)) AS qty,
              p.name, p.sku, p.selling_price, p.cost_price,
              p.inventory_account, p.revenue_account, p.cogs_head
       FROM store_entries se
       JOIN products p ON p.facility_id = se.facilityId AND p.sku = se.product_id
       WHERE se.facilityId=?
       GROUP BY se.product_id, se.branchId, se.branch_name, se.source, p.name, p.sku, p.selling_price, p.cost_price, p.inventory_account, p.revenue_account, p.cogs_head
       HAVING qty >= 1
       ORDER BY qty DESC
       LIMIT 10`,
      [FACILITY],
    );
    stock = s;
  } catch (e) {
    info(`stock query failed: ${e.message}`);
    const [s2] = await conn.query(
      `SELECT product_id, branchId, branch_name, source,
              SUM(COALESCE(qty_in,0) - COALESCE(qty_out,0)) AS qty
       FROM store_entries WHERE facilityId=?
       GROUP BY product_id, branchId, branch_name, source
       HAVING qty >= 1 ORDER BY qty DESC LIMIT 5`,
      [FACILITY],
    );
    if (s2[0]) {
      const [p] = await conn.query(
        `SELECT * FROM products WHERE facility_id=? AND sku=? LIMIT 1`,
        [FACILITY, s2[0].product_id],
      );
      stock = [{ ...s2[0], ...p[0], sku: p[0]?.sku || s2[0].product_id }];
    }
  }

  const [cashAccts] = await conn.query(
    `SELECT code, description FROM account_category
     WHERE facility_id=? AND code IN ('112199','112200')
     ORDER BY code`,
    [FACILITY],
  );
  const [bankRows] = await conn.query(
    `SELECT id, account_name, head, status FROM bank_accounts
     WHERE facility_id=? AND LOWER(status)='active' LIMIT 5`,
    [FACILITY],
  ).catch(() => [[]]);

  assert(customers.length > 0, "Has active customer", customers[0]?.customerNo);
  assert(stock.length > 0, "Has stock for sale", stock[0] ? `${stock[0].sku} qty=${stock[0].qty}` : "none");

  const customer = customers.find((c) => /flowbook/i.test(c.nm)) || customers[0];
  const product = stock[0];
  const cashHead =
    cashAccts.find((a) => a.code === "112199")?.code ||
    cashAccts[0]?.code ||
    "112199";
  const bankAccount = bankRows[0] || null;

  info(`customer=${customer.customerNo} ${customer.nm}`);
  info(`product=${product.sku} ${product.name} @${product.selling_price} branch=${product.branchId}`);
  info(`cashHead=${cashHead} bank=${bankAccount?.id || "none"}`);

  const unitPrice = Number(product.selling_price) || 1000;
  const qty = 1;
  const lineTotal = unitPrice * qty;

  function saleItem() {
    return {
      product_id: product.sku,
      sku: product.sku,
      item_name: product.name,
      item_code: product.sku,
      quantity: qty,
      qty: qty,
      price: unitPrice,
      selling_price: unitPrice,
      cost_price: Number(product.cost_price) || 0,
      amount: lineTotal,
      branch_id: product.branchId,
      branchId: product.branchId,
      branch_name: product.branch_name || "for sales",
      source: product.source || "for sales",
      type: "Regular",
      inventory_account: product.inventory_account || business.finished_goods_code,
      revenue_account: product.revenue_account || business.sale_revenue_code,
      cogs_head: product.cogs_head || business.cost_of_sale,
    };
  }

  function baseSalePayload(txn_type, modeOfPayment) {
    const id = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
      id,
      receivable_code: business.receivable_code,
      receivable_accural_code: business.receivable_accural_code,
      cost_of_sale: business.cost_of_sale,
      sale_revenue_code: business.sale_revenue_code,
      finished_goods_code: business.finished_goods_code,
      items: [saleItem()],
      subtotal: lineTotal,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: lineTotal,
      amountPaid: 0,
      modeOfPayment,
      discount: 0,
      txn_type,
      reference: id,
      facilityId: FACILITY,
      created_by: userId,
      customer_id: customer.customerNo,
      apply_prepayment: false,
      transaction_date: new Date().toISOString().slice(0, 10),
      sale_branch_id: product.branchId,
      defer_payment: txn_type === "Cash Sale",
      taxes: [],
      accountHead: cashHead ? { head: cashHead } : undefined,
    };
  }

  async function getWorkflow(saleCode) {
    const r = await api(
      "GET",
      `/api/v1/sale-workflows/one?facilityId=${FACILITY}&saleCode=${encodeURIComponent(saleCode)}`,
      { token },
    );
    return r.json.results || null;
  }

  async function listFulfillments(saleCode) {
    const r = await api(
      "GET",
      `/api/v1/sale-workflows/fulfillments?facilityId=${FACILITY}&saleCode=${encodeURIComponent(saleCode)}`,
      { token },
    );
    return r.json.results || [];
  }

  // ── 3. CASH SALE FLOW ─────────────────────────────────────
  console.log("\n--- Cash sale: create → cashier → separation → warehouse → done ---\n");

  const cashCreate = await api("POST", "/api/v1/transactions/create-sale", {
    token,
    body: baseSalePayload("Cash Sale", "cash"),
  });
  const cashSaleCode =
    cashCreate.json?.sale_code ||
    cashCreate.json?.results?.sale_code ||
    cashCreate.json?.results?.invoice_ref ||
    cashCreate.json?.invoice_ref ||
    cashCreate.json?.reference;
  if (
    !assert(
      cashCreate.json.success && cashSaleCode,
      "Cash sale created",
      cashCreate.json.message || cashSaleCode || JSON.stringify(cashCreate.json).slice(0, 200),
    )
  ) {
    info(JSON.stringify(cashCreate.json).slice(0, 500));
  } else {
    info(`sale_code=${cashSaleCode}`);
    let wf = await getWorkflow(cashSaleCode);
    assert(
      wf && ["awaiting_cashier_confirm", "awaiting_payment"].includes(wf.status),
      "Cash workflow awaiting cashier",
      wf?.status,
    );

    const confirm = await api("POST", "/api/v1/sale-workflows/cashier-confirm", {
      token,
      body: {
        facilityId: FACILITY,
        saleCode: cashSaleCode,
        updated_by: userId,
        cashier_type: "cash",
        payment_splits: [
          { mode: "cash", amount: Number(wf.amount) || lineTotal, accountHead: { head: cashHead } },
        ],
      },
    });
    assert(confirm.json.success, "Cashier confirm payment", confirm.json.message);
    wf = await getWorkflow(cashSaleCode);
    assert(
      wf && ["invoice_separation", "payment_confirmed"].includes(wf.status),
      "After cashier → separation",
      wf?.status,
    );

    const sep = await api("POST", "/api/v1/sale-workflows/complete-separation", {
      token,
      body: {
        facilityId: FACILITY,
        saleCode: cashSaleCode,
        updated_by: userId,
        note: "E2E separation",
      },
    });
    assert(sep.json.success, "Complete separation", sep.json.message);
    wf = await getWorkflow(cashSaleCode);
    assert(wf?.status === "warehouse_picking", "After separation → warehouse", wf?.status);

    const packs = await listFulfillments(cashSaleCode);
    assert(packs.length > 0, "Warehouse packs exist", `${packs.length} pack(s)`);

    for (const pack of packs) {
      const col = await api("POST", "/api/v1/sale-workflows/fulfillment/collect", {
        token,
        body: {
          facilityId: FACILITY,
          id: pack.id,
          packCode: pack.pack_code,
          collectAll: true,
          updated_by: userId,
        },
      });
      assert(col.json.success, `Collect pack ${pack.pack_code}`, col.json.message);
    }

    wf = await getWorkflow(cashSaleCode);
    assert(
      ["completed", "dual_signature", "goods_released"].includes(wf?.status),
      "Cash sale completed",
      wf?.status,
    );
  }

  // ── 4. CREDIT SALE FLOW ───────────────────────────────────
  console.log("\n--- Credit sale: create → approve → separation → warehouse ---\n");

  const creditCreate = await api("POST", "/api/v1/transactions/create-sale", {
    token,
    body: baseSalePayload("Credit Sale", "CREDIT"),
  });
  const creditSaleCode =
    creditCreate.json?.sale_code ||
    creditCreate.json?.results?.sale_code ||
    creditCreate.json?.results?.invoice_ref ||
    creditCreate.json?.invoice_ref;
  if (
    !assert(
      creditCreate.json.success && creditSaleCode,
      "Credit sale created",
      creditCreate.json.message || creditSaleCode,
    )
  ) {
    info(JSON.stringify(creditCreate.json).slice(0, 500));
  } else {
    info(`sale_code=${creditSaleCode}`);
    let wf = await getWorkflow(creditSaleCode);
    assert(
      wf?.status === "awaiting_credit_approval",
      "Credit workflow awaiting approval",
      wf?.status,
    );

    const approve = await api("POST", "/api/v1/sale-workflows/advance", {
      token,
      body: {
        facilityId: FACILITY,
        saleCode: creditSaleCode,
        action: "advance",
        note: "E2E credit approved",
        updated_by: userId,
      },
    });
    assert(approve.json.success, "Approve credit", approve.json.message);
    wf = await getWorkflow(creditSaleCode);
    assert(
      ["invoice_separation", "credit_approved"].includes(wf?.status),
      "After credit approve → separation",
      wf?.status,
    );

    const sep = await api("POST", "/api/v1/sale-workflows/complete-separation", {
      token,
      body: {
        facilityId: FACILITY,
        saleCode: creditSaleCode,
        updated_by: userId,
      },
    });
    assert(sep.json.success, "Credit sale separation", sep.json.message);
    wf = await getWorkflow(creditSaleCode);
    assert(wf?.status === "warehouse_picking", "Credit → warehouse", wf?.status);

    const packs = await listFulfillments(creditSaleCode);
    for (const pack of packs) {
      await api("POST", "/api/v1/sale-workflows/fulfillment/collect", {
        token,
        body: {
          facilityId: FACILITY,
          id: pack.id,
          packCode: pack.pack_code,
          collectAll: true,
          updated_by: userId,
        },
      });
    }
    wf = await getWorkflow(creditSaleCode);
    assert(
      ["completed", "dual_signature", "goods_released"].includes(wf?.status),
      "Credit sale completed",
      wf?.status,
    );
  }

  // ── 5. SPECIAL INVOICE TREATMENT ──────────────────────────
  console.log("\n--- Special treatment: cash → warehouse ---\n");

  const treatCreate = await api("POST", "/api/v1/transactions/create-sale", {
    token,
    body: baseSalePayload("Cash Sale", "cash"),
  });
  const treatCode =
    treatCreate.json?.sale_code ||
    treatCreate.json?.results?.sale_code ||
    treatCreate.json?.results?.invoice_ref ||
    treatCreate.json?.invoice_ref;

  if (
    !assert(
      treatCreate.json.success && treatCode,
      "Sale for special treatment created",
      treatCode || treatCreate.json.message,
    )
  ) {
    info(JSON.stringify(treatCreate.json).slice(0, 400));
  } else {
    let wf = await getWorkflow(treatCode);
    assert(
      wf?.payment_type === "cash" || wf?.payment_type === "bank",
      "Starts as cash/transfer type",
      wf?.payment_type,
    );

    const treat = await api("POST", "/api/v1/sale-workflows/special-treatment", {
      token,
      body: {
        facilityId: FACILITY,
        saleCodes: [treatCode],
        paymentType: "warehouse",
        updated_by: userId,
        note: "E2E special treatment",
      },
    });
    assert(treat.json.success, "Special treatment → warehouse", treat.json.message);
    wf = await getWorkflow(treatCode);
    assert(wf?.payment_type === "warehouse", "payment_type is warehouse", wf?.payment_type);
    assert(
      wf?.status === "invoice_separation",
      "Warehouse treatment skips cashier → separation",
      wf?.status,
    );

    const packs = await listFulfillments(treatCode);
    assert(packs.length > 0, "Warehouse packs after special treatment", `${packs.length}`);

    // switch back to cash
    const back = await api("POST", "/api/v1/sale-workflows/special-treatment", {
      token,
      body: {
        facilityId: FACILITY,
        saleCodes: [treatCode],
        paymentType: "cash",
        updated_by: userId,
      },
    });
    assert(back.json.success, "Special treatment warehouse → cash", back.json.message);
    wf = await getWorkflow(treatCode);
    assert(wf?.payment_type === "cash", "Back to cash", wf?.payment_type);
    assert(
      wf?.status === "awaiting_cashier_confirm",
      "Back to cashier after reverse treatment",
      wf?.status,
    );
  }

  // ── 6. REPORTS ────────────────────────────────────────────
  console.log("\n--- Sales reports (by product / supplier) ---\n");

  const today = new Date().toISOString().slice(0, 10);
  const from = `${today.slice(0, 8)}01`;

  const byProduct = await api("POST", "/api/reports/sales/per-product", {
    token,
    body: { facilityId: FACILITY, fromDate: from, toDate: today },
  });
  assert(byProduct.json.success, "Sales report by product", `rows=${byProduct.json.data?.rows?.length ?? 0}`);

  const byProductCash = await api("POST", "/api/reports/sales/per-product", {
    token,
    body: {
      facilityId: FACILITY,
      fromDate: from,
      toDate: today,
      paymentType: "cash",
    },
  });
  assert(
    byProductCash.json.success,
    "Sales by product filtered by cash",
    `rows=${byProductCash.json.data?.rows?.length ?? 0}`,
  );

  const bySupplier = await api("POST", "/api/reports/sales/by-supplier", {
    token,
    body: { facilityId: FACILITY, fromDate: from, toDate: today },
  });
  assert(
    bySupplier.json.success,
    "Sales report by supplier",
    `rows=${bySupplier.json.data?.rows?.length ?? 0}`,
  );

  // ── 7. Dashboard financial overview ───────────────────────
  console.log("\n--- Dashboard ---\n");
  const dashFrom = `01-03-${today.slice(0, 4)}`;
  const dashTo = `${today.slice(8, 10)}-${today.slice(5, 7)}-${today.slice(0, 4)}`;
  const dash = await api(
    "GET",
    `/api/dashboard/financial-overview?facilityId=${FACILITY}&from=${dashFrom}&to=${dashTo}`,
    { token },
  );
  assert(
    dash.json.success || dash.json.results,
    "Dashboard financial overview",
    dash.json.message || (dash.json.results ? "ok" : `status ${dash.status}`),
  );

  // ── 8. Track-only sales process list ──────────────────────
  const list = await api(
    "GET",
    `/api/v1/sale-workflows?facilityId=${FACILITY}`,
    { token },
  );
  assert(list.json.success, "Sales process list", `count=${list.json.results?.length ?? 0}`);

  await conn.end();

  // ── Summary ───────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n=== SUMMARY ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed) {
    console.log("\nFailed checks:");
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
