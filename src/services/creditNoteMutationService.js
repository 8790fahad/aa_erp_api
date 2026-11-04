"use strict";

const { Op } = require("sequelize");
const db = require("../models");

/** Parking a money-only supplier credit on the advance does not use it up. */
function applicationUsesCredit(row) {
  return String(row?.invoice_ref || "").trim().toUpperCase() !== "ADVANCE";
}

function creditNoteGlWhere(facilityId, creditNoteNumber) {
  const ref = String(creditNoteNumber || "").trim();
  return {
    facility_id: facilityId,
    [Op.or]: [
      { reference_number: ref.slice(0, 100) },
      { transaction_ref: { [Op.like]: `${ref}%` } },
      {
        transaction_description: {
          [Op.like]: `%Credit Note ${ref}%`,
        },
      },
    ],
  };
}

async function loadCreditNoteMutableContext(facilityId, creditNoteNumber, transaction) {
  const invoice = await db.Invoice.findOne({
    where: {
      facility_id: facilityId,
      invoice_ref: creditNoteNumber,
      amount: { [Op.lt]: 0 },
    },
    transaction,
  });
  if (!invoice) {
    const err = new Error("Credit note not found");
    err.statusCode = 404;
    throw err;
  }

  const applications = await db.CreditNoteApplication.findAll({
    where: {
      facility_id: facilityId,
      credit_note_number: creditNoteNumber,
    },
    transaction,
  });

  const totalAmount = Math.abs(parseFloat(invoice.amount) || 0);
  const creditsApplied = applications.reduce(
    (s, a) =>
      applicationUsesCredit(a) ? s + (parseFloat(a.amount) || 0) : s,
    0,
  );
  const creditsRemaining = Math.max(0, totalAmount - creditsApplied);
  const status = creditsRemaining <= 0.009 ? "closed" : "open";
  const hasAnyApplication = applications.length > 0;

  return {
    invoice,
    applications,
    totalAmount,
    creditsApplied,
    creditsRemaining,
    status,
    hasAnyApplication,
    canEdit: !hasAnyApplication && status === "open",
    canDelete: !hasAnyApplication && status === "open",
  };
}

function assertCreditNoteMutable(context) {
  if (!context?.canDelete) {
    const err = new Error(
      context?.hasAnyApplication
        ? "This note has been applied, refunded, parked, or moved to GIT and cannot be changed"
        : "Only open unused credit or debit notes can be edited or deleted",
    );
    err.statusCode = 400;
    throw err;
  }
}

async function softVoidGeneralLedger(facilityId, creditNoteNumber, transaction) {
  const rows = await db.GeneralLedger.findAll({
    where: creditNoteGlWhere(facilityId, creditNoteNumber),
    transaction,
  });
  let count = 0;
  for (const row of rows) {
    const plain = row.get ? row.get({ plain: true }) : row;
    const desc = String(plain.transaction_description || "");
    if (/^VOID:/i.test(desc)) continue;
    if (String(plain.status || "").toLowerCase() === "reversed") continue;
    const dr = parseFloat(plain.dr || 0);
    const cr = parseFloat(plain.cr || 0);
    if (dr === 0 && cr === 0) continue;
    const clone = { ...plain };
    delete clone.transaction_id;
    delete clone.id;
    delete clone.createdAt;
    delete clone.updatedAt;
    delete clone.created_at;
    delete clone.updated_at;
    clone.dr = cr;
    clone.cr = dr;
    clone.status = "reversed";
    clone.transaction_description = `VOID: ${plain.transaction_description || creditNoteNumber}`.slice(
      0,
      500,
    );
    clone.purpose_of_payment =
      plain.purpose_of_payment || `Void ${creditNoteNumber}`;
    clone.transaction_ref = plain.transaction_ref;
    await db.GeneralLedger.create(clone, { transaction });
    count += 1;
  }
  return count;
}

async function hardDeleteGeneralLedger(facilityId, creditNoteNumber, transaction) {
  return db.GeneralLedger.destroy({
    where: creditNoteGlWhere(facilityId, creditNoteNumber),
    transaction,
  });
}

async function softVoidStoreEntries(facilityId, creditNoteNumber, transaction) {
  const StoreModel = db.StoreEntry || db.StoreEntries;
  if (!StoreModel) return 0;
  const ref = String(creditNoteNumber || "").trim();
  const rows = await StoreModel.findAll({
    where: {
      facilityId,
      [Op.or]: [
        { reference_number: ref },
        { reference_number: ref.slice(0, 20) },
      ],
    },
    transaction,
  }).catch(() => []);

  let count = 0;
  for (const row of rows || []) {
    const plain = row.get ? row.get({ plain: true }) : row;
    if (String(plain.status || "").toLowerCase() === "voided") continue;
    if (String(plain.destination || "").toLowerCase() === "void") continue;
    const qtyOut = parseFloat(plain.qty_out || 0);
    const qtyIn = parseFloat(plain.qty_in || 0);
    if (qtyOut <= 0 && qtyIn <= 0) continue;
    const clone = { ...plain };
    delete clone.id;
    delete clone.entry_id;
    delete clone.createdAt;
    delete clone.updatedAt;
    delete clone.created_at;
    delete clone.updated_at;
    clone.qty_in = qtyOut;
    clone.qty_out = qtyIn;
    clone.status = "voided";
    clone.destination = "void";
    clone.reference_number = String(plain.reference_number || ref).slice(0, 20);
    await StoreModel.create(clone, { transaction });
    count += 1;
  }
  return count;
}

async function hardDeleteStoreEntries(facilityId, creditNoteNumber, transaction) {
  const StoreModel = db.StoreEntry || db.StoreEntries;
  if (!StoreModel) return 0;
  const ref = String(creditNoteNumber || "").trim();
  return StoreModel.destroy({
    where: {
      facilityId,
      [Op.or]: [
        { reference_number: ref },
        { reference_number: ref.slice(0, 20) },
      ],
    },
    transaction,
  });
}

async function removeCreditNoteSubledgers(facilityId, creditNoteNumber, transaction) {
  let customer = 0;
  let supplier = 0;
  if (db.CustomerEntry) {
    customer = await db.CustomerEntry.destroy({
      where: {
        facilityId,
        [Op.or]: [
          { receiptNo: creditNoteNumber },
          { link_id: creditNoteNumber },
        ],
      },
      transaction,
    });
  }
  if (db.SupplierEntry) {
    supplier = await db.SupplierEntry.destroy({
      where: {
        facilityId,
        [Op.or]: [
          { receiptNo: creditNoteNumber },
          { cheque_no: creditNoteNumber },
        ],
      },
      transaction,
    });
  }
  return { customer, supplier };
}

/**
 * Tear down an unused credit/debit note so it can be deleted or rebuilt.
 * @param {{ mode?: "delete" | "replace" }} options
 *   delete = soft-void GL/store for audit; replace = hard-delete so create can repost same number
 */
async function reverseCreditNoteDocument(
  facilityId,
  creditNoteNumber,
  transaction,
  options = {},
) {
  const mode = options.mode === "replace" ? "replace" : "delete";
  const context = await loadCreditNoteMutableContext(
    facilityId,
    creditNoteNumber,
    transaction,
  );
  assertCreditNoteMutable(context);

  let glCount = 0;
  let storeCount = 0;
  if (mode === "replace") {
    glCount = await hardDeleteGeneralLedger(
      facilityId,
      creditNoteNumber,
      transaction,
    );
    storeCount = await hardDeleteStoreEntries(
      facilityId,
      creditNoteNumber,
      transaction,
    );
  } else {
    glCount = await softVoidGeneralLedger(
      facilityId,
      creditNoteNumber,
      transaction,
    );
    storeCount = await softVoidStoreEntries(
      facilityId,
      creditNoteNumber,
      transaction,
    );
  }

  const subledgers = await removeCreditNoteSubledgers(
    facilityId,
    creditNoteNumber,
    transaction,
  );

  await db.CreditNoteApplication.destroy({
    where: {
      facility_id: facilityId,
      credit_note_number: creditNoteNumber,
    },
    transaction,
  });

  await context.invoice.destroy({ transaction });

  return {
    glCount,
    storeCount,
    subledgers,
    totalAmount: context.totalAmount,
    type: context.invoice.type === "sales" ? "customer" : "supplier",
  };
}

function mutabilityFlags(applications, totalAmount) {
  const hasAnyApplication = (applications || []).length > 0;
  const creditsApplied = (applications || []).reduce(
    (s, a) =>
      applicationUsesCredit(a) ? s + (parseFloat(a.amount) || 0) : s,
    0,
  );
  const creditsRemaining = Math.max(0, totalAmount - creditsApplied);
  const status = creditsRemaining <= 0.009 ? "closed" : "open";
  const canMutate = !hasAnyApplication && status === "open";
  return {
    creditsApplied,
    creditsRemaining,
    status,
    canEdit: canMutate,
    canDelete: canMutate,
  };
}

module.exports = {
  applicationUsesCredit,
  loadCreditNoteMutableContext,
  assertCreditNoteMutable,
  reverseCreditNoteDocument,
  mutabilityFlags,
  creditNoteGlWhere,
};
