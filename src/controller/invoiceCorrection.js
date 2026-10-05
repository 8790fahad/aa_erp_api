"use strict";

const { Op } = require("sequelize");
const db = require("../models");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");

function normalizeDateOnly(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

exports.listInvoicesForCorrection = async (req, res) => {
  try {
    const { facilityId, q = "", limit = 30 } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const trimmed = String(q || "").trim();
    const where = { facility_id: facilityId };
    if (trimmed) {
      where[Op.or] = [
        { invoice_ref: { [Op.like]: `%${trimmed}%` } },
        { ref_number: { [Op.like]: `%${trimmed}%` } },
      ];
    }

    const invoices = await db.Invoice.findAll({
      where,
      attributes: [
        "invoice_id",
        "invoice_ref",
        "ref_number",
        "transaction_date",
        "due_date",
        "amount",
        "description",
        "type",
        "created_at",
      ],
      order: [["transaction_date", "DESC"], ["invoice_id", "DESC"]],
      limit: Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100),
      raw: true,
    });

    const refs = invoices
      .map((i) => String(i.invoice_ref || "").trim())
      .filter(Boolean);
    const supplierRefs = [
      ...new Set(
        invoices
          .filter((i) => String(i.type || "").toLowerCase() === "purchase")
          .map((i) => String(i.ref_number || "").trim())
          .filter(Boolean)
      ),
    ];
    const customerRefs = [
      ...new Set(
        invoices
          .filter((i) => String(i.type || "").toLowerCase() === "sales")
          .map((i) => String(i.ref_number || "").trim())
          .filter(Boolean)
      ),
    ];

    let glMap = new Map();
    if (refs.length > 0) {
      const glRows = await db.GeneralLedger.findAll({
        where: {
          facility_id: facilityId,
          reference_number: { [Op.in]: refs },
        },
        attributes: [
          "reference_number",
          [db.sequelize.fn("COUNT", db.sequelize.col("transaction_id")), "entry_count"],
        ],
        group: ["reference_number"],
        raw: true,
      });
      glMap = new Map(
        glRows.map((r) => [String(r.reference_number || ""), parseInt(r.entry_count, 10) || 0])
      );
    }

    const [suppliers, customers] = await Promise.all([
      supplierRefs.length
        ? db.SuppliersInfo.findAll({
            where: {
              facilityId,
              supplier_number: { [Op.in]: supplierRefs },
            },
            attributes: ["supplier_number", "supplier_name"],
            raw: true,
          })
        : Promise.resolve([]),
      customerRefs.length
        ? db.Customer.findAll({
            where: {
              facilityId,
              customerNo: { [Op.in]: customerRefs },
            },
            attributes: ["customerNo", "fullname"],
            raw: true,
          })
        : Promise.resolve([]),
    ]);

    const supplierNameByNo = new Map(
      suppliers.map((s) => [String(s.supplier_number || "").trim(), s.supplier_name || ""])
    );
    const customerNameByNo = new Map(
      customers.map((c) => [String(c.customerNo || "").trim(), c.fullname || ""])
    );

    return res.status(200).json({
      success: true,
      results: invoices.map((inv) => ({
        ...inv,
        ledger_entries: glMap.get(String(inv.invoice_ref || "")) || 0,
        person_name:
          String(inv.type || "").toLowerCase() === "purchase"
            ? supplierNameByNo.get(String(inv.ref_number || "").trim()) || ""
            : String(inv.type || "").toLowerCase() === "sales"
            ? customerNameByNo.get(String(inv.ref_number || "").trim()) || ""
            : "",
      })),
    });
  } catch (error) {
    console.error("listInvoicesForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list invoices for correction",
      error: error.message,
    });
  }
};

exports.updateInvoiceDateWithLedger = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, invoiceRef, newTransactionDate } = req.body || {};
    if (!facilityId || !invoiceRef || !newTransactionDate) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId, invoiceRef and newTransactionDate are required",
      });
    }

    const normalizedDate = normalizeDateOnly(newTransactionDate);
    if (!normalizedDate) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid newTransactionDate",
      });
    }

    const invoice = await db.Invoice.findOne({
      where: { facility_id: facilityId, invoice_ref: String(invoiceRef).trim() },
      transaction,
    });

    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    await invoice.update(
      { transaction_date: normalizedDate },
      { transaction }
    );

    const [updatedLedgerCount] = await db.GeneralLedger.update(
      {
        transaction_date: normalizedDate,
        updated_by: req.user?.id || req.body?.updatedBy || null,
      },
      {
        where: {
          facility_id: facilityId,
          reference_number: String(invoiceRef).trim(),
        },
        transaction,
      }
    );

    let updatedStoreEntries = 0;
    let updatedSupplierEntries = 0;
    let updatedCustomerEntries = 0;
    const invoiceType = String(invoice.type || "").toLowerCase();

    if (invoiceType === "sales") {
      const [storeCount] = await db.StoreEntry.update(
        { receive_date: normalizedDate },
        {
          where: {
            facilityId,
            reference_number: String(invoiceRef).trim(),
          },
          transaction,
        }
      );
      updatedStoreEntries = storeCount || 0;

      const [customerCount] = await db.CustomerEntry.update(
        { transaction_date: normalizedDate },
        {
          where: {
            facilityId,
            [Op.or]: [
              { receiptNo: String(invoiceRef).trim() },
              { link_id: String(invoiceRef).trim() },
            ],
          },
          transaction,
        }
      );
      updatedCustomerEntries = customerCount || 0;
    } else if (invoiceType === "purchase") {
      const [storeCount] = await db.StoreEntry.update(
        { receive_date: normalizedDate },
        {
          where: {
            facilityId,
            reference_number: String(invoiceRef).trim(),
          },
          transaction,
        }
      );
      updatedStoreEntries = storeCount || 0;

      const [supplierCount] = await db.SupplierEntry.update(
        { transaction_date: normalizedDate },
        {
          where: {
            facilityId,
            [Op.or]: [
              { receiptNo: String(invoiceRef).trim() },
              { link_id: String(invoiceRef).trim() },
            ],
          },
          transaction,
        }
      );
      updatedSupplierEntries = supplierCount || 0;
    }

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message: "Invoice date corrected successfully",
      result: {
        invoice_ref: invoice.invoice_ref,
        type: invoice.type,
        transaction_date: normalizedDate,
        updated_ledger_entries: updatedLedgerCount || 0,
        updated_store_entries: updatedStoreEntries,
        updated_supplier_entries: updatedSupplierEntries,
        updated_customer_entries: updatedCustomerEntries,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("updateInvoiceDateWithLedger error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update invoice date",
      error: error.message,
    });
  }
};

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function round4(n) {
  return Number((Number(n) || 0).toFixed(4));
}

function scaleMoney(value, factor) {
  return round2((Number(value) || 0) * factor);
}

function replaceQtyInDescription(description, productName, newQty) {
  const name = String(productName || "").trim();
  const text = String(description || "");
  if (!name || !text) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\(Qty:\\s*[\\d.]+\\)`, "i");
  if (re.test(text)) {
    return text.replace(re, `${name} (Qty: ${newQty})`);
  }
  return text;
}

function removeItemFromDescription(description, productName) {
  const name = String(productName || "").trim();
  const text = String(description || "");
  if (!name || !text) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`,\\s*${escaped}\\s*\\(Qty:\\s*[\\d.]+\\)`, "i"), "")
    .replace(new RegExp(`${escaped}\\s*\\(Qty:\\s*[\\d.]+\\)\\s*,?\\s*`, "i"), "")
    .replace(/,\s*$/, "")
    .trim();
}

function appendItemToDescription(description, productName, qty) {
  const piece = `${productName} (Qty: ${qty})`;
  const text = String(description || "").trim();
  if (!text) return piece;
  if (new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
    return replaceQtyInDescription(text, productName, qty);
  }
  return `${text}, ${piece}`;
}

async function syncInvoiceDocumentTotals({
  facilityId,
  invoice,
  invoiceRef,
  isPurchase,
  isSales,
  description,
  oldDocTotal,
  updatedBy,
  transaction,
}) {
  const refreshedStore = await db.StoreEntry.findAll({
    where: { facilityId, reference_number: invoiceRef },
    transaction,
  });
  const newDocTotal = refreshedStore.reduce((sum, row) => {
    const qty = isPurchase
      ? Number(row.qty_in || 0)
      : Number(row.qty_out || 0);
    const unit = isPurchase
      ? Number(row.cost_price || 0)
      : Number(row.selling_price || row.cost_price || 0);
    return sum + qty * unit;
  }, 0);

  const oldAmount = Number(invoice.amount || oldDocTotal || 0);
  const nextAmount = round2(newDocTotal);
  const docFactor =
    oldDocTotal > 0.0001
      ? newDocTotal / oldDocTotal
      : oldAmount > 0
        ? nextAmount / oldAmount
        : 1;

  const productSkuSet = new Set(
    refreshedStore
      .map((row) => String(row.product_id || "").trim())
      .filter(Boolean),
  );
  const ledgerRows = await db.GeneralLedger.findAll({
    where: {
      facility_id: facilityId,
      reference_number: invoiceRef,
    },
    transaction,
  });

  const productRevenue = ledgerRows.reduce((sum, row) => {
    const ref = String(row.transaction_ref || "").trim();
    if (productSkuSet.has(ref) && String(row.type || "").toLowerCase() === "revenue") {
      return sum + Number(row.cr || 0) - Number(row.dr || 0);
    }
    return sum;
  }, 0);

  for (const gl of ledgerRows) {
    const ref = String(gl.transaction_ref || "").trim();
    const glType = String(gl.type || "").toLowerCase();
    if (productSkuSet.has(ref)) continue;

    if (glType === "tax") {
      const vat = isSales
        ? round2(Math.max(nextAmount - productRevenue, 0))
        : scaleMoney(Number(gl.dr || 0) || Number(gl.cr || 0), docFactor);
      if (Number(gl.cr || 0) > 0) {
        await gl.update(
          { cr: isSales ? vat : scaleMoney(gl.cr, docFactor), dr: 0, updated_by: updatedBy },
          { transaction },
        );
      } else if (Number(gl.dr || 0) > 0) {
        await gl.update(
          { dr: isSales ? vat : scaleMoney(gl.dr, docFactor), cr: 0, updated_by: updatedBy },
          { transaction },
        );
      }
      continue;
    }

    if (
      ["receivable", "payable", "bank", "payment", "deposit", "accrued"].includes(
        glType,
      )
    ) {
      await gl.update(
        {
          dr: scaleMoney(gl.dr, docFactor),
          cr: scaleMoney(gl.cr, docFactor),
          updated_by: updatedBy,
        },
        { transaction },
      );
    }
  }

  if (isSales && db.CustomerEntry) {
    const headerEntries = await db.CustomerEntry.findAll({
      where: {
        facilityId,
        [Op.or]: [{ receiptNo: invoiceRef }, { link_id: invoiceRef }],
        type: { [Op.in]: ["tax", "deposit", "payment"] },
      },
      transaction,
    });
    for (const entry of headerEntries) {
      const entryType = String(entry.type || "").toLowerCase();
      if (entryType === "tax") {
        await entry.update(
          { cost: round2(Math.max(nextAmount - productRevenue, 0)) },
          { transaction },
        );
      } else {
        await entry.update({ cost: nextAmount }, { transaction });
      }
    }
  }

  if (isPurchase && db.SupplierEntry) {
    const headerEntries = await db.SupplierEntry.findAll({
      where: {
        facilityId,
        [Op.or]: [{ receiptNo: invoiceRef }, { link_id: invoiceRef }],
        type: { [Op.in]: ["tax", "payment"] },
      },
      transaction,
    });
    for (const entry of headerEntries) {
      await entry.update(
        { cost: scaleMoney(entry.cost, docFactor) },
        { transaction },
      );
    }
  }

  await invoice.update(
    {
      amount: nextAmount,
      description,
    },
    { transaction },
  );

  return { nextAmount, description, refreshedStore };
}

async function syncInventoryValuationForSkus(facilityId, skus, transaction) {
  if (!db.InventoryValuation || !skus?.size) return;
  for (const sku of skus) {
    const valuation = await db.InventoryValuation.findOne({
      where: { product_id: sku, facility_id: facilityId },
      transaction,
    });
    if (!valuation) continue;
    const balRows = await db.sequelize.query(
      `SELECT SUM(COALESCE(qty_in, 0)) - SUM(COALESCE(qty_out, 0)) AS qty
       FROM store_entries
       WHERE facilityId = :facilityId AND product_id = :sku`,
      {
        replacements: { facilityId, sku },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    const nextQty = round2(balRows?.[0]?.qty || 0);
    const prevQty = Number(valuation.quantity_on_hand || 0);
    const avg = Number(valuation.avg_unit_cost || 0);
    const prevValue = Number(valuation.total_value || 0);
    let nextValue = prevValue;
    if (avg > 0) nextValue = round2(nextQty * avg);
    else if (prevQty > 0) nextValue = round2((prevValue * nextQty) / prevQty);
    await valuation.update(
      { quantity_on_hand: nextQty, total_value: nextValue },
      { transaction },
    );
  }
}

async function loadInvoiceStoreLines(facilityId, invoiceRef, invoiceType, transaction) {
  const isPurchase = String(invoiceType || "").toLowerCase() === "purchase";
  const storeRows = await db.StoreEntry.findAll({
    where: {
      facilityId,
      reference_number: invoiceRef,
      ...(isPurchase
        ? { qty_in: { [Op.gt]: 0 } }
        : { qty_out: { [Op.gt]: 0 } }),
    },
    order: [["id", "ASC"]],
    transaction,
    raw: true,
  });

  const skus = [...new Set(storeRows.map((r) => String(r.product_id || "").trim()).filter(Boolean))];
  const products = skus.length
    ? await db.Product.findAll({
        where: { facility_id: facilityId, sku: { [Op.in]: skus } },
        attributes: ["sku", "name"],
        transaction,
        raw: true,
      })
    : [];
  const nameBySku = new Map(
    products.map((p) => [String(p.sku || "").trim(), p.name || ""]),
  );

  return storeRows.map((row) => {
    const sku = String(row.product_id || "").trim();
    const qty = isPurchase
      ? Number(row.qty_in || 0)
      : Number(row.qty_out || 0);
    const unitCost = Number(row.cost_price || 0);
    const unitSell = Number(row.selling_price || 0);
    const unitPrice = isPurchase ? unitCost : unitSell || unitCost;
    return {
      store_entry_id: row.id,
      product_id: sku,
      item_name: nameBySku.get(sku) || sku,
      qty,
      cost_price: unitCost,
      selling_price: unitSell,
      unit_price: unitPrice,
      line_total: round2(qty * unitPrice),
      branchId: row.branchId,
      type: row.type,
    };
  });
}

exports.getInvoiceLinesForCorrection = async (req, res) => {
  try {
    const { facilityId, invoiceRef } = req.query;
    if (!facilityId || !invoiceRef) {
      return res.status(400).json({
        success: false,
        message: "facilityId and invoiceRef are required",
      });
    }

    const normalizedRef = String(invoiceRef).trim();
    const invoice = await db.Invoice.findOne({
      where: { facility_id: facilityId, invoice_ref: normalizedRef },
      raw: true,
    });
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const lines = await loadInvoiceStoreLines(
      facilityId,
      normalizedRef,
      invoice.type,
    );

    return res.status(200).json({
      success: true,
      invoice: {
        invoice_id: invoice.invoice_id,
        invoice_ref: invoice.invoice_ref,
        type: invoice.type,
        amount: invoice.amount,
        transaction_date: invoice.transaction_date,
        description: invoice.description,
        ref_number: invoice.ref_number,
      },
      results: lines,
    });
  } catch (error) {
    console.error("getInvoiceLinesForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load invoice lines",
      error: error.message,
    });
  }
};

exports.updateInvoiceQtyWithLedger = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, invoiceRef, lines = [] } = req.body || {};
    if (!facilityId || !invoiceRef) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and invoiceRef are required",
      });
    }
    if (!Array.isArray(lines) || !lines.length) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "lines with storeEntryId are required",
      });
    }

    const normalizedRef = String(invoiceRef).trim();
    const invoice = await db.Invoice.findOne({
      where: { facility_id: facilityId, invoice_ref: normalizedRef },
      transaction,
    });
    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const invoiceType = String(invoice.type || "").toLowerCase();
    const isPurchase = invoiceType === "purchase";
    const isSales = invoiceType === "sales";
    if (!isPurchase && !isSales) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Line correction supports sales and purchase invoices only",
      });
    }

    const storeRows = await db.StoreEntry.findAll({
      where: {
        facilityId,
        reference_number: normalizedRef,
      },
      transaction,
    });
    const storeById = new Map(storeRows.map((row) => [Number(row.id), row]));

    const oldDocTotal = storeRows.reduce((sum, row) => {
      const qty = isPurchase
        ? Number(row.qty_in || 0)
        : Number(row.qty_out || 0);
      const unit = isPurchase
        ? Number(row.cost_price || 0)
        : Number(row.selling_price || row.cost_price || 0);
      return sum + qty * unit;
    }, 0);

    let updatedLines = 0;
    const changedSkus = new Set();
    let description = String(invoice.description || "");

    for (const line of lines) {
      const storeEntryId = Number(line.storeEntryId ?? line.store_entry_id);
      if (!Number.isFinite(storeEntryId) || storeEntryId <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Each line needs a valid storeEntryId",
        });
      }

      const store = storeById.get(storeEntryId);
      if (!store) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: `Store line ${storeEntryId} not found on this invoice`,
        });
      }

      const oldQty = isPurchase
        ? Number(store.qty_in || 0)
        : Number(store.qty_out || 0);
      if (!(oldQty > 0)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Store line ${storeEntryId} has no quantity to correct`,
        });
      }

      const hasQty = line.qty != null && String(line.qty).trim() !== "";
      const hasCost =
        line.cost != null ||
        line.cost_price != null ||
        line.costPrice != null;
      const newQty = hasQty ? Number(line.qty) : oldQty;
      const oldCost = Number(store.cost_price || 0);
      const newCost = hasCost
        ? Number(line.cost ?? line.cost_price ?? line.costPrice)
        : oldCost;

      if (!Number.isFinite(newQty) || newQty <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Quantity must be greater than zero",
        });
      }
      if (!Number.isFinite(newCost) || newCost < 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Cost must be zero or greater",
        });
      }

      const qtyChanged = Math.abs(oldQty - newQty) >= 0.00005;
      const costChanged = Math.abs(oldCost - newCost) >= 0.00005;
      if (!qtyChanged && !costChanged) continue;

      const qtyFactor = newQty / oldQty;
      const sku = String(store.product_id || "").trim();
      changedSkus.add(sku);
      const sellingPrice = Number(store.selling_price || 0);
      const nextMarkUp =
        newCost > 0 && sellingPrice > 0
          ? Number((sellingPrice / newCost).toFixed(4))
          : Number(store.mark_up || 0);

      const storePatch = {
        cost_price: round2(newCost),
        mark_up: nextMarkUp,
      };
      if (isPurchase) storePatch.qty_in = round4(newQty);
      else storePatch.qty_out = round4(newQty);
      await store.update(storePatch, { transaction });

      const costTotal = round2(newQty * newCost);
      const productGl = await db.GeneralLedger.findAll({
        where: {
          facility_id: facilityId,
          reference_number: normalizedRef,
          transaction_ref: sku,
        },
        transaction,
      });
      for (const gl of productGl) {
        const glType = String(gl.type || "").toLowerCase();
        const desc = String(gl.transaction_description || "").toLowerCase();
        const isCogs =
          glType === "expenses" ||
          desc.startsWith("cogs [") ||
          desc.includes("cost of");
        const isInventory = glType === "inventory";
        const isRevenue = glType === "revenue";

        if (isCogs || isInventory) {
          // Sales: Dr COGS / Cr Inventory. Purchase: Dr Inventory (/ Cr payable on product).
          const preferDebit =
            Number(gl.dr || 0) >= Number(gl.cr || 0) ||
            (isPurchase && isInventory) ||
            isCogs;
          await gl.update(
            {
              dr: preferDebit ? costTotal : 0,
              cr: preferDebit ? 0 : costTotal,
              updated_by: req.user?.id || req.body?.updatedBy || null,
            },
            { transaction },
          );
          continue;
        }

        if (isRevenue || qtyChanged) {
          await gl.update(
            {
              dr: scaleMoney(gl.dr, qtyFactor),
              cr: scaleMoney(gl.cr, qtyFactor),
              updated_by: req.user?.id || req.body?.updatedBy || null,
            },
            { transaction },
          );
        }
      }

      if (isSales && db.CustomerEntry) {
        const itemLines = await db.CustomerEntry.findAll({
          where: {
            facilityId,
            receiptNo: normalizedRef,
            link_id: sku,
            type: { [Op.in]: ["sales", "service", "pro-bono"] },
          },
          transaction,
        });
        for (const entry of itemLines) {
          await entry.update(
            { qty_out: round4(newQty) },
            { transaction },
          );
        }
      }

      if (isPurchase && db.SupplierEntry) {
        const supplierLines = await db.SupplierEntry.findAll({
          where: {
            facilityId,
            receiptNo: normalizedRef,
            link_id: sku,
            type: { [Op.in]: ["purchase", "service"] },
          },
          transaction,
        });
        for (const entry of supplierLines) {
          const patch = { qty_in: round4(newQty) };
          // Supplier item lines store unit cost in `cost`.
          if (costChanged) patch.cost = round2(newCost);
          await entry.update(patch, { transaction });
        }
      }

      if (isSales && db.SaleFulfillmentLine && db.SaleFulfillment) {
        const packs = await db.SaleFulfillment.findAll({
          where: { facility_id: facilityId, sale_code: normalizedRef },
          attributes: ["id"],
          transaction,
          raw: true,
        });
        const packIds = packs.map((p) => p.id);
        if (packIds.length) {
          const fulfillmentLines = await db.SaleFulfillmentLine.findAll({
            where: {
              fulfillment_id: { [Op.in]: packIds },
              [Op.or]: [
                { store_entry_id: storeEntryId },
                { product_id: sku },
              ],
            },
            transaction,
          });
          for (const fl of fulfillmentLines) {
            const collected = Number(fl.qty_collected || 0);
            await fl.update(
              {
                qty: round4(newQty),
                qty_collected: Math.min(collected, newQty),
              },
              { transaction },
            );
          }
        }
      }

      if (qtyChanged) {
        const product = await db.Product.findOne({
          where: { facility_id: facilityId, sku },
          attributes: ["name"],
          transaction,
          raw: true,
        });
        description = replaceQtyInDescription(
          description,
          product?.name || sku,
          newQty,
        );
      }
      updatedLines += 1;
    }

    const updatedBy = req.user?.id || req.body?.updatedBy || null;
    const { nextAmount, description: nextDescription } =
      await syncInvoiceDocumentTotals({
        facilityId,
        invoice,
        invoiceRef: normalizedRef,
        isPurchase,
        isSales,
        description,
        oldDocTotal,
        updatedBy,
        transaction,
      });
    await syncInventoryValuationForSkus(facilityId, changedSkus, transaction);

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message: "Invoice lines corrected successfully",
      result: {
        invoice_ref: normalizedRef,
        type: invoice.type,
        updated_lines: updatedLines,
        amount: nextAmount,
        description: nextDescription,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("updateInvoiceQtyWithLedger error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update invoice lines",
      error: error.message,
    });
  }
};

exports.searchProductsForCorrection = async (req, res) => {
  try {
    const { facilityId, q = "", limit = 20 } = req.query;
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    const trimmed = String(q || "").trim();
    const where = {
      facility_id: facilityId,
    };
    if (trimmed) {
      where[Op.or] = [
        { sku: { [Op.like]: `%${trimmed}%` } },
        { name: { [Op.like]: `%${trimmed}%` } },
      ];
    }
    const products = await db.Product.findAll({
      where,
      attributes: [
        "sku",
        "name",
        "cost_price",
        "selling_price",
        "inventory_account",
        "cogs_head",
        "revenue_account",
        "item_type",
      ],
      order: [["name", "ASC"]],
      limit: Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50),
      raw: true,
    });
    return res.status(200).json({ success: true, results: products });
  } catch (error) {
    console.error("searchProductsForCorrection error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search products",
      error: error.message,
    });
  }
};

exports.deleteInvoiceLineWithLedger = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, invoiceRef, storeEntryId } = req.body || {};
    if (!facilityId || !invoiceRef || !storeEntryId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId, invoiceRef and storeEntryId are required",
      });
    }

    const normalizedRef = String(invoiceRef).trim();
    const invoice = await db.Invoice.findOne({
      where: { facility_id: facilityId, invoice_ref: normalizedRef },
      transaction,
    });
    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const invoiceType = String(invoice.type || "").toLowerCase();
    const isPurchase = invoiceType === "purchase";
    const isSales = invoiceType === "sales";
    if (!isPurchase && !isSales) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Line delete supports sales and purchase invoices only",
      });
    }

    const storeRows = await db.StoreEntry.findAll({
      where: { facilityId, reference_number: normalizedRef },
      transaction,
    });
    if (storeRows.length <= 1) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Cannot delete the last line. Delete the invoice instead.",
      });
    }

    const store = storeRows.find((row) => Number(row.id) === Number(storeEntryId));
    if (!store) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Store line not found on this invoice",
      });
    }

    const oldDocTotal = storeRows.reduce((sum, row) => {
      const qty = isPurchase ? Number(row.qty_in || 0) : Number(row.qty_out || 0);
      const unit = isPurchase
        ? Number(row.cost_price || 0)
        : Number(row.selling_price || row.cost_price || 0);
      return sum + qty * unit;
    }, 0);

    const sku = String(store.product_id || "").trim();
    const product = await db.Product.findOne({
      where: { facility_id: facilityId, sku },
      attributes: ["name"],
      transaction,
      raw: true,
    });

    await db.GeneralLedger.destroy({
      where: {
        facility_id: facilityId,
        reference_number: normalizedRef,
        transaction_ref: sku,
      },
      transaction,
    });

    if (isSales && db.CustomerEntry) {
      await db.CustomerEntry.destroy({
        where: {
          facilityId,
          receiptNo: normalizedRef,
          link_id: sku,
          type: { [Op.in]: ["sales", "service", "pro-bono"] },
        },
        transaction,
      });
    }
    if (isPurchase && db.SupplierEntry) {
      await db.SupplierEntry.destroy({
        where: {
          facilityId,
          receiptNo: normalizedRef,
          link_id: sku,
          type: { [Op.in]: ["purchase", "service"] },
        },
        transaction,
      });
    }
    if (isSales && db.SaleFulfillmentLine && db.SaleFulfillment) {
      const packs = await db.SaleFulfillment.findAll({
        where: { facility_id: facilityId, sale_code: normalizedRef },
        attributes: ["id"],
        transaction,
        raw: true,
      });
      const packIds = packs.map((p) => p.id);
      if (packIds.length) {
        await db.SaleFulfillmentLine.destroy({
          where: {
            fulfillment_id: { [Op.in]: packIds },
            [Op.or]: [{ store_entry_id: store.id }, { product_id: sku }],
          },
          transaction,
        });
      }
    }

    await store.destroy({ transaction });

    const description = removeItemFromDescription(
      invoice.description,
      product?.name || sku,
    );
    const updatedBy = req.user?.id || req.body?.updatedBy || null;
    const { nextAmount, description: nextDescription } =
      await syncInvoiceDocumentTotals({
        facilityId,
        invoice,
        invoiceRef: normalizedRef,
        isPurchase,
        isSales,
        description,
        oldDocTotal,
        updatedBy,
        transaction,
      });
    await syncInventoryValuationForSkus(facilityId, new Set([sku]), transaction);

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message: "Invoice line deleted successfully",
      result: {
        invoice_ref: normalizedRef,
        amount: nextAmount,
        description: nextDescription,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("deleteInvoiceLineWithLedger error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete invoice line",
      error: error.message,
    });
  }
};

exports.addInvoiceLineWithLedger = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const {
      facilityId,
      invoiceRef,
      productId,
      qty,
      cost,
      sellingPrice,
    } = req.body || {};
    if (!facilityId || !invoiceRef || !productId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId, invoiceRef and productId are required",
      });
    }

    const newQty = Number(qty);
    if (!Number.isFinite(newQty) || newQty <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Quantity must be greater than zero",
      });
    }

    const normalizedRef = String(invoiceRef).trim();
    const invoice = await db.Invoice.findOne({
      where: { facility_id: facilityId, invoice_ref: normalizedRef },
      transaction,
    });
    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const invoiceType = String(invoice.type || "").toLowerCase();
    const isPurchase = invoiceType === "purchase";
    const isSales = invoiceType === "sales";
    if (!isPurchase && !isSales) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Line add supports sales and purchase invoices only",
      });
    }

    const sku = String(productId).trim();
    const product = await db.Product.findOne({
      where: { facility_id: facilityId, sku },
      attributes: [
        "sku",
        "name",
        "cost_price",
        "selling_price",
        "inventory_account",
        "cogs_head",
        "revenue_account",
        "category",
        "item_type",
      ],
      transaction,
      raw: true,
    });
    if (!product) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `Product not found: ${sku}`,
      });
    }

    const existingStore = await db.StoreEntry.findAll({
      where: { facilityId, reference_number: normalizedRef },
      transaction,
    });
    if (
      existingStore.some(
        (row) => String(row.product_id || "").trim().toUpperCase() === sku.toUpperCase(),
      )
    ) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "This product is already on the invoice. Edit the existing line.",
      });
    }

    const oldDocTotal = existingStore.reduce((sum, row) => {
      const q = isPurchase ? Number(row.qty_in || 0) : Number(row.qty_out || 0);
      const unit = isPurchase
        ? Number(row.cost_price || 0)
        : Number(row.selling_price || row.cost_price || 0);
      return sum + q * unit;
    }, 0);

    const unitCost =
      cost != null && String(cost).trim() !== ""
        ? Number(cost)
        : Number(product.cost_price || 0);
    const unitSell =
      sellingPrice != null && String(sellingPrice).trim() !== ""
        ? Number(sellingPrice)
        : Number(product.selling_price || 0);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Cost must be zero or greater",
      });
    }
    if (isSales && (!(Number.isFinite(unitSell) && unitSell > 0))) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Selling price must be greater than zero for sales lines",
      });
    }

    const template = existingStore[0] || null;
    const sampleGl = await db.GeneralLedger.findOne({
      where: { facility_id: facilityId, reference_number: normalizedRef },
      order: [["transaction_id", "ASC"]],
      transaction,
      raw: true,
    });
    const hasVat = !!(await db.GeneralLedger.findOne({
      where: {
        facility_id: facilityId,
        reference_number: normalizedRef,
        type: "tax",
      },
      transaction,
      attributes: ["transaction_id"],
      raw: true,
    }));

    const receiveDate =
      template?.receive_date ||
      (invoice.transaction_date
        ? String(invoice.transaction_date).slice(0, 10)
        : normalizeDateOnly(new Date()));
    const branchId = Number(template?.branchId || invoice.branchId || 0) || 0;
    const costTotal = round2(newQty * unitCost);
    const shelfTotal = round2(newQty * (isPurchase ? unitCost : unitSell));
    const revenueTotal = isSales
      ? round2(hasVat ? shelfTotal / 1.075 : shelfTotal)
      : 0;
    const markUp =
      unitCost > 0 && unitSell > 0
        ? Number((unitSell / unitCost).toFixed(4))
        : 1;

    const createdStore = await db.StoreEntry.create(
      {
        receive_date: receiveDate,
        reference_number: normalizedRef,
        qty_in: isPurchase ? round4(newQty) : 0,
        qty_out: isSales ? round4(newQty) : 0,
        expiry_date: template?.expiry_date || null,
        cost_price: round2(unitCost),
        selling_price: round2(isPurchase ? unitSell || unitCost : unitSell),
        branch_name: template?.branch_name || "for sales",
        branchId,
        inserted_by: req.user?.id || template?.inserted_by || null,
        facilityId,
        type: isPurchase ? STORE_ENTRY_TYPE.PURCHASE : STORE_ENTRY_TYPE.SALES,
        source: isPurchase
          ? template?.source || "purchase"
          : template?.source || "for sales",
        destination: isPurchase
          ? template?.destination || "for sales"
          : template?.destination || "sold",
        status: template?.status || "approved",
        product_id: sku,
        markup_mode: template?.markup_mode || "percentage",
        mark_up: markUp,
        multple: template?.multple || "1",
        location: template?.location || "Warehouse",
        departmentId: template?.departmentId || null,
      },
      { transaction },
    );

    const payee = sampleGl?.payee || "";
    const mode = sampleGl?.mode_of_payment || "";
    const purpose = sampleGl?.purpose_of_payment || (isSales ? "Cash Sale" : "Purchase");
    const txDate =
      sampleGl?.transaction_date ||
      invoice.transaction_date ||
      receiveDate;
    const createdBy = req.user?.id || sampleGl?.created_by || null;
    const invAccount = String(product.inventory_account || "").trim();
    const cogsAccount = String(product.cogs_head || "").trim();
    const revenueAccount = String(product.revenue_account || "").trim();

    const glBase = {
      transaction_date: txDate,
      reference_number: normalizedRef,
      purpose_of_payment: purpose,
      payee,
      mode_of_payment: mode,
      created_by: createdBy,
      facility_id: facilityId,
      status: "posted",
      transaction_ref: sku,
      branch_id: branchId || null,
      account_subhead: "",
    };

    if (isSales) {
      if (!cogsAccount || !invAccount || !revenueAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message:
            "Product is missing inventory, COGS, or revenue account for sales posting",
        });
      }
      await db.GeneralLedger.bulkCreate(
        [
          {
            ...glBase,
            account_code: cogsAccount,
            account_subhead: cogsAccount,
            dr: costTotal,
            cr: 0,
            account_description: product.name,
            transaction_description: `COGS [${sku}] – ${product.name}`,
            type: "expenses",
          },
          {
            ...glBase,
            account_code: invAccount,
            account_subhead: invAccount,
            dr: 0,
            cr: costTotal,
            account_description: product.name,
            transaction_description: `Inventory reduction [${sku}] – ${product.name}`,
            type: "inventory",
          },
          {
            ...glBase,
            account_code: revenueAccount,
            account_subhead: revenueAccount,
            dr: 0,
            cr: revenueTotal,
            account_description: product.name,
            transaction_description: `Sales revenue [${sku}] – ${product.name}`,
            type: "revenue",
          },
        ],
        { transaction },
      );

      if (db.CustomerEntry) {
        await db.CustomerEntry.create(
          {
            customerNo: invoice.ref_number,
            description: `${product.name} :`,
            qty_in: 0,
            qty_out: round4(newQty),
            cost: round2(unitSell),
            facilityId,
            mode_of_payment: mode || "CREDIT",
            link_id: sku,
            receiptNo: normalizedRef,
            type: "sales",
            created_by: createdBy,
            branch_id: branchId || null,
          },
          { transaction },
        );
      }
    } else {
      if (!invAccount) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Product is missing inventory account for purchase posting",
        });
      }
      await db.GeneralLedger.create(
        {
          ...glBase,
          account_code: invAccount,
          account_subhead: invAccount,
          dr: costTotal,
          cr: 0,
          account_description: product.name,
          transaction_description: `Inventory receipt [${sku}] – ${product.name}`,
          type: "inventory",
        },
        { transaction },
      );
      if (db.SupplierEntry) {
        await db.SupplierEntry.create(
          {
            supplier_number: invoice.ref_number,
            receiptNo: normalizedRef,
            description: `${product.name}`,
            qty_in: round4(newQty),
            qty_out: 0,
            cost: round2(unitCost),
            facilityId,
            type: "purchase",
            link_id: sku,
            created_by: createdBy,
            transaction_date: txDate,
          },
          { transaction },
        );
      }
    }

    const description = appendItemToDescription(
      invoice.description,
      product.name || sku,
      newQty,
    );
    const updatedBy = req.user?.id || req.body?.updatedBy || null;
    const { nextAmount, description: nextDescription } =
      await syncInvoiceDocumentTotals({
        facilityId,
        invoice,
        invoiceRef: normalizedRef,
        isPurchase,
        isSales,
        description,
        oldDocTotal,
        updatedBy,
        transaction,
      });
    await syncInventoryValuationForSkus(facilityId, new Set([sku]), transaction);

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message: "Invoice line added successfully",
      result: {
        invoice_ref: normalizedRef,
        store_entry_id: createdStore.id,
        amount: nextAmount,
        description: nextDescription,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("addInvoiceLineWithLedger error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add invoice line",
      error: error.message,
    });
  }
};

exports.deleteInvoiceWithLedger = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { facilityId, invoiceRef } = req.body || {};
    if (!facilityId || !invoiceRef) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId and invoiceRef are required",
      });
    }

    const normalizedRef = String(invoiceRef).trim();
    const invoice = await db.Invoice.findOne({
      where: { facility_id: facilityId, invoice_ref: normalizedRef },
      transaction,
    });

    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const deletedLedgerCount = await db.GeneralLedger.destroy({
      where: {
        facility_id: facilityId,
        reference_number: normalizedRef,
      },
      transaction,
    });

    let deletedStoreEntries = 0;
    let deletedSupplierEntries = 0;
    let deletedCustomerEntries = 0;
    const invoiceType = String(invoice.type || "").toLowerCase();

    if (invoiceType === "sales") {
      deletedStoreEntries = await db.StoreEntry.destroy({
        where: {
          facilityId,
          reference_number: normalizedRef,
        },
        transaction,
      });

      deletedCustomerEntries = await db.CustomerEntry.destroy({
        where: {
          facilityId,
          [Op.or]: [{ receiptNo: normalizedRef }, { link_id: normalizedRef }],
        },
        transaction,
      });
    } else if (invoiceType === "purchase") {
      deletedStoreEntries = await db.StoreEntry.destroy({
        where: {
          facilityId,
          reference_number: normalizedRef,
        },
        transaction,
      });

      deletedSupplierEntries = await db.SupplierEntry.destroy({
        where: {
          facilityId,
          [Op.or]: [{ receiptNo: normalizedRef }, { link_id: normalizedRef }],
        },
        transaction,
      });
    }

    await db.Invoice.destroy({
      where: {
        facility_id: facilityId,
        invoice_ref: normalizedRef,
      },
      transaction,
    });

    await transaction.commit();
    return res.status(200).json({
      success: true,
      message: "Invoice and linked ledger entries deleted successfully",
      result: {
        invoice_ref: normalizedRef,
        type: invoice.type,
        deleted_ledger_entries: deletedLedgerCount || 0,
        deleted_store_entries: deletedStoreEntries || 0,
        deleted_supplier_entries: deletedSupplierEntries || 0,
        deleted_customer_entries: deletedCustomerEntries || 0,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("deleteInvoiceWithLedger error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete invoice",
      error: error.message,
    });
  }
};

