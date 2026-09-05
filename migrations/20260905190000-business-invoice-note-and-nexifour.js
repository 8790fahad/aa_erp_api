"use strict";

/**
 * Invoice footer: thank-you + no refunds, and a configurable Nexifour line.
 *
 * Business: 094c6e1e-dd07-48c4-a344-6e9d58cd7861
 */
const BUSINESS_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const OLD_IMPORTANT_NOTE =
  "Thank you for patronizing us. We look forward to your return and to continuing to do business with you.";
const NEW_IMPORTANT_NOTE =
  "Thank you for patronizing us. We look forward to your return and to continuing to do business with you, and all goods sold in good condition are final. No refunds or exchanges will be accepted after purchase.";
const DEFAULT_POWERED_BY = "This solution is powered by Nexifour Limited";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("business");

    if (!table.invoice_powered_by) {
      await queryInterface.addColumn("business", "invoice_powered_by", {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Powered-by / Nexifour line printed on sales invoices",
      });
    }

    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET terms_conditions = :newNote
      WHERE id = :id
         OR UPPER(business_name) LIKE '%YAMMUSA%'
         OR UPPER(business_name) LIKE '%YAMUSA%'
         OR UPPER(business_name) LIKE '%ALI MUHAMMAD%'
         OR terms_conditions IS NULL
         OR terms_conditions = ''
         OR terms_conditions = :oldNote
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          newNote: NEW_IMPORTANT_NOTE,
          oldNote: OLD_IMPORTANT_NOTE,
        },
      },
    );

    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET invoice_powered_by = :poweredBy
      WHERE invoice_powered_by IS NULL OR invoice_powered_by = ''
      `,
      {
        replacements: { poweredBy: DEFAULT_POWERED_BY },
      },
    );
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("business");

    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET terms_conditions = :oldNote
      WHERE terms_conditions = :newNote
      `,
      {
        replacements: {
          oldNote: OLD_IMPORTANT_NOTE,
          newNote: NEW_IMPORTANT_NOTE,
        },
      },
    );

    if (table.invoice_powered_by) {
      await queryInterface.removeColumn("business", "invoice_powered_by");
    }
  },
};
