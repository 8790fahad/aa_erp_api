const {
  InsertMaterials,
  insertCollectionMaterials,
  getMaterials,
  getMaterialsByCustomerNo,
  InsertRecordProduction,
  getRecordProduction,
  getMaterialByCollectionId,
  InsertTeamSetup,
  getTeamSetup,
  InsertRateSetup,
  getRateSetup,
  getCollectionMaterials,
  getAllCollectionMaterials,
  approveCollection,
  getProductionById,
  InsertConsumptionRecord,
  InsertProductionLedger,
  InsertMaterialLedger,
  getDiscountMaterials,
  InsertDepositLedger,
  CreditOperatorRate,
  InsertCollectionProductionLedger,
  getTeamMembers,
  updateTeamMembers,
  deleteRate,
  EditRateSetup,
  deleteTeam,
  InsertDiscountSetup,
  EditDiscountSetup,
  getDiscountSetup,
  deleteDiscount,
} = require("../controller/materials");

module.exports = (app) => {
  app.post("/v1/materials/insert", InsertMaterials);
  app.post("/v1/materials/get", getMaterials);
  app.post("/v1/materials/getDiscountMaterials", getDiscountMaterials);
  app.post("/v1/materials/getByCustomerNo", getMaterialsByCustomerNo);
  app.post("/v1/materials/getCollectionMaterials", getCollectionMaterials);
  app.post(
    "/v1/materials/insertCollectionMaterials",
    insertCollectionMaterials
  );
  app.post("/v1/materials/get_collections", getAllCollectionMaterials);
  app.post("/v1/materials/credit_operation_rate", CreditOperatorRate);
  app.post("/v1/materials/approve_collection", approveCollection);
  app.post("/v1/materials/recordProduction", InsertRecordProduction);
  app.post("/v1/materials/insertProductionLedger", InsertProductionLedger);
  app.post(
    "/v1/materials/insertCollectionProductionLedger",
    InsertCollectionProductionLedger
  );
  app.post("/v1/materials/insertDepositLedger", InsertDepositLedger);
  app.post("/v1/materials/insertMaterialLedger", InsertMaterialLedger);
  app.post("/v1/materials/record-energy-consumption", InsertConsumptionRecord);
  app.post("/v1/materials/getRecordProduction", getRecordProduction);
  app.get(
    "/v1/materials/get/:collection_id/:facilityId",
    getMaterialByCollectionId
  );
  app.get(
    "/v1/materials/get-production/:collection_id/:facilityId",
    getProductionById
  );
  app.post("/v1/customer/insertTeamSetup", InsertTeamSetup);
  app.post("/v1/customer/getTeamSetup", getTeamSetup);
  app.post("/v1/customer/getTeamMembers", getTeamMembers);
  app.post("/v1/materials/insertRateSetup", InsertRateSetup);
  app.post("/v1/materials/editRateSetup", EditRateSetup);
  app.post("/v1/materials/getRateSetup", getRateSetup);
  app.delete("/v1/materials/delete-team", deleteTeam);
  app.delete("/v1/materials/delete-rate", deleteRate);
  app.post("/v1/materials/updateTeamMembers", updateTeamMembers);
  
  // Discount routes
  app.post("/v1/materials/insertDiscountSetup", InsertDiscountSetup);
  app.post("/v1/materials/editDiscountSetup", EditDiscountSetup);
  app.post("/v1/materials/getDiscountSetup", getDiscountSetup);
  app.delete("/v1/materials/delete-discount", deleteDiscount);
};
