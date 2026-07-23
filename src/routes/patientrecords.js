const passport = require('passport');


module.exports = app => {
  const patientrecords = require('../controller/patientrecords');
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;

  app.post('/patientrecords/patient/new', patientrecords.getPatientList);
  app.get('/patientrecords/patientlist/:facilityId', patientrecords.getPatientList);
  // app.get(
  //   '/patientrecords/unassignedPatientlist/:facilityId',
  //   patientrecords.getUnassignedPatients
  // );
  // app.get('/patientrecords/patientClarking/:facilityId', patientrecords.patientClarking);
  // app.get('/patientrecords/fetchUserById/:id/:facilityId', patientrecords.getUsersById);
  // app.get('/patientrecords/doctor/:doctor/:facilityId', patientrecords.doctor);
  // app.get('/patientrecords/getId/:facilityId', patientrecords.getId);
  // app.get('/patientrecords/getAccount/:facilityId', patientrecords.getAccount);
  // app.post('/patientrecords/new', patientrecords.newRecord);
  // app.post('/patientrecords/upload', patientrecords.upload);
  // app.put('/patientrecords/edit', patientrecords.edit);
  // app.post('/patientrecords/delete', patientrecords.delete);
  // app.post('/patientrecords/assign', patientrecords.assign);
  // app.get(
  //   '/patientrecords/patientAssignedToday/:facilityId',
  //   patientrecords.patientAssignedToday
  // );
  // app.get('/patientrecords/fetchByDoctor/:facilityId', patientrecords.fetchByDoctor);
  // app.get('/patientrecords/getAll/:facilityId', patientrecords.getAll);
  // app.get('/patientrecords/getIds/:facilityId', patientrecords.getIds);
  // app.get(
  //   '/patientrecords/getBeneficiaryNo/:accountNo/:facilityId',
  //   patientrecords.getBeneficiaryNo
  // );
  // app.post('/patientrecords/operation', patientrecords.operationNote)
};
