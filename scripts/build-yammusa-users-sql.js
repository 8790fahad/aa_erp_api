const fs = require("fs");
const path = require("path");

const tablesDump = process.argv[2];
const outFile = process.argv[3];
const FACILITY = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";

const NAMES = {
  4: { firstname: "Admin", lastname: "User", phone: "08106871760" },
  "USER-73": { firstname: "Ashiru", lastname: "Ali Muhammed", phone: "8144444220" },
  "USER-74": { firstname: "Anas", lastname: "Ali Muhammed", phone: "8060162673" },
  "USER-75": { firstname: "Mansur", lastname: "Yusuf", phone: "8145685493" },
  "USER-76": { firstname: "Aliyu", lastname: "Ashiru", phone: "8081634455" },
  "USER-77": { firstname: "Ali", lastname: "Ishaq", phone: "8060249438" },
  "USER-78": { firstname: "Baffa", lastname: "suleiman", phone: "7032512600" },
  "USER-79": { firstname: "Aminu", lastname: "Yau", phone: "7063301608" },
  "USER-80": { firstname: "Umar", lastname: "Haruna", phone: "8037374666" },
  "USER-81": { firstname: "Muhammad", lastname: "Usman", phone: "8035811739" },
  "USER-82": { firstname: "Auwalu", lastname: "Abubakar", phone: "8087716893" },
  "USER-83": { firstname: "Salisu", lastname: "Jafar", phone: "7065964601" },
  "USER-84": { firstname: "Sadiq", lastname: "Garba", phone: "8060994784" },
  "USER-86": { firstname: "Dayyamu", lastname: "Ahmed", phone: "8036554596" },
  "USER-87": { firstname: "Kabiru", lastname: "Hamisu", phone: "9056483535" },
  "USER-89": { firstname: "Abdulsalam", lastname: "Bara'u", phone: "7033987431" },
  "USER-90": { firstname: "Shaaibu", lastname: "Abdullahi", phone: "8089812290" },
  "USER-91": { firstname: "Sani", lastname: "Bala", phone: "7044174045" },
  "USER-92": { firstname: "Yusuf", lastname: "Ishaq", phone: "8039656094" },
  "USER-93": { firstname: "Yahaya", lastname: "Ubah", phone: "8037656229" },
  "USER-102": { firstname: "Idris", lastname: "Danzaki", phone: "08000000102" },
  "USER-103": { firstname: "Shafiu", lastname: "Iliyasu", phone: "08000000103" },
  "USER-104": { firstname: "Musa", lastname: "Idris", phone: "08000000104" },
  "USER-105": { firstname: "Yusuf", lastname: "Muhammad", phone: "8030536016" },
  "USER-106": { firstname: "Bello", lastname: "Hafiz", phone: "08000000106" },
  "USER-107": { firstname: "Fahad", lastname: "Ado", phone: "08000000107" },
  "USER-108": { firstname: "Shuaibu", lastname: "Musa", phone: "8102686226" },
  "USER-109": { firstname: "Lawan", lastname: "Usman", phone: "8062335787" },
  "USER-110": { firstname: "Fahad", lastname: "Saleh", phone: "08000000110" },
  "USER-111": { firstname: "Mansur", lastname: "Muhammad", phone: "08000000111" },
  "USER-112": { firstname: "Muttaka", lastname: "Adamasi", phone: "08000000112" },
  "USER-113": { firstname: "Munzali", lastname: "Muktar", phone: "08000000113" },
};

const VALID_BRANCHES = new Set([45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 123, 124]);
const DEFAULT_BRANCH = 57;

function esc(v) {
  if (v == null) return "NULL";
  return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

const sql = fs.readFileSync(tablesDump, "utf8");
const memMatch = sql.match(
  /INSERT INTO `membership`[\s\S]*?VALUES\s*([\s\S]*?);\s*\n\s*-- -{10,}/,
);
if (!memMatch) throw new Error("membership INSERT not found");

const rows = [];
const tupleRe =
  /\('094c6e1e-dd07-48c4-a344-6e9d58cd7861',\s*'([^']+)',\s*'([^']*)'([\s\S]*?),\s*(NULL|'[^']*'),\s*'([^']+@[^']+)',\s*(\d+|NULL)\)/g;
let m;
while ((m = tupleRe.exec(memMatch[1]))) {
  const roleRaw = m[4];
  rows.push({
    id: m[1],
    createdAt: m[2],
    role: roleRaw === "NULL" ? "staff" : roleRaw.slice(1, -1),
    email: m[5],
    branchId: m[6] === "NULL" ? DEFAULT_BRANCH : Number(m[6]),
  });
}

if (!rows.length) throw new Error("no membership rows parsed");

const users = rows.map((r, i) => {
  const named = NAMES[r.id] || {};
  const email = r.email || `${r.id.toLowerCase()}@yammusa.local`;
  let branchId = VALID_BRANCHES.has(r.branchId) ? r.branchId : DEFAULT_BRANCH;
  const local = email.split("@")[0];
  return {
    id: r.id,
    firstname: named.firstname || local,
    lastname: named.lastname || "",
    role: r.role || "staff",
    email,
    phone: named.phone || `0809${String(1000000 + i).slice(-7)}`,
    createdAt: r.createdAt || "2026-08-26 15:24:50",
    branchId,
  };
});

const userValues = users
  .map(
    (u) =>
      `(${esc(u.id)}, ${esc(u.firstname)}, ${esc(u.lastname)}, ${esc(u.role)}, NULL, ${esc(u.email)}, NULL, 'verified', NULL, ${esc(u.phone)}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${esc(u.createdAt)}, NOW(), ${esc(FACILITY)}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${u.branchId}, NULL, 1)`,
  )
  .join(",\n");

const ubValues = users
  .map(
    (u, i) =>
      `(${i + 1}, ${esc(u.id)}, ${u.branchId}, ${esc(FACILITY)}, 1, ${esc(u.createdAt)}, NOW())`,
  )
  .join(",\n");

const out = `-- flowbooks_db — USERS (missing from truncated dump)
-- Import after flowbooks_tables.sql
-- Rebuilt from membership + known Yammusa staff names.
-- Passwords are empty: use Forgot password, or re-export the users table from Brainstorm.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`users\` (
  \`id\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`firstname\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`lastname\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`role\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`username\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`email\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`password\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`status\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`address\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`phone\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`paymentMethod\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`paymentAmount\` int DEFAULT NULL,
  \`referralId\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`lastLogin\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`image\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`verificationToken\` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`verificationExpires\` datetime DEFAULT NULL,
  \`createdAt\` datetime NOT NULL,
  \`updatedAt\` datetime NOT NULL,
  \`facilityId\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`createdBy\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`department\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`branch_name\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`code\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`expiring_code\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`busName\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`businessType\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`appExpiry\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`licenseExpiry\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`expiring_date\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`store\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`departmentId\` int DEFAULT NULL,
  \`teamId\` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`signature\` longtext COLLATE utf8mb4_unicode_ci,
  \`branchId\` int DEFAULT NULL,
  \`cashier_type\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`allow_after_hours_login\` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (\`id\`,\`facilityId\`),
  UNIQUE KEY \`email\` (\`email\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`users_role\` (
  \`id\` int NOT NULL,
  \`roles\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`user_status\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`status_to\` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`user_branches\` (
  \`id\` int NOT NULL,
  \`user_id\` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`branch_id\` int NOT NULL,
  \`facility_id\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`is_primary\` tinyint(1) NOT NULL DEFAULT 0,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uniq_user_branch\` (\`user_id\`,\`branch_id\`,\`facility_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO \`users\` (\`id\`, \`firstname\`, \`lastname\`, \`role\`, \`username\`, \`email\`, \`password\`, \`status\`, \`address\`, \`phone\`, \`paymentMethod\`, \`paymentAmount\`, \`referralId\`, \`lastLogin\`, \`image\`, \`verificationToken\`, \`verificationExpires\`, \`createdAt\`, \`updatedAt\`, \`facilityId\`, \`createdBy\`, \`department\`, \`branch_name\`, \`code\`, \`expiring_code\`, \`busName\`, \`businessType\`, \`appExpiry\`, \`licenseExpiry\`, \`expiring_date\`, \`store\`, \`departmentId\`, \`teamId\`, \`signature\`, \`branchId\`, \`cashier_type\`, \`allow_after_hours_login\`) VALUES
${userValues};

INSERT INTO \`user_branches\` (\`id\`, \`user_id\`, \`branch_id\`, \`facility_id\`, \`is_primary\`, \`created_at\`, \`updated_at\`) VALUES
${ubValues};

INSERT IGNORE INTO \`users_role\` (\`id\`, \`roles\`, \`user_status\`, \`status_to\`) VALUES
(1, 'Admin', 'pending', 'Sale agent approved'),
(2, 'Admin', 'Sale agent approved', 'Approved'),
(3, 'Admin', 'Approved', 'Dispatched'),
(4, 'Admin', 'Dispatched', 'Delivered'),
(5, 'Sale Agent', 'pending', 'Sale agent approved'),
(6, 'Warehouse Manager', 'Sale agent approved', 'Approved'),
(7, 'Dispatch', 'Approved', 'Dispatched'),
(9, 'Dispatch', 'Dispatched', 'Delivered'),
(10, 'Business', 'Delivered', 'Received'),
(11, 'Warehouse Manager', 'Received', 'Completed');

COMMIT;
`;

fs.writeFileSync(outFile, out);
console.log(JSON.stringify({ users: users.length, file: outFile, ids: users.map((u) => u.id) }, null, 2));
