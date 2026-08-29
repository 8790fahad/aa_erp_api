"use strict";

const { Sequelize } = require("sequelize");

/**
 * YAMMUSA phones: keep originals + add two new (4 total).
 * Widen business_phone for multiple numbers.
 * Business: 094c6e1e-dd07-48c4-a344-6e9d58cd7861
 *
 * Tel: 08036032541, 07032144609, 07077222277, 08081634455
 */
const BUSINESS_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const FOUR_PHONES =
  "08036032541, 07032144609, 07077222277, 08081634455";
const PREVIOUS_PHONES = "07077222277, 08081634455";

module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable("business");
    if (table.business_phone) {
      await queryInterface.changeColumn("business", "business_phone", {
        type: Sequelize.STRING(120),
        allowNull: true,
      });
    }

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
          phone: FOUR_PHONES,
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
          phone: PREVIOUS_PHONES,
        },
      },
    );
  },
};
