module.exports = (app) => {
  const employeeScan = require("../controller/employeeScan");

  // Employee scanning routes
  app.post("/api/hr/employees/scan", employeeScan.scanEmployee);
};

