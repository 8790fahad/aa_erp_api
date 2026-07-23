
module.exports = app => {
    const sales = require('../controller/sales');
    app.get('/sale/sales/get-pending-items/:store/:facilityId', sales.getPendingItems);
    app.get('/sale/sales/get-update-pending-items/:id/:trn_number/:query_type/:facilityId',sales.updatePendingItems)
}