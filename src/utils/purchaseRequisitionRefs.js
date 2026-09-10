function normalizePoNo(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.toUpperCase() === "DIRECT") return "";
  return raw;
}

function collectPurchaseRequisitionRefs(body = {}) {
  const prNos = new Set();
  const orderIds = new Set();

  (Array.isArray(body.pr_nos) ? body.pr_nos : []).forEach((n) => {
    if (n) prNos.add(String(n).trim());
  });

  const headerPo = normalizePoNo(body.order_id || body.po_no);
  if (headerPo) orderIds.add(headerPo);

  (Array.isArray(body.data) ? body.data : []).forEach((item) => {
    if (item?.pr_no) prNos.add(String(item.pr_no).trim());
    const oid = normalizePoNo(item?.order_id);
    const po = normalizePoNo(item?.po_no);
    if (oid) orderIds.add(oid);
    else if (po) orderIds.add(po);
  });

  return {
    prNos: [...prNos].filter(Boolean),
    orderIds: [...orderIds],
  };
}

function poAlreadyOnBill(items, poNo) {
  const needle = normalizePoNo(poNo).toLowerCase();
  if (!needle) return false;
  return (items || []).some((item) => {
    const line = normalizePoNo(item?.order_id || item?.po_no).toLowerCase();
    return line === needle;
  });
}

module.exports = {
  normalizePoNo,
  collectPurchaseRequisitionRefs,
  poAlreadyOnBill,
};
