"use strict";

/**
 * Yammusa staff seed (excludes Admin):
 * 1) Remove demo upload users USER-70 / USER-71 (Fahad, Amina Bello).
 * 2) Upsert remaining staff USER-72 … USER-94 with warehouse + role.
 *
 * Business: 094c6e1e-dd07-48c4-a344-6e9d58cd7861 (ALH ALI MUHAMMAD YAMMUSA)
 * Admin is intentionally not included.
 */

const BUSINESS_ID = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const DEMO_USER_IDS = ["USER-70", "USER-71"];
const DEMO_EMAILS = ["fahad@brainstorm.ng", "amina.bello@example.com"];

/** Staff to keep / seed — no Admin. */
const STAFF = [
  {
    id: "USER-72",
    firstname: "Ibrahim",
    lastname: "Sani",
    email: "ibrahim.sani@example.com",
    phone: "08098765432",
    role: "Cashier",
    warehouse: "YAMUSA STORE",
  },
  {
    id: "USER-73",
    firstname: "Ashiru",
    lastname: "Ali Muhammed",
    email: "aayammusa@gmail.com",
    phone: "8144444220",
    role: "C.E.O",
    warehouse: "Head Office",
  },
  {
    id: "USER-74",
    firstname: "Anas",
    lastname: "Ali Muhammed",
    email: "yammusa1995@gmail.com",
    phone: "8060162673",
    role: "M.D",
    warehouse: "Head Office",
  },
  {
    id: "USER-75",
    firstname: "Mansur",
    lastname: "Yusuf",
    email: "myusufyms24@gmail.com",
    phone: "8145685493",
    role: "Accountant",
    warehouse: "Head Office",
  },
  {
    id: "USER-76",
    firstname: "Aliyu",
    lastname: "Ashiru",
    email: "daddyyammusa@gmail.com",
    phone: "8081634455",
    role: "Sales(cash & credit)",
    warehouse: "Head Office",
  },
  {
    id: "USER-77",
    firstname: "Ali",
    lastname: "Ishaq",
    email: "danzaki2008@gmail.com",
    phone: "8060249438",
    role: "Cashier 1",
    warehouse: "Head Office",
  },
  {
    id: "USER-78",
    firstname: "Baffa",
    lastname: "suleiman",
    email: "baffah1990@gmail.com",
    phone: "7032512600",
    role: "Separate invoices",
    warehouse: "Head Office",
  },
  {
    id: "USER-79",
    firstname: "Aminu",
    lastname: "Yau",
    email: "aminuyauyammusa@gmail.com",
    phone: "7063301608",
    role: "Sales (cash)",
    warehouse: "Head Office",
  },
  {
    id: "USER-80",
    firstname: "Umar",
    lastname: "Haruna",
    email: "omarharunaibrahim@gmail.com",
    phone: "8037374666",
    role: "Cashier 2",
    warehouse: "Head Office",
  },
  {
    id: "USER-81",
    firstname: "Muhammad",
    lastname: "Usman",
    email: "muhdusman4566@gmail.com",
    phone: "8035811739",
    role: "Record officer",
    warehouse: "Head Office",
  },
  {
    id: "USER-82",
    firstname: "Auwalu",
    lastname: "Abubakar",
    email: "awalababkar@gmail.com",
    phone: "8087716893",
    role: "Safe officer",
    warehouse: "Head Office",
  },
  {
    id: "USER-83",
    firstname: "Salisu",
    lastname: "Jafar",
    email: "salisujafargaro@gmail.com",
    phone: "7065964601",
    role: "Cashier",
    warehouse: "Head Office",
  },
  {
    id: "USER-84",
    firstname: "Sadiq",
    lastname: "Garba",
    email: "sgarbahezawa47@gmail.com",
    phone: "8060994784",
    role: "Cashier",
    warehouse: "Head Office",
  },
  {
    id: "USER-85",
    firstname: "lawan",
    lastname: "Usman",
    email: "lawanusmanm438@gmail.com",
    phone: "8062335787",
    role: "Gidan Yammusa store",
    warehouse: "Gidan Yammusa Store",
  },
  {
    id: "USER-86",
    firstname: "Dayyamu",
    lastname: "Ahmed",
    email: "dayyanuahmed1987@gmail.com",
    phone: "8036554596",
    role: "Jogana store",
    warehouse: "JOGANA STORE",
  },
  {
    id: "USER-87",
    firstname: "Kabiru",
    lastname: "Hamisu",
    email: "kabiruhamisuadam5@gmail.com",
    phone: "9056483535",
    role: "Gidan kifi store",
    warehouse: "Gidan Kifi Store",
  },
  {
    id: "USER-88",
    firstname: "Yusuf",
    lastname: "Muhammad",
    email: "yusufmuhammadibrahim@gmail.com",
    phone: "8030536016",
    role: "Shattimah store",
    warehouse: "Shattimah Stor",
  },
  {
    id: "USER-89",
    firstname: "Abdulsalam",
    lastname: "Bara'u",
    email: "barauaabdussalam@gmail.com",
    phone: "7033987431",
    role: "Gidan banki store",
    warehouse: "GIDAN BANKI",
  },
  {
    id: "USER-90",
    firstname: "Shaaibu",
    lastname: "Abdullahi",
    email: "shaaibuabdullahi999@gmail.com",
    phone: "8089812290",
    role: "Ali yammusa store",
    warehouse: "ALI YAMMUSA STORE",
  },
  {
    id: "USER-91",
    firstname: "Sani",
    lastname: "Bala",
    email: "yammusasani@gmail.com",
    phone: "7044174045",
    role: "Gidan idi kano store",
    warehouse: "Gidan Idi kano Store",
  },
  {
    id: "USER-92",
    firstname: "Yusuf",
    lastname: "Ishaq",
    email: "yishaq760@gmail.com",
    phone: "8039656094",
    role: "Danzaki store",
    warehouse: "DANZAKI STORE",
  },
  {
    id: "USER-93",
    firstname: "Yahaya",
    lastname: "Ubah",
    email: "yahayaubah2026@gmail.com",
    phone: "8037656229",
    role: "Gidan fata store",
    warehouse: "GIDAN FATA STORE",
  },
  {
    id: "USER-94",
    firstname: "Shuaibu",
    lastname: "musa",
    email: "shaiabumusaumar@gmail.com",
    phone: "8102686226",
    role: "Gidan tetalas store",
    warehouse: "Gidan tetalas Store",
  },
];

async function removeDemoUsers(qi, QT) {
  const idPlaceholders = DEMO_USER_IDS.map((_, i) => `:id${i}`).join(", ");
  const emailPlaceholders = DEMO_EMAILS.map((_, i) => `:em${i}`).join(", ");
  const idRepl = Object.fromEntries(
    DEMO_USER_IDS.map((id, i) => [`id${i}`, id]),
  );
  const emailRepl = Object.fromEntries(
    DEMO_EMAILS.map((em, i) => [`em${i}`, em]),
  );

  // Resolve all ids (by id or email) for this business
  const rows = await qi.sequelize.query(
    `SELECT DISTINCT u.id
       FROM users u
       LEFT JOIN membership m
         ON BINARY m.user_id = BINARY u.id
        AND BINARY m.business_id = BINARY :facilityId
      WHERE BINARY u.facilityId = BINARY :facilityId
        AND (
          u.id IN (${idPlaceholders})
          OR LOWER(u.email) IN (${emailPlaceholders})
        )`,
    {
      replacements: { facilityId: BUSINESS_ID, ...idRepl, ...emailRepl },
      type: QT.SELECT,
    },
  );

  const ids = rows.map((r) => r.id).filter(Boolean);
  if (!ids.length) return;

  for (const userId of ids) {
    await qi.sequelize.query(
      `DELETE FROM user_branches
        WHERE BINARY user_id = BINARY :userId
          AND BINARY facility_id = BINARY :facilityId`,
      {
        replacements: { userId, facilityId: BUSINESS_ID },
        type: QT.DELETE,
      },
    );
    await qi.sequelize.query(
      `DELETE FROM membership
        WHERE BINARY user_id = BINARY :userId
          AND BINARY business_id = BINARY :facilityId`,
      {
        replacements: { userId, facilityId: BUSINESS_ID },
        type: QT.DELETE,
      },
    );
    await qi.sequelize.query(
      `DELETE FROM users WHERE BINARY id = BINARY :userId`,
      { replacements: { userId }, type: QT.DELETE },
    );
  }
}

async function resolveWarehouseId(qi, QT, warehouseName) {
  const rows = await qi.sequelize.query(
    `SELECT id, branch_name
       FROM branches
      WHERE BINARY facilityId = BINARY :facilityId
        AND LOWER(TRIM(branch_name)) = LOWER(TRIM(:name))
      LIMIT 1`,
    {
      replacements: { facilityId: BUSINESS_ID, name: warehouseName },
      type: QT.SELECT,
    },
  );
  if (rows[0]?.id) return Number(rows[0].id);

  // Fallback: substring match (e.g. "Shattimah" ≈ "SHATTEEMAH STORE")
  const fuzzy = await qi.sequelize.query(
    `SELECT id, branch_name
       FROM branches
      WHERE BINARY facilityId = BINARY :facilityId
        AND (
          LOWER(branch_name) LIKE CONCAT('%', LOWER(:needle), '%')
          OR LOWER(:needle) LIKE CONCAT('%', LOWER(branch_name), '%')
        )
      ORDER BY LENGTH(branch_name) ASC
      LIMIT 1`,
    {
      replacements: {
        facilityId: BUSINESS_ID,
        needle: String(warehouseName).replace(/\s+store$/i, "").trim(),
      },
      type: QT.SELECT,
    },
  );
  return fuzzy[0]?.id ? Number(fuzzy[0].id) : null;
}

async function ensureRole(qi, QT, roleName) {
  const existing = await qi.sequelize.query(
    `SELECT id FROM roles
      WHERE BINARY facilityId = BINARY :facilityId
        AND LOWER(TRIM(name)) = LOWER(TRIM(:name))
      LIMIT 1`,
    {
      replacements: { facilityId: BUSINESS_ID, name: roleName },
      type: QT.SELECT,
    },
  );
  if (existing[0]?.id) return;

  await qi.sequelize.query(
    `INSERT INTO roles (name, description, facilityId, status, permissions, created_at, updated_at)
     VALUES (:name, :name, :facilityId, 'active', '{}', NOW(), NOW())`,
    {
      replacements: { name: roleName, facilityId: BUSINESS_ID },
      type: QT.INSERT,
    },
  );
}

async function upsertStaff(qi, QT, staff, branchId) {
  await ensureRole(qi, QT, staff.role);

  const existing = await qi.sequelize.query(
    `SELECT id FROM users WHERE BINARY id = BINARY :id LIMIT 1`,
    { replacements: { id: staff.id }, type: QT.SELECT },
  );

  if (existing[0]?.id) {
    await qi.sequelize.query(
      `UPDATE users
          SET firstname = :firstname,
              lastname = :lastname,
              email = :email,
              phone = :phone,
              role = :role,
              status = 'verified',
              facilityId = :facilityId,
              branchId = :branchId,
              updatedAt = NOW()
        WHERE BINARY id = BINARY :id`,
      {
        replacements: {
          id: staff.id,
          firstname: staff.firstname,
          lastname: staff.lastname,
          email: staff.email,
          phone: staff.phone,
          role: staff.role,
          facilityId: BUSINESS_ID,
          branchId,
        },
        type: QT.UPDATE,
      },
    );
  } else {
    // Skip if email/phone already owned by another id
    const clash = await qi.sequelize.query(
      `SELECT id FROM users
        WHERE LOWER(email) = LOWER(:email) OR phone = :phone
        LIMIT 1`,
      {
        replacements: { email: staff.email, phone: staff.phone },
        type: QT.SELECT,
      },
    );
    if (clash[0]?.id) {
      console.warn(
        `[seed-yammusa-staff] skip ${staff.id} — email/phone already on ${clash[0].id}`,
      );
      return;
    }

    await qi.sequelize.query(
      `INSERT INTO users
         (id, facilityId, firstname, lastname, email, phone, role, status, branchId, createdAt, updatedAt)
       VALUES
         (:id, :facilityId, :firstname, :lastname, :email, :phone, :role, 'verified', :branchId, NOW(), NOW())`,
      {
        replacements: {
          id: staff.id,
          facilityId: BUSINESS_ID,
          firstname: staff.firstname,
          lastname: staff.lastname,
          email: staff.email,
          phone: staff.phone,
          role: staff.role,
          branchId,
        },
        type: QT.INSERT,
      },
    );
  }

  const mem = await qi.sequelize.query(
    `SELECT user_id FROM membership
      WHERE BINARY business_id = BINARY :facilityId
        AND BINARY user_id = BINARY :userId
      LIMIT 1`,
    {
      replacements: { facilityId: BUSINESS_ID, userId: staff.id },
      type: QT.SELECT,
    },
  );

  if (mem[0]?.user_id) {
    await qi.sequelize.query(
      `UPDATE membership
          SET role = :role,
              email = :email,
              branch_id = :branchId
        WHERE BINARY business_id = BINARY :facilityId
          AND BINARY user_id = BINARY :userId`,
      {
        replacements: {
          role: staff.role,
          email: staff.email,
          branchId,
          facilityId: BUSINESS_ID,
          userId: staff.id,
        },
        type: QT.UPDATE,
      },
    );
  } else {
    await qi.sequelize.query(
      `INSERT INTO membership
         (business_id, user_id, access_to, role, functionalities, email, branch_id)
       VALUES
         (:facilityId, :userId, '', :role, '', :email, :branchId)`,
      {
        replacements: {
          facilityId: BUSINESS_ID,
          userId: staff.id,
          role: staff.role,
          email: staff.email,
          branchId,
        },
        type: QT.INSERT,
      },
    );
  }

  await qi.sequelize.query(
    `DELETE FROM user_branches
      WHERE BINARY user_id = BINARY :userId
        AND BINARY facility_id = BINARY :facilityId`,
    {
      replacements: { userId: staff.id, facilityId: BUSINESS_ID },
      type: QT.DELETE,
    },
  );
  await qi.sequelize.query(
    `INSERT INTO user_branches
       (user_id, branch_id, facility_id, is_primary, created_at, updated_at)
     VALUES
       (:userId, :branchId, :facilityId, 1, NOW(), NOW())`,
    {
      replacements: {
        userId: staff.id,
        branchId,
        facilityId: BUSINESS_ID,
      },
      type: QT.INSERT,
    },
  );
}

module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const QT = queryInterface.sequelize.QueryTypes;

    const biz = await queryInterface.sequelize.query(
      `SELECT id FROM business WHERE BINARY id = BINARY :id LIMIT 1`,
      { replacements: { id: BUSINESS_ID }, type: QT.SELECT },
    );
    if (!biz[0]?.id) {
      console.warn(
        "[seed-yammusa-staff] business not found — skipping seed",
      );
      return;
    }

    await removeDemoUsers(queryInterface, QT);

    let maxNum = 0;
    for (const staff of STAFF) {
      const branchId = await resolveWarehouseId(
        queryInterface,
        QT,
        staff.warehouse,
      );
      if (!branchId) {
        console.warn(
          `[seed-yammusa-staff] warehouse not found for ${staff.id}: ${staff.warehouse}`,
        );
        continue;
      }
      await upsertStaff(queryInterface, QT, staff, branchId);
      const n = parseInt(String(staff.id).replace(/^USER-/i, ""), 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }

    if (maxNum > 0) {
      await queryInterface.sequelize.query(
        `UPDATE number_generator
            SET code_no = GREATEST(COALESCE(code_no, 0), :maxNum)
          WHERE BINARY facilityId = BINARY :facilityId
            AND prefix = 'user'`,
        {
          replacements: { maxNum, facilityId: BUSINESS_ID },
          type: QT.UPDATE,
        },
      );
    }
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== "mysql" && dialect !== "mariadb") return;

    const QT = queryInterface.sequelize.QueryTypes;
    // Only remove seeded staff that still match these emails (do not restore demos).
    for (const staff of STAFF) {
      await queryInterface.sequelize.query(
        `DELETE FROM user_branches
          WHERE BINARY user_id = BINARY :userId
            AND BINARY facility_id = BINARY :facilityId`,
        {
          replacements: { userId: staff.id, facilityId: BUSINESS_ID },
          type: QT.DELETE,
        },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM membership
          WHERE BINARY user_id = BINARY :userId
            AND BINARY business_id = BINARY :facilityId`,
        {
          replacements: { userId: staff.id, facilityId: BUSINESS_ID },
          type: QT.DELETE,
        },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM users
          WHERE BINARY id = BINARY :userId
            AND LOWER(email) = LOWER(:email)`,
        {
          replacements: { userId: staff.id, email: staff.email },
          type: QT.DELETE,
        },
      );
    }
  },
};
