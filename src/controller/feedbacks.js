const db = require('../models');
const moment = require('moment');
const Contact = db.contact;
const Referral = db.referral;
const Feedbacks = db.feedbacks;

exports.getAllFeedbacks = (req, res) => {
  Feedbacks.findAll()
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getAllContactUs = (req, res) => {
  Contact.findAll()
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};
