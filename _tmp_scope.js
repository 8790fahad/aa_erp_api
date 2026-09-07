const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({host:'localhost',user:'root',password:'',database:'aa_erp_db'});

  const [customers] = await conn.execute(
    "SELECT customerNo, fullname, facilityId, createdAt FROM customers WHERE fullname LIKE '%BRAINSTORM%'"
  );
  console.log('Customer rows:', JSON.stringify(customers, null, 2));

  if (customers.length) {
    const custNo = customers[0].customerNo;

    const [invoices] = await conn.execute(
      "SELECT invoice_ref, amount, type, created_at FROM invoices WHERE customerNo = ? ORDER BY created_at",
      [custNo]
    );
    console.log('Invoices count:', invoices.length, JSON.stringify(invoices, null, 2));

    const [glAll] = await conn.execute(
      "SELECT type, COUNT(*) AS cnt, SUM(dr) AS total_dr, SUM(cr) AS total_cr FROM general_ledger WHERE transaction_description LIKE '%BRAINSTORM%' GROUP BY type"
    );
    console.log('All GL entries referencing BRAINSTORM (any account):', JSON.stringify(glAll, null, 2));

    const [glAccounts] = await conn.execute(
      "SELECT account_code, COUNT(*) AS cnt, SUM(dr) AS total_dr, SUM(cr) AS total_cr FROM general_ledger WHERE transaction_description LIKE '%BRAINSTORM%' GROUP BY account_code"
    );
    console.log('GL by account_code referencing BRAINSTORM:', JSON.stringify(glAccounts, null, 2));

    // Also check payee/party fields in case description doesn't cover everything
    const [glByPayee] = await conn.execute(
      "SELECT account_code, type, COUNT(*) AS cnt, SUM(dr) AS total_dr, SUM(cr) AS total_cr FROM general_ledger WHERE payee LIKE '%BRAINSTORM%' GROUP BY account_code, type"
    );
    console.log('GL by payee referencing BRAINSTORM:', JSON.stringify(glByPayee, null, 2));
  }

  // sale_workflows table columns + rows referencing brainstorm invoices
  const [swCols] = await conn.execute("SHOW COLUMNS FROM sale_workflows");
  console.log('sale_workflows columns:', swCols.map(c=>c.Field).join(', '));

  await conn.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
