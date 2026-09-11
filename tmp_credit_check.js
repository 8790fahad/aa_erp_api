const db = require("./src/models");

(async () => {
  const fid = "094c6e1e-dd07-48c4-a344-6e9d58cd7861";
  const rows = await db.sequelize.query(
    `SELECT payment_type, status, amount, sale_code, assigned_cashier_id, created_by
     FROM sale_workflows
     WHERE facility_id = :fid AND DATE(created_at) = '2026-09-10'
     ORDER BY id DESC LIMIT 40`,
    {
      replacements: { fid },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
