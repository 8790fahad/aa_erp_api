module.exports = (app) => {
  const feedbacks = require("../controller/feedbacks");
  const customerFeedback = require("../controller/customerFeedback");

  app.get("/feedbacks/all", feedbacks.getAllFeedbacks);
  app.get("/contactus/all", feedbacks.getAllContactUs);

  // Public customer feedback (QR on Goods Issue Note)
  app.post("/api/v1/customer-feedback", customerFeedback.submitCustomerFeedback);
  app.get("/api/v1/customer-feedback", customerFeedback.listCustomerFeedback);
};

