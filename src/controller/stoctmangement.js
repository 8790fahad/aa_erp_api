const db = require("../models");
const moment = require("moment");

exports.newService = (req, res) => {
  const {
    description = "",
    service_cost = "",
    percentage = "",
    query_type = "",
    id = "",
  } = req.body;
  // console.log({ body: req.body });
  db.sequelize
    .query(
      `call add_new_service (:description,:service_cost,:percentage,:query_type,:id)`,
      {
        replacements: {
          description,
          service_cost,
          percentage,
          query_type,
          id,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.Getservice = (req, res) => {
  let sql = "SELECT * FROM service_list";
  db.sequelize
    .query(sql)
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.GetserviceById = (req, res) => {
  const { id } = req.params;
  let sql = `SELECT * FROM service_list  where id = ${id}`;
  db.sequelize
    .query(sql)
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.Delete = (req, res) => {
  db.sequelize
    .query(
      `call add_new_service (:description,:service_cost,:service_fee,:in_query_type)`
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.postServiceDelivery = (req, res) => {
  // console.log(req.body);

  const {
    barber_name = "",
    barber_phone = "",
    barber_date = "",
    barber_address = "",
    barber_role = "",
    query_type = "",
    id = "",
  } = req.body;
  const { data, type,facilityId='' } = req.body;

  // console.log({ body: req.body });
  if (type == "insert") {
    data.forEach((item) => {
      db.sequelize.query(
        `call barbers_list (:query_type,:barber_name,:barber_address,:barber_phone,:barber_date,:barber_role,:id,:facilityId)`,
        {
          replacements: {
            query_type: item.query_type,
            barber_name: item.barber_name,
            barber_address: item.barber_address,
            barber_phone: item.barber_phone,
            barber_date: item.barber_date,
            barber_role: item.barber_role,
            id: item.id,
            facilityId
          },
        }
      )
      // .then((results) => {
      //   res.json({ success: true, results });
      //   console.log(results);
      // })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
    });
    res.json({ success: true, results: 'Success' });
  } else {
    db.sequelize
      .query(
        `call barbers_list (:query_type,:barber_name,:barber_address,:barber_phone,:barber_date,:barber_role,:id,:facilityId)`,
        {
          replacements: {
            query_type,
            barber_name,
            barber_address,
            barber_phone,
            barber_date,
            barber_role,
            id,
            facilityId
          },
        }
      )
      .then((results) => {
        res.json({ success: true, results });
        // console.log(results);
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
  }
};
