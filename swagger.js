require("dotenv").config();

const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const {
  scanRoutesFromFiles,
  mergeOpenApiPaths,
} = require("./swagger/routeScanner");
const { buildEInvoicingSpec } = require("./swagger/eInvoicingSpec");

const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || "/inventria_new";
const API_BASE_URL = (
  process.env.API_BASE_URL ||
  process.env.APP_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, "");

const baseNoTrailing = BASE_PATH.endsWith("/")
  ? BASE_PATH.slice(0, -1)
  : BASE_PATH;

const buildServers = () => {
  const localBase = `http://localhost:${PORT}${baseNoTrailing}`;
  const servers = [
    { url: localBase, description: "Local development" },
  ];

  const productionHost = "https://server.brainstorm.ng";
  if (!API_BASE_URL.includes("localhost")) {
    // Prefer explicit API_BASE_URL; otherwise production host + BASE_PATH
    const remoteBase = API_BASE_URL.includes(baseNoTrailing)
      ? API_BASE_URL
      : `${API_BASE_URL.replace(/\/$/, "")}${baseNoTrailing}`;
    if (remoteBase !== localBase) {
      servers.push({ url: remoteBase, description: "Remote / configured" });
    }
  }

  const prodApi = `${productionHost}${baseNoTrailing}`;
  if (!servers.some((s) => s.url === prodApi)) {
    servers.push({ url: prodApi, description: "Production (brainstorm.ng)" });
  }

  return servers;
};

const sharedComponents = {
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "JWT from POST /api/auth/login — paste the token value (without the Bearer prefix if Swagger adds it automatically).",
    },
  },
  schemas: {
    ErrorResponse: {
      type: "object",
      properties: {
        success: { type: "boolean", example: false },
        message: { type: "string" },
      },
    },
    SuccessResponse: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        message: { type: "string" },
        data: { type: "object" },
      },
    },
  },
};

const routesDir = path.join(__dirname, "src", "routes");
const scannedPaths = scanRoutesFromFiles(routesDir);

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FlowBooks API",
      version: "2.0.0",
      description: [
        "FlowBooks ERP / accounting API documentation.",
        "",
        "**Auth:** `POST /api/auth/login` → use the returned JWT with **Authorize**.",
        "",
        "Data compliance: Nigeria Data Protection Commission (NDPC) · ISO 27001 · ISO 9001",
        "",
        `Most endpoints are auto-listed from route files (${Object.keys(scannedPaths).length} paths).`,
        "Invoice endpoints include full request/response schemas.",
      ].join("\n"),
      contact: {
        name: "FlowBooks",
        url: "https://flowbooks.org",
        email: "hello@flowbooks.org",
      },
    },
    servers: buildServers(),
    components: sharedComponents,
    tags: [
      { name: "Auth", description: "Login and authentication" },
      { name: "Users", description: "Authentication and user management" },
      { name: "Account", description: "Chart of accounts, sales, inventory balances" },
      { name: "Products", description: "Product catalogue and stock" },
      { name: "Inventory", description: "Stock, goods transfers, store entries" },
      { name: "Customer", description: "Customer registration and ledger" },
      { name: "Sales", description: "Sales and transactions" },
      { name: "Production", description: "Manufacturing and production records" },
    ],
  },
  apis: [
    path.join(__dirname, "src", "swagger", "definitions", "*.js"),
    path.join(__dirname, "src", "routes", "*.js"),
    path.join(__dirname, "routes", "*.js"),
  ],
};

const jsdocSpecs = swaggerJsdoc(options);

const paths = mergeOpenApiPaths(scannedPaths, jsdocSpecs.paths || {});

// E-invoicing has its own dedicated docs — keep it out of the main API catalog.
const E_INVOICING_PATH_PREFIX = "/api/v1/invoice";
const specsPaths = Object.fromEntries(
  Object.entries(paths).filter(
    ([pathKey]) => !pathKey.startsWith(E_INVOICING_PATH_PREFIX),
  ),
);

const specs = {
  ...jsdocSpecs,
  servers: buildServers(),
  components: {
    ...sharedComponents,
    ...(jsdocSpecs.components || {}),
    schemas: {
      ...sharedComponents.schemas,
      ...(jsdocSpecs.components?.schemas || {}),
    },
    securitySchemes: {
      ...sharedComponents.securitySchemes,
      ...(jsdocSpecs.components?.securitySchemes || {}),
    },
  },
  paths: specsPaths,
};

// Dedicated E-Invoicing API — programmatic OpenAPI (NRS only, no ERP routes)
const eInvoicingSpecs = buildEInvoicingSpec();

const eInvoicingUiOptions = {
  explorer: false,
  customSiteTitle: "FlowBooks E-Invoicing API",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: false,
    tryItOutEnabled: true,
    docExpansion: "list",
    defaultModelsExpandDepth: 2,
  },
};

const swaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
};

module.exports = {
  swaggerUi,
  specs,
  eInvoicingSpecs,
  eInvoicingUiOptions,
  swaggerUiOptions,
};
