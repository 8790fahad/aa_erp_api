const fs = require("fs");
const path = require("path");

const SKIP_SCAN_FILES = new Set([]);

const ROUTE_METHOD_REGEX =
  /app\.(get|post|put|delete|patch)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi;



  
/** Routes that do not require JWT (login, signup, health, etc.). */
const PUBLIC_ROUTE_PREFIXES = [
  "/api/auth/login",
  "/api/auth/username-login",
  "/api/auth/sign-up",
  "/api/auth/verify",
  "/api/auth/verify-user",
  "/api/auth/check-mail",
  "/api/auth/reset-password",
  "/welcome",
  "/",
];

const toOpenApiPath = (expressPath) =>
  expressPath.replace(/:([^/]+)/g, "{$1}");

const toTagName = (filename) => {
  const base = filename.replace(/\.js$/, "");
  return base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const isPublicRoute = (routePath) =>
  PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`),
  );

/**
 * Scan Express route files and build basic OpenAPI path entries.
 * Detailed schemas remain in per-route @swagger JSDoc blocks.
 */
function scanRoutesFromFiles(routesDir) {
  const resolvedDir = path.resolve(routesDir);
  if (!fs.existsSync(resolvedDir)) {
    return {};
  }

  const paths = {};
  const files = fs
    .readdirSync(resolvedDir)
    .filter((name) => name.endsWith(".js"))
    .sort();

  for (const file of files) {
    if (SKIP_SCAN_FILES.has(file)) continue;
    const content = fs.readFileSync(path.join(resolvedDir, file), "utf8");
    const tag = toTagName(file);
    let match;

    while ((match = ROUTE_METHOD_REGEX.exec(content)) !== null) {
      const method = match[1].toLowerCase();
      const expressPath = match[2].trim();
      if (!expressPath || expressPath.includes("${")) continue;

      const openApiPath = toOpenApiPath(expressPath);
      if (!paths[openApiPath]) paths[openApiPath] = {};

      // Keep first registration; duplicate method+path in same file is rare
      if (paths[openApiPath][method]) continue;

      const operation = {
        tags: [tag],
        summary: `${method.toUpperCase()} ${openApiPath}`,
        description: `Registered in \`${file}\`.`,
        responses: {
          200: { description: "Successful response" },
          400: { description: "Bad request" },
          401: { description: "Unauthorized" },
          404: { description: "Not found" },
          500: { description: "Server error" },
        },
      };

      if (!isPublicRoute(expressPath)) {
        operation.security = [{ bearerAuth: [] }];
      }

      paths[openApiPath][method] = operation;
    }
  }

  return paths;
}

/** Merge scanned paths with JSDoc-generated paths (JSDoc wins on conflicts). */
function mergeOpenApiPaths(basePaths = {}, overridePaths = {}) {
  const merged = { ...basePaths };

  for (const [pathKey, pathItem] of Object.entries(overridePaths)) {
    merged[pathKey] = { ...(merged[pathKey] || {}), ...pathItem };
  }

  return merged;
}

module.exports = {
  scanRoutesFromFiles,
  mergeOpenApiPaths,
};
