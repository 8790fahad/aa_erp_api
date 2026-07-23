module.exports = (app) => {
    const record = require('../controller/record');
    app.post(`/save/record/info`,record.saveRecordInfo)
    app.get('/get/patient/:facId',record.getPatient)
}