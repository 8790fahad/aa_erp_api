const db = require("../models");

exports.getPendingItems = (req, res) => {
  const { facilityId, store } = req.params;
  db.sequelize
    .query("call get_pending_items(:store,:facilityId)", {
      replacements: { store, facilityId },
    })
    .then((results) => res.json({ results: results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updatePendingItems = (req, res) => {
  const { id, trn_number,query_type, facilityId } = req.params;
  db.sequelize
    .query("call update_pending_items(:id,:trn_number, :facilityId,:query_type)", {
      replacements: { id:parseInt(id), trn_number:parseInt(trn_number), facilityId,query_type },
    })
    .then((results) => res.json({status:true, results: results}))
    .catch((err) => res.status(500).json({ err }));
};
