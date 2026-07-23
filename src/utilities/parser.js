const fs = require("fs");
const pdf2table = require("pdf2table");

exports.extractStatementOfAccount = async (pdfFilePath) => {
  // date format supported e.g. 04-May-2025,08-NOV-24, 04/May/2025
  const dateRegex = /^(\d{2})[-\/](?:[A-Za-z]{3,})[-\/](\d{2}|\d{4})$/;
  return new Promise((resolve, reject) => {
    fs.readFile(pdfFilePath, (err, buffer) => {
      if (err) return reject(err);

      pdf2table.parse(buffer, (err, rows) => {
        if (err) return reject(err);
console.log(rows)
        const dataRows = rows.filter((row) => dateRegex.test(row[0]?.trim()));
        const result = [];

        let prevBalance = null;

        for (const row of dataRows) {
          const date = row[0]?.trim();
          const valueDate = row[1]?.trim();

          const narration = row[2]?.trim() || "";
          const reference = row.length >= 6 ? row[3]?.trim() : "";

          const description = reference
            ? `${narration} - ${reference}`
            : narration;

          const amountStr = row[row.length - 2]?.trim(); // second-to-last
          const balanceStr = row[row.length - 1]?.trim(); // last

          const amount = amountStr
            ? parseFloat(amountStr.replace(/,/g, ""))
            : null;
          const balance = balanceStr
            ? parseFloat(balanceStr.replace(/,/g, ""))
            : null;

          let debit = null;
          let credit = null;

          if (amount !== null && balance !== null) {
            if (prevBalance === null) {
              credit = amount;
            } else if (balance < prevBalance) {
              debit = amount;
            } else if (balance > prevBalance) {
              credit = amount;
            }
          }

          result.push({
            date,
            valueDate,
            description,
            debit,
            credit,
            balance,
          });

          prevBalance = balance;
        }

        resolve(result);
      });
    });
  });
};
