const passport = require("passport");

module.exports = (app) => {
  const lab = require("../controller/lab");
  const lab2 = require("../controller/lab2");
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;
  app.post("/lab/service/new", lab.addLab);
  app.post("/lab/head/new", lab.addLabHead);
  app.get("/lab/setup/head/:head/:facilityId", lab.getLabByHead);
  app.put("/lab/setup/head/update", lab.updateLabHead);
  app.put("/lab/setup/tests/update", lab.updateLabTest);
  app.delete("/lab/setup/head", lab.deleteLabService);

  app.get("/lab/chart/next-code/:head/:facilityId", lab.getNextLabChartCode);
  app.get("/lab/service/all/:facilityId", lab.getAllLabServices);
  app.get(
    "/lab/service/general/all/:facilityId",
    lab.getAllPossibleLabServices
  );
  app.get("/lab/service/tree/:facilityId", lab.getLabServicesTree);
  app.get("/lab/service/head/:facilityId", lab.getLabServicesHeads);
  app.get("/lab/request/pending/:facilityId", lab.getAllLabRequestPending);
  app.get("/lab/requisitions/:facilityId", lab.getLabRequisitions);

  app.post("/lab/requests/new", lab.newLabRequest);
  // app.post('/lab/requests/new', lab.newLabRequest);
  app.get("/lab/tests/:id/:facilityId", lab.getLabReqByPatient);

  app.get("/lab/next/id/:facilityId", lab.getNextLabNo);
  app.get("/lab/next/monthid/:facilityId", lab.getNextLabNoForCurrentMonth);
  app.get('/lab/patients/:condition/:type/:facilityId', lab.getLabPatients);

  app.get("/lab/pending/collection/:facilityId", lab.getLab);
  app.get(
    "/lab/history/collection/:facilityId",
    lab.getSampleCollectionHistory
  );

  app.get(
    "/lab/pending/analysis/:department/:facilityId",
    lab.getPendingAnalysis
  );
  app.get(
    "/lab/history/analysis/:department/:facilityId",
    lab.getAnalysisHistory
  );

  app.get(
    "/lab/pending/sample-collection/:department/:facilityId",
    lab.getPendingMicrobiologySample
  );
  app.get(
    "/lab/history/sample-collection/:department/:facilityId",
    lab.getMicrobiologyAnalysisHistory
  );

  // app.get('/lab/pending/radiology/sample-collection/:facilityId', lab.getPendingRadiologySample);
  app.get(
    "/lab/pending/microbiology/analysis/:labno/:facilityId",
    lab.getPendingMicrobiologyAnalysis
  );

  app.get("/lab/pending/doctor-comment/:facilityId", lab.getPendingDocComment);
  app.get("/lab/history/doctor-comment/:facilityId", lab.getDocReportHistory);

  app.get("/lab/doctor-comment/:labno/:facilityId", lab.getDocComment);
  app.put("/lab/doctor-comment", lab.updateTestRemark);
  app.delete("/lab/doctor-comment", lab.deleteTestRemark);

  app.post("/lab/client/new", lab.createLabNewClient);
  app.post("/lab/client/lab-number", lab.saveLabNumber);
  app.post("/lab/client/account/new", lab.createNewClientAccount);
  app.get(
    "/lab/client/approval/pending/:facilityId",
    lab.getPendingClientAccApproval
  );
  app.post("/lab/client/approval/approve", lab.approveClientAccount);

  app.get("/lab/client/account/by/:type/:facilityId", lab.getAccountsByType);
  app.get("/lab/client/account/types/:facilityId", lab.getAccountTypes);

  app.get("/lab/patient/info/:patientId/:facilityId", lab.getPatientInfo);
  app.get("/lab/labinfo/:labno/:facilityId", lab.getPendingLab);
  app.get(
    "/lab/collected/:labno/:department/:facilityId",
    lab.getSampleCollectedLabsForDept
  );
  app.put("/lab/request/update", lab.updateLabRequest);
  app.put("/lab/request/save-history", lab.savePatientHistory);
  app.get(
    "/lab/request/history/:patientId/:labno/:facilityId",
    lab.getLabHistory
  );
  app.get(
    "/lab/sample/history/:labno/:facilityId",
    lab2.getSampleHistory
  );
  app.get(
    "/lab/request/analyzed/:labno/:department/:facilityId",
    lab.getAnalyzedTest
  );

  app.get("/lab/request/:patientId/:facilityId", lab.getPatientLabDetails);
  app.put("/lab/result/new", lab.saveTestResult);
  // app.put("/lab/result/new", lab.saveTestResult);
  app.put("/lab/result/update", lab.updateTestResult);
  app.post("/lab/result/remark/new", lab.saveTestRemark);
  app.get("/lab/comment/:labno/:facilityId", lab.getLabComment);
  app.post("/lab/comment/doctors/new", lab.saveDoctorsComment);
  app.post('/lab/commission/new', lab2.saveDoctorsCommission)
  app.get('/lab/doctor/acc-balance/:userId/:facilityId', lab2.getDoctorAccountBalance)
  app.get('/lab/doctor/acc-summary/:userId/:from/:to/:facilityId', lab2.getDoctorAccountSummary)

  app.get("/lab/sensitivities/:facilityId", lab.getSensitivities);
  app.post("/lab/sensitivities/new", lab.saveNewSensitivity);
  app.delete("/lab/sensitivities", lab.deleteSensitivities);

  app.post("/lab/templates/new", lab.saveNewReportTemplate);
  app.get("/lab/templates/list/:facilityId", lab.getReportTemplatesList);

  app.get("/lab/departments/list/:facilityId", lab.getDepartmentList);

  app.get("/lab/completed-lab-tests/:facilityId", lab.getCompletedLabTests);
  app.get("/lab/lab-results/:labNo/:facilityId", lab.getLabResults);
  app.get("/lab/lab-results/uncompleted/:labNo/:facilityId", lab.getUnCompletedLabResults);
  app.post("/lab/microbiology/new", lab.saveMicrobiologyResult);
  app.put("/lab/lab-results/printed", lab.savePrintMode);
  // app.post

  app.get("/lab/specimen/list/:facilityId", lab.getSpecimenList);
  app.get("/lab/search-unit/:unit/:facilityId", lab.labUnitSearch);
  app.get("/lab/search/:facilityId", lab.labSearch);
  app.get("/lab/get-children/:head/:facilityId", lab.getLabChildren);
  app.get("/lab/get-patient-history/:labNo/:facilityId", lab.getPatientHistory);

  app.get('/lab/patient/daily-count/:username/:facilityId', lab2.getDailyPatientCount)
  app.get('/lab/requests/info/:labNo/:facilityId', lab2.getLabDetailsByLabNo)
  // app.get('/lab/sample-collection-time/:patientId/:labno/:facilityId', lab.getSampleCollectionTime)
};
