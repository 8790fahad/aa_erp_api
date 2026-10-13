const db = require("../src/models");
const { Op } = require("sequelize");

(async () => {
  try {
    const n = await db.SaleFulfillment.count({
      where: {
        facility_id: "094c6e1e-dd07-48c4-a344-6e9d58cd7861",
        sale_code: "INV-2056",
        printed_at: { [Op.ne]: null },
      },
    });
    console.log("count", n);
  } catch (e) {
    console.error("ERR", e && e.stack ? e.stack : e);
  }
  process.exit(0);
})();
