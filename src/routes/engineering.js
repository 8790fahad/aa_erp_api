const passport = require('passport');

module.exports = (app) => {
  const eng = require('../controller/engineering');
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;
  app.post('/save/equipment/registration/form', eng.SaveEquipmentRegistrationForm);
  app.post('/save/equipment/installation/form',eng.SaveEquipmentInstalationForm)
  app.post("/repair/form",eng.RepairForm)
  app.get('/get/equipment/registration/:facilityId',eng.getEquipmentRegistration)
  app.get('/get/equipment/installation/:facilityId',eng.getEquipmentInstallation)
  app.get('/get/repair/:facilityId',eng.getRepair)
  app.post('/status/form',eng.StatusForm)
  app.get('/get/form/number/:query_type/:facilityId',eng.getFormNumber)
};
