const numberGeneratorController = require("../controller/numberGenerator");

// Get and update number (generates new number) - using existing route pattern

module.exports = (app) => {
  app.get(
    "/get-and-update/:query_type/:facilityId",
    numberGeneratorController._getAndUpdateNumber
  );

  // Get current number without updating (for preview)
  app.get(
    "/current/:query_type/:facilityId",

    numberGeneratorController.getCurrentNumber
  );
};
