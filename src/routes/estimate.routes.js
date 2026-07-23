const estimateController = require("../controller/estimate.controller");

module.exports = (app) => {
    // Create a new estimate
    app.post("/api/estimates", estimateController.createEstimate);

    // Get estimates by facility
    app.get("/api/estimates/:facilityId", estimateController.getEstimates);
};
