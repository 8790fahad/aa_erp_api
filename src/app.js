const express = require("express");
const passport = require("passport");
require("dotenv").config();
const port = process.env.PORT || 3000;
const path = require("path");
const fs = require("fs");
const logger = require("morgan");
const cors = require("cors");
require("./config/cloudinary"); // CLOUDINARY_* from .env
const helmet = require("helmet");
const { swaggerUi, specs, swaggerUiOptions } = require("../swagger");

var cluster = require("cluster");
const os = require("os");

const bodyParser = require("body-parser");
var multer = require("multer");
var upload = multer({ dest: "uploads/" });
const app = express();

const trustProxyIps = process.env.TRUST_PROXY_IPS;
if (trustProxyIps && trustProxyIps.trim()) {
  app.set(
    "trust proxy",
    trustProxyIps.split(",").map((ip) => ip.trim()).filter(Boolean),
  );
} else if (process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== "") {
  const n = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(n) ? process.env.TRUST_PROXY : n);
} else if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
} else {
  app.set("trust proxy", 1);
}
// Base path under which the API is mounted (public URL prefix)
const BASE_PATH = process.env.BASE_PATH || "/flowbooks";
const welcomePayload = {
  msg: "Welcome",
  description: "FlowBooks API Server",
  version: "2.0.0",
  documentation: `${(process.env.APP_URL || "").replace(/\/$/, "")}${BASE_PATH}/api-docs`,
  compliance:
    "Data compliance organization · Nigeria Data Protection Commission (NDPC) · ISO 27001 · ISO 9001",
};

app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ limit: "1mb", extended: true }));

// Stamp MySQL session vars so row-change audit triggers can attribute actors
try {
  const {
    auditContextMiddleware,
  } = require("./middleware/auditContext");
  app.use(auditContextMiddleware);
} catch (err) {
  console.warn("[auditContext] middleware not loaded:", err.message);
}

// CORS must run before any routes so OPTIONS preflight always gets allowlist headers.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://ashiru-ali.com",
  "http://ashiru-ali.com",
  "https://www.ashiru-ali.com",
  "http://www.ashiru-ali.com",
  "https://dashboard.inventria.app",
  "http://flowbooks.org",
  "https://flowbooks.org",
  "http://app.flowbooks.org",
  "https://app.flowbooks.org",
  "http://connect.flowbooks.org",
  "https://connect.flowbooks.org",
  "http://marketspace.flowbooks.org",
  "https://marketspace.flowbooks.org",
  "http://localhost:42790",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5175",
  "http://192.168.1.238:5175",
  "http://10.161.93.56:42843",
  "http://10.161.93.56:5175/login",
  "http://192.168.1.87:5175",
];

const normaliseOrigin = (origin) => {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    url.pathname = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    return origin.replace(/\/$/, "");
  }
};

const parseAllowedOrigins = () => {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  const parsed =
    raw && raw.trim().length
      ? raw
          .split(",")
          .map((value) => normaliseOrigin(value.trim()))
          .filter(Boolean)
      : [];

  const merged = [
    ...DEFAULT_ALLOWED_ORIGINS.map(normaliseOrigin),
    ...parsed,
  ].filter(Boolean);
  return merged.length ? Array.from(new Set(merged)) : DEFAULT_ALLOWED_ORIGINS;
};

const allowedOrigins = parseAllowedOrigins();

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const allowLocalhost =
      process.env.NODE_ENV !== "production" ||
      process.env.CORS_ALLOW_LOCALHOST === "true";
    if (
      allowLocalhost &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1")
    ) {
      return true;
    }
  } catch (error) {}

  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.some((allowedOrigin) => {
    const normalisedAllowed = normaliseOrigin(allowedOrigin);
    const normalisedRequest = normaliseOrigin(origin);
    return (
      !!normalisedAllowed &&
      !!normalisedRequest &&
      normalisedRequest.toLowerCase() === normalisedAllowed.toLowerCase()
    );
  });
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else if (!origin && allowedOrigins.includes("*")) {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma",
  );
}

const corsOptions = {
  origin(requestOrigin, callback) {
    if (!requestOrigin) {
      return callback(null, true);
    }

    if (isAllowedCorsOrigin(requestOrigin)) {
      return callback(null, true);
    }

    console.warn(
      `CORS blocked request from origin: ${requestOrigin}. Update CORS_ALLOWED_ORIGINS if this is expected.`,
    );
    return callback(
      new Error(
        "Not allowed by CORS. Contact administrator to whitelist origin.",
      ),
    );
  },
  // JWT lives in Authorization header, not cookies — do not send
  // Access-Control-Allow-Credentials: true unless fetch() uses credentials: "include",
  // or browsers may block the POST after a successful OPTIONS preflight.
  credentials: false,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Cache-Control",
    "Pragma",
  ],
  exposedHeaders: ["Content-Type", "Authorization"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Belt-and-suspenders: set ACAO early so error/timeout paths still expose CORS to connect.flowbooks.org.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  next();
});

// Apache/nginx often forwards the public URL path (e.g. /flowbooks/api/...) while routes are registered at /api/...
// Strip BASE_PATH so OPTIONS preflight and POST hit the same handlers and cors() can attach headers.
if (BASE_PATH && BASE_PATH !== "/") {
  const baseNoTrailing = BASE_PATH.endsWith("/")
    ? BASE_PATH.slice(0, -1)
    : BASE_PATH;
  app.use((req, res, next) => {
    const q = req.url.indexOf("?");
    const pathOnly = q === -1 ? req.url : req.url.slice(0, q);
    const query = q === -1 ? "" : req.url.slice(q);
    if (
      pathOnly === baseNoTrailing ||
      pathOnly === `${baseNoTrailing}/` ||
      pathOnly.startsWith(`${baseNoTrailing}/`)
    ) {
      let rest = pathOnly.slice(baseNoTrailing.length);
      if (!rest || rest === "") rest = "/";
      else if (!rest.startsWith("/")) rest = `/${rest}`;
      req.url = rest + query;
    }
    next();
  });
}

// Security headers — before public docs routes so e-invoicing pages are covered.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    // HSTS only meaningful over HTTPS; enabled in production (2 years, subdomains).
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 63072000, includeSubDomains: true, preload: true }
        : false,
    // API is JSON/first-party docs; a conservative CSP with no inline-by-default.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Docs pages use small inline scripts; keep inline allowed to avoid
        // breaking the e-invoicing docs/theme toggle and Swagger UI.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'", "blob:", "data:"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use(helmet.xContentTypeOptions());
app.use(helmet.referrerPolicy({ policy: "no-referrer" }));
app.use(helmet.frameguard({ action: "deny" }));
app.use(helmet.hidePoweredBy());
app.use(helmet.noSniff());
app.use(
  helmet.permittedCrossDomainPolicies({ permittedPolicies: "none" }),
);

// Health / sanity checks — must be AFTER BASE_PATH strip so /flowbooks/ and /flowbooks/welcome match.
app.get("/", (req, res) => {
  res.json(welcomePayload);
});
app.get("/welcome", (req, res) => {
  res.json(welcomePayload);
});
// Lightweight liveness probe for clients on unreliable networks (no auth).
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "aa_erp_api",
    ts: Date.now(),
  });
});
app.head("/health", (req, res) => {
  res.status(200).end();
});

app.use(
  "/public/uploads",
  express.static(path.join(__dirname, "..", "public", "uploads")),
);

// Swagger UI - primary docs route (respects BASE_PATH)
app.use(
  `${BASE_PATH}/api-docs`,
  swaggerUi.serve,
  swaggerUi.setup(specs, swaggerUiOptions),
);
app.get(`${BASE_PATH}/api-docs.json`, (req, res) => {
  res.json(specs);
});

// Convenience Swagger UI route without base path for local access (e.g. http://localhost:3000/api-docs)
// This avoids confusing "Route not found" when BASE_PATH is enabled.
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs, swaggerUiOptions));
app.get("/api-docs.json", (req, res) => {
  res.json(specs);
});

// Linking log folder and ensure directory exists
const logDirectory = path.join(__dirname, "log");
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);
fs.appendFile("./ServerData.log", "", function (err) {
  if (err) throw err;
});

// Generating date and time for logger
logger.token("datetime", function displayTime() {
  return new Date().toString();
});

logger.token("body", (req) => JSON.stringify(req.body || {}));

// Request logging: never log request bodies (they contain passwords, OTPs, BVN).
// Use concise "dev" format locally and standard "combined" format in production.
// Skip health/monitor noise. Set LOG_FORMAT to override.
const morganFormat =
  process.env.LOG_FORMAT ||
  (process.env.NODE_ENV === "production" ? "combined" : "dev");
app.use(
  logger(morganFormat, {
    skip: (req) =>
      req.path === "/status" ||
      req.path === "/health" ||
      req.path === "/favicon.ico",
  }),
);

app.use(express.static(path.join(__dirname, "build")));
// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// app.use(cookieParser());

// initialize models first
const models = require("./models");

// initialize passport here
app.use(passport.initialize());

require("./config/passport")(passport);
// force: true will drop the table if it already exits
models.sequelize
  .sync
  // { alter: true }
  ()
  .then(() => {
    console.log("Sequelize sync completed (no force — tables ensured only).");
  });

require("./routes/users")(app);
require("./routes/kyc")(app);
require("./routes/patientrecords")(app);
require("./routes/transactions")(app);
require("./routes/services")(app);
require("./routes/drugs")(app);
require("./routes/maintenance")(app);
require("./routes/dashboard")(app);
require("./routes/account")(app);
require("./routes/transfer")(app);
require("./routes/wholesales")(app);
require("./routes/doc")(app);
require("./routes/feedbacks")(app);
require("./routes/pharmacy")(app);
require("./routes/engineering")(app);
require("./routes/inventory")(app);
require("./routes/audit")(app);
require("./routes/activityAudit")(app);
require("./routes/stoctmangement")(app);
require("./routes/sales")(app);
require("./routes/saleWorkflow")(app);
require("./routes/collectionReconciliation")(app);
require("./routes/globalSearch")(app);
require("./routes/rebateLedger")(app);
require("./routes/crm")(app);
require("./routes/customer")(app);
require("./routes/generalledger")(app);
require("./routes/journalEntries")(app);
require("./routes/production")(app);
require("./routes/bank_reconciliation")(app);
require("./routes/materials")(app);
require("./routes/department")(app);
require("./routes/team")(app);
require("./routes/supplier")(app);
require("./routes/accountingReports")(app);
require("./routes/products")(app); // Temporarily commented out to avoid route conflicts
require("./routes/productGroups")(app);
require("./routes/productsRoutes")(app);
require("./routes/procurement")(app);
require("./routes/production")(app);
require("./routes/finishedGoods")(app);
require("./routes/productionReports")(app);
require("./routes/hr")(app);
require("./routes/productionRecords")(app);
require("./routes/products")(app);
require("./routes/inventoryProducedGoods")(app);
require("./routes/multiplierRoutes")(app);
require("./routes/markupRoutes")(app);
require("./routes/assets")(app);
require("./routes/bonuses")(app);
require("./routes/salaryStructures")(app);
require("./routes/allowances")(app);
require("./routes/numberGenerator")(app);
require("./routes/taxes")(app);
require("./routes/storeEntries")(app);
require("./routes/employeeScan")(app);
require("./routes/leaveAttendance")(app);
require("./routes/publicHolidays")(app);
require("./routes/costingTemplates")(app);
require("./routes/creditNote")(app);
require("./routes/catalog")(app);
require("./routes/project")(app);
require("./routes/estimate.routes")(app);

app.post(
  "/account/multer/file",
  upload.array("photos", 12),
  (req, res) => {
    res.json({
      ok: true,
      count: Array.isArray(req.files) ? req.files.length : 0,
    });
  },
);

app.post("/test/profile", upload.single("avatar"), function (req, res) {
  res.json({ ok: true, uploaded: Boolean(req.file) });
});

// globally catching unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "Unhandled Rejection at promise " + promise + " reason ",
    reason,
  );
  console.log("Server is still running...\n");
});

// globally catching unhandled exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception is thrown with ", error + "\n");
  process.exit();
});

// Express Status Monitor for monitoring server status
const auth = require("http-auth");
const db = require("./models");

const statusUser = process.env.STATUS_MONITOR_USER || "";
const statusPass = process.env.STATUS_MONITOR_PASSWORD || "";
const statusEnabled =
  process.env.STATUS_MONITOR_ENABLED === "true" &&
  statusUser.length >= 8 &&
  statusPass.length >= 12;

if (statusEnabled) {
  const basic = auth.basic(
    { realm: "Monitor Area" },
    function (user, pass, callback) {
      callback(user === statusUser && pass === statusPass);
    },
  );
  const statusMonitor = require("express-status-monitor")({ path: "" });
  app.use(statusMonitor.middleware);
  app.get("/status", auth.connect(basic), statusMonitor.pageRoute);
}

// Error handler middleware - ensure CORS headers are set on error responses
app.use((err, req, res, next) => {
  applyCorsHeaders(req, res);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// 404 handler - ensure CORS headers are set
app.use((req, res) => {
  applyCorsHeaders(req, res);
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

const startServer = () => {
  const server = app.listen(port, function () {
    const host = server.address().address;
    const portNumber = server.address().port;
    console.log(`[Worker ${process.pid}] host`, host);
    console.log(`[Worker ${process.pid}] port`, portNumber);
    console.log(
      `[Worker ${process.pid}] App listening at http://${host}:${portNumber}`,
    );

    // Only one worker should own the depreciation cron (avoid duplicate runs).
    const isCronLeader =
      !cluster.isWorker || (cluster.worker && cluster.worker.id === 1);
    if (isCronLeader) {
      try {
        const {
          startDepreciationCron,
        } = require("./jobs/depreciationCron");
        startDepreciationCron();
      } catch (err) {
        console.error(
          `[Worker ${process.pid}] Failed to start depreciation cron:`,
          err.message,
        );
      }
      try {
        const {
          startInvoiceClosingCron,
        } = require("./jobs/invoiceClosingCron");
        startInvoiceClosingCron();
      } catch (err) {
        console.error(
          `[Worker ${process.pid}] Failed to start invoice closing cron:`,
          err.message,
        );
      }
      try {
        const {
          startArApWeeklyDigestCron,
        } = require("./jobs/arApWeeklyDigestCron");
        startArApWeeklyDigestCron();
      } catch (err) {
        console.error(
          `[Worker ${process.pid}] Failed to start AR/AP weekly digest cron:`,
          err.message,
        );
      }
      try {
        const {
          startCrmClassificationCron,
        } = require("./jobs/crmClassificationCron");
        startCrmClassificationCron();
      } catch (err) {
        console.error(
          `[Worker ${process.pid}] Failed to start CRM classification cron:`,
          err.message,
        );
      }
    }
  });
  return server;
};

async function boot() {
  // Create/upgrade schema + audit triggers before accepting traffic
  try {
    const {
      runPendingMigrations,
    } = require("./bootstrap/runPendingMigrations");
    await runPendingMigrations();
  } catch (err) {
    console.error(
      `[pid ${process.pid}] Auto-migrate failed:`,
      err.message,
    );
    // Continue boot — app may still serve if DB already exists
  }
  startServer();
}

const shouldUseCluster =
  process.env.ENABLE_CLUSTER?.toLowerCase() !== "false" &&
  (os.cpus()?.length || 1) > 1;

if ((cluster.isPrimary || cluster.isMaster) && shouldUseCluster) {
  const cpuCount =
    parseInt(process.env.CLUSTER_WORKERS, 10) || os.cpus().length;

  (async () => {
    try {
      const {
        runPendingMigrations,
      } = require("./bootstrap/runPendingMigrations");
      await runPendingMigrations();
    } catch (err) {
      console.error(
        `[Master ${process.pid}] Auto-migrate failed:`,
        err.message,
      );
    }

    console.log(
      `[Master ${process.pid}] Starting ${cpuCount} worker${
        cpuCount > 1 ? "s" : ""
      }`,
    );
    for (let i = 0; i < cpuCount; i += 1) {
      cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
      console.warn(
        `[Master ${process.pid}] Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`,
      );
      cluster.fork();
    });
  })();
} else if (shouldUseCluster) {
  // Worker process — migrations already ran in master
  startServer();
} else {
  boot();
}
