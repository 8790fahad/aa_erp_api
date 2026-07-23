const db = require("../models");
const moment = require("moment");

/**
 * Production costing waste GL defaults live on `business`:
 * - `abnormal_loss_account` — abnormal waste expense (DR)
 * - `scrap_inventory_account` — recyclable / by-product inventory (DR)
 *
 * Staff configure them in the web app: Account Settings cards
 * “Abnormal Loss” and “Scrap Inventory” (anchors `#production-abnormal-loss-account`,
 * `#production-scrap-inventory-account`).
 *
 * Persisted via `POST /account/update-payable-code/:head/:facilityId/:user_id`
 * with `query_type=Abnormal Loss` or `query_type=Scrap Inventory`
 * — see `exports.updatePayableCode` in `controller/account.js`.
 */

exports.createBranch = (req, res) => {
    const {   _id,storename ,phone,storelocation ,storetype ,storeName,address,storeType,createdAt,facilityID,userId } = req.body;
    db.sequelize
      .query(
        "CALL create_branch(:po_no,:item_name,:old_price,:expiring_date,:new_price,:new_balance)",
        {
          replacements: {
            po_no,
            item_name,
            old_price: unit_price,
            new_price,
            expiring_date,
            query_type,
            new_balance,
            balance
          },
        }
      )
      .then((results) => res.json({ success: true, results }))
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
  };