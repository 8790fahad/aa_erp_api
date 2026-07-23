"use strict";

const crypto = require("crypto");

function encodeBvn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits)) return value;
  const hash = crypto.createHash("sha256").update(digits, "utf8").digest("hex");
  return `sha256:${hash}:${digits.slice(-4)}`;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable("kyc_stakeholders");
    if (desc.bvn) {
      await queryInterface.changeColumn("kyc_stakeholders", "bvn", {
        type: Sequelize.STRING(90),
        allowNull: false,
        comment:
          "SHA-256 encoded BVN with last-four suffix for masking; full BVN is not stored.",
      });

      const [rows] = await queryInterface.sequelize.query(
        "SELECT id, bvn FROM kyc_stakeholders WHERE bvn NOT LIKE 'sha256:%'",
      );
      for (const row of rows) {
        const encoded = encodeBvn(row.bvn);
        if (encoded !== row.bvn) {
          await queryInterface.sequelize.query(
            "UPDATE kyc_stakeholders SET bvn = ? WHERE id = ?",
            { replacements: [encoded, row.id] },
          );
        }
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable("kyc_stakeholders");
    if (desc.bvn) {
      await queryInterface.changeColumn("kyc_stakeholders", "bvn", {
        type: Sequelize.STRING(11),
        allowNull: false,
      });
    }
  },
};
