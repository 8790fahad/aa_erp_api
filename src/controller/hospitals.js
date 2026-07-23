const db = require('../models');
const Hospital = db.hospital;
const { uuid } = require('uuidv4');
const { request } = require('http');

// create hospital
exports.create = (req, res) => {
  let { name, code, address, type, logo, admin, hasStore } = req.body;
  let id = uuid();
console.log(req.body)
  Hospital.create({
    id,
    name,
    code,
    address,
    type,
    admin,
    hasStore: hasStore==="Yes" ? 1 : 0,
    logo: logo
      ? logo
      : 'https://res.cloudinary.com/emaitee/image/upload/v1583943949/bits_his_logo.png',
  })
    .then((hospital) => {
      res.json({ hospital });
    })
    .catch((err) => {
      res.status(500).json({ err });
    });
};

exports.createBedSpace = (req, res) => {
  const { facilityId, classType, bedName } = req.body;

  db.sequelize
    .query('call create_new_bed(:facilityId, :classType, :bedName)', {
      replacements: {
        facilityId,
        classType,
        bedName,
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getFacilityInfo = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query('call get_facility_info(:facilityId)', {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAllBedsForFacility = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query('call get_all_beds(:facilityId)', {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

// fetch all hospitals
exports.findAll = (req, res) => {
  Hospital.findAll({
    attributes: ['id', 'name', 'address', 'logo', 'type', 'createdAt'],
    order: [['createdAt', 'DESC']],
  })
    .then((hospital) => {
      res.json({ hospital });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.findAllPharmacy = (req, res) => {
  Hospital.findAll({
    attributes: ['id', 'name', 'address', 'logo', 'type', 'createdAt'],
    order: [['createdAt', 'DESC']],
    where: { type: 'pharmacy' },
  })
    .then((hospital) => {
      res.json({ hospital });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.findAllLab = (req, res) => {
  Hospital.findAll({
    attributes: ['id', 'name', 'address', 'logo', 'type', 'createdAt'],
    order: [['createdAt', 'DESC']],
    where: { type: 'laboratory' },
  })
    .then((hospital) => {
      res.json({ hospital });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.countFacilities = (req, res) => {
  db.sequelize
    .query('SELECT type, count(*) AS count FROM hospitals GROUP BY type;')
    .then((hospital) => {
      let newObj = {};
      hospital[0].forEach((item) => (newObj[item.type] = item.count));
      res.json({ counts: newObj });
    })
    .catch((err) => res.status(500).json({ err }));
};

// fetch hospital by hospitalId
exports.findById = (req, res) => {
  const id = req.params.hospitalId;

  Hospital.findAll({ where: { id } })
    .then((hospital) => res.json({ hospital }))
    .catch((err) => res.status(500).json({ err }));
};

// update a hospital's info
exports.update = (req, res) => {
  // var hospital = req.body.hospital;
  let { name } = req.body;
  const id = req.params.hospitalId;

  Hospital.update(
    {
      name,
    },
    { where: { id } },
  )
    .then((hospital) => res.status(200).json({ hospital }))
    .catch((err) => res.status(500).json({ err }));
};

// delete a hospital
exports.delete = (req, res) => {
  const id = req.params.hospitalId;
  Hospital.destroy({ where: { id } })
    .then(() =>
      res.status.json({ msg: 'Hospital has been deleted successfully!' }),
    )
    .catch((err) => res.status(500).json({ msg: 'Failed to delete!' }));
};
