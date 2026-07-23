const passport = require('passport');

module.exports = app => {
  const maintenance = require('../controller/maintenance');
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;

  app.post('/maintenance/usage/new', maintenance.addDieselUsage);
//   app.get('/maintenance/all', maintenance.getAll);
  app.post('/maintenance/refuel/new', maintenance.addDieselRefuel);
//   app.get('/maintenance/all', maintenance.getAll);
app.post('/maintenance/servicelog/new', maintenance.addServiceLog);
app.post('/maintenance/errorrepairlog/new', maintenance.addErrorRepairLog );

};