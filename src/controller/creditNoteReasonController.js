/**
 * Credit / Debit note reason definitions and metadata.
 * Single source of truth for labels, inventory flags, and API consumers (Flowbooks UI).
 */

/**
 * Scenario key for UI behaviour (Flowbooks credit / debit note form).
 * RETURN | OVERCHARGE | PRICING_ERROR | DAMAGED | DISCOUNT
 */
const CREDIT_NOTE_REASONS = [
  {
    category: "RETURN",
    value:
      "Customer returns goods — items sold are returned, reducing the invoice value",
    label: "Customer returns goods",
    explanation: "Items sold are returned, so you reduce the invoice value.",
    inventoryRelated: true,
    lineKind: "product",
    inventoryExplanationPrompt:
      "Describe how inventory is affected (e.g. goods returned to stock, quantity, condition).",
  },
  {
    category: "OVERCHARGE",
    value: "Overcharged customer — invoice amount is higher than it should be",
    label: "Overcharged customer",
    explanation: "Invoice amount is higher than it should be.",
    inventoryRelated: false,
    lineKind: null,
  },
  {
    category: "PRICING_ERROR",
    value: "Pricing error — wrong price, wrong calculation, or missing discount",
    label: "Pricing error",
    explanation: "Wrong price, wrong calculation, or missing discount.",
    inventoryRelated: false,
    lineKind: null,
  },
  {
    category: "DAMAGED",
    value:
      "Damaged or defective goods — customer should not pay full amount",
    label: "Damaged or defective goods",
    explanation: "Customer should not pay full amount.",
    inventoryRelated: true,
    lineKind: "product",
    inventoryExplanationPrompt:
      "Explain the defect/damage and how stock or inventory should be adjusted.",
  },
  {
    category: "DISCOUNT",
    value: "Post-sale discount or rebate — discount after invoice was issued",
    label: "Post-sale discount or rebate",
    explanation: "Discount given after invoice was already issued.",
    inventoryRelated: false,
    lineKind: null,
  },
];

/** Purchase (supplier) debit note reasons */
const DEBIT_NOTE_REASONS = [
  {
    category: "RETURN",
    value: "Return goods to supplier — reducing amount owed to supplier",
    label: "Return goods to supplier",
    explanation: "You reduce what you owe the supplier.",
    inventoryRelated: true,
    lineKind: "product",
    inventoryExplanationPrompt:
      "Describe returned goods and how inventory or stock should be updated.",
  },
  {
    category: "OVERCHARGE",
    value: "Supplier overcharged — adjustment for excess billing",
    label: "Supplier overcharged",
    explanation: "You request adjustment for excess billing.",
    inventoryRelated: false,
    lineKind: null,
  },
  {
    category: "PRICING_ERROR",
    value:
      "Supplier pricing error — incorrect price or calculation on their invoice",
    label: "Supplier pricing error",
    explanation: "Incorrect price or calculation on their invoice.",
    inventoryRelated: false,
    lineKind: null,
  },
  {
    category: "DAMAGED",
    value:
      "Damaged or incomplete goods received — should not pay full invoice amount",
    label: "Damaged or incomplete goods received",
    explanation: "You should not pay full invoice amount.",
    inventoryRelated: true,
    lineKind: "product",
    inventoryExplanationPrompt:
      "Explain what was damaged/missing and the expected inventory impact.",
  },
  {
    category: "DISCOUNT",
    value: "Discount or rebate claimed — after purchase invoice was issued",
    label: "Discount or rebate claimed",
    explanation: "After purchase invoice was already issued.",
    inventoryRelated: false,
    lineKind: null,
  },
];

function listForDocType(docType) {
  const t = String(docType || "credit").toLowerCase();
  if (t === "credit") return CREDIT_NOTE_REASONS;
  if (t === "debit") return DEBIT_NOTE_REASONS;
  return null;
}

/**
 * GET /api/credit-notes/reason-metadata?docType=credit|debit|all
 */
exports.getReasonMetadata = (req, res) => {
  try {
    const docType = (req.query.docType || "credit").toLowerCase();

    if (docType === "all") {
      return res.json({
        success: true,
        data: {
          credit: { reasons: CREDIT_NOTE_REASONS },
          debit: { reasons: DEBIT_NOTE_REASONS },
        },
      });
    }

    const reasons = listForDocType(docType);
    if (!reasons) {
      return res.status(400).json({
        success: false,
        message: "docType must be credit, debit, or all",
      });
    }

    return res.json({
      success: true,
      data: {
        docType,
        reasons,
      },
    });
  } catch (e) {
    console.error("getReasonMetadata:", e);
    return res.status(500).json({
      success: false,
      message: "Failed to load reason metadata",
    });
  }
};

/**
 * @param {string} reasonValue - Full reason string from the client
 * @param {"customer"|"supplier"} entityType - customer = credit note reasons, supplier = debit note reasons
 */
exports.getReasonDefinition = (reasonValue, entityType) => {
  const list =
    entityType === "supplier" ? DEBIT_NOTE_REASONS : CREDIT_NOTE_REASONS;
  return list.find((r) => r.value === reasonValue) || null;
};

/**
 * Inventory-related reasons require Product lines and an inventory explanation on create.
 */
exports.reasonRequiresInventoryProductLines = (reasonValue, entityType) => {
  const def = exports.getReasonDefinition(reasonValue, entityType);
  return !!(def?.inventoryRelated && def?.lineKind === "product");
};

exports.getInventoryExplanationPrompt = (reasonValue, entityType) => {
  const def = exports.getReasonDefinition(reasonValue, entityType);
  return def?.inventoryExplanationPrompt || null;
};
