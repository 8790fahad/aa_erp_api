"use strict";

const fs = require("fs");
const path = require("path");

const BUSINESS_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
const NEW_NAME = "ALH ALI MUHAMMAD YAMMUSA";
const NEW_ADDRESS = "#52E Ado Bayero Road Singer Market, Kano.";
const NEW_PHONE = "08036032541, 07032144609";
const OLD_NAME = "YAMMUSA GLOBAL FARMS & AGRO ALLIED SERVICES";
const OLD_ADDRESS =
  "NO. 9 SHEHU NA ALLAH STREET, YANKABA, NASARAWA LGA, KANO, KANO STATE";
const OLD_PHONE = "0814 444 4220";

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
  if (!logoPath) {
    throw new Error(
      "yammusa-logo.png not found — expected under migrations/assets/",
    );
  }
  const buf = fs.readFileSync(logoPath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/**
 * Rebrand YAMMUSA business:
 * - Name: ALH ALI MUHAMMAD YAMMUSA
 * - Address: #52E Ado Bayero Road Singer Market, Kano.
 * - Phones: 08036032541, 07032144609
 * - Logo: circular Salt/Rice emblem (migrations/assets/yammusa-logo.png)
 */
module.exports = {
  async up(queryInterface) {
    const logo = loadLogoDataUri();

    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET
        business_name = :name,
        business_address = :address,
        business_phone = :phone,
        business_logo = :logo,
        document_header_style = 'logo'
      WHERE id = :id
         OR UPPER(business_name) LIKE '%YAMMUSA%'
         OR UPPER(business_name) LIKE '%YAMUSA%'
         OR UPPER(business_name) LIKE '%ALI MUHAMMAD%'
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          name: NEW_NAME,
          address: NEW_ADDRESS,
          phone: NEW_PHONE,
          logo,
        },
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `
      UPDATE business
      SET
        business_name = :name,
        business_address = :address,
        business_phone = :phone,
        business_logo = NULL
      WHERE id = :id
         OR business_name = :newName
      `,
      {
        replacements: {
          id: BUSINESS_ID,
          name: OLD_NAME,
          address: OLD_ADDRESS,
          phone: OLD_PHONE,
          newName: NEW_NAME,
        },
      },
    );
  },
};
