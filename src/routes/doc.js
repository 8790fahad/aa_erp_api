
module.exports = app => {
    const doc = require('../controller/doc');
    // const config = require('../config/config')
    // const allowOnly = require('../services/routesHelper').allowOnly;
  
    app.post('/doc/patients/new', doc.addPatient);
}