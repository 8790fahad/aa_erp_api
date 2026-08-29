"use strict";

/**
 * Update ALH ALI MUHAMMAD YAMMUSA business phones.
 * Business: 094c6e1e-dd07-48c4-a344-6e9d58cd7861
 */
const BUSINESS_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const NEW_PHONE =
  "08036032541, 07032144609, 07077222277, 08081634455";
const OLD_PHONE = "08036032541, 07032144609";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET business_phone = :phone
      WHERE id = :id
         OR UPPER(business_name) LIKE '%YAMMUSA%'
         OR UPPER(business_name) LIKE '%YAMUSA%'
         OR UPPER(business_name) LIKE '%ALI MUHAMMAD%'
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          phone: NEW_PHONE,
        },
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET business_phone = :phone
      WHERE id = :id
         OR UPPER(business_name) LIKE '%YAMMUSA%'
         OR UPPER(business_name) LIKE '%YAMUSA%'
         OR business_name = 'ALH ALI MUHAMMAD YAMMUSA'
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          phone: OLD_PHONE,
        },
      },
    );
  },
};
