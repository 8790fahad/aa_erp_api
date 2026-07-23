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
    await db.SupplierContact.bulkCreate(rows, { transaction });
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
    await db.SupplierAddress.bulkCreate(rows, { transaction });
  }
}

module.exports = {
  buildAddressLine,
  syncSupplierContacts,
  syncSupplierAddresses,
};
