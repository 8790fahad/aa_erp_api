module.exports = (app) => {
  const publicHolidays = require("../controller/publicHolidays");

  // Public holidays routes
  app.get("/api/hr/public-holidays/check", publicHolidays.checkPublicHoliday);
  app.get("/api/hr/public-holidays", publicHolidays.getPublicHolidays);
  app.post("/api/hr/public-holidays", publicHolidays.createPublicHoliday);
};

