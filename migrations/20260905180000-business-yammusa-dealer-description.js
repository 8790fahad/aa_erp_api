"use strict";

/**
 * ALH ALI MUHAMMAD YAMMUSA letterhead line (underlined on documents):
 * "Farming, agro allied, fishing, poultry & trading"
 * → "Dealer in all types Rice, Sugar, Pasta and Flour etc."
 *
 * Business: 094c6e1e-dd07-48c4-a344-6e9d58cd7861
 */
const BUSINESS_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const NEW_DESCRIPTION =
  "Dealer in all types Rice, Sugar, Pasta and Flour etc.";
const OLD_DESCRIPTION =
  "Farming, agro allied, fishing, poultry & trading";

const WHERE_YAMMUSA = `
  id = :id
  OR UPPER(business_name) LIKE '%YAMMUSA%'
  OR UPPER(business_name) LIKE '%YAMUSA%'
  OR UPPER(business_name) LIKE '%ALI MUHAMMAD%'
  OR description = :oldDescription
`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET description = :description
      WHERE ${WHERE_YAMMUSA}
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          description: NEW_DESCRIPTION,
          oldDescription: OLD_DESCRIPTION,
        },
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET description = :description
      WHERE id = :id
         OR description = :newDescription
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          description: OLD_DESCRIPTION,
          newDescription: NEW_DESCRIPTION,
        },
      },
    );
  },
};
