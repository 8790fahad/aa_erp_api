"""Repair phpMyAdmin dumps that replaced ';' with '$$' and truncated routines."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROUTINE_START = re.compile(
    r"^CREATE\s+(?:DEFINER\s*=\s*(?:`[^`]+`@`[^`]+`|[^\s]+)\s+)?"
    r"(PROCEDURE|FUNCTION|TRIGGER)\b",
    re.IGNORECASE | re.MULTILINE,
)

KEYWORD = re.compile(
    r"\b(END\s+IF|END\s+WHILE|END\s+LOOP|END\s+REPEAT|END\s+CASE|END\s+FOR|"
    r"BEGIN|END|ELSEIF|WHILE|REPEAT|CASE|LOOP|FOR|IF)\b",
    re.IGNORECASE,
)

ACCOUNT_REPORTS = r"""CREATE PROCEDURE `account_reports` (IN `in_query_type` VARCHAR(40), IN `in_from_date` VARCHAR(20), IN `in_to` VARCHAR(20), IN `in_facility_id` VARCHAR(50), IN `in_code` VARCHAR(20), IN `in_account_description` VARCHAR(50), IN `in_subhead` VARCHAR(50))
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
    INNER JOIN `account` a
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
END$$"""


def strip_literals(sql: str) -> str:
    out = []
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if ch == "-" and i + 1 < n and sql[i + 1] == "-":
            while i < n and sql[i] != "\n":
                i += 1
            continue
        if ch == "/" and i + 1 < n and sql[i + 1] == "*":
            i += 2
            while i + 1 < n and not (sql[i] == "*" and sql[i + 1] == "/"):
                i += 1
            i += 2
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            out.append(" ")
            while i < n:
                if sql[i] == "\\" and quote != "`":
                    i += 2
                    continue
                if sql[i] == quote:
                    if i + 1 < n and sql[i + 1] == quote:
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def closer_for(kind: str) -> str:
    return {
        "BEGIN": "END",
        "IF": "END IF",
        "WHILE": "END WHILE",
        "LOOP": "END LOOP",
        "REPEAT": "END REPEAT",
        "CASE": "END CASE",
        "FOR": "END FOR",
    }[kind]


def needed_closers(body: str) -> list[str]:
    text = strip_literals(body)
    stack: list[str] = []
    for match in KEYWORD.finditer(text):
        word = re.sub(r"\s+", " ", match.group(0)).upper()
        start = match.start()
        after = text[match.end() : match.end() + 8].lstrip()

        if word == "IF":
            if after.startswith("("):
                continue
            stack.append("IF")
            continue
        if word == "ELSEIF":
            continue
        if word == "BEGIN":
            stack.append("BEGIN")
            continue
        if word == "WHILE":
            stack.append("WHILE")
            continue
        if word == "REPEAT":
            stack.append("REPEAT")
            continue
        if word == "LOOP":
            stack.append("LOOP")
            continue
        if word == "FOR":
            stack.append("FOR")
            continue
        if word == "CASE":
            stack.append("CASE")
            continue
        if word == "END IF":
            if stack and stack[-1] == "IF":
                stack.pop()
            continue
        if word == "END WHILE":
            if stack and stack[-1] == "WHILE":
                stack.pop()
            continue
        if word == "END LOOP":
            if stack and stack[-1] == "LOOP":
                stack.pop()
            continue
        if word == "END REPEAT":
            if stack and stack[-1] == "REPEAT":
                stack.pop()
            continue
        if word == "END CASE":
            if stack and stack[-1] == "CASE":
                stack.pop()
            continue
        if word == "END FOR":
            if stack and stack[-1] == "FOR":
                stack.pop()
            continue
        if word == "END":
            if stack and stack[-1] == "CASE":
                stack.pop()
                continue
            if stack and stack[-1] == "BEGIN":
                stack.pop()
                continue
            continue
    return [closer_for(kind) for kind in reversed(stack)]


def close_routine(sql: str) -> str:
    sql = sql.rstrip()
    terminated = sql.endswith("$$")
    body = sql[:-2].rstrip() if terminated else sql
    body = re.sub(
        r"\bJOIN\s+((?:`[^`]+`|\w+))\s+where\b",
        r"JOIN \1 ON",
        body,
        flags=re.IGNORECASE,
    )
    closers = needed_closers(body)
    if closers:
        body = body.rstrip().rstrip(";")
        body += ";\n" + ";\n".join(closers)
    if not body.endswith("$$"):
        body += "$$"
    return body


def strip_definer(sql: str) -> str:
    return re.sub(
        r"CREATE\s+DEFINER\s*=\s*(?:`[^`]+`@`[^`]+`|[^\s]+)\s+",
        "CREATE ",
        sql,
        flags=re.IGNORECASE,
    )


def split_routines(section: str) -> list[str]:
    starts = [m.start() for m in ROUTINE_START.finditer(section)]
    if not starts:
        return [section]
    parts: list[str] = []
    if starts[0] > 0:
        parts.append(section[: starts[0]])
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(section)
        parts.append(section[start:end])
    return parts


def is_routine(chunk: str) -> bool:
    return bool(ROUTINE_START.match(chunk.lstrip()))


def routine_name(chunk: str) -> str | None:
    match = re.search(
        r"CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?PROCEDURE\s+`([^`]+)`",
        chunk,
        re.IGNORECASE,
    )
    return match.group(1) if match else None


def repair_dump(text: str) -> str:
    delim_start = re.search(r"^DELIMITER\s+\$\$\s*$", text, re.MULTILINE)
    delim_end = re.search(r"^DELIMITER\s+;\s*$", text, re.MULTILINE)
    if not delim_start or not delim_end or delim_end.start() < delim_start.end():
        raise SystemExit("Could not find DELIMITER $$ ... DELIMITER ; routine block")

    before = text[: delim_start.end()]
    section = text[delim_start.end() : delim_end.start()]
    after = text[delim_end.start() :]

    repaired: list[str] = []
    for chunk in split_routines(section):
        if not is_routine(chunk):
            repaired.append(chunk)
            continue
        name = routine_name(chunk)
        if name == "account_reports":
            prefix_nl = "" if not repaired else ""
            repaired.append("\n" + ACCOUNT_REPORTS + "\n\n")
            continue
        chunk = strip_definer(chunk)
        chunk = close_routine(chunk)
        if not chunk.endswith("\n"):
            chunk += "\n"
        if not chunk.endswith("\n\n"):
            chunk += "\n"
        repaired.append(chunk)

    return before + "".join(repaired) + after


def main() -> None:
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2]) if len(sys.argv) > 2 else src
    original = src.read_text(encoding="utf-8", errors="replace")
    fixed = repair_dump(original)
    dest.write_text(fixed, encoding="utf-8", newline="\n")
    print(f"Wrote {dest} ({len(fixed)} chars)")


if __name__ == "__main__":
    main()
