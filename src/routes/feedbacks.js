const passport = require('passport');

module.exports = app => {
  const feedbacks = require('../controller/feedbacks');
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;
  app.get('/feedbacks/all', feedbacks.getAllFeedbacks)
  app.get('/contactus/all', feedbacks.getAllContactUs)
  
};

