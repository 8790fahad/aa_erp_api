const fs = require("fs");
const path = require("path");

const src = process.argv[2];
const outDir = process.argv[3] || path.dirname(src);
const sql = fs.readFileSync(src, "utf8");
const lines = sql.split(/\r?\n/);

function isDelimDollar(line) {
  return /^\s*DELIMITER\s+\$\$\s*$/i.test(line);
}
function isDelimSemi(line) {
  return /^\s*DELIMITER\s+;\s*$/i.test(line);
}
function isCreateTrigger(line) {
  return /^\s*CREATE\s+TRIGGER\b/i.test(line);
}
function isCreateProc(line) {
  return /^\s*CREATE\s+(DEFINER=.+\s+)?PROCEDURE\b/i.test(line);
}

let firstDelim = lines.findIndex(isDelimDollar);
if (firstDelim < 0) throw new Error("No DELIMITER $$ found");
let procEnd = -1;
for (let i = firstDelim + 1; i < lines.length; i++) {
  if (isDelimSemi(lines[i])) {
    procEnd = i;
    break;
  }
}
if (procEnd < 0) throw new Error("Procedure block has no closing DELIMITER ;");

const header = lines.slice(0, firstDelim);
const proceduresBody = lines.slice(firstDelim, procEnd + 1);
const rest = lines.slice(procEnd + 1);

const tables = [];
const triggers = [];
let i = 0;
while (i < rest.length) {
  const line = rest[i];
  let look = i;
  while (look < rest.length && /^\s*$/.test(rest[look])) look++;
  let commentStart = look;
  if (
    look < rest.length &&
    rest[look].trim() === "--" &&
    look + 1 < rest.length &&
    /^-- Triggers\b/i.test(rest[look + 1])
  ) {
    look += 3;
    while (look < rest.length && /^\s*$/.test(rest[look])) look++;
  }
  if (look < rest.length && isDelimDollar(rest[look])) {
    let j = look + 1;
    while (j < rest.length && /^\s*$/.test(rest[j])) j++;
    if (j < rest.length && isCreateTrigger(rest[j])) {
      let k = look;
      while (k < rest.length && !isDelimSemi(rest[k])) k++;
      if (k >= rest.length) throw new Error("Trigger missing DELIMITER ;");
      const block = rest.slice(i, k + 1);
      triggers.push(...block, "");
      i = k + 1;
      continue;
    }
  }
  tables.push(line);
  i++;
}

const prelude = [
  ...header,
  "",
  "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
  "SET time_zone = '+00:00';",
  "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;",
  "",
].join("\n");

function wrap(title, bodyLines) {
  return [
    `-- flowbooks_db — ${title}`,
    `-- Import after tables exist (except the tables file).`,
    `-- Use utf8mb4_unicode_ci (MariaDB 10.4 compatible).`,
    "",
    "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;",
    "",
    bodyLines.join("\n").replace(/\n{3,}/g, "\n\n"),
    "",
  ].join("\n");
}

const tablesOut = [
  `-- flowbooks_db — TABLES (structure + data + indexes)`,
  `-- Import FIRST.`,
  "",
  ...header,
  "",
  tables.join("\n").replace(/\n{3,}/g, "\n\n"),
  "",
].join("\n");

const procOut = wrap("PROCEDURES", proceduresBody);
const trigOut = wrap("TRIGGERS", triggers);

const tFile = path.join(outDir, "flowbooks_tables.sql");
const pFile = path.join(outDir, "flowbooks_procedures.sql");
const gFile = path.join(outDir, "flowbooks_triggers.sql");
fs.writeFileSync(tFile, tablesOut);
fs.writeFileSync(pFile, procOut);
fs.writeFileSync(gFile, trigOut);

function kb(n) {
  return (n / 1024).toFixed(1);
}
console.log(
  JSON.stringify(
    {
      procedures: { file: pFile, kb: kb(Buffer.byteLength(procOut)), lines: procOut.split("\n").length },
      tables: { file: tFile, kb: kb(Buffer.byteLength(tablesOut)), lines: tablesOut.split("\n").length },
      triggers: { file: gFile, kb: kb(Buffer.byteLength(trigOut)), lines: trigOut.split("\n").length, count: (trigOut.match(/CREATE TRIGGER/gi) || []).length },
    },
    null,
    2,
  ),
);
