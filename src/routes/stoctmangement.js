module.exports = (app) => {
  const stoctmangement = require("../controller/stoctmangement");

  app.post("/services/newService", stoctmangement.newService);
  app.get("/services/Getservice", stoctmangement.Getservice);
  app.get("/services/Getservice/:id", stoctmangement.GetserviceById);
  app.post(
    "/services/post_delivery_service",
    stoctmangement.postServiceDelivery
  );
};
