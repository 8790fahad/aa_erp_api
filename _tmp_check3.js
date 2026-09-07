const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({host:'localhost',user:'root',password:'',database:'aa_erp_db'});

  const [byType] = await conn.execute(
    "SELECT type, COUNT(*) AS cnt, SUM(dr) AS total_dr, SUM(cr) AS total_cr, SUM(dr-cr) AS net FROM general_ledger WHERE account_code = '112202' GROUP BY type ORDER BY net DESC"
  );
  console.log('By type for account_code=112202:');
  console.table ? console.table(byType) : console.log(JSON.stringify(byType, null, 2));

  // Check for duplicate transaction_ref (possible double-posting)
  const [dupRefs] = await conn.execute(
    "SELECT transaction_ref, COUNT(*) AS cnt, SUM(dr) AS total_dr FROM general_ledger WHERE account_code = '112202' AND transaction_ref IS NOT NULL AND transaction_ref <> '' GROUP BY transaction_ref HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 20"
  );
  console.log('Duplicate transaction_ref rows:', JSON.stringify(dupRefs, null, 2));

  // Sample largest individual dr entries
  const [top] = await conn.execute(
    "SELECT transaction_id, transaction_date, dr, cr, type, transaction_description, transaction_ref, reference_number FROM general_ledger WHERE account_code = '112202' ORDER BY dr DESC LIMIT 15"
  );
  console.log('Top dr entries:', JSON.stringify(top, null, 2));

  const [byCustomer] = await conn.execute(
    "SELECT transaction_description LIKE '%BRAINSTORM%' AS is_brainstorm, COUNT(*) AS cnt, SUM(dr) AS total_dr FROM general_ledger WHERE account_code = '112202' AND type = 'bank' GROUP BY is_brainstorm"
  );
  console.log('Brainstorm vs other bank rows:', JSON.stringify(byCustomer, null, 2));

  const [dateRange] = await conn.execute(
    "SELECT MIN(transaction_date) AS earliest, MAX(transaction_date) AS latest FROM general_ledger WHERE account_code = '112202' AND type='bank'"
  );
  console.log('Date range of bank entries:', JSON.stringify(dateRange, null, 2));

  await conn.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
