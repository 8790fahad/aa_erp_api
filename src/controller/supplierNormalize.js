const { QueryTypes } = require("sequelize");

function buildAddressLine(addr = {}) {
  return [
    addr.attention,
    addr.street1,
    addr.street2,
    addr.city,
    addr.state,
    addr.zip,
    addr.country,
  ]
    .filter(Boolean)
    .join(", ");
}

async function nextIntId(sequelize, table, transaction) {
  const row = await sequelize.query(
    `SELECT COALESCE(MAX(\`id\`), 0) AS m FROM \`${table}\``,
    { transaction, type: QueryTypes.SELECT, plain: true },
  );
  return Number(row?.m || 0) + 1;
}

async function insertRowsWithIds(sequelize, table, rows, transaction) {
  if (!rows.length) return;
  let nextId = await nextIntId(sequelize, table, transaction);
  for (const row of rows) {
    const cols = ["id", ...Object.keys(row)];
    const placeholders = cols.map(() => "?").join(", ");
    const values = [nextId, ...Object.values(row)];
    nextId += 1;
    await sequelize.query(
      `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${placeholders})`,
      { replacements: values, transaction },
    );
  }
}

async function syncSupplierContacts(
  db,
  { facilityId, supplier_number, primary, contactPersons = [] },
  transaction,
) {
  if (!db.SupplierContact) return;

  await db.SupplierContact.destroy({
    where: { facility_id: facilityId, supplier_number },
    transaction,
  });

  const rows = [];
  if (primary && (primary.first_name || primary.last_name || primary.email)) {
    rows.push({
      facility_id: facilityId,
      supplier_number,
      salutation: primary.salutation || null,
      first_name: primary.first_name || null,
      last_name: primary.last_name || null,
      email: primary.email || null,
      work_phone: primary.work_phone || null,
      mobile: primary.mobile || null,
      is_primary: true,
    });
  }

  for (const person of contactPersons) {
    if (
      !person ||
      !(
        person.first_name ||
        person.last_name ||
        person.email ||
        person.work_phone ||
        person.mobile
      )
    ) {
      continue;
    }
    rows.push({
      facility_id: facilityId,
      supplier_number,
      salutation: person.salutation || null,
      first_name: person.first_name || null,
      last_name: person.last_name || null,
      email: person.email || null,
      work_phone: person.work_phone || null,
      mobile: person.mobile || null,
      is_primary: false,
    });
  }

  if (rows.length) {
    const now = new Date();
    await insertRowsWithIds(
      db.sequelize,
      "supplier_contacts",
      rows.map((r) => ({
        facility_id: r.facility_id,
        supplier_number: r.supplier_number,
        salutation: r.salutation,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        work_phone: r.work_phone,
        mobile: r.mobile,
        is_primary: r.is_primary ? 1 : 0,
        created_at: now,
        updated_at: now,
      })),
      transaction,
    );
  }
}

async function syncSupplierAddresses(
  db,
  { facilityId, supplier_number, billing, shipping },
  transaction,
) {
  if (!db.SupplierAddress) return;

  await db.SupplierAddress.destroy({
    where: { facility_id: facilityId, supplier_number },
    transaction,
  });

  const rows = [];
  if (billing && (billing.street1 || billing.city || billing.attention)) {
    rows.push({
      facility_id: facilityId,
      supplier_number,
      address_type: "billing",
      attention: billing.attention || null,
      country: billing.country || null,
      street1: billing.street1 || null,
      street2: billing.street2 || null,
      city: billing.city || null,
      state: billing.state || null,
      zip: billing.zip || null,
      phone: billing.phone || null,
      fax: billing.fax || null,
    });
  }
  if (shipping && (shipping.street1 || shipping.city || shipping.attention)) {
    rows.push({
      facility_id: facilityId,
      supplier_number,
      address_type: "shipping",
      attention: shipping.attention || null,
      country: shipping.country || null,
      street1: shipping.street1 || null,
      street2: shipping.street2 || null,
      city: shipping.city || null,
      state: shipping.state || null,
      zip: shipping.zip || null,
      phone: shipping.phone || null,
      fax: shipping.fax || null,
    });
  }

  if (rows.length) {
    const now = new Date();
    await insertRowsWithIds(
      db.sequelize,
      "supplier_addresses",
      rows.map((r) => ({
        facility_id: r.facility_id,
        supplier_number: r.supplier_number,
        address_type: r.address_type,
        attention: r.attention,
        country: r.country,
        street1: r.street1,
        street2: r.street2,
        city: r.city,
        state: r.state,
        zip: r.zip,
        phone: r.phone,
        fax: r.fax,
        created_at: now,
        updated_at: now,
      })),
      transaction,
    );
  }
}

module.exports = {
  buildAddressLine,
  syncSupplierContacts,
  syncSupplierAddresses,
};
