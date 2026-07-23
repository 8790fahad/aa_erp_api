"use strict";

const { Op } = require("sequelize");
const db = require("../models");

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

