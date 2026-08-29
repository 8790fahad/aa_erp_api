"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Sync ALH ALI MUHAMMAD YAMMUSA document header settings so online
 * matches local (name, address, phones, logo header).
 *
 * Business: 094c6e1e-dd07-48c4-a344-6e9d58cd7861
 */
const BUSINESS_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const BUSINESS_NAME = "ALH ALI MUHAMMAD YAMMUSA";
const BUSINESS_ADDRESS = "#52E Ado Bayero Road Singer Market, Kano.";
const BUSINESS_PHONE =
  "08036032541, 07032144609, 07077222277, 08081634455";

function resolveLogoPath() {
  const candidates = [
    path.join(__dirname, "assets", "yammusa-logo.png"),
    path.join(__dirname, "..", "migrations", "assets", "yammusa-logo.png"),
    path.join(
      __dirname,
      "..",
      "public",
      "uploads",
      "business",
      "yammusa-logo.png",
    ),
    path.join(
      __dirname,
      "..",
      "..",
      "public",
      "uploads",
      "business",
      "yammusa-logo.png",
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadLogoDataUri() {
  const logoPath = resolveLogoPath();
  if (!logoPath) return null;
  const buf = fs.readFileSync(logoPath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

module.exports = {
  async up(queryInterface) {
    const logo = loadLogoDataUri();
    const setLogo = logo
      ? ", business_logo = :logo"
      : "";

    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET
        business_name = :name,
        business_address = :address,
        business_phone = :phone,
        document_header_style = 'logo'
        ${setLogo}
      WHERE id = :id
         OR UPPER(business_name) LIKE '%YAMMUSA%'
         OR UPPER(business_name) LIKE '%YAMUSA%'
         OR UPPER(business_name) LIKE '%ALI MUHAMMAD%'
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          name: BUSINESS_NAME,
          address: BUSINESS_ADDRESS,
          phone: BUSINESS_PHONE,
          ...(logo ? { logo } : {}),
        },
      },
    );
  },

  async down() {
    // Keep current branding — earlier migrations own the prior values.
  },
};
