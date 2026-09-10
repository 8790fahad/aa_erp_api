const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectPurchaseRequisitionRefs,
  poAlreadyOnBill,
  normalizePoNo,
} = require("./purchaseRequisitionRefs");

test("header PO No. is collected even when line items omit it", () => {
  const refs = collectPurchaseRequisitionRefs({
    order_id: "qwerty",
    po_no: "qwerty",
    pr_nos: ["PR/26/150"],
    data: [{ sku: "P001", qty: 20 }],
  });
  assert.deepEqual(refs.prNos, ["PR/26/150"]);
  assert.deepEqual(refs.orderIds, ["qwerty"]);
});

test("line PO No. is collected from order_id or po_no", () => {
  const refs = collectPurchaseRequisitionRefs({
    data: [
      { pr_no: "PR/26/151", order_id: "qwerty-1" },
      { po_no: "PO/26/22" },
    ],
  });
  assert.deepEqual(refs.prNos, ["PR/26/151"]);
  assert.deepEqual(refs.orderIds.sort(), ["PO/26/22", "qwerty-1"]);
});

test("DIRECT is ignored", () => {
  const refs = collectPurchaseRequisitionRefs({
    order_id: "DIRECT",
    data: [{ po_no: "DIRECT" }],
  });
  assert.deepEqual(refs.orderIds, []);
});

test("same PO cannot be added twice on one bill", () => {
  const items = [{ sku: "P001", order_id: "qwerty" }];
  assert.equal(poAlreadyOnBill(items, "qwerty"), true);
  assert.equal(poAlreadyOnBill(items, "QWERTY"), true);
  assert.equal(poAlreadyOnBill(items, "other"), false);
  assert.equal(poAlreadyOnBill(items, "DIRECT"), false);
});

test("normalizePoNo strips blank and DIRECT", () => {
  assert.equal(normalizePoNo("  qwerty  "), "qwerty");
  assert.equal(normalizePoNo("DIRECT"), "");
  assert.equal(normalizePoNo(""), "");
});
