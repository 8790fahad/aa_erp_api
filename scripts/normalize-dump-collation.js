const fs = require("fs");

const file = process.argv[2];
let sql = fs.readFileSync(file, "utf8");

const collations = [
  "utf8mb4_0900_ai_ci",
  "utf8mb4_0900_as_ci",
  "utf8mb4_0900_bin",
  "utf8mb4_general_ci",
  "utf8mb4_bin",
  "utf8mb4_unicode_520_ci",
  "utf8_general_ci",
  "utf8_unicode_ci",
  "utf8_bin",
  "latin1_swedish_ci",
  "latin1_bin",
  "latin1_general_ci",
];

for (const from of collations) {
  sql = sql.split(from).join("utf8mb4_unicode_ci");
}

sql = sql.replace(/CHARACTER SET latin1\b/gi, "CHARACTER SET utf8mb4");
sql = sql.replace(/CHARSET=latin1\b/gi, "CHARSET=utf8mb4");
sql = sql.replace(/CHARSET latin1\b/gi, "CHARSET utf8mb4");
sql = sql.replace(/\bSET latin1\b/gi, "SET utf8mb4");

// Tables that had CHARSET=latin1 with no COLLATE
sql = sql.replace(
  /ENGINE=(\w+) DEFAULT CHARSET=utf8mb4(?! COLLATE)/g,
  "ENGINE=$1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
);
sql = sql.replace(
  /ENGINE=(\w+) DEFAULT CHARSET=utf8mb4;/g,
  "ENGINE=$1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;",
);

sql = sql.replace(
  /SET NAMES utf8mb4\s*;/,
  "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;",
);

sql = sql.replace(
  /\nALTER DATABASE `([^`]+)` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\s*/g,
  "\n",
);
if (!/CREATE DATABASE IF NOT EXISTS/i.test(sql)) {
  sql = sql.replace(
    /(--\s*\n-- Database: `([^`]+)`\s*\n--)/,
    `$1\n\nCREATE DATABASE IF NOT EXISTS \`$2\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nUSE \`$2\`;`,
  );
}

fs.writeFileSync(file, sql, "utf8");

const leftover = [];
for (const name of [
  "latin1",
  "utf8mb4_general_ci",
  "utf8mb4_bin",
  "utf8mb4_0900",
  "latin1_swedish",
  "latin1_bin",
]) {
  const n = (sql.match(new RegExp(name, "g")) || []).length;
  if (n) leftover.push(`${name}=${n}`);
}
console.log("normalized", file);
console.log("leftover", leftover.join(", ") || "none");
console.log("size_kb", (Buffer.byteLength(sql) / 1024).toFixed(1));
