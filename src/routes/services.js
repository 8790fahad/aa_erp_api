const passport = require('passport');

module.exports = app => {
  const services = require('../controller/services');
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;

  app.post('/services/new', services.newService);
  app.get('/services/all/:facilityId', services.getAllServices);
  app.put('/services/:serviceId', services.updateService);

  app.post('/services/recordservices', services.saveBatchPaidServices);
  app.post('/services/bill', services.prepareBill)
  app.post('/services/outstanding', services.payOutstanding)

  app.delete('/services/:serviceId/', services.deleteService)

  // app.get('/services/print', services.printPage)
};
