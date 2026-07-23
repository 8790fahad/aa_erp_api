const account = require('./account');

module.exports = (app) => {
  const pharmacy = require('../controller/pharmacy');
  // const config = require('../config/config')
  // const allowOnly = require('../services/routesHelper').allowOnly;

  app.post('/client/new', pharmacy.createClientAccount);

  app.post('/client/beneficiary/new', pharmacy.addClientBeneficiary);

  app.get('/client/nextId/:facId', pharmacy.getNextClientAccountNo);
  app.get(
    '/client/nextBeneficiaryId/:accountNo/:facId',
    pharmacy.getNextClientBeneficiaryNo
  );
  app.get('/client/next-patient-id/:facId', pharmacy.getNextPatientNo);

  app.get('/drugs/bybatch/:facId', pharmacy.getDrugListByBatch);
  app.get('/returndrugs/new/:receipt/:facilityId', pharmacy.getReturnDrugs);
  app.get('/supplier/id/:facilityId', pharmacy.getSupplierId);

  app.get(
    '/get/purchase/order/list/:id/:facilityId',
    pharmacy.getPurchaseOrderList
  );
  app.post('/pharmacy/internal/transfer', pharmacy.internalTransfer);
  app.post('/reject/auditor', pharmacy.RejectAuditor);
  app.post('/update/auditor', pharmacy.UpdateAuditor);
  app.post('/manager/approved',pharmacy.managerApproved)
  app.post('/management/reject',pharmacy.managementReject)
  app.post('/approved/management',pharmacy.approvedManagement)
  app.get('/approved/account/details/:facilityId',pharmacy.getApprovedAccount)
  app.post("/update/reviewer",pharmacy.UpdateReviewer)
  app.get("/supplier/good/info/:supplier_code/:facilityId",pharmacy.getAccSupplierInfo)
  app.get('/select/purchase/order/list/:facilityId',pharmacy.select_purchase_order_list)

  app.get('/customer-stock-balance/history', pharmacy.getCustomerStockBalanceHistory)

  app.post('/markup/new', pharmacy.newMarkup)
  app.post('/item-category/new', pharmacy.newItemCategory)
};
