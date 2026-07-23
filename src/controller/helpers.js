const db = require("../models");

exports.getTxnVersionId = (callback=f=>f) => {
  db.sequelize
      .query("SELECT count(*) + 1 as version_id from transactions")
      .then((val) => {
        let version_id = val[0][0].version_id;
        callback(version_id)
      })
      .catch((err) => console.log(err));
}

exports.getAccountEntriesVersionId = (callback=f=>f) => {
  db.sequelize
      .query("SELECT count(*) + 1 as version_id from account_entries")
      .then((val) => {
        let version_id = val[0][0].version_id;
        callback(version_id)
      })
      .catch((err) => console.log(err));
}

exports.getStoreVersionId = (callback=f=>f) => {
  db.sequelize
      .query("SELECT count(*) + 1 as version_id from store")
      .then((val) => {
        let version_id = val[0][0].version_id;
        callback(version_id)
      })
      .catch((err) => console.log(err));
}