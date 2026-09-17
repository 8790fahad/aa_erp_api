const fs = require("fs");

const KEYWORD =
  /\b(END\s+IF|END\s+WHILE|END\s+LOOP|END\s+REPEAT|END\s+CASE|END\s+FOR|BEGIN|END|ELSEIF|WHILE|REPEAT|CASE|LOOP|FOR|IF)\b/gi;

const ROUTINE_START =
  /^CREATE\s+(?:DEFINER\s*=\s*(?:`[^`]+`@`[^`]+`|[^\s]+)\s+)?(PROCEDURE|FUNCTION|TRIGGER)\b/im;

const ACCOUNT_REPORTS = `CREATE PROCEDURE \`account_reports\` (IN \`in_query_type\` VARCHAR(40), IN \`in_from_date\` VARCHAR(20), IN \`in_to\` VARCHAR(20), IN \`in_facility_id\` VARCHAR(50), IN \`in_code\` VARCHAR(20), IN \`in_account_description\` VARCHAR(50), IN \`in_subhead\` VARCHAR(50))
BEGIN
  IF in_query_type = 'Trial_Balance' THEN
    SELECT
      a.description,
      gl.account_code,
      gl.account_subhead,
      CASE
        WHEN (SUM(gl.cr) - SUM(gl.dr)) < 0 THEN ROUND(ABS(SUM(gl.cr) - SUM(gl.dr)), 2)
        ELSE 0.00
      END AS debit,
      CASE
        WHEN (SUM(gl.cr) - SUM(gl.dr)) > 0 THEN ROUND(SUM(gl.cr) - SUM(gl.dr), 2)
        ELSE 0.00
      END AS credit
    FROM general_ledger gl
    INNER JOIN \`account\` a
      ON a.head = gl.account_subhead
     AND a.facilityId = in_facility_id
    WHERE gl.facility_id = in_facility_id
    GROUP BY a.description, gl.account_code, gl.account_subhead, a.head
    HAVING debit > 0 OR credit > 0
    ORDER BY a.head;

  ELSEIF in_query_type = 'individual_ledger' THEN
    SELECT
      gl.transaction_date,
      gl.account_code,
      gl.account_description,
      gl.dr AS debit,
      gl.cr AS credit,
      (
        SELECT ROUND(SUM(g2.dr - g2.cr), 2)
        FROM general_ledger g2
        WHERE g2.facility_id = gl.facility_id
          AND g2.account_subhead = gl.account_subhead
          AND (
            g2.transaction_date < gl.transaction_date
            OR (
              g2.transaction_date = gl.transaction_date
              AND g2.transaction_id <= gl.transaction_id
            )
          )
      ) AS balance
    FROM general_ledger gl
    WHERE gl.facility_id = in_facility_id
      AND gl.account_subhead = in_subhead
    ORDER BY gl.transaction_date, gl.transaction_id;

  ELSEIF in_query_type = 'supplier_individual_ledger' THEN
    SELECT
      gl.transaction_date,
      gl.account_code,
      gl.account_description,
      gl.dr AS debit,
      gl.cr AS credit,
      (
        SELECT ROUND(SUM(g2.dr - g2.cr), 2)
        FROM general_ledger g2
        WHERE g2.facility_id = gl.facility_id
          AND g2.account_code = gl.account_code
          AND (
            g2.transaction_date < gl.transaction_date
            OR (
              g2.transaction_date = gl.transaction_date
              AND g2.transaction_id <= gl.transaction_id
            )
          )
      ) AS balance
    FROM general_ledger gl
    WHERE gl.facility_id = in_facility_id
      AND gl.account_code = in_code
    ORDER BY gl.transaction_date, gl.transaction_id;
  END IF;
END$$`;

function stripLiterals(sql) {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i + 1 < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      out += " ";
      while (i < sql.length) {
        if (sql[i] === "\\" && quote !== "`") {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      i--;
      continue;
    }
    out += ch;
  }
  return out;
}

function closerFor(kind) {
  return {
    BEGIN: "END",
    IF: "END IF",
    WHILE: "END WHILE",
    LOOP: "END LOOP",
    REPEAT: "END REPEAT",
    CASE: "END CASE",
    FOR: "END FOR",
  }[kind];
}

function neededClosers(body) {
  const text = stripLiterals(body);
  const stack = [];
  KEYWORD.lastIndex = 0;
  let match;
  while ((match = KEYWORD.exec(text))) {
    const word = match[0].replace(/\s+/g, " ").toUpperCase();
    const after = text.slice(match.index + match[0].length).trimStart();

    if (word === "IF") {
      if (after.startsWith("(") && !/^\([\s\S]{0,400}?\)\s*THEN\b/i.test(after)) {
        continue;
      }
      stack.push("IF");
    } else if (word === "ELSEIF") {
      continue;
    } else if (word === "BEGIN") {
      stack.push("BEGIN");
    } else if (word === "WHILE") {
      stack.push("WHILE");
    } else if (word === "REPEAT") {
      stack.push("REPEAT");
    } else if (word === "LOOP") {
      stack.push("LOOP");
    } else if (word === "FOR") {
      if (/^EACH\s+ROW\b/i.test(after)) continue;
      stack.push("FOR");
    } else if (word === "CASE") {
      stack.push("CASE");
    } else if (word === "END IF") {
      if (stack[stack.length - 1] === "IF") stack.pop();
    } else if (word === "END WHILE") {
      if (stack[stack.length - 1] === "WHILE") stack.pop();
    } else if (word === "END LOOP") {
      if (stack[stack.length - 1] === "LOOP") stack.pop();
    } else if (word === "END REPEAT") {
      if (stack[stack.length - 1] === "REPEAT") stack.pop();
    } else if (word === "END CASE") {
      if (stack[stack.length - 1] === "CASE") stack.pop();
    } else if (word === "END FOR") {
      if (stack[stack.length - 1] === "FOR") stack.pop();
    } else if (word === "END") {
      const top = stack[stack.length - 1];
      if (top === "CASE" || top === "BEGIN") stack.pop();
    }
  }
  return stack.reverse().map(closerFor);
}

function closeRoutine(sql) {
  let body = sql.replace(/\s+$/, "");
  if (body.endsWith("$$")) body = body.slice(0, -2).replace(/\s+$/, "");
  body = body.replace(/\bJOIN\s+((?:`[^`]+`|\w+))\s+where\b/gi, "JOIN $1 ON");
  const closers = neededClosers(body);
  if (closers.length) {
    body = body.replace(/[;\s]+$/, "");
    body += ";\n" + closers.join(";\n");
  }
  if (!body.endsWith("$$")) body += "$$";
  return body;
}

function stripDefiner(sql) {
  return sql.replace(
    /CREATE\s+DEFINER\s*=\s*(?:`[^`]+`@`[^`]+`|[^\s]+)\s+/gi,
    "CREATE ",
  );
}

function splitRoutines(section) {
  const re =
    /^CREATE\s+(?:DEFINER\s*=\s*(?:`[^`]+`@`[^`]+`|[^\s]+)\s+)?(PROCEDURE|FUNCTION|TRIGGER)\b/gim;
  const starts = [];
  let m;
  while ((m = re.exec(section))) starts.push(m.index);
  if (!starts.length) return [section];
  const parts = [];
  if (starts[0] > 0) parts.push(section.slice(0, starts[0]));
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : section.length;
    parts.push(section.slice(starts[i], end));
  }
  return parts;
}

function isRoutine(chunk) {
  return ROUTINE_START.test(chunk.trimStart());
}

function routineName(chunk) {
  const m = chunk.match(
    /CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?PROCEDURE\s+`([^`]+)`/i,
  );
  return m ? m[1] : null;
}

function repairSection(section) {
  const repaired = [];
  for (const chunk of splitRoutines(section)) {
    if (!isRoutine(chunk)) {
      repaired.push(chunk);
      continue;
    }
    if (routineName(chunk) === "account_reports") {
      repaired.push("\n" + ACCOUNT_REPORTS + "\n\n");
      continue;
    }
    let next = closeRoutine(stripDefiner(chunk));
    if (!next.endsWith("\n")) next += "\n";
    if (!next.endsWith("\n\n")) next += "\n";
    repaired.push(next);
  }
  return repaired.join("");
}

function repairDump(text) {
  const starts = [...text.matchAll(/^DELIMITER\s+\$\$\s*$/gm)];
  if (!starts.length) {
    throw new Error("Could not find DELIMITER $$ ... DELIMITER ; routine block");
  }

  let out = "";
  let cursor = 0;
  for (const start of starts) {
    const startIdx = start.index + start[0].length;
    const afterStart = text.slice(startIdx);
    const endMatch = afterStart.match(/^DELIMITER\s+;\s*$/m);
    if (!endMatch) {
      throw new Error("Could not find closing DELIMITER ; after routines");
    }
    const endIdx = startIdx + endMatch.index;
    out += text.slice(cursor, startIdx);
    out += repairSection(text.slice(startIdx, endIdx));
    cursor = endIdx;
  }
  return out + text.slice(cursor);
}

const src = process.argv[2];
const dest = process.argv[3] || src;
const original = fs.readFileSync(src, "utf8");
const fixed = repairDump(original);
fs.writeFileSync(dest, fixed, "utf8");
console.log(`Wrote ${dest} (${fixed.length} chars)`);
