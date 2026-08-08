module.exports = (app) => {
  const catalogController = require("../controller/catalogController");
  const BASE_PATH = process.env.BASE_PATH || "/flowbooks";

  // Keep legacy routes and add BASE_PATH routes for production/live access.
  app.get("/api/catalog/business", catalogController.getCatalogBusiness);
  app.get("/api/catalog/products", catalogController.getCatalogProducts);
  app.get("/api/catalog/storefront", catalogController.getCatalogStorefront);
  app.get("/api/catalog/resolve-slug", catalogController.resolveMarketplaceSlug);
  app.get("/api/catalog/login-branding", catalogController.getLoginBranding);
  app.get(
    "/api/catalog/login-branding/:slug",
    catalogController.getLoginBranding,
  );

  app.get(
    `${BASE_PATH}/api/catalog/business`,
    catalogController.getCatalogBusiness
  );
  app.get(
    `${BASE_PATH}/api/catalog/products`,
    catalogController.getCatalogProducts
  );
  app.get(
    `${BASE_PATH}/api/catalog/storefront`,
    catalogController.getCatalogStorefront
  );
  app.get(
    `${BASE_PATH}/api/catalog/resolve-slug`,
    catalogController.resolveMarketplaceSlug
  );
  app.get(
    `${BASE_PATH}/api/catalog/login-branding`,
    catalogController.getLoginBranding
  );
  app.get(
    `${BASE_PATH}/api/catalog/login-branding/:slug`,
    catalogController.getLoginBranding
  );
};
