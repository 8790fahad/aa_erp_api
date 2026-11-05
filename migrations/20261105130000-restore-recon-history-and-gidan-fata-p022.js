"use strict";

/**
 * Automatic hand-in save is turned off. Days it already confirmed stay on
 * Collection Reconciliation History: insert the saved rows when that
 * cashier and date are missing. Do not replace a row that is already there.
 *
 * Gidan Fata (branch 56) still shows Rafa Detergent P022 because the opening
 * quantity is on hand. Write that quantity off so the goods list drops it.
 * Other warehouses are left as they are.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const GIDAN_FATA_BRANCH_ID = 56;
const P022 = "P022";
const WRITE_OFF_REF = "WO-P022-GF";

const AUTO_HISTORY = [
  {
    recon_date: "2026-10-31",
    cashier_user_id: "USER-77",
    cashier_name: "Ali Ishaq",
    expected_cash: 276320,
    expected_transfer: 0,
    expected_total: 276320,
    received_cash: 276320,
    received_transfer: 0,
    received_total: 276320,
    expected_card: 0,
    received_card: 0,
    cash_from_account: "112199",
    cash_from_account_name: "Cash on Hand",
    safe_account: "112101",
    safe_account_name: "Cash Holding Safe",
    cash_to_safe_amount: 276320,
    shortage_account: "800605",
    shortage_account_name: "Cash Shortage",
    cash_transfer_id: "CS-47",
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-10-31 22:49:34",
  },
  {
    recon_date: "2026-10-31",
    cashier_user_id: "USER-79",
    cashier_name: "Aminu Yau",
    expected_cash: 0,
    expected_transfer: 0,
    expected_total: 7634650,
    received_cash: 0,
    received_transfer: 0,
    received_total: 7634650,
    expected_card: 7634650,
    received_card: 7634650,
    cash_to_safe_amount: 0,
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-10-31 22:49:34",
  },
  {
    recon_date: "2026-10-31",
    cashier_user_id: "USER-73",
    cashier_name: "Ashiru Ali Mohammed",
    expected_cash: 0,
    expected_transfer: 90622000,
    expected_total: 90622000,
    received_cash: 0,
    received_transfer: 90622000,
    received_total: 90622000,
    expected_card: 0,
    received_card: 0,
    cash_to_safe_amount: 0,
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-10-31 22:49:34",
  },
  {
    recon_date: "2026-10-31",
    cashier_user_id: "USER-112",
    cashier_name: "Muttaka  Badamasi",
    expected_cash: 0,
    expected_transfer: 133809350,
    expected_total: 135744950,
    received_cash: 0,
    received_transfer: 133809350,
    received_total: 135744950,
    expected_card: 1935600,
    received_card: 1935600,
    cash_to_safe_amount: 0,
    credit_total: 8807650,
    deposit_total: 57600000,
    confirmed_at: "2026-10-31 22:49:34",
  },
  {
    recon_date: "2026-11-01",
    cashier_user_id: "USER-76",
    cashier_name: "Aliyu Ashiru",
    expected_cash: 0,
    expected_transfer: 0,
    expected_total: 0,
    received_cash: 0,
    received_transfer: 0,
    received_total: 0,
    expected_card: 0,
    received_card: 0,
    cash_to_safe_amount: 0,
    credit_total: 4766000,
    deposit_total: 0,
    confirmed_at: "2026-11-01 22:49:34",
  },
  {
    recon_date: "2026-11-01",
    cashier_user_id: "USER-79",
    cashier_name: "Aminu Yau",
    expected_cash: 0,
    expected_transfer: 0,
    expected_total: 3084800,
    received_cash: 0,
    received_transfer: 0,
    received_total: 3084800,
    expected_card: 3084800,
    received_card: 3084800,
    cash_to_safe_amount: 0,
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-11-01 22:49:34",
  },
  {
    recon_date: "2026-11-01",
    cashier_user_id: "USER-73",
    cashier_name: "Ashiru Ali Mohammed",
    expected_cash: 0,
    expected_transfer: 152823000,
    expected_total: 152823000,
    received_cash: 0,
    received_transfer: 152823000,
    received_total: 152823000,
    expected_card: 0,
    received_card: 0,
    cash_to_safe_amount: 0,
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-11-01 22:49:35",
  },
  {
    recon_date: "2026-11-01",
    cashier_user_id: "USER-112",
    cashier_name: "Muttaka  Badamasi",
    expected_cash: 0,
    expected_transfer: 150366500,
    expected_total: 151697500,
    received_cash: 0,
    received_transfer: 150366500,
    received_total: 151697500,
    expected_card: 1331000,
    received_card: 1331000,
    cash_to_safe_amount: 0,
    credit_total: 17614800,
    deposit_total: 310425000,
    confirmed_at: "2026-11-01 22:49:35",
  },
  {
    recon_date: "2026-11-03",
    cashier_user_id: "USER-77",
    cashier_name: "Ali Ishaq",
    expected_cash: 1200750,
    expected_transfer: 0,
    expected_total: 1200750,
    received_cash: 1200750,
    received_transfer: 0,
    received_total: 1200750,
    expected_card: 0,
    received_card: 0,
    cash_from_account: "112199",
    cash_from_account_name: "Cash on Hand",
    safe_account: "112101",
    safe_account_name: "Cash Holding Safe",
    cash_to_safe_amount: 1200750,
    shortage_account: "800605",
    shortage_account_name: "Cash Shortage",
    cash_transfer_id: "CS-48",
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-11-03 22:49:35",
  },
  {
    recon_date: "2026-11-03",
    cashier_user_id: "USER-76",
    cashier_name: "Aliyu Ashiru",
    expected_cash: 0,
    expected_transfer: 0,
    expected_total: 0,
    received_cash: 0,
    received_transfer: 0,
    received_total: 0,
    expected_card: 0,
    received_card: 0,
    cash_to_safe_amount: 0,
    credit_total: 1192000,
    deposit_total: 0,
    confirmed_at: "2026-11-03 22:49:36",
  },
  {
    recon_date: "2026-11-03",
    cashier_user_id: "USER-79",
    cashier_name: "Aminu Yau",
    expected_cash: 0,
    expected_transfer: 0,
    expected_total: 1844300,
    received_cash: 0,
    received_transfer: 0,
    received_total: 1844300,
    expected_card: 1844300,
    received_card: 1844300,
    cash_to_safe_amount: 0,
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-11-03 22:49:36",
  },
  {
    recon_date: "2026-11-03",
    cashier_user_id: "USER-74",
    cashier_name: "Anas Ali Muhammed",
    expected_cash: 0,
    expected_transfer: 1978000,
    expected_total: 1978000,
    received_cash: 0,
    received_transfer: 1978000,
    received_total: 1978000,
    expected_card: 0,
    received_card: 0,
    cash_to_safe_amount: 0,
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-11-03 22:49:36",
  },
  {
    recon_date: "2026-11-03",
    cashier_user_id: "USER-73",
    cashier_name: "Ashiru Ali Mohammed",
    expected_cash: 0,
    expected_transfer: 148870400,
    expected_total: 148870400,
    received_cash: 0,
    received_transfer: 148870400,
    received_total: 148870400,
    expected_card: 0,
    received_card: 0,
    cash_to_safe_amount: 0,
    credit_total: 0,
    deposit_total: 0,
    confirmed_at: "2026-11-03 22:49:36",
  },
  {
    recon_date: "2026-11-03",
    cashier_user_id: "USER-112",
    cashier_name: "Muttaka  Badamasi",
    expected_cash: 0,
    expected_transfer: 58010600,
    expected_total: 58010600,
    received_cash: 0,
    received_transfer: 58010600,
    received_total: 58010600,
    expected_card: 0,
    received_card: 0,
    cash_to_safe_amount: 0,
    credit_total: 5888300,
    deposit_total: 108000000,
    confirmed_at: "2026-11-03 22:49:36",
  },
];

async function restoreAutoHistory(sequelize, transaction) {
  let inserted = 0;
  for (const row of AUTO_HISTORY) {
    const [existing] = await sequelize.query(
      `
      SELECT id
      FROM collection_reconciliations
      WHERE facility_id = :facilityId
        AND branch_id = 0
        AND recon_date = :reconDate
        AND cashier_user_id = :cashierUserId
        AND status IN ('confirmed', 'variance')
      LIMIT 1
      `,
      {
        replacements: {
          facilityId: FACILITY_ID,
          reconDate: row.recon_date,
          cashierUserId: row.cashier_user_id,
        },
        transaction,
      },
    );
    if (existing.length) continue;

    await sequelize.query(
      `
      INSERT INTO collection_reconciliations (
        facility_id, branch_id, recon_date, cashier_user_id, cashier_name,
        expected_cash, expected_transfer, expected_total,
        received_cash, received_transfer, received_total,
        variance_cash, variance_transfer, variance_total,
        status, note, confirmed_by, confirmed_by_name, confirmed_at,
        created_at, updated_at,
        expected_card, received_card, variance_card,
        cash_from_account, cash_from_account_name,
        safe_account, safe_account_name, cash_to_safe_amount,
        shortage_account, shortage_account_name, shortage_amount,
        cash_transfer_id, credit_total, deposit_total
      ) VALUES (
        :facilityId, 0, :reconDate, :cashierUserId, :cashierName,
        :expectedCash, :expectedTransfer, :expectedTotal,
        :receivedCash, :receivedTransfer, :receivedTotal,
        0, 0, 0,
        'confirmed', 'Saved automatically', NULL, 'Automatic save', :confirmedAt,
        :confirmedAt, :confirmedAt,
        :expectedCard, :receivedCard, 0,
        :cashFromAccount, :cashFromAccountName,
        :safeAccount, :safeAccountName, :cashToSafe,
        :shortageAccount, :shortageAccountName, 0,
        :cashTransferId, :creditTotal, :depositTotal
      )
      `,
      {
        replacements: {
          facilityId: FACILITY_ID,
          reconDate: row.recon_date,
          cashierUserId: row.cashier_user_id,
          cashierName: row.cashier_name,
          expectedCash: row.expected_cash,
          expectedTransfer: row.expected_transfer,
          expectedTotal: row.expected_total,
          receivedCash: row.received_cash,
          receivedTransfer: row.received_transfer,
          receivedTotal: row.received_total,
          expectedCard: row.expected_card,
          receivedCard: row.received_card,
          cashFromAccount: row.cash_from_account || null,
          cashFromAccountName: row.cash_from_account_name || null,
          safeAccount: row.safe_account || null,
          safeAccountName: row.safe_account_name || null,
          cashToSafe: row.cash_to_safe_amount || 0,
          shortageAccount: row.shortage_account || null,
          shortageAccountName: row.shortage_account_name || null,
          cashTransferId: row.cash_transfer_id || null,
          creditTotal: row.credit_total || 0,
          depositTotal: row.deposit_total || 0,
          confirmedAt: row.confirmed_at,
        },
        transaction,
      },
    );
    inserted += 1;
  }
  console.log(
    `[migrate] collection history restore: ${inserted} missing automatic day(s) inserted`,
  );
}

async function writeOffGidanFataP022(sequelize, transaction) {
  const [already] = await sequelize.query(
    `
    SELECT id
    FROM store_entries
    WHERE facilityId = :facilityId
      AND product_id = :sku
      AND branchId = :branchId
      AND reference_number = :ref
    LIMIT 1
    `,
    {
      replacements: {
        facilityId: FACILITY_ID,
        sku: P022,
        branchId: GIDAN_FATA_BRANCH_ID,
        ref: WRITE_OFF_REF,
      },
      transaction,
    },
  );
  if (already.length) {
    console.log("[migrate] Gidan Fata P022 write-off already posted");
    return;
  }

  const [nets] = await sequelize.query(
    `
    SELECT
      COALESCE(SUM(qty_in), 0) - COALESCE(SUM(qty_out), 0) AS net,
      COALESCE(MAX(NULLIF(cost_price, 0)), 0) AS cost_price
    FROM store_entries
    WHERE facilityId = :facilityId
      AND product_id = :sku
      AND branchId = :branchId
      AND LOWER(TRIM(IFNULL(branch_name, ''))) IN ('for sales', 'for sale')
    `,
    {
      replacements: {
        facilityId: FACILITY_ID,
        sku: P022,
        branchId: GIDAN_FATA_BRANCH_ID,
      },
      transaction,
    },
  );
  const net = Number(nets[0]?.net || 0);
  if (!(net > 0.0001)) {
    console.log("[migrate] Gidan Fata P022 already has no stock to remove");
    return;
  }
  const costPrice = Number(nets[0]?.cost_price || 0);

  await sequelize.query(
    `
    INSERT INTO store_entries (
      receive_date, reference_number, qty_in, qty_out, expiry_date,
      cost_price, selling_price, branch_name, inserted_by, facilityId,
      truckNo, waybillNo, supplier_code, type, source, destination, status,
      product_id, batch_id, multiplier_id, createdAt, markup_mode, mark_up,
      multple, location, departmentId, branchId, user_id, po_no, vat_amount
    ) VALUES (
      DATE_FORMAT(NOW(), '%Y-%m-%d'), :ref, 0, :qtyOut, NULL,
      :costPrice, 0, 'for sales', NULL, :facilityId,
      '', '', 'Removed from Gidan Fata inventory', 'adjustment',
      'for sales', 'Scrap/Loss', 'Active',
      :sku, NULL, NULL, NOW(), 'percentage', 0,
      '1', 'Warehouse', NULL, :branchId, NULL, NULL, 0
    )
    `,
    {
      replacements: {
        ref: WRITE_OFF_REF,
        qtyOut: net,
        costPrice,
        facilityId: FACILITY_ID,
        sku: P022,
        branchId: GIDAN_FATA_BRANCH_ID,
      },
      transaction,
    },
  );
  console.log(
    `[migrate] Gidan Fata P022 written off ${net} (Rafa Detergent 125x36pcs)`,
  );
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `
        UPDATE business
        SET recon_auto_save_enabled = 0
        WHERE recon_auto_save_enabled <> 0
        `,
        { transaction },
      );
      await restoreAutoHistory(sequelize, transaction);
      await writeOffGidanFataP022(sequelize, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down() {
    // History rows and the stock write-off are left in place.
  },
};
