module.exports = (app) => {
  const globalSearch = require("../controller/globalSearch");
  app.get("/api/v1/global-search", globalSearch.globalSearch);
};
