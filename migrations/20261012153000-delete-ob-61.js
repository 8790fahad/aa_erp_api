"use strict";

/**
 * Remove Musa Anchau's opening balance OB-61 (₦3,500,000).
 * The First Bank (Ashiru) transfer that settled it stays, under receipt AD-514,
 * so the bank ledger is unchanged and the customer keeps a ₦3,500,000 credit.
 */

const FACILITY_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const OB_REF = "OB-61";
const PAYMENT_REF = "AD-514";

function eq(column, param) {
  const side = (expr) =>
    `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;
  return `${side(column)} = ${side(param)}`;
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const dialect = sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `DELETE FROM general_ledger
         WHERE ${eq("facility_id", ":facilityId")}
           AND ${eq("reference_number", ":obRef")}
           AND purpose_of_payment LIKE 'Opening Balance%'`,
        {
          replacements: { facilityId: FACILITY_ID, obRef: OB_REF },
          transaction,
        },
      );

      await sequelize.query(
        `UPDATE general_ledger
         SET reference_number = :paymentRef,
             transaction_description = REPLACE(transaction_description, :obRef, :paymentRef)
         WHERE ${eq("facility_id", ":facilityId")}
           AND ${eq("reference_number", ":obRef")}`,
        {
          replacements: {
            facilityId: FACILITY_ID,
            obRef: OB_REF,
            paymentRef: PAYMENT_REF,
          },
          transaction,
        },
      );

      await sequelize.query(
        `DELETE FROM invoices
         WHERE ${eq("facility_id", ":facilityId")}
           AND ${eq("invoice_ref", ":obRef")}`,
        {
          replacements: { facilityId: FACILITY_ID, obRef: OB_REF },
          transaction,
        },
      );

      await sequelize.query(
        `DELETE FROM customer_entries
         WHERE ${eq("facilityId", ":facilityId")}
           AND ${eq("link_id", ":obRef")}
           AND type = 'opening_balance'`,
        {
          replacements: { facilityId: FACILITY_ID, obRef: OB_REF },
          transaction,
        },
      );

      await sequelize.query(
        `UPDATE customer_entries
         SET link_id = :paymentRef
         WHERE ${eq("facilityId", ":facilityId")}
           AND ${eq("link_id", ":obRef")}`,
        {
          replacements: {
            facilityId: FACILITY_ID,
            obRef: OB_REF,
            paymentRef: PAYMENT_REF,
          },
          transaction,
        },
      );
    });
  },

  async down() {},
};
