"use strict";

/**
 * GIDAN KIFI sold Crown Thick Pasta (P014) before any receipt was on the
 * books. The batch valuation walks receipts first, so those early sales
 * were never taken off the later ₦12,550 layers and the report kept
 * showing stock the inventory ledger does not have.
 *
 * Move only that unapplied quantity to just after the last Gidan Kifi
 * movement (never past today). Quantity in and out stay the same, so
 * inventory on hand does not change. Other stores are left alone.
 * Safe to run more than once.
 */

const BRANCH_NAME = "GIDAN KIFI";
const SKU = "P014";
const QTY_EPS = 0.0001;

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function nextDay(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function effectiveDate(row) {
  const received = row.receive_date ? String(row.receive_date).slice(0, 10) : "";
  if (received && received > "2000-01-01") return received;
  if (!row.createdAt) return "1970-01-01";
  const created = new Date(row.createdAt);
  if (Number.isNaN(created.getTime())) return "1970-01-01";
  const month = String(created.getMonth() + 1).padStart(2, "0");
  const day = String(created.getDate()).padStart(2, "0");
  return `${created.getFullYear()}-${month}-${day}`;
}

function expiryKey(row) {
  if (!row.expiry_date) return null;
  const value = String(row.expiry_date).slice(0, 10);
  return value > "2000-01-01" ? value : null;
}

function consumeLayerQty(layers, qtyOut, matchFn) {
  let remaining = qtyOut;
  const takeFrom = (predicate) => {
    for (const layer of layers) {
      if (remaining <= QTY_EPS) break;
      if (layer.qty <= QTY_EPS || !predicate(layer)) continue;
      const take = Math.min(layer.qty, remaining);
      layer.qty -= take;
      remaining -= take;
    }
  };
  if (matchFn) takeFrom(matchFn);
  takeFrom(() => true);
  return remaining;
}

function planCorrections(rows, today) {
  const ordered = [...rows].sort((a, b) => {
    const date = effectiveDate(a).localeCompare(effectiveDate(b));
    if (date !== 0) return date;
    return Number(a.id) - Number(b.id);
  });

  let finalLastIn = null;
  let maxDate = "1970-01-01";
  for (const row of ordered) {
    const date = effectiveDate(row);
    if (date > maxDate) maxDate = date;
    if ((parseFloat(row.qty_in) || 0) > QTY_EPS && (!finalLastIn || date > finalLastIn)) {
      finalLastIn = date;
    }
  }

  const layers = [];
  const pending = [];
  for (const row of ordered) {
    const date = effectiveDate(row);
    const qtyIn = parseFloat(row.qty_in) || 0;
    const qtyOut = parseFloat(row.qty_out) || 0;
    if (qtyIn > QTY_EPS) {
      layers.push({
        qty: qtyIn,
        expiry: expiryKey(row),
      });
    }
    if (qtyOut > QTY_EPS) {
      const expiry = expiryKey(row);
      const leftover = consumeLayerQty(
        layers,
        qtyOut,
        expiry ? (layer) => layer.expiry === expiry : null,
      );
      // A sale already dated after every receipt cannot be cleared by moving
      // it again. Sales on or before the last receipt still need a later date.
      if (leftover > QTY_EPS && finalLastIn && date <= finalLastIn) {
        pending.push({
          id: Number(row.id),
          qtyOut,
          leftover,
          vat: parseFloat(row.vat_amount) || 0,
        });
      }
    }
  }

  if (!pending.length || !finalLastIn) {
    return { moveTo: null, shiftIds: [], splits: [], movedQty: 0 };
  }

  let moveTo = nextDay(maxDate);
  let needsNewRow = false;
  if (moveTo > today) {
    moveTo = maxDate > today ? maxDate : today;
    needsNewRow = true;
  }

  const shiftIds = [];
  const splits = [];
  let movedQty = 0;
  for (const line of pending) {
    const applied = line.qtyOut - line.leftover;
    movedQty += line.leftover;
    if (applied <= QTY_EPS && !needsNewRow) {
      shiftIds.push(line.id);
      continue;
    }
    const kept = applied > QTY_EPS ? applied : 0;
    const vatKept =
      line.qtyOut > 0 ? (line.vat * kept) / line.qtyOut : 0;
    const vatMoved =
      line.qtyOut > 0 ? (line.vat * line.leftover) / line.qtyOut : 0;
    splits.push({
      id: line.id,
      kept: Number(kept.toFixed(4)),
      moved: Number(line.leftover.toFixed(4)),
      vatKept: Number(vatKept.toFixed(2)),
      vatMoved: Number(vatMoved.toFixed(2)),
    });
  }

  return {
    moveTo,
    shiftIds,
    splits,
    movedQty: Number(movedQty.toFixed(4)),
  };
}

async function correctGidanKifiCrownThickPasta(sequelize, options = {}) {
  const transaction = options.transaction;
  const today = options.today || localToday();
  const rows = await sequelize.query(
    `
    SELECT
      se.id,
      se.facilityId,
      se.branchId,
      se.qty_in,
      se.qty_out,
      se.receive_date,
      se.createdAt,
      se.expiry_date,
      se.vat_amount
    FROM store_entries se
    INNER JOIN branches b
      ON b.id = se.branchId
     AND b.branch_name = :branchName
    WHERE se.product_id = :sku
    `,
    {
      replacements: { branchName: BRANCH_NAME, sku: SKU },
      type: sequelize.QueryTypes.SELECT,
      transaction,
    },
  );

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.facilityId}|${row.branchId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let movedQty = 0;
  let movedLines = 0;
  for (const group of groups.values()) {
    const plan = planCorrections(group, today);
    if (!plan.moveTo || plan.movedQty <= QTY_EPS) continue;

    if (plan.shiftIds.length) {
      await sequelize.query(
        `UPDATE store_entries SET receive_date = :moveTo WHERE id IN (:ids)`,
        {
          replacements: { moveTo: plan.moveTo, ids: plan.shiftIds },
          transaction,
        },
      );
      movedLines += plan.shiftIds.length;
    }

    for (const split of plan.splits) {
      await sequelize.query(
        `
        UPDATE store_entries
        SET qty_out = :kept, vat_amount = :vatKept
        WHERE id = :id
        `,
        {
          replacements: {
            kept: split.kept,
            vatKept: split.vatKept,
            id: split.id,
          },
          transaction,
        },
      );
      await sequelize.query(
        `
        INSERT INTO store_entries (
          receive_date, reference_number, qty_in, qty_out, expiry_date, cost_price,
          selling_price, branch_name, inserted_by, facilityId, truckNo, waybillNo,
          supplier_code, type, source, destination, status, product_id, batch_id,
          multiplier_id, createdAt, markup_mode, mark_up, multple, location,
          departmentId, branchId, user_id, po_no, vat_amount
        )
        SELECT
          :moveTo, reference_number, 0, :moved, expiry_date, cost_price,
          selling_price, branch_name, inserted_by, facilityId, truckNo, waybillNo,
          supplier_code, type, source, destination, status, product_id, batch_id,
          multiplier_id, createdAt, markup_mode, mark_up, multple, location,
          departmentId, branchId, user_id, po_no, :vatMoved
        FROM store_entries
        WHERE id = :id
        `,
        {
          replacements: {
            moveTo: plan.moveTo,
            moved: split.moved,
            vatMoved: split.vatMoved,
            id: split.id,
          },
          transaction,
        },
      );
      movedLines += 1;
    }

    movedQty += plan.movedQty;
    console.log(
      `GIDAN KIFI ${SKU}: dated ${plan.movedQty} units of stock that was sold before it was received onto ${plan.moveTo}`,
    );
  }

  return { movedQty: Number(movedQty.toFixed(4)), movedLines };
}

module.exports = {
  correctGidanKifiCrownThickPasta,
  planCorrections,
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await correctGidanKifiCrownThickPasta(queryInterface.sequelize, {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
  async down() {
    // Original sale dates are not stored, so this stock correction is not reversed.
  },
};
