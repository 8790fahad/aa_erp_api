const passport = require("passport");

// Import bonus controller
const bonusesController = require("../controller/bonuses");

// Middleware for authentication
const authenticate = passport.authenticate("jwt", { session: false });

module.exports = (app) => {
  // Bonus Management Routes
  app.post("/api/hr/bonuses", bonusesController.createBonus);
  app.post("/api/hr/bonuses/bulk", bonusesController.bulkCreateBonuses);
  app.get("/api/hr/bonuses", bonusesController.getAllBonuses);
  app.get("/api/hr/bonuses/statistics", bonusesController.getBonusStatistics);
  app.get("/api/hr/bonuses/:id", bonusesController.getBonusById);
  app.put("/api/hr/bonuses/:id", bonusesController.updateBonus);
  app.delete("/api/hr/bonuses/:id", bonusesController.deleteBonus);
  app.put("/api/hr/bonuses/:id/approve", bonusesController.approveBonus);
};