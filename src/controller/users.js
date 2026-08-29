/**
 * User Controller
 *
 * This controller handles all user-related operations including:
 * - User authentication (login, registration, password reset)
 * - User management (create, update, delete)
 * - Role management
 * - Email verification
 * - Password management
 */
import { MailtrapTransport } from "mailtrap";
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
import nodemailer from "nodemailer";
const Nodemailer = require("nodemailer");
const { MailtrapClient } = require("mailtrap");
// Using SMTP configuration instead of MailtrapTransport for user/pass credentials
import crypto from "crypto";
import { log } from "console";
import { ContentContext } from "twilio/lib/rest/content/v1/content";
import { getAndUpdateNumber } from "../services/numberGen";
const cuid = require("cuid");
const UUIDV4 = require("uuid").v4;
const transport = require("../config/nodemailer");
const { Op } = require("sequelize");

const db = require("../models");
const User = db.users;
const Contact = db.contact;
const Referral = db.referral;
const Feedbacks = db.feedbacks;
const SMS = require("../services/smsApi");
const smsTemplates = require("../template/template");
const sendMail = require("../services/emailApi").sendMail;
const constants = require("../services/constants").constants;
require("dotenv").config();

const JWT_SECRET =
  process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || "secret";
/** Workday-length session; refresh via /auth/verify-token keeps active users signed in */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

// load input validation
const validateRegisterForm = require("../validation/register");
const validateLoginForm = require("../validation/login");
const moment = require("moment");
const { response } = require("express");
const userApi = require("./userApi");

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Replace all branch assignments for a user.
 * branchIds: number[] — first entry becomes the primary (mirrored to users.branchId).
 * Keeps legacy single-branch paths (MakeSale branch select, branch reports, etc.)
 * working via users.branchId.
 */
async function syncUserBranches(
  userId,
  facilityId,
  branchIds = [],
  transaction = null,
  email = null,
) {
  const ids = [
    ...new Set(
      (Array.isArray(branchIds) ? branchIds : [])
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];

  const opts = transaction ? { transaction } : {};
  const QueryTypes = db.Sequelize.QueryTypes;
  const uid = String(userId);
  const fid = String(facilityId);

  if (!db.UserBranch) return ids;

  // Always use explicit query types — mysql2 OkPacket is not a row array.
  // Using type SELECT/model on UPDATE/DELETE causes: valueSets.map is not a function.
  await db.sequelize.query(
    `DELETE FROM user_branches
     WHERE BINARY user_id = BINARY :userId
       AND BINARY facility_id = BINARY :facilityId`,
    {
      replacements: { userId: uid, facilityId: fid },
      ...opts,
      type: QueryTypes.RAW,
    },
  );

  if (ids.length === 0) {
    await db.sequelize.query(
      `UPDATE users SET branchId = NULL
       WHERE BINARY id = BINARY :userId`,
      {
        replacements: { userId: uid },
        ...opts,
        type: QueryTypes.UPDATE,
      },
    );
    return [];
  }

  const valueSql = ids
    .map(
      (_, i) =>
        `(:userId, :branchId${i}, :facilityId, ${i === 0 ? "1" : "0"}, NOW(), NOW())`,
    )
    .join(", ");
  const replacements = { userId: uid, facilityId: fid };
  ids.forEach((branchId, i) => {
    replacements[`branchId${i}`] = branchId;
  });

  await db.sequelize.query(
    `INSERT INTO user_branches
       (user_id, branch_id, facility_id, is_primary, created_at, updated_at)
     VALUES ${valueSql}`,
    {
      replacements,
      ...opts,
      type: QueryTypes.INSERT,
    },
  );

  await db.sequelize.query(
    `UPDATE users SET branchId = :branchId
     WHERE BINARY id = BINARY :userId`,
    {
      replacements: { branchId: ids[0], userId: uid },
      ...opts,
      type: QueryTypes.UPDATE,
    },
  );

  return ids;
}

/** Load branch id/name pairs for one or many users. */
async function getBranchesForUsers(userIds) {
  if (!userIds || userIds.length === 0) return {};

  const rows = await db.sequelize.query(
    `SELECT
        ub.user_id,
        ub.branch_id,
        ub.is_primary,
        b.branch_name,
        b.branch_id AS branch_code
       FROM user_branches ub
       JOIN branches b ON b.id = ub.branch_id
      WHERE ub.user_id IN (:userIds)
      ORDER BY ub.is_primary DESC, b.branch_name ASC`,
    {
      replacements: { userIds },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );

  return rows.reduce((acc, row) => {
    if (!acc[row.user_id]) acc[row.user_id] = [];
    acc[row.user_id].push({
      id: row.branch_id,
      branch_name: row.branch_name,
      branch_code: row.branch_code,
      is_primary: !!row.is_primary,
    });
    return acc;
  }, {});
}

/** Create nodemailer transport for Mailtrap. Prefers SMTP (user/pass) to avoid token Unauthorized errors. */
function getMailtrapTransport() {
  if (process.env.MAILTRAP_USER && process.env.MAILTRAP_PASS) {
    return nodemailer.createTransport({
      host: "sandbox.smtp.mailtrap.io",
      port: 2525,
      secure: false,
      auth: {
        user: process.env.MAILTRAP_USER,
        pass: process.env.MAILTRAP_PASS,
      },
    });
  }
  return nodemailer.createTransport(
    MailtrapTransport({ token: process.env.MAILTRAP_TOKEN }),
  );
}

function generatePrefixSubstrings(name) {
  const words = name.split(" ");
  return (
    words[0].substring(0, 3) +
    (words[1] ? words[1].substring(0, 2) : "") +
    (words[2] ? words[2].substring(0, 1) : "")
  ).toUpperCase();
}

const verificationToken = crypto.randomBytes(32).toString("hex");
const verificationExpires = new Date(Date.now() + 10 * 60 * 1000);

/** Public KYC / auth frontend base used in email verification links. */
function getKycFrontendBaseUrl() {
  // Dev emails → local Connect app; production emails → live Connect.
  const isProd = process.env.NODE_ENV === "production";
  const raw = isProd
    ? process.env.KYC_FRONTEND_URL_PROD ||
      process.env.KYC_FRONTEND_URL ||
      "https://connect.aa_erp.org"
    : process.env.KYC_FRONTEND_URL_DEV || "http://localhost:5173";
  return String(raw).replace(/\/$/, "");
}

function buildEmailVerificationUrl(token, email, type = "login") {
  const params = new URLSearchParams({
    token: String(token),
    type: String(type),
    email: String(email),
  });
  return `${getKycFrontendBaseUrl()}/verify-email?${params.toString()}`;
}

// Role to Designation mapping function
const mapRoleToDesignation = (role) => {
  const roleDesignationMap = {
    admin: "Administrator",
    manager: "Manager",
    staff: "Staff",
    viewer: "Viewer",
    cashier: "Cashier",
    inventory_manager: "Inventory Manager",
    sales_rep: "Sales Representative",
    superAdmin: "Super Administrator",
    user: "User",
    guest: "Guest",
  };

  return roleDesignationMap[role] || role; // Return mapped designation or original role if not found
};

/**
 * MySQL CALL nurmber_generator1 returns different shapes depending on driver:
 * { user: n }, [{ user: n }], or nested [[{ user: n }]]. Normalize to the code value.
 */
function extractNurmberCode(generatorResult, columnKey) {
  if (generatorResult == null) return null;

  const tryObject = (obj) => {
    if (obj == null || typeof obj !== "object" || Array.isArray(obj))
      return null;
    const variants = [
      columnKey,
      columnKey.toLowerCase(),
      columnKey.toUpperCase(),
    ];
    for (const k of variants) {
      if (obj[k] != null && obj[k] !== "") return obj[k];
    }
    const vals = Object.values(obj);
    if (
      vals.length === 1 &&
      vals[0] != null &&
      vals[0] !== "" &&
      typeof vals[0] !== "object"
    ) {
      return vals[0];
    }
    return null;
  };

  let code = tryObject(generatorResult);
  if (code != null) return code;

  if (Array.isArray(generatorResult)) {
    for (const row of generatorResult) {
      if (Array.isArray(row)) {
        const inner = extractNurmberCode(row, columnKey);
        if (inner != null) return inner;
      } else {
        code = tryObject(row);
        if (code != null) return code;
      }
    }
  }

  return null;
}

// ========================================
// STAFF MANAGEMENT
// ========================================
export const createStaff = async (req, res) => {
  const {
    firstname,
    lastname,
    username,
    email,
    phone,
    facilityId,
    query_type,
    password,
    id,
    role,
    status,
  } = req.body;

  try {
    if (query_type !== "update") {
      const existingPhoneUser = await User.findOne({ where: { phone } });
      if (existingPhoneUser) {
        return res.status(400).json({
          success: false,
          msg: "User with this phone number already exists!",
        });
      }

      const existingEmailUser = await User.findOne({ where: { email } });
      if (existingEmailUser) {
        return res.status(400).json({
          success: false,
          msg: "User with this email already exists!",
        });
      }
    }

    const date = moment().format("YYYY-MM-DD HH:mm:ss");

    if (query_type === "update") {
      const updateUser = {
        username,
        email,
        phone,
        firstname,
        lastname,
        date,
        role,
        status,
      };
      const filteredUser = {};
      Object.entries(updateUser).forEach(([key, value]) => {
        if (value !== "") {
          filteredUser[key] = value;
        }
      });

      const updateWhere = { id: req.body.id, facilityId };
      if (email) updateWhere.email = email;

      await User.update(filteredUser, { where: updateWhere });
      return res.status(200).json({ success: true, user: filteredUser });
    } else {
      const transaction = await db.sequelize.transaction();
      try {
        const [genResult] = await db.sequelize.query(
          `CALL nurmber_generator1(:in_query_type,:facilityId)`,
          {
            replacements: { in_query_type: "user", facilityId },
            transaction,
          },
        );

        const entryInCode = extractNurmberCode(genResult, "user");
        if (entryInCode == null || entryInCode === "") {
          throw new Error(
            "Failed to generate user code — check number_generator prefix `user` for this facility.",
          );
        }

        await db.sequelize.query(
          `CALL update_number_generator(:query_type, :in_number,:facilityId)`,
          {
            replacements: {
              query_type: "user",
              in_number: entryInCode,
              facilityId,
            },
            transaction,
          },
        );

        const entry_id_in = `USER-${entryInCode}`;

        const newUser = {
          id: entry_id_in,
          username,
          email,
          phone,
          firstname,
          lastname,
          date,
          facilityId,
        };

        if (password) {
          const salt = await bcrypt.genSalt(10);
          newUser.password = await bcrypt.hash(password, salt);
        }

        const createdUser = await User.create(newUser, { transaction });
        await transaction.commit();
        return res.status(201).json({ success: true, user: createdUser });
      } catch (staffTxErr) {
        await transaction.rollback();
        throw staffTxErr;
      }
    }
  } catch (error) {
    console.error("Error creating/updating staff:", error);
    return res.status(500).json({
      success: false,
      msg: "Server Error. Could not process request.",
    });
  }
};

//controller for adding new user
exports.createNewUser = async (req, res) => {
  const {
    id,
    firstname,
    lastname,
    email,
    phone,
    facilityId,
    query_type,
    role = "",
    status = "",
    accessTo = [],
    functionalities = [],
    branchId = null,
    branchIds = [],
    departmentId = null,
    cashier_type = null,
  } = req.body;

  // Accept either branchIds[] (multi) or a single branchId for backward
  // compatibility. The first entry becomes the primary branch.
  const resolvedBranchIds =
    Array.isArray(branchIds) && branchIds.length > 0
      ? branchIds
      : branchId != null && branchId !== ""
        ? [branchId]
        : [];

  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      if (query_type !== "update" && query_type !== "permission") {
        return res
          .status(400)
          .json({ success: false, message: "Email already exist" });
      }

      if (query_type === "update") {
        if (id === "" || !id) {
          return res
            .status(400)
            .json({ success: false, message: "Id is require to update" });
        }

        const updateUser = {
          email,
          phone,
          firstname,
          lastname,
          role,
          status,
          cashier_type: null,
          // Single departmentId is still supported for legacy HR forms.
          departmentId:
            departmentId != null && departmentId !== ""
              ? departmentId
              : undefined,
        };

        const filteredUser = {};
        Object.entries(updateUser).forEach(([key, value]) => {
          if (value !== "" && value !== undefined) {
            filteredUser[key] = value;
          }
        });

        const updateWhere = { id: req.body.id, facilityId };
        if (email) updateWhere.email = email;

        const [updatedCount] = await User.update(filteredUser, {
          where: updateWhere,
        });

        // Branch + role are sourced from `membership`, so the membership row
        // is the authoritative record to update for this business.
        const parsedBranchIdForUpdate = (() => {
          const candidate = resolvedBranchIds[0] ?? branchId;
          if (candidate == null || candidate === "") return null;
          const n = parseInt(candidate, 10);
          return Number.isFinite(n) ? n : null;
        })();

        await db.sequelize.query(
          `UPDATE membership
              SET role = :role,
                  branch_id = :branch_id
            WHERE business_id = :facilityId
              AND user_id = :id${email ? " AND email = :email" : ""}`,
          {
            replacements: {
              role: role || "",
              branch_id: parsedBranchIdForUpdate,
              facilityId,
              id: req.body.id,
              ...(email ? { email } : {}),
            },
          },
        );

        // Always sync branch assignments on update so removing all branches
        // clears the junction (and clears users.branchId).
        await syncUserBranches(
          req.body.id,
          facilityId,
          resolvedBranchIds,
          null,
          email,
        );

        if (updatedCount === 0 && resolvedBranchIds.length === 0) {
          return res.status(500).json({
            success: false,
            message: "No user found or no changes were made",
          });
        }

        return res.status(200).json({ success: true, user: filteredUser });
      }

      if (query_type === "permission") {
        const {
          id,
          accessTo = [],
          functionalities = [],
          businessId,
        } = req.body;

        // Validate required fields
        if (!id || !businessId) {
          return res.status(400).json({
            success: false,
            message: "User ID and Business ID are required",
          });
        }

        // Convert permissions to strings
        const access_to = Array.isArray(accessTo) ? accessTo.join(",") : "";
        const functionalities_str = Array.isArray(functionalities)
          ? functionalities.join(",")
          : "";

        try {
          // Execute stored procedure (no return expected)
          await db.sequelize.query(
            `CALL update_membership_permissions(
              :id, :access_to, :functionalities_str, :businessId
            )`,
            {
              replacements: {
                id,
                access_to,
                functionalities_str,
                businessId,
              },
              type: db.sequelize.QueryTypes.RAW,
            },
          );

          return res.status(200).json({
            success: true,
            message: "Permissions update processed",
            updatedFields: {
              access_to,
              functionalities: functionalities_str,
            },
          });
        } catch (error) {
          console.error("Permission update error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to process permissions update",
            error:
              process.env.NODE_ENV === "development"
                ? error.message
                : undefined,
          });
        }
      }

      // return res
      //   .status(400)
      //   .json({ success: false, message: "User already exists" });
    }

    // Generate unique user code + membership (transactional)
    const transaction = await db.sequelize.transaction();
    try {
      const [genResult] = await db.sequelize.query(
        `CALL nurmber_generator1(:in_query_type,:facilityId)`,
        {
          replacements: { in_query_type: "user", facilityId },
          transaction,
        },
      );

      const entryInCode = extractNurmberCode(genResult, "user");
      if (entryInCode == null || entryInCode === "") {
        throw new Error(
          "Failed to generate user code — check number_generator prefix `user` for this facility.",
        );
      }

      await db.sequelize.query(
        `CALL update_number_generator(:query_type, :in_number,:facilityId)`,
        {
          replacements: {
            query_type: "user",
            in_number: entryInCode,
            facilityId,
          },
          transaction,
        },
      );

      const entry_id_in = `USER-${entryInCode}`;

      // Primary branch: first id from branchIds[], else legacy single branchId.
      const parsedPrimaryBranchId = (() => {
        const candidate = resolvedBranchIds[0] ?? branchId;
        if (candidate == null || candidate === "") return null;
        const n = parseInt(candidate, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const user = await User.create(
        {
          id: entry_id_in,
          firstname,
          lastname,
          email,
          phone,
          role,
          status,
          facilityId,
          branchId: parsedPrimaryBranchId,
          cashier_type: null,
        },
        { transaction },
      );

      await db.sequelize.query(
        `INSERT INTO membership(business_id, user_id, access_to,role,functionalities,email,branch_id)
        VALUES (:business_id,:in_id, :accessTo,:role, :functionalities,:email,:branch_id )`,
        {
          replacements: {
            business_id: facilityId,
            in_id: user.id,
            role: role,
            email: email,
            branch_id: parsedPrimaryBranchId,
            accessTo: Array.isArray(accessTo) ? accessTo.join(",") : "",
            functionalities: Array.isArray(functionalities)
              ? functionalities.join(",")
              : "",
          },
          transaction,
        },
      );

      if (resolvedBranchIds.length > 0) {
        await syncUserBranches(
          user.id,
          facilityId,
          resolvedBranchIds,
          transaction,
          email,
        );
      }

      await transaction.commit();
      return res.status(201).json({ success: true, user });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("Error creating basic user:", err);
    return res.status(500).json({
      success: false,
      message: "server error",
      error: err.message, // <-- THIS is what will help you debug
    });
  }
};

/**
 * Bulk create staff from Excel upload (Manage Users).
 * Body: { users: [...], facilityId }
 * Each row: firstname, lastname, email, phone, role, branch (name), status?
 */
exports.bulkCreateStaff = async (req, res) => {
  const { users: staffRows, facilityId } = req.body;

  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, message: "facilityId is required" });
  }
  if (!Array.isArray(staffRows) || staffRows.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "users array is required" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const errors = [];
  let created = 0;
  let rolesCreated = 0;
  let branchesCreated = 0;

  try {
    const Branch = db.branches || db.Branch;
    const branchRows = Branch
      ? await db.sequelize.query(
          `SELECT id, branch_name, branch_id FROM branches
           WHERE BINARY facilityId = BINARY :facilityId`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
          },
        )
      : [];

    const branchByName = new Map(
      branchRows.map((b) => [
        String(b.branch_name || "")
          .trim()
          .toLowerCase(),
        b,
      ]),
    );
    const branchByCode = new Map(
      branchRows.map((b) => [
        String(b.branch_id || "")
          .trim()
          .toLowerCase(),
        b,
      ]),
    );

    // Cache facility roles by lowercase name → canonical Role record
    const roleByName = new Map();
    if (db.Role) {
      const existingRoles = await db.sequelize.query(
        `SELECT id, name, status FROM roles
         WHERE BINARY facilityId = BINARY :facilityId`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      (existingRoles || []).forEach((r) => {
        roleByName.set(String(r.name || "").trim().toLowerCase(), r);
      });
    }

    /**
     * Collation-safe email / phone existence check.
     * Avoids "Illegal mix of collations" when connection charset differs
     * from users.email / users.phone column collations.
     */
    const userExistsByField = async (field, value) => {
      if (field !== "email" && field !== "phone") {
        throw new Error("Invalid user lookup field");
      }
      const rows = await db.sequelize.query(
        `SELECT id FROM users
         WHERE BINARY \`${field}\` = BINARY :value
         LIMIT 1`,
        {
          replacements: { value: String(value || "").trim() },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      return rows?.[0] || null;
    };

    /**
     * Find role by name (case-insensitive). If missing, create it.
     * Matching is done in JS from the in-memory cache — never SQL string '='
     * on role name (avoids utf8mb4 collation clashes).
     */
    const resolveOrCreateRole = async (roleName, transaction) => {
      const key = String(roleName || "")
        .trim()
        .toLowerCase();
      if (!key) {
        throw new Error("Role name is required");
      }

      const cached = roleByName.get(key);
      if (cached) {
        return {
          id: cached.id,
          name: cached.name,
          created: false,
        };
      }

      if (!db.Role) {
        return { id: null, name: roleName.trim(), created: false };
      }

      // Re-scan facility roles in JS (collation-safe facility filter)
      const allForFacility = await db.sequelize.query(
        `SELECT id, name, status FROM roles
         WHERE BINARY facilityId = BINARY :facilityId`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      let role =
        (allForFacility || []).find(
          (r) =>
            String(r.name || "")
              .trim()
              .toLowerCase() === key,
        ) || null;

      let createdRole = false;
      if (!role) {
        role = await db.Role.create(
          {
            facilityId,
            name: roleName.trim(),
            description: `Role created automatically during staff bulk upload`,
            status: "active",
          },
          { transaction },
        );
        createdRole = true;
      }

      roleByName.set(key, role);
      return { id: role.id, name: role.name, created: createdRole };
    };

    /**
     * Find branch by name or code (case-insensitive). If missing, create it.
     * Matching is done in JS — never SQL string '=' on branch_name.
     */
    const resolveOrCreateBranch = async (branchLabel, transaction) => {
      const key = String(branchLabel || "")
        .trim()
        .toLowerCase();
      if (!key) {
        throw new Error("Branch name is required");
      }

      const cached =
        branchByName.get(key) || branchByCode.get(key) || null;
      if (cached) {
        return { branch: cached, created: false };
      }

      if (!Branch) {
        throw new Error(`Branch/warehouse not found: ${branchLabel}`);
      }

      const allForFacility = await db.sequelize.query(
        `SELECT id, branch_name, branch_id FROM branches
         WHERE BINARY facilityId = BINARY :facilityId`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      let branch =
        (allForFacility || []).find((b) => {
          const nameKey = String(b.branch_name || "")
            .trim()
            .toLowerCase();
          const codeKey = String(b.branch_id || "")
            .trim()
            .toLowerCase();
          return nameKey === key || codeKey === key;
        }) || null;

      let createdBranch = false;
      if (!branch) {
        const [{ branch_count } = {}] = await db.sequelize.query(
          `SELECT COUNT(*) AS branch_count
           FROM branches
           WHERE BINARY facilityId = BINARY :facilityId`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        const isFirst = Number(branch_count || 0) === 0;
        const createdBy =
          req.body.createdBy || req.body.created_by || "";

        branch = await Branch.create(
          {
            branch_id: `BR-${Date.now().toString(36).toUpperCase()}-${Math.random()
              .toString(36)
              .slice(2, 6)
              .toUpperCase()}`,
            branch_name: branchLabel.trim(),
            state: "",
            address: "",
            phone: "",
            crm: "",
            facilityId,
            store_type: "",
            admin: "",
            created_by: String(createdBy),
            admin_name: "",
            is_default: isFirst,
          },
          { transaction },
        );
        createdBranch = true;
      }

      const plain = {
        id: branch.id,
        branch_name: branch.branch_name,
        branch_id: branch.branch_id,
      };
      branchByName.set(
        String(plain.branch_name || "")
          .trim()
          .toLowerCase(),
        plain,
      );
      if (plain.branch_id) {
        branchByCode.set(
          String(plain.branch_id).trim().toLowerCase(),
          plain,
        );
      }
      return { branch: plain, created: createdBranch };
    };

    const seenEmails = new Set();
    const seenPhones = new Set();

    for (let i = 0; i < staffRows.length; i++) {
      const row = staffRows[i] || {};
      const rowNum = i + 2;

      const firstname = String(row.firstname || row.firstName || "").trim();
      const lastname = String(row.lastname || row.lastName || "").trim();
      const email = String(row.email || "")
        .trim()
        .toLowerCase();
      const phone = String(row.phone || "").trim();
      const roleInput = String(row.role || "").trim();
      const branchLabel = String(
        row.branch || row.branch_name || row.warehouse || "",
      ).trim();
      const status = String(row.status || "verified")
        .trim()
        .toLowerCase() || "verified";

      // Skip blank Excel rows (trailing empties from sheet export)
      if (
        !firstname &&
        !lastname &&
        !email &&
        !phone &&
        !roleInput &&
        !branchLabel
      ) {
        continue;
      }

      if (
        !firstname ||
        !lastname ||
        !email ||
        !phone ||
        !roleInput ||
        !branchLabel
      ) {
        errors.push({
          row: rowNum,
          message:
            "First name, last name, email, phone, role, and warehouse are required",
        });
        continue;
      }

      if (!emailRegex.test(email)) {
        errors.push({ row: rowNum, message: `Invalid email: ${email}` });
        continue;
      }

      if (seenEmails.has(email)) {
        errors.push({
          row: rowNum,
          message: `Duplicate email in file: ${email}`,
        });
        continue;
      }
      if (seenPhones.has(phone)) {
        errors.push({
          row: rowNum,
          message: `Duplicate phone in file: ${phone}`,
        });
        continue;
      }
      seenEmails.add(email);
      seenPhones.add(phone);

      const existingEmail = await userExistsByField("email", email);
      if (existingEmail) {
        errors.push({ row: rowNum, message: `Email already exists: ${email}` });
        continue;
      }

      const existingPhone = await userExistsByField("phone", phone);
      if (existingPhone) {
        errors.push({
          row: rowNum,
          message: `Phone already exists: ${phone}`,
        });
        continue;
      }

      const allowedStatus = ["verified", "pending", "suspended"];
      const resolvedStatus = allowedStatus.includes(status)
        ? status
        : "verified";

      const transaction = await db.sequelize.transaction();
      try {
        // Align connection collation with number_generator / mixed tables
        await db.sequelize.query(
          `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`,
          { transaction },
        );

        const resolvedRole = await resolveOrCreateRole(roleInput, transaction);
        const role = resolvedRole.name;
        const { branch, created: branchWasCreated } =
          await resolveOrCreateBranch(branchLabel, transaction);

        const entryInCode = await getAndUpdateNumber(
          "user",
          facilityId,
          transaction,
        );
        if (entryInCode == null || entryInCode === "") {
          throw new Error(
            "Failed to generate user code — check number_generator prefix `user` for this facility.",
          );
        }

        const entry_id_in = `USER-${entryInCode}`;
        const branchId = parseInt(branch.id, 10);

        const user = await User.create(
          {
            id: entry_id_in,
            firstname,
            lastname,
            email,
            phone,
            role,
            status: resolvedStatus,
            facilityId,
            branchId,
            cashier_type: null,
          },
          { transaction },
        );

        await db.sequelize.query(
          `INSERT INTO membership(business_id, user_id, access_to,role,functionalities,email,branch_id)
          VALUES (:business_id,:in_id, :accessTo,:role, :functionalities,:email,:branch_id )`,
          {
            replacements: {
              business_id: facilityId,
              in_id: user.id,
              role,
              email,
              branch_id: branchId,
              accessTo: "",
              functionalities: "",
            },
            type: db.Sequelize.QueryTypes.INSERT,
            transaction,
          },
        );

        await syncUserBranches(
          user.id,
          facilityId,
          [branchId],
          transaction,
          email,
        );

        await transaction.commit();
        created += 1;
        if (resolvedRole.created) rolesCreated += 1;
        if (branchWasCreated) branchesCreated += 1;
      } catch (rowErr) {
        await transaction.rollback();
        errors.push({
          row: rowNum,
          message: rowErr.message || "Failed to create staff row",
        });
      }
    }

    const failed = errors.length;
    const success = created > 0;
    return res.status(success ? 200 : 400).json({
      success,
      message: success
        ? `Bulk import complete: ${created} staff created${
            rolesCreated ? `, ${rolesCreated} role(s) created` : ""
          }${
            branchesCreated ? `, ${branchesCreated} branch(es) created` : ""
          }${failed ? `, ${failed} failed` : ""}`
        : "Upload failed — no records were imported",
      data: {
        created,
        roles_created: rolesCreated,
        branches_created: branchesCreated,
        failed,
        errors,
      },
    });
  } catch (error) {
    console.error("Error bulk creating staff:", error);
    return res.status(500).json({
      success: false,
      message: "Error bulk creating staff",
      error: error.message,
    });
  }
};

exports.create = async (req, res) => {
  let {
    id = "",
    username = "",
    email = "",
    phone = "",
    password = "",
    busName = "",
    busType = "",
    description = "",
    business_phone = "",
    business_email = "",
    rc = "",
    tin = "",
    fax = "",
    address = "",
    role = "",
    date = "",
    store = "",
    accessTo = "",
    functionalities = "",
    firstname = "",
    lastname = "",
    facilityId,
    query_type = null,
    business_includes_logistics = false,
    fullname = "",
    country = "NG",
  } = req.body;

  // Normalize business types to lowercase array
  const businessTypes = Array.isArray(busType)
    ? busType.map((t) => t.trim().toLowerCase())
    : busType
      ? [busType.trim().toLowerCase()]
      : [];

  const hasRetail =
    businessTypes.includes("retailers") || businessTypes.includes("retail");
  const hasManufacturing =
    businessTypes.includes("manufacturing") ||
    businessTypes.includes("manufacturers");
  const hasServices =
    businessTypes.includes("services") || businessTypes.includes("service");
  const hasRecycling = businessTypes.includes("recycling");

  // Store as properly capitalized comma-separated string
  const business_type =
    businessTypes.length > 0
      ? businessTypes
          .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
          .join(",")
      : "";

  const prefixes = [
    { description: "Account Number", prefix: "account_no" },
    { description: "Batch Number", prefix: "batch_no" },
    { description: "Customer", prefix: "cus" },
    { description: "Customer Deposit", prefix: "cus_dep" },
    { description: "Customer Security Deposit", prefix: "cus_sec_dep" },
    { description: "Direct Purchase", prefix: "direct_p" },
    { description: "Material Entries", prefix: "ent" },
    { description: "production", prefix: "production" },

    { description: "Expenses", prefix: "exp" },
    { description: "Goods Received Note", prefix: "grn" },
    { description: "Inventory ID", prefix: "inv" },
    { description: "Item Code", prefix: "itm" },
    { description: "Journal Entries", prefix: "JE" },
    { description: "Memo", prefix: "mm" },
    { description: "Manufacturing Number for WIP", prefix: "mr" },
    { description: "Purchase Order", prefix: "po" },
    { description: "Purchase Requisition", prefix: "pr" },
    { description: "Production", prefix: "pro" },
    { description: "Product", prefix: "PRODUCT" },
    { description: "Payment Voucher", prefix: "pv" },
    { description: "Rate", prefix: "rate" },
    { description: "Raw Material Collection", prefix: "rm" },
    { description: "Sales", prefix: "sale" },
    { description: "Store ID", prefix: "str" },
    { description: "Supplier", prefix: "sup" },
    { description: "Supplier Payment", prefix: "sup_dep" },
    { description: "User", prefix: "user" },
  ];

  const transaction = await db.sequelize.transaction();

  try {
    // ============ VALIDATION (only for new users) ============
    if (query_type !== "update") {
      // const existingPhoneUser = await User.findOne({
      //   where: { phone },
      //   transaction,
      // });
      // if (existingPhoneUser) {
      //   await transaction.rollback();
      //   return res.status(400).json({
      //     success: false,
      //     msg: "User with this phone number already exists!",
      //   });
      // }

      // KYC signups use kyc_users as the source of truth for email uniqueness
      // (same as check-email-exists). Do not gate on the main users table.
      const existingKycUser = await db.KycUser.findOne({
        where: { email },
        transaction,
      });
      if (existingKycUser) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          msg: "User with this email already exists!",
        });
      }

      if (password.length < 6) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          msg: "Your password can't be less than six characters",
        });
      }
    }

    // ============ HANDLE USER UPDATE ============
    if (query_type === "update") {
      const updateData = {};
      const fields = {
        username,
        email,
        phone,
        address,
        store,
        role,
        date,
        fullname,
        firstname,
        lastname,
      };
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== "") updateData[key] = value;
      });
      if (accessTo) updateData.accessTo = accessTo.toString();
      if (functionalities)
        updateData.functionalities = functionalities.toString();

      if (password) {
        const salt = await bcrypt.genSalt(10);
        updateData.password = await bcrypt.hash(password, salt);
      }

      const updateWhere = { id: req.body.id };
      if (facilityId) updateWhere.facilityId = facilityId;
      if (email) updateWhere.email = email;

      await User.update(updateData, {
        where: updateWhere,
        transaction,
      });
      await transaction.commit();
      return res.json({ success: true, msg: "User updated successfully" });
    }

    // ============ NEW ADMIN CREATION ONLY ============
    if (query_type !== "new_admin") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        msg: "Invalid query_type. Use 'new_admin' for business setup.",
      });
    }

    const _facilityId = UUIDV4();
    const today = moment().format("YYYY-MM-DD HH:mm:ss");
    const appExpiry = moment().add(14, "days").format("YYYY-MM-DD HH:mm:ss");

    // Step 1: Insert Number Generators
    for (const { description, prefix } of prefixes) {
      await db.sequelize.query(
        `INSERT INTO number_generator (description, prefix, code_no, facilityId)
         VALUES (:description, :prefix, 2, :facilityId)
           ON DUPLICATE KEY UPDATE code_no = code_no`,
        {
          replacements: { description, prefix, facilityId: _facilityId },
          transaction,
        },
      );
    }

    // Step 2: Insert Nigerian Bank List
    const bankList = [
      ["FIRST BANK PLC", "011122155", "011", 1],
      ["FIRST CITY MONUMENT BANK PLC", "214121995", "214", 2],
      ["ACCESS BANK NIGERIA", "044121149", "044", 3],
      ["UNITY BANK PLC", "215122401", "215", 4],
      ["ZENITH BANK PLC", "057120014", "057", 5],
      ["GT BANK PLC", "058123010", "058", 6],
      ["STANBIC IBTC BANK PLC", "221120060", "221", 7],
      ["FIDELITY BANK PLC", "070120211", "070", 8],
      ["UNION BANK OF NIGERIA PLC", "032123942", "032", 9],
      ["ECOBANK NIGERIA PLC", "050120545", "050", 10],
      ["STERLING BANK PLC", "232120020", "232", 11],
      ["POLARIS BANK", "076121845", "076", 13],
      ["UNITED BANK FOR AFRICA PLC", "033120601", "033", 14],
      ["JAIZ BANK", "301110042", "301", 16],
      ["Wema Bank", "035121029", "035", 45],
      ["Globus Bank", "103121048", "103", 64],
      ["Titan Trust Bank", "000121049", "000", 65],
      ["ProvidusBank PLC", "101121060", "101", 76],
      ["Opay", "100121068", "100", 84],
      ["Moniepoint Microfinance Bank", "090121069", "090", 85],
    ];

    for (const [bank_name, bank_code, bank_cbn_code, id] of bankList) {
      await db.sequelize.query(
        `INSERT INTO bank_list (bank_name, bank_code, bank_cbn_code, id, facilityId)
         VALUES (:bank_name, :bank_code, :bank_cbn_code, :id, :facilityId)
         ON DUPLICATE KEY UPDATE bank_name = bank_name`,
        {
          replacements: {
            bank_name,
            bank_code,
            bank_cbn_code,
            id,
            facilityId: _facilityId,
          },
          transaction,
        },
      );
    }

    // Step 3: Chart of Accounts — full ACCOUNT_TAXONOMY mapped to 6-digit codes
    // Code scheme: [1-5] single-digit root (level 1), [1-5]XXXXX six-digit (level 2 & 3)
    // Columns: description, display, code, parent_code, level, category, type,
    //          account_nature, facility_id, is_active, created_at, updated_at, subcategory
    const accountsSQL = [];

    // ── LEVEL 1: Root categories ──────────────────────────────────────────
    accountsSQL.push(
      `('Assets',      0, '1', NULL, 1, 'assets',      NULL, 'ASSET', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Liabilities', 0, '2', NULL, 1, 'liabilities', NULL, 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Equity',      0, '3', NULL, 1, 'equity',      NULL, 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Revenue',     0, '4', NULL, 1, 'revenue',     NULL, 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Expenses',    0, '5', NULL, 1, 'expenses',    NULL, 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
    );

    // ── ASSETS: Level 2 types ─────────────────────────────────────────────
    accountsSQL.push(
      `('Current Assets',     0, '100001', '1', 2, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Non-Current Assets', 0, '100002', '1', 2, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
    );

    // ── ASSETS: Level 3 — current_assets subcategories ───────────────────
    accountsSQL.push(
      `('Cash and Cash Equivalents',  1, '100003', '100001', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Cash and Cash Equivalents')`,
      `('Inventory',                  1, '100004', '100001', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Inventory')`,
      `('Receivables',                1, '100005', '100001', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Receivables')`,
      `('Prepayments',                1, '100006', '100001', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Prepayments')`,
      `('Short-Term Investments',     1, '100007', '100001', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Short-Term Investments')`,
      `('Assets Held for Sale',       1, '100008', '100001', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Assets Held for Sale')`,
      `('Other Current Assets',       1, '100009', '100001', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Other Current Assets')`,
      `('Goods in Transit',           1, '100022', '100004', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Goods in Transit')`,
    );

    // ── ASSETS: Level 3 — non_current_assets subcategories ───────────────
    accountsSQL.push(
      `('Property, Plant & Equipment',   1, '100010', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Property, Plant & Equipment')`,
      `('Investment Property',           1, '100011', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Investment Property')`,
      `('Intangible Assets',             1, '100012', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Intangible Assets')`,
      `('Investments',                   1, '100013', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Investments')`,
      `('Right-of-Use Assets',           1, '100014', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Right-of-Use Assets')`,
      `('Biological Assets',             1, '100015', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Biological Assets')`,
      `('Long-Term Receivables',         1, '100016', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Long-Term Receivables')`,
      `('Other Non-Current Assets',      1, '100017', '100002', 3, 'assets', 'Non-Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Other Non-Current Assets')`,
    );

    // ── LIABILITIES: Level 2 types ────────────────────────────────────────
    accountsSQL.push(
      `('Current Liabilities',     0, '200001', '2', 2, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Non-Current Liabilities', 0, '200002', '2', 2, 'liabilities', 'Non-Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
    );

    // ── LIABILITIES: Level 3 — current_liabilities subcategories ─────────
    accountsSQL.push(
      `('Trade Payables',                           1, '200003', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Trade Payables')`,
      `('Accruals',                                 1, '200004', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Accruals')`,
      `('Contract Liabilities / Deferred Revenue',  1, '200005', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Contract Liabilities / Deferred Revenue')`,
      `('Tax Payable',                              1, '200006', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Tax Payable')`,
      `('Interest Payable',                         1, '200007', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Interest Payable')`,
      `('Dividends Payable',                        1, '200008', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Dividends Payable')`,
      `('Short-Term Loans',                         1, '200009', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Short-Term Loans')`,
      `('Customer Deposits',                        1, '200010', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Customer Deposits')`,
      `('Refund Liabilities',                       1, '200011', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Refund Liabilities')`,
      `('Other Current Liabilities',                1, '200012', '200001', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Other Current Liabilities')`,
    );

    // ── LIABILITIES: Level 3 — non_current_liabilities subcategories ─────
    accountsSQL.push(
      `('Loans',                          1, '200013', '200002', 3, 'liabilities', 'Non-Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Loans')`,
      `('Deferred Tax',                   1, '200014', '200002', 3, 'liabilities', 'Non-Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Deferred Tax')`,
      `('Provisions',                     1, '200015', '200002', 3, 'liabilities', 'Non-Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Provisions')`,
      `('Lease Liabilities',              1, '200016', '200002', 3, 'liabilities', 'Non-Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Lease Liabilities')`,
      `('Employee Benefits',              1, '200017', '200002', 3, 'liabilities', 'Non-Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Employee Benefits')`,
      `('Other Non-Current Liabilities',  1, '200018', '200002', 3, 'liabilities', 'Non-Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Other Non-Current Liabilities')`,
    );

    // ── EQUITY: Level 2 (taxonomy equity items have no sub-arrays; direct level-2 accounts)
    accountsSQL.push(
      `('Share Capital',                           0, '300001', '3', 2, 'equity', 'Share Capital', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Share Premium',                           0, '300002', '3', 2, 'equity', 'Share Premium', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Retained Earnings',                       1, '300003', '3', 2, 'equity', 'Retained Earnings', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), 'Retained Earnings')`,
      `('Preference Dividends',                    0, '300004', '3', 2, 'equity', 'Preference Dividends', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Other Reserves',                          0, '300005', '3', 2, 'equity', 'Other Reserves', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Treasury Shares',                         0, '300006', '3', 2, 'equity', 'Treasury Shares', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Non-Controlling Interests',               0, '300007', '3', 2, 'equity', 'Non-Controlling Interests', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Revaluation Reserve',                     0, '300008', '3', 2, 'equity', 'Revaluation Reserve', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Translation Reserve',                     0, '300009', '3', 2, 'equity', 'Translation Reserve', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Accumulated Other Comprehensive Income',  0, '300010', '3', 2, 'equity', 'Accumulated Other Comprehensive Income', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Opening Balance Equity',                  0, '300011', '3', 2, 'equity', 'Opening Balance Equity', 'EQUITY', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
    );

    // ── REVENUE: Level 2 types ────────────────────────────────────────────
    accountsSQL.push(
      `('Operating Revenue',     0, '400001', '4', 2, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Non-Operating Revenue', 0, '400002', '4', 2, 'revenue', 'Non-Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
    );

    // ── REVENUE: Level 3 — operating_revenue subcategories ───────────────
    accountsSQL.push(
      `('Sales',                   1, '400003', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Sales')`,
      `('Service Income',          1, '400004', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Service Income')`,
      `('Subscription Income',     1, '400005', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Subscription Income')`,
      `('Rental Income',           1, '400006', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Rental Income')`,
      `('Project Revenue',         1, '400007', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Project Revenue')`,
      `('Commission Income',       1, '400008', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Commission Income')`,
      `('Grant Income',            1, '400009', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Grant Income')`,
      `('Other Operating Revenue', 1, '400010', '400001', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Other Operating Revenue')`,
    );

    // ── REVENUE: Level 3 — non_operating_revenue subcategories ───────────
    accountsSQL.push(
      `('Interest Income',       1, '400011', '400002', 3, 'revenue', 'Non-Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Interest Income')`,
      `('Gain on Disposal',      1, '400012', '400002', 3, 'revenue', 'Non-Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Gain on Disposal')`,
      `('Foreign Exchange Gain', 1, '400013', '400002', 3, 'revenue', 'Non-Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Foreign Exchange Gain')`,
      `('Dividend Income',       1, '400014', '400002', 3, 'revenue', 'Non-Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Dividend Income')`,
      `('Other Income',          1, '400015', '400002', 3, 'revenue', 'Non-Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Other Income')`,
    );

    // ── EXPENSES: Level 2 types ───────────────────────────────────────────
    accountsSQL.push(
      `('Cost of Sales',          0, '500001', '5', 2, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Operating Expenses',     0, '500002', '5', 2, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Non-Operating Expenses', 0, '500003', '5', 2, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
      `('Taxes',                  0, '500004', '5', 2, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), NULL)`,
    );

    // ── EXPENSES: Level 3 — cost_of_sales subcategories ──────────────────
    accountsSQL.push(
      `('Direct Materials',      1, '500005', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Direct Materials')`,
      `('Direct Labor',          1, '500006', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Direct Labor')`,
      `('Production Overhead',   1, '500007', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Production Overhead')`,
      `('Freight In',            1, '500008', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Freight In')`,
      `('Import Duties',         1, '500009', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Import Duties')`,
      `('Factory Utilities',     1, '500010', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Factory Utilities')`,
      `('Subcontractor Costs',   1, '500011', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Subcontractor Costs')`,
      `('Royalties',             1, '500012', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Royalties')`,
      `('Packaging Costs',       1, '500013', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Packaging Costs')`,
      `('Quality Control Costs', 1, '500014', '500001', 3, 'expenses', 'Cost of Sales', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Quality Control Costs')`,
    );

    // ── EXPENSES: Level 3 — operating_expenses subcategories ─────────────
    accountsSQL.push(
      `('Admin Expenses',                1, '500015', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Admin Expenses')`,
      `('Selling Expenses',              1, '500016', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Selling Expenses')`,
      `('Salaries',                      1, '500017', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Salaries')`,
      `('Staff Welfare',                 1, '500018', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Staff Welfare')`,
      `('Rent Expense',                  1, '500019', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Rent Expense')`,
      `('Utilities',                     1, '500020', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Utilities')`,
      `('Depreciation Expense',          1, '500021', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Depreciation Expense')`,
      `('Amortization Expense',          1, '500022', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Amortization Expense')`,
      `('Marketing Expenses',            1, '500023', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Marketing Expenses')`,
      `('Repair and Maintenance',        1, '500024', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Repair and Maintenance')`,
      `('Insurance Expense',             1, '500025', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Insurance Expense')`,
      `('Travel and Transport',          1, '500026', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Travel and Transport')`,
      `('Professional Fees',             1, '500027', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Professional Fees')`,
      `('Training and Development',      1, '500028', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Training and Development')`,
      `('IT and Software Subscriptions', 1, '500029', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'IT and Software Subscriptions')`,
      `('Bad Debt Expense',              1, '500030', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Bad Debt Expense')`,
      `('Research and Development',      1, '500031', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Research and Development')`,
      `('Regulatory Fees and Levies',    1, '500032', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Regulatory Fees and Levies')`,
      `('Other Operating Expenses',      1, '500033', '500002', 3, 'expenses', 'Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Other Operating Expenses')`,
    );

    // ── EXPENSES: Level 3 — non_operating_expenses subcategories ─────────
    accountsSQL.push(
      `('Interest Expense',      1, '500034', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Interest Expense')`,
      `('Bank Charges',          1, '500035', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Bank Charges')`,
      `('Loan Processing Fees',  1, '500036', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Loan Processing Fees')`,
      `('Impairment Loss',       1, '500037', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Impairment Loss')`,
      `('Foreign Exchange Loss', 1, '500038', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Foreign Exchange Loss')`,
      `('Loss on Disposal',      1, '500039', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Loss on Disposal')`,
      `('Write-Off Losses',      1, '500040', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Write-Off Losses')`,
      `('Penalties and Fines',   1, '500041', '500003', 3, 'expenses', 'Non-Operating Expenses', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Penalties and Fines')`,
    );

    // ── EXPENSES: Level 3 — taxes subcategories ───────────────────────────
    accountsSQL.push(
      `('Income Tax',           1, '500042', '500004', 3, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Income Tax')`,
      `('Deferred Tax Expense', 1, '500043', '500004', 3, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Deferred Tax Expense')`,
      `('Withholding Tax',      1, '500044', '500004', 3, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Withholding Tax')`,
      `('Education Tax',        1, '500045', '500004', 3, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Education Tax')`,
      `('VAT Expense',          1, '500046', '500004', 3, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'VAT Expense')`,
      `('Capital Gains Tax',    1, '500047', '500004', 3, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Capital Gains Tax')`,
      `('Other Taxes',          1, '500048', '500004', 3, 'expenses', 'Taxes', 'EXPENSE', '${_facilityId}', 1, NOW(), NOW(), 'Other Taxes')`,
    );

    // ── BUSINESS-TYPE SPECIFIC ACCOUNTS ──────────────────────────────────
    // Codes 100018-100022 and 200019 reserved for business-specific sub-accounts
    // (100022 Goods in Transit is seeded for all facilities under Inventory)

    // MANUFACTURING & RECYCLING
    if (hasManufacturing || hasRecycling) {
      // WIP inventory sub-accounts under Inventory (100004)
      accountsSQL.push(
        `('Work in Progress',           1, '100018', '100004', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Work in Progress')`,
        `('Raw Materials',              1, '100019', '100004', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Raw Materials')`,
        `('Finished Goods',             1, '100020', '100004', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Finished Goods')`,
        `('Advance to Suppliers',       1, '100021', '100009', 3, 'assets', 'Current Assets', 'ASSET', '${_facilityId}', 1, NOW(), NOW(), 'Advance to Suppliers')`,
        `('Unearned Deposits Received', 1, '200019', '200010', 3, 'liabilities', 'Current Liabilities', 'LIABILITY', '${_facilityId}', 1, NOW(), NOW(), 'Unearned Deposits Received')`,
        `('Discounts Given',            1, '400016', '400003', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Discounts Given')`,
      );
    }

    // RETAIL (if not also manufacturing)
    if (hasRetail && !hasManufacturing && !hasRecycling) {
      accountsSQL.push(
        `('Discounts Given', 1, '400016', '400003', 3, 'revenue', 'Operating Revenue', 'REVENUE', '${_facilityId}', 1, NOW(), NOW(), 'Discounts Given')`,
      );
    }

    // Execute batch insert - Use INSERT IGNORE to handle duplicates gracefully
    if (accountsSQL.length > 0) {
      // Check if Chart of Accounts already exists for this facility
      const existingAccounts = await db.sequelize.query(
        `SELECT COUNT(*) as count FROM account_category WHERE facility_id = :facilityId`,
        {
          replacements: { facilityId: _facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
          transaction,
        },
      );

      const accountCount = existingAccounts[0]?.count || 0;

      // Only insert if no accounts exist for this facility
      if (accountCount === 0) {
        const insertSQL = `
          INSERT IGNORE INTO account_category
          (description, display, code, parent_code, level, category, type,
           account_nature, facility_id, is_active, created_at, updated_at, subcategory)
          VALUES ${accountsSQL.join(",\n")}
        `;

        await db.sequelize.query(insertSQL, { transaction });
      } else {
        console.log(
          `Chart of Accounts already exists for facility ${_facilityId}. Skipping insertion.`,
        );
      }
    }

    // Step 4: Insert Account Types (for account selection dropdowns) — uses new 6-digit codes
    // account_type rows: (code, category, type, detail, account_nature, normal_balance, fs_section, facility_id, is_active)
    const accountTypeSQL = [
      // ── ASSETS ──────────────────────────────────────────────────────────
      `('100003', 'assets', 'Current Assets',       'Cash and Cash Equivalents',  'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100004', 'assets', 'Current Assets',       'Inventory',                  'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100005', 'assets', 'Current Assets',       'Receivables',                'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100006', 'assets', 'Current Assets',       'Prepayments',                'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100007', 'assets', 'Current Assets',       'Short-term Investments',     'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100008', 'assets', 'Current Assets',       'Other Current Assets',       'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100009', 'assets', 'Current Assets',       'Prepayments and Deposits',   'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100022', 'assets', 'Current Assets',       'Goods in Transit',           'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100010', 'assets', 'Non-Current Assets',   'Property Plant and Equipment','ASSET',    'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100011', 'assets', 'Non-Current Assets',   'Intangible Assets',          'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100012', 'assets', 'Non-Current Assets',   'Long-term Investments',      'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('100013', 'assets', 'Non-Current Assets',   'Other Non-Current Assets',   'ASSET',     'DEBIT',  'BS', '${_facilityId}', 1)`,
      // ── LIABILITIES ─────────────────────────────────────────────────────
      `('200001', 'liabilities', 'Current Liabilities',     'Accounts Payable',       'LIABILITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('200002', 'liabilities', 'Current Liabilities',     'Accrued Liabilities',    'LIABILITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('200003', 'liabilities', 'Current Liabilities',     'Short-term Loans',       'LIABILITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('200004', 'liabilities', 'Current Liabilities',     'Deferred Revenue',       'LIABILITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('200005', 'liabilities', 'Current Liabilities',     'Other Current Liabilities','LIABILITY','CREDIT','BS', '${_facilityId}', 1)`,
      `('200013', 'liabilities', 'Non-Current Liabilities', 'Long-term Loans',        'LIABILITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('200014', 'liabilities', 'Non-Current Liabilities', 'Bonds Payable',          'LIABILITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('200015', 'liabilities', 'Non-Current Liabilities', 'Deferred Tax Liabilities','LIABILITY','CREDIT','BS', '${_facilityId}', 1)`,
      // ── EQUITY ──────────────────────────────────────────────────────────
      `('300001', 'equity', 'Share Capital',     'Share Capital',         'EQUITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('300002', 'equity', 'Share Capital',     'Additional Paid-in Capital','EQUITY','CREDIT','BS','${_facilityId}', 1)`,
      `('300003', 'equity', 'Retained Earnings', 'Retained Earnings',     'EQUITY', 'CREDIT', 'BS', '${_facilityId}', 1)`,
      `('300004', 'equity', 'Retained Earnings', 'Dividends',             'EQUITY', 'DEBIT',  'BS', '${_facilityId}', 1)`,
      `('300005', 'equity', 'Other Equity',      'Other Comprehensive Income','EQUITY','CREDIT','BS','${_facilityId}', 1)`,
      // ── REVENUE ─────────────────────────────────────────────────────────
      `('400001', 'revenue', 'Operating Revenue',     'Sales Revenue',          'REVENUE', 'CREDIT', 'PL', '${_facilityId}', 1)`,
      `('400002', 'revenue', 'Non-Operating Revenue', 'Interest Income',        'REVENUE', 'CREDIT', 'PL', '${_facilityId}', 1)`,
      `('400003', 'revenue', 'Operating Revenue',     'Service Revenue',        'REVENUE', 'CREDIT', 'PL', '${_facilityId}', 1)`,
      `('400004', 'revenue', 'Operating Revenue',     'Other Operating Revenue','REVENUE', 'CREDIT', 'PL', '${_facilityId}', 1)`,
      // ── EXPENSES ────────────────────────────────────────────────────────
      `('500001', 'expenses', 'Cost of Sales',           'Cost of Goods Sold',       'EXPENSE', 'DEBIT', 'PL', '${_facilityId}', 1)`,
      `('500002', 'expenses', 'Operating Expenses',      'Operating Expenses',        'EXPENSE', 'DEBIT', 'PL', '${_facilityId}', 1)`,
      `('500003', 'expenses', 'Non-Operating Expenses',  'Non-Operating Expenses',    'EXPENSE', 'DEBIT', 'PL', '${_facilityId}', 1)`,
      `('500004', 'expenses', 'Taxes',                   'Income Tax Expense',        'EXPENSE', 'DEBIT', 'PL', '${_facilityId}', 1)`,
    ];

    // Execute account_type batch insert
    if (accountTypeSQL.length > 0) {
      const existingAccountTypes = await db.sequelize.query(
        `SELECT COUNT(*) as count FROM account_type WHERE facility_id = :facilityId`,
        {
          replacements: { facilityId: _facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
          transaction,
        },
      );

      const accountTypeCount = existingAccountTypes[0]?.count || 0;

      if (accountTypeCount === 0) {
        const insertAccountTypeSQL = `
          INSERT IGNORE INTO account_type
          (code, category, type, detail, account_nature, normal_balance, fs_section, facility_id, is_active)
          VALUES ${accountTypeSQL.join(",\n")}
        `;

        await db.sequelize.query(insertAccountTypeSQL, { transaction });
      } else {
        console.log(
          `Account Types already exist for facility ${_facilityId}. Skipping insertion.`,
        );
      }
    }

    // Generate User Code
    const generatedCode = 1;
    const codeValue =
      typeof generatedCode === "object" ? generatedCode.code_no : generatedCode;
    const entry_id_in = `user-${codeValue}`;

    // Create Business
    await new Promise((resolve, reject) => {
      userApi.createBusiness(
        {
          id: _facilityId,
          business_name: busName,
          business_email: business_email,
          business_type,
          description,
          business_address: address,
          business_logo: "",
          primary_color: "#4267B2",
          secondary_color: "#fff",
          tertiary_color: "#fff",
          license_type: "TRIAL",
          license_expiry: appExpiry,
          license_last_renewal: today,
          business_phone: business_phone,
          rc: rc,
          tin: tin,
          fax: fax,
          business_admin: entry_id_in,
          created_at: today,
          business_includes_logistics,
          store,
          dashboard_widgets: `{"cashFlow":true,"invoices":true,"bankAccounts":true,"referrals":true,"sales":true,"accountsReceivable":true,"workRequests":true,"accountsPayable":true,"expenses":true}`,
          transaction, // Pass transaction to ensure business is created within the same transaction
        },
        resolve,
        reject,
      );
    });

    const defaultBranch = await db.sequelize.query(
      `SELECT id FROM branches
        WHERE facilityId = :facilityId AND is_default = 1
        ORDER BY id ASC
        LIMIT 1`,
      {
        replacements: { facilityId: _facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
        transaction,
      },
    );
    const defaultBranchId = defaultBranch[0]?.id || null;

    // Create User
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpires = moment()
      .add(24, "hours")
      .format("YYYY-MM-DD HH:mm:ss");
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create(
      {
        id: entry_id_in,
        username,
        email,
        phone,
        address,
        store: busName,
        role: "Admin",
        date,
        fullname,
        password: hashedPassword,
        verificationToken,
        verificationExpires,
        accessTo: accessTo.toString(),
        functionalities: functionalities.toString(),
        firstname,
        lastname,
        status: "pending",
        facilityId: _facilityId,
        branchId: defaultBranchId,
      },
      { transaction },
    );

    const mainDepartment = await db.Department.create(
      {
        departmentName: "Main",
        departmentCode: "",
        facilityId: _facilityId,
        description: "",
        headOfDepartment: entry_id_in,
        status: "active",
        type: "main",
      },
      { transaction },
    );

    // Create Membership
    await db.sequelize.query(
      `INSERT INTO membership (business_id, user_id, access_to, functionalities, role, email, departmentId, branch_id)
       VALUES (:business_id, :user_id, :accessTo, :functionalities, :role, :email, :departmentId, :branch_id)`,
      {
        replacements: {
          business_id: _facilityId,
          user_id: newUser.id,
          accessTo: accessTo.toString(),
          functionalities: functionalities.toString(),
          role: "Admin",
          email: email,
          departmentId: mainDepartment.id,
          branch_id: defaultBranchId,
        },
        transaction,
      },
    );

    if (defaultBranchId) {
      await syncUserBranches(
        newUser.id,
        _facilityId,
        [defaultBranchId],
        transaction,
        email,
      );
    }

    // Track this signup in the dedicated KYC table (source of truth for
    // check-email-exists). Kept in the same transaction as the user/business.
    await db.KycUser.create(
      {
        facility_id: _facilityId,
        business_name: busName,
        country,
        first_name: firstname,
        last_name: lastname,
        email,
        phone,
        status: "pending",
      },
      { transaction },
    );

    await transaction.commit();

    // Send Verification Email (new admin account)
    try {
      const verificationUrl = buildEmailVerificationUrl(
        verificationToken,
        email,
        "login",
      );
      const transport = nodemailer.createTransport(
        MailtrapTransport({
          token: process.env.MAILTRAP_TOKEN,
        }),
      );
      const companyWebsite =
        process.env.COMPANY_WEBSITE || "https://aa_erp.org";
      const companyEmail = process.env.COMPANY_EMAIL || "hello@aa_erp.org";
      const companyPhone = process.env.COMPANY_PHONE || "+2348067643479";
      const companyTwitter =
        process.env.COMPANY_TWITTER || "https://x.com/aa_erpng";
      const companyInstagram =
        process.env.COMPANY_INSTAGRAM ||
        "https://www.instagram.com/aa_erpng";
      const companyLinkedIn =
        process.env.COMPANY_LINKEDIN ||
        "https://www.linkedin.com/company/aa_erpng";
      const companyFacebook =
        process.env.COMPANY_FACEBOOK || "https://www.facebook.com/aa_erpng";
      const companyLogoUrl =
        process.env.COMPANY_LOGO_URL || "https://app.aa_erp.org/logo.png";

      const mailOptions = {
        from: '"AA ERP" <no-reply@aa_erp.org>',
        to: email,
        subject: "AA ERP - Email Verification Link",
        category: "Email Verification Link",
        html: `
          <div style="background-color:#f5f5f7;padding:24px 0;font-family: Arial, sans-serif;">
            <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.06);overflow:hidden;">
              <div style="padding:20px 24px 0 24px;">
                <img
                  src="${companyLogoUrl}"
                  alt="AA ERP"
                  style="display:block;height:32px;width:auto;object-fit:contain;"
                />
              </div>

              <div style="padding:24px 24px 16px 24px;">
                <h2 style="margin:0 0 16px 0;font-size:22px;color:#111;">Hi ${fullname || "there"}!</h2>
                <p style="margin:0 0 12px 0;font-size:14px;color:#333;line-height:1.6;">
                  Welcome to <strong style="color:#4267B2;">AA ERP</strong> 🎉
                </p>
                <p style="margin:0 0 20px 0;font-size:14px;color:#333;line-height:1.6;">
                  To finish setting up your account and start using AA ERP, please verify your email address.
                </p>

                <div style="border:1px solid #f3b3c0;background:#fff4f6;border-radius:12px;padding:16px 18px;margin-bottom:20px;text-align:center;">
                  <p style="margin:0 0 12px 0;font-size:14px;color:#b0194a;line-height:1.6;">
                    Email verification helps us keep your account secure.
                  </p>
                  <a href="${verificationUrl}" style="display:inline-block;background-color:#4267B2;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                    Verify Email
                  </a>
                </div>

                <p style="margin:0 0 24px 0;font-size:12px;color:#777;line-height:1.6;">
                  If you didn’t create this account, you can safely ignore this email.
                </p>

                <p style="margin:0 0 8px 0;font-size:13px;color:#555;">
                  With respect,<br/>
                  <strong>AA ERP Team</strong>
                </p>
              </div>

              <div style="border-top:1px solid #eee;padding:16px 24px 20px 24px;font-size:12px;color:#666;line-height:1.6;">
                <div style="margin-bottom:8px;">
                  Website:
                  <a href="${companyWebsite}" style="color:#4267B2;text-decoration:none;">
                    ${companyWebsite}
                  </a>
                </div>
                <div style="margin-bottom:8px;">
                  Email:
                  <a href="mailto:${companyEmail}" style="color:#4267B2;text-decoration:none;">
                    ${companyEmail}
                  </a>
                </div>
                <div style="margin-bottom:8px;">
                  Phone: ${companyPhone}
                </div>
                <div>
                  <p style="margin:0 0 8px 0;font-size:12px;color:#666;">Follow us:</p>
                  <a href="${companyTwitter}" style="display:inline-block;margin-right:12px;">
                    <img src="https://img.icons8.com/color/48/twitterx--v1.png"
                         width="28" height="28" alt="Twitter" style="display:block;" />
                  </a>
                  <a href="${companyInstagram}" style="display:inline-block;margin-right:12px;">
                    <img src="https://img.icons8.com/color/48/instagram-new.png"
                         width="28" height="28" alt="Instagram" style="display:block;" />
                  </a>
                  <a href="${companyLinkedIn}" style="display:inline-block;margin-right:12px;">
                    <img src="https://img.icons8.com/color/48/linkedin.png"
                         width="28" height="28" alt="LinkedIn" style="display:block;" />
                  </a>
                  <a href="${companyFacebook}" style="display:inline-block;">
                    <img src="https://img.icons8.com/color/48/facebook.png"
                         width="28" height="28" alt="Facebook" style="display:block;" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        `,
      };

      await transport.sendMail(mailOptions);
    } catch (emailError) {
      console.error("Email sending failed:", emailError);
    }

    // Fetch Business Profile - Use facilityId directly since we just created it
    try {
      // Fetch business directly using facilityId instead of going through membership
      const business = await db.business.findOne({
        where: { id: _facilityId },
        attributes: [
          "id",
          "business_name",
          "business_type",
          "business_address",
          "wip",
          "opening_balance_equity",
          "sale_revenue_code",
          "business_logo",
          "document_header_style",
          "primary_color",
          "secondary_color",
          "business_phone",
          "business_email",
          "rc",
          "fax",
          "description",
          "prefix",
          "payable_code",
          "finished_goods_code",
          "other_payable_code",
          "receivable_code",
          "cost_of_sale",
          "payable_accural_code",
          "other_receivable_code",
          "receivable_accural_code",
          "seal",
          "inv_ev_m",
          "default_valuation_source",
          "customer_notes",
          "terms_conditions",
        ],
      });

      // Get membership for access_to and functionalities
      const membership = await db.membership.findOne({
        where: { user_id: newUser.id, business_id: _facilityId },
        attributes: ["access_to", "functionalities"],
      });

      const businessProfile = business
        ? {
            ...business.toJSON(),
            access_to: membership?.access_to || accessTo.toString(),
            functionalities:
              membership?.functionalities || functionalities.toString(),
          }
        : null;

      return res.json({
        success: true,
        user: newUser,
        business: businessProfile,
      });
    } catch (profileErr) {
      console.error("Profile fetch failed:", profileErr);
      // Still return success since user and business were created
      return res.json({ success: true, user: newUser, business: null });
    }
  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(console.error);
    }
    console.error("Create User Error:", err);
    return res.status(500).json({
      success: false,
      msg: "An error occurred while creating the user",
      error: err.message,
    });
  }
};

// ========================================
// EMAIL VERIFICATION & PASSWORD RESET
// ========================================
exports.checkEmail = async (req, res) => {
  const { email, facilityId } = req.body;

  try {
    const where = { email };
    if (facilityId) where.facilityId = facilityId;

    const user = await User.findOne({ where });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "No user found with that email" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const verificationExpires = new Date(Date.now() + 10 * 60 * 1000);

    await User.update(
      {
        verificationToken: resetToken,
        verificationExpires,
      },
      { where: { id: user.id, facilityId: user.facilityId } },
    );

    const resetUrl = buildEmailVerificationUrl(resetToken, email, "reset");

    const companyWebsite =
      process.env.COMPANY_WEBSITE || "https://aa_erp.org";
    const companyEmail = process.env.COMPANY_EMAIL || "hello@aa_erp.org";
    const companyPhone = process.env.COMPANY_PHONE || "+2348067643479";
    const companyTwitter =
      process.env.COMPANY_TWITTER || "https://x.com/aa_erpng";
    const companyInstagram =
      process.env.COMPANY_INSTAGRAM || "https://www.instagram.com/aa_erpng";
    const companyLinkedIn =
      process.env.COMPANY_LINKEDIN ||
      "https://www.linkedin.com/company/aa_erpng";
    const companyFacebook =
      process.env.COMPANY_FACEBOOK || "https://www.facebook.com/aa_erpng";
    const companyLogoUrl =
      process.env.COMPANY_LOGO_URL || "https://app.aa_erp.org/logo.png";
    const transport = nodemailer.createTransport(
      MailtrapTransport({
        token: process.env.MAILTRAP_TOKEN,
      }),
    );
    const mailOptions = {
      from: '"AA ERP" <no-reply@aa_erp.org>',
      to: email,
      subject: "AA ERP - Password Reset Verification Link",
      category: "Password Reset Link",
      html: `
        <div style="background-color:#f5f5f7;padding:24px 0;font-family: Arial, sans-serif;">
          <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.06);overflow:hidden;">
            <div style="padding:20px 24px 0 24px;">
              <img
                src="${companyLogoUrl}"
                alt="AA ERP"
                style="display:block;height:32px;width:auto;object-fit:contain;"
              />
            </div>

            <div style="padding:24px 24px 16px 24px;">
              <h2 style="margin:0 0 16px 0;font-size:22px;color:#111;">Hi ${user.firstname}!</h2>
              <p style="margin:0 0 12px 0;font-size:14px;color:#333;line-height:1.6;">
                We received a request to reset your <strong style="color:#4267B2;">AA ERP</strong> account password.
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;color:#333;line-height:1.6;">
                To create a new password for your account, please click the button below.
              </p>

              <div style="border:1px solid #f3b3c0;background:#fff4f6;border-radius:12px;padding:16px 18px;margin-bottom:20px;text-align:center;">
                <p style="margin:0 0 12px 0;font-size:14px;color:#b0194a;line-height:1.6;">
                  This password reset link will expire in 10 minutes for your security.
                </p>
                <a href="${resetUrl}" style="display:inline-block;background-color:#4267B2;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                  Reset Password
                </a>
              </div>

              <p style="margin:0 0 24px 0;font-size:12px;color:#777;line-height:1.6;">
                If you did not request a password reset, you can safely ignore this email.
              </p>

              <p style="margin:0 0 8px 0;font-size:13px;color:#555;">
                With respect,<br/>
                <strong>AA ERP Team</strong>
              </p>
            </div>

            <div style="border-top:1px solid #eee;padding:16px 24px 20px 24px;font-size:12px;color:#666;line-height:1.6;">
              <div style="margin-bottom:8px;">
                Website:
                <a href="${companyWebsite}" style="color:#4267B2;text-decoration:none;">
                  ${companyWebsite}
                </a>
              </div>
              <div style="margin-bottom:8px;">
                Email:
                <a href="mailto:${companyEmail}" style="color:#4267B2;text-decoration:none;">
                  ${companyEmail}
                </a>
              </div>
              <div style="margin-bottom:8px;">
                Phone: ${companyPhone}
              </div>
              <div>
                <p style="margin:0 0 8px 0;font-size:12px;color:#666;">Follow us:</p>
                <a href="${companyTwitter}" style="display:inline-block;margin-right:12px;">
                  <img src="https://img.icons8.com/color/48/twitterx--v1.png"
                       width="28" height="28" alt="Twitter" style="display:block;" />
                </a>
                <a href="${companyInstagram}" style="display:inline-block;margin-right:12px;">
                  <img src="https://img.icons8.com/color/48/instagram-new.png"
                       width="28" height="28" alt="Instagram" style="display:block;" />
                </a>
                <a href="${companyLinkedIn}" style="display:inline-block;margin-right:12px;">
                  <img src="https://img.icons8.com/color/48/linkedin.png"
                       width="28" height="28" alt="LinkedIn" style="display:block;" />
                </a>
                <a href="${companyFacebook}" style="display:inline-block;">
                  <img src="https://img.icons8.com/color/48/facebook.png"
                       width="28" height="28" alt="Facebook" style="display:block;" />
                </a>
              </div>
            </div>
          </div>
        </div>
      `,
    };

    await transport.sendMail(mailOptions);
    return res.status(200).json({
      success: true,
      message: `Password reset email sent to ${email}!`,
    });
  } catch (err) {
    console.error("Password reset error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during verification" });
  }
};

exports.inviteStaff = async (req, res) => {
  const { email, businessId } = req.body; // <-- Make sure frontend sends businessId

  try {
    const user = await User.findOne({ where: { email } });

    const transport = nodemailer.createTransport(
      MailtrapTransport({
        token: process.env.MAILTRAP_TOKEN,
      }),
    );
    const companyWebsite =
      process.env.COMPANY_WEBSITE || "https://app.aa_erp.org";
    const companyEmail = process.env.COMPANY_EMAIL || "hello@aa_erp.org";
    const companyPhone = process.env.COMPANY_PHONE || "+2348067643479";
    const companyTwitter =
      process.env.COMPANY_TWITTER || "twitter.com/aa_erpng";
    const companyInstagram =
      process.env.COMPANY_INSTAGRAM || "instagram.com/aa_erpng";
    const companyFacebook =
      process.env.COMPANY_FACEBOOK || "facebook.com/aa_erpng";
    const companyLinkedIn =
      process.env.COMPANY_LINKEDIN || "linkedin.com/company/yourcompany";
    const companyLogoUrl =
      process.env.COMPANY_LOGO_URL || "https://app.aa_erp.org/logo.png";
    console.log(companyLogoUrl);

    if (user) {
      // ✅ Send invite with embedded userId & businessId  https://dashboard.aa_erp.app/accept-invite?userId=${user.id}&businessId=${businessId}`;
      const actionLink = `https://app.aa_erp.org/accept-invite?userId=${user.id}&businessId=${businessId}`;

      const mailOptions = {
        from: '"AA ERP" <no-reply@aa_erp.org>',
        to: email,
        subject: "You've Been Invited to Join AA ERP as Staff",
        html: `
          <div style="background-color:#f5f5f7;padding:24px 0;font-family: Arial, sans-serif;">
            <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.06);overflow:hidden;">
              <div style="padding:20px 24px 0 24px;display:flex;justify-content:space-between;align-items:center;">
              <div style="font-weight:bold;font-size:18px;color:#333;">
                <img
                  src="${companyLogoUrl}"
                  alt="AA ERP"
                  style="display:block;height:32px;width:auto;object-fit:contain;"
                />
              </div>
              </div>

              <div style="padding:24px 24px 16px 24px;">
                <h2 style="margin:0 0 16px 0;font-size:22px;color:#111;">Hi ${user.firstname}!</h2>
                <p style="margin:0 0 12px 0;font-size:14px;color:#333;line-height:1.6;">
                  You have been invited to join the <strong>AA ERP</strong> workspace as a staff member.
                </p>
                <p style="margin:0 0 20px 0;font-size:14px;color:#333;line-height:1.6;">
                  To complete your registration and activate your staff account, please use the link below.
                </p>

                <div style="border:1px solid #f3b3c0;background:#fff4f6;border-radius:12px;padding:16px 18px;margin-bottom:20px;">
                  <p style="margin:0 0 8px 0;font-size:14px;color:#b0194a;line-height:1.6;">
                    Account activation is required to complete your invitation and access AA ERP.
                  </p>
                  <p style="margin:0;font-size:14px;line-height:1.6;">
                    Please follow this link:
                    <a href="${actionLink}" style="color:#b0194a;text-decoration:underline;">
                      Activate your staff account
                    </a>
                  </p>
                </div>

                <p style="margin:0 0 24px 0;font-size:12px;color:#777;line-height:1.6;">
                  If you didn’t expect this invitation, you can safely ignore this message.
                </p>

                <p style="margin:0 0 8px 0;font-size:13px;color:#555;">
                  With respect,<br/>
                  <strong>AA ERP Team</strong>
                </p>
              </div>

              <div style="border-top:1px solid #eee;padding:16px 24px 20px 24px;font-size:12px;color:#666;line-height:1.6;">
                <div style="margin-bottom:8px;">
                  Website:
                  <a href="${companyWebsite}" style="color:#4267B2;text-decoration:none;">
                    ${companyWebsite}
                  </a>
                </div>
                <div style="margin-bottom:8px;">
                  Email:
                  <a href="mailto:${companyEmail}" style="color:#4267B2;text-decoration:none;">
                    ${companyEmail}
                  </a>
                </div>
                <div style="margin-bottom:8px;">
                  Phone: ${companyPhone}
                </div>
                <div>
                  <p style="margin:0 0 8px 0;font-size:12px;color:#666;">Follow us:</p>
                 <a href="${companyTwitter}" style="display:inline-block;margin-right:12px;">
  <img src="https://img.icons8.com/color/48/twitterx--v1.png"
       width="28" height="28" alt="Twitter" style="display:block;" />
</a>

<a href="${companyInstagram}" style="display:inline-block;margin-right:12px;">
  <img src="https://img.icons8.com/color/48/instagram-new.png"
       width="28" height="28" alt="Instagram" style="display:block;" />
</a>

<a href="${companyLinkedIn}" style="display:inline-block;margin-right:12px;">
  <img src="https://img.icons8.com/color/48/linkedin.png"
       width="28" height="28" alt="LinkedIn" style="display:block;" />
</a>

<a href="${companyFacebook}" style="display:inline-block;">
  <img src="https://img.icons8.com/color/48/facebook.png"
       width="28" height="28" alt="Facebook" style="display:block;" />
</a>
                </div>
              </div>
            </div>
          </div>
        `,
        category: "Staff Invite",
      };

      await transport.sendMail(mailOptions);
      return res.status(200).json({
        success: true,
        message: "User exists, invite link sent to user",
      });
    } else {
      // ❌ Do not send email
      return res.status(200).json({
        success: false,
        message: "User does not exist, please add the user first",
      });
    }
  } catch (error) {
    console.error("Error inviting staff:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// controller for accepting invite
exports.acceptInvite = async (req, res) => {
  const {
    userId,
    businessId,
    functionalities = "",
    access_to = "",
  } = req.body;

  try {
    // 1. Check if User exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 2. Check if Business exists (raw query since there's no Business model)
    const [businessResults] = await db.sequelize.query(
      "SELECT * FROM business WHERE id = :businessId",
      { replacements: { businessId }, type: db.Sequelize.QueryTypes.SELECT },
    );

    if (!businessResults) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    // 3. Check if Membership already exists
    const [existingMembership] = await db.sequelize.query(
      "SELECT * FROM membership WHERE user_id = :userId AND business_id = :businessId",
      {
        replacements: { userId, businessId },
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    if (existingMembership) {
      return res.status(400).json({
        success: false,
        message: "You are already a member of this business",
      });
    }
    const status = "Approved";
    // 4. Create Membership (raw insert)
    await db.sequelize.query(
      `INSERT INTO membership (
    business_id,
    user_id,
    functionalities,
    access_to,
    email
  ) VALUES (:businessId, :userId, :functionalities, :access_to, :email)`,
      {
        replacements: {
          businessId,
          userId,
          functionalities,
          access_to,
          email: user.email,
        },
        type: db.Sequelize.QueryTypes.INSERT,
      },
    );

    return res.status(200).json({
      success: true,
      message: "You have been successfully added to the business",
    });
  } catch (error) {
    console.error("Error accepting invite:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while accepting invitations",
      error: error.message,
    });
  }
};

exports.verifyEmail = async (req, res) => {
  const { token, type, email } = req.query;

  try {
    let user;

    if (type === "reset") {
      if (email) {
        user = await User.findOne({
          where: { verificationToken: token, email },
        });
      } else if (token) {
        user = await User.findOne({
          where: { verificationToken: token },
        });
      } else {
        return res.status(400).json({ message: "Invalid or expired token" });
      }
    } else {
      if (!token || !email) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }
      user = await User.findOne({
        where: { verificationToken: token, email },
      });
    }

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    if (
      user.verificationExpires &&
      new Date(user.verificationExpires).getTime() < Date.now()
    ) {
      return res.status(400).json({ message: "Token has expired" });
    }

    if (type === "reset") {
      return res.status(200).json({
        success: true,
        type: "reset",
        message: "Request for password reset is verified",
        email: user.email,
      });
    }

    await User.update(
      {
        status: "verified",
        verificationToken: null,
        verificationExpires: null,
      },
      { where: { id: user.id, facilityId: user.facilityId } },
    );

    // Keep KYC signup row in sync when the user verifies via email.
    try {
      await db.KycUser.update(
        { status: "verified" },
        { where: { email: user.email } },
      );
    } catch (kycErr) {
      console.error("KYC status update after email verify failed:", kycErr);
    }

    return res.status(200).json({
      success: true,
      type: "login",
      message: "Email verified successfully! You can now log in.",
    });
  } catch (err) {
    console.error("Email verification error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during verification" });
  }
};

exports.verifyUser = async (req, res) => {
  const { email, facilityId } = req.query;
  try {
    const where = { email };
    if (facilityId) where.facilityId = facilityId;

    const user = await User.findOne({ where });
    console.log("user", user?.dataValues);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "No user found with that email" });
    } else if (user.dataValues.status === "verified") {
      let error = "Your account has been verified!";
      return res.status(404).json({ success: false, message: error });
    } else if (user.dataValues.status === "suspended") {
      let error = "Your account has been suspended, contact business admin.";
      return res.status(404).json({ success: false, message: error });
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    // const verificationExpires = new Date(Date.now() + 10 * 60 * 1000);
    const verificationExpires = new Date(Date.now() + 60 * 60 * 1000);
    await User.update(
      {
        verificationToken,
        verificationExpires,
      },
      { where: { id: user.id, facilityId: user.facilityId } },
    );
    const verificationUrl = buildEmailVerificationUrl(
      verificationToken,
      email,
      "login",
    );

    try {
      const transport = nodemailer.createTransport(
        MailtrapTransport({
          token: process.env.MAILTRAP_TOKEN,
        }),
      );
      const companyWebsite =
        process.env.COMPANY_WEBSITE || "https://aa_erp.org";
      const companyEmail = process.env.COMPANY_EMAIL || "hello@aa_erp.org";
      const companyPhone = process.env.COMPANY_PHONE || "+2348067643479";
      const companyTwitter =
        process.env.COMPANY_TWITTER || "https://x.com/aa_erpng";
      const companyInstagram =
        process.env.COMPANY_INSTAGRAM ||
        "https://www.instagram.com/aa_erpng";
      const companyLinkedIn =
        process.env.COMPANY_LINKEDIN ||
        "https://www.linkedin.com/company/aa_erpng";
      const companyFacebook =
        process.env.COMPANY_FACEBOOK || "https://www.facebook.com/aa_erpng";
      const companyLogoUrl =
        process.env.COMPANY_LOGO_URL || "https://app.aa_erp.org/logo.png";

      const mailOptions = {
        from: '"AA ERP" <no-reply@aa_erp.org>',
        to: email,
        subject: "AA ERP - Email Verification Link",
        category: "Email Verification Link",
        html: `
          <div style="background-color:#f5f5f7;padding:24px 0;font-family: Arial, sans-serif;">
            <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.06);overflow:hidden;">
              <div style="padding:20px 24px 0 24px;">
                <img
                  src="${companyLogoUrl}"
                  alt="AA ERP"
                  style="display:block;height:32px;width:auto;object-fit:contain;"
                />
              </div>

              <div style="padding:24px 24px 16px 24px;">
                <h2 style="margin:0 0 16px 0;font-size:22px;color:#111;">Hi!</h2>
                <p style="margin:0 0 12px 0;font-size:14px;color:#333;line-height:1.6;">
                  Thank you for using <strong style="color:#4267B2;">AA ERP</strong>!
                </p>
                <p style="margin:0 0 20px 0;font-size:14px;color:#333;line-height:1.6;">
                  To finish setting up your account and start using AA ERP, please verify your email address.
                </p>

                <div style="border:1px solid #f3b3c0;background:#fff4f6;border-radius:12px;padding:16px 18px;margin-bottom:20px;text-align:center;">
                  <p style="margin:0 0 12px 0;font-size:14px;color:#b0194a;line-height:1.6;">
                    Email verification helps us keep your account secure.
                  </p>
                  <a href="${verificationUrl}" style="display:inline-block;background-color:#4267B2;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
                    Verify Email
                  </a>
                </div>

                <p style="margin:0 0 24px 0;font-size:12px;color:#777;line-height:1.6;">
                  If you did not create this account, you can safely ignore this email.
                </p>

                <p style="margin:0 0 8px 0;font-size:13px;color:#555;">
                  With respect,<br/>
                  <strong>AA ERP Team</strong>
                </p>
              </div>

              <div style="border-top:1px solid #eee;padding:16px 24px 20px 24px;font-size:12px;color:#666;line-height:1.6;">
                <div style="margin-bottom:8px;">
                  Website:
                  <a href="${companyWebsite}" style="color:#4267B2;text-decoration:none;">
                    ${companyWebsite}
                  </a>
                </div>
                <div style="margin-bottom:8px;">
                  Email:
                  <a href="mailto:${companyEmail}" style="color:#4267B2;text-decoration:none;">
                    ${companyEmail}
                  </a>
                </div>
                <div style="margin-bottom:8px;">
                  Phone: ${companyPhone}
                </div>
                <div>
                  <p style="margin:0 0 8px 0;font-size:12px;color:#666;">Follow us:</p>
                  <a href="${companyTwitter}" style="display:inline-block;margin-right:12px;">
                    <img src="https://img.icons8.com/color/48/twitterx--v1.png"
                         width="28" height="28" alt="Twitter" style="display:block;" />
                  </a>
                  <a href="${companyInstagram}" style="display:inline-block;margin-right:12px;">
                    <img src="https://img.icons8.com/color/48/instagram-new.png"
                         width="28" height="28" alt="Instagram" style="display:block;" />
                  </a>
                  <a href="${companyLinkedIn}" style="display:inline-block;margin-right:12px;">
                    <img src="https://img.icons8.com/color/48/linkedin.png"
                         width="28" height="28" alt="LinkedIn" style="display:block;" />
                  </a>
                  <a href="${companyFacebook}" style="display:inline-block;">
                    <img src="https://img.icons8.com/color/48/facebook.png"
                         width="28" height="28" alt="Facebook" style="display:block;" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        `,
      };

      await transport.sendMail(mailOptions);
      return res
        .status(200)
        .json({ success: true, message: `Email sent to ${email}!` });
    } catch (emailError) {
      console.error("Email sending failed:", emailError);
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email",
        error: emailError.message || String(emailError),
      });
    }
  } catch (err) {
    console.error("Error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during verification" });
  }
};

exports.updateStatus = async (req, res) => {
  const { email, status } = req.body;

  try {
    const user = await User.findOne({ where: { email } });
    console.log("user", user.dataValues);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "No user found with that email" });
    }

    user.status = status;
    await user.save();

    return res.status(200).json({
      success: true,
      type: "login",
      message: "Email verified successfully! You can now log in.",
    });
  } catch (err) {
    console.error("Error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during verification" });
  }
};

exports.updateSignature = async (req, res) => {
  const { email, signature } = req.body;

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found with that email",
      });
    }

    user.signature = signature;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Signature updated successfully!",
    });
  } catch (err) {
    console.error("Error saving signature:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during signature update",
    });
  }
};

exports.resetPassword = async (req, res) => {
  const { password, token } = req.body;

  if (!password || !token) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Your password can't be less than six characters",
    });
  }

  try {
    const user = await User.findOne({
      where: { verificationToken: token },
    });

    if (!user || !user.verificationToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    if (
      user.verificationExpires &&
      new Date(user.verificationExpires).getTime() < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const email = String(user.email).trim();

    await User.update(
      {
        password: hashedPassword,
        verificationToken: null,
        verificationExpires: null,
      },
      { where: { id: user.id, facilityId: user.facilityId, email } },
    );

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You can now log in.",
    });
  } catch (err) {
    console.error("Reset password error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error during password reset" });
  }
};

// ========================================
// USER AUTHENTICATION
// ========================================
exports.updateUser = (req, res) => {
  const { id } = req.params;
  const {
    firstname,
    lastname,
    accessTo,
    functionalities,
    role,
    username,
    email,
    password,
    image,
    status,
    address,
    phone,
  } = req.body;

  User.findByPk(id)
    .then(async (user) => {
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Hash password if provided
      let updateData = {
        firstname,
        lastname,
        accessTo,
        functionalities,
        role,
        username,
        email,
        image,
        status,
        address,
        phone,
      };

      if (password) {
        try {
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);
          updateData.password = hashedPassword;
        } catch (err) {
          console.error("Password hashing error:", err);
          return res.status(500).json({ message: "Error hashing password" });
        }
      }

      // Remove undefined fields
      Object.keys(updateData).forEach(
        (key) => updateData[key] === undefined && delete updateData[key],
      );

      user
        .update(updateData)
        .then((updatedUser) => {
          return res
            .status(200)
            .json({ message: "User updated successfully", user: updatedUser });
        })
        .catch((err) => {
          console.error("Update error:", err);
          return res.status(500).json({ message: "Failed to update user" });
        });
    })
    .catch((err) => {
      console.error("Find error:", err);
      return res.status(500).json({ message: "Internal server error" });
    });
};

exports.login = (req, res) => {
  const { email, password } = req.body;
  User.findAll({
    where: {
      email,
    },
  })
    .then((user) => {
      //check for user
      // console.log(user)
      if (!user.length) {
        let error = "User not found!!!";
        return res.status(404).json({ success: false, message: error });
      } else if (user[0].dataValues.status === "pending") {
        let error =
          "Your account is not yet verified, check mail for verification";
        return res.status(404).json({
          success: false,
          message: error,
          facilityId: user[0].dataValues.facilityId,
        });
      }

      let originalPassword = user[0].dataValues.password;

      //check for password
      bcrypt
        .compare(password, originalPassword)
        .then((isMatch) => {
          if (isMatch) {
            // user matched
            console.log("matched!");
            // console.log(user[0].dataValues);
            const { id, username, email, facilityId } = user[0].dataValues;
            const payload = { id, username, email, facilityId }; //jwt payload
            jwt.sign(
              payload,
              JWT_SECRET,
              {
                expiresIn: JWT_EXPIRES_IN,
              },
              async (err, token) => {
                // let accessTo = [],

                const branchMap = await getBranchesForUsers([
                  user[0].dataValues.id,
                ]);
                const branches = branchMap[user[0].dataValues.id] || [];
                const branchIds = branches.map((b) => b.id);
                const primaryBranch =
                  branches.find((b) => b.is_primary) || branches[0];

                const sendLoginSuccess = (business, businessesList = []) => {
                  const userRole = user[0].dataValues.role;
                  const designation = mapRoleToDesignation(userRole);
                  const currentBusiness = business?.[0]?.[0];
                  let result = {
                    success: true,
                    token: "Bearer " + token,
                    user: {
                      id: user[0].dataValues.id,
                      username: user[0].dataValues.username,
                      fullname: user[0].dataValues.fullname,
                      firstname: user[0].dataValues.firstname,
                      lastname: user[0].dataValues.lastname,
                      email: user[0].dataValues.email,
                      phone: user[0].dataValues.phone,
                      busName: user[0].dataValues.busName,
                      businessType: user[0].dataValues.businessType,
                      address: user[0].dataValues.address,
                      facilityId: user[0].dataValues.facilityId,
                      branchId:
                        user[0].dataValues.branchId ||
                        primaryBranch?.id ||
                        null,
                      branchIds,
                      branches,
                      branch_name:
                        primaryBranch?.branch_name ||
                        user[0].dataValues.branch_name ||
                        null,
                      branch_names: branches.map((b) => b.branch_name),
                      departmentId: user[0].dataValues.departmentId || null,
                      role: userRole,
                      cashier_type: user[0].dataValues.cashier_type || null,
                      description:
                        currentBusiness?.description ??
                        business?.dataValues?.description,
                      designation: designation,
                      createdAt: user[0].dataValues.createdAt,
                      updatedAt: user[0].dataValues.updatedAt,
                      licenseExpiry: user[0].dataValues.licenseExpiry,
                      appExpiry: user[0].dataValues.appExpiry,
                      store: user[0].dataValues.store,
                      accessTo: currentBusiness?.access_to
                        ? currentBusiness.access_to
                            .split(",")
                            .filter((item) => item.trim())
                        : [],
                      functionalities: currentBusiness?.functionalities
                        ? currentBusiness.functionalities
                            .split(",")
                            .filter((item) => item.trim())
                        : [],
                    },
                    business: business,
                    businessesList: businessesList,
                    businessCount: businessesList.length,
                    branch_id: currentBusiness?.branch_id || null,
                  };
                  console.log(result);
                  res.json(result);
                };

                userApi.getBusinessProfile(
                  sendLoginSuccess,
                  (profileErr) => {
                    console.error(
                      "Business profile load failed during login:",
                      profileErr,
                    );
                    sendLoginSuccess(null, []);
                  },
                  user[0].dataValues.email,
                );
              },
            );
          } else {
            let error = "Password not correct";
            return res.status(200).json({ success: false, message: error });
          }
        })
        .catch((err) => console.log(err));
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.loginWithUsername = (req, res) => {
  const { errors, isValid } = validateLoginForm(req.body);
  let error;

  // check validation
  if (!isValid) {
    return res.status(400).json({ error: errors.toString() });
  }

  const { username, password } = req.body;

  User.findOne({
    where: {
      username,
      status: "approved",
    },
  })
    .then((user) => {
      console.log({ user });
      //check for user
      if (!user.length) {
        error = "User not found or not approved!";
        return res.status(404).json({ error });
      }

      let originalPassword = user.password;

      //check for password
      bcrypt
        .compare(password, originalPassword)
        .then((isMatch) => {
          if (isMatch) {
            // user matched
            console.log("matched!");
            const { id, username } = user[0].dataValues;
            const payload = { id, username }; //jwt payload
            // console.log(payload)

            jwt.sign(
              payload,
              JWT_SECRET,
              {
                expiresIn: JWT_EXPIRES_IN,
              },
              (err, token) => {
                // let accessTo = [],
                const userRole = user[0].dataValues.role;
                const designation = mapRoleToDesignation(userRole);

                let result = {
                  success: true,
                  token: "Bearer " + token,
                  user: {
                    id: user[0].dataValues.id,
                    username: user[0].dataValues.username,
                    firstname: user[0].dataValues.firstname,
                    lastname: user[0].dataValues.lastname,
                    email: user[0].dataValues.email,
                    phone: user[0].dataValues.phone,
                    image: user[0].dataValues.image,
                    role: userRole,
                    cashier_type: user[0].dataValues.cashier_type || null,
                    designation: designation,
                    accessTo: user[0]?.dataValues?.accessTo?.split(","),
                    facilityId: user[0].dataValues.facilityId,
                    prefix: user[0].dataValues.prefix,
                    speciality: user[0].dataValues.speciality,
                    userType: user[0].dataValues.userType,
                    serviceCost: user[0].dataValues.serviceCost,
                    referralId: user[0].dataValues.referralId,
                    address: user[0].dataValues.address,
                    available: user[0].dataValues.available,
                    availableDays: user[0].dataValues.availableDays,
                    availableFromTime: user[0].dataValues.availableFromTime,
                    availableToTime: user[0].dataValues.availableToTime,
                    department: user[0].dataValues.department,
                    functionality:
                      user[0]?.dataValues?.functionality?.split(","),
                    branch_name: user[0].dataValues.branch_name,
                  },
                };
                res.json(result);

                console.log(user[0].dataValues);
              },
            );
          } else {
            let error = "Password not correct";
            return res.status(400).json({ error });
          }
        })
        .catch((err) => console.log(err));
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ error });
    });
};

exports.verifyUserToken = (req, res) => {
  const authToken =
    req.headers["authorization"] || req.headers["Authorization"];
  if (!authToken || typeof authToken !== "string") {
    return res.status(401).json({
      success: false,
      msg: "No token provided.",
    });
  }
  const token = authToken.startsWith("Bearer ")
    ? authToken.slice(7).trim()
    : authToken.trim().split(/\s+/).pop();

  if (!token) {
    return res.status(401).json({
      success: false,
      msg: "No token provided.",
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      const expired = err.name === "TokenExpiredError";
      if (expired) {
        console.warn("[verifyUserToken] JWT expired");
      } else {
        console.warn(
          "[verifyUserToken]",
          err.name || "JsonWebTokenError",
          err.message,
        );
      }
      return res.status(401).json({
        success: false,
        msg: expired
          ? "Session expired. Please sign in again."
          : "Failed to authenticate token.",
        code: err.name,
      });
    }
    const { id, email, facilityId, username } = decoded;
    User.findAll({
      where: { id, email, facilityId },
    })
      .then((user) => {
        if (!user.length) {
          return res.json({ success: false, msg: "user not found" });
        }

        userApi.getBusinessProfile(
          async (business, businessesList = []) => {
            const userRole = user[0].dataValues.role;
            const designation = mapRoleToDesignation(userRole);
            const currentBusiness = business?.[0]?.[0];
            const userId = user[0].dataValues.id;
            const branchMap = await getBranchesForUsers([userId]);
            const branches = branchMap[userId] || [];
            const branchIds = branches.map((b) => b.id);
            const primaryBranch =
              branches.find((b) => b.is_primary) || branches[0];

            // Issue a fresh token on each successful verify (sliding session)
            const freshToken = jwt.sign(
              {
                id: userId,
                username: user[0].dataValues.username || username,
                email: user[0].dataValues.email || email,
                facilityId: user[0].dataValues.facilityId || facilityId,
              },
              JWT_SECRET,
              { expiresIn: JWT_EXPIRES_IN },
            );

            res.json({
              success: true,
              token: "Bearer " + freshToken,
              user: {
                id: userId,
                username: user[0].dataValues.username,
                fullname: user[0].dataValues.fullname,
                firstname: user[0].dataValues.firstname,
                lastname: user[0].dataValues.lastname,
                email: user[0].dataValues.email,
                phone: user[0].dataValues.phone,
                busName: user[0].dataValues.busName,
                businessType: user[0].dataValues.businessType,
                address: user[0].dataValues.address,
                role: userRole,
                cashier_type: user[0].dataValues.cashier_type || null,
                designation: designation,
                facilityId: user[0].dataValues.facilityId,
                facilityID: user[0].dataValues.facilityId,
                branchId:
                  user[0].dataValues.branchId || primaryBranch?.id || null,
                branchIds,
                branches,
                branch_name:
                  primaryBranch?.branch_name ||
                  user[0].dataValues.branch_name ||
                  null,
                branch_names: branches.map((b) => b.branch_name),
                departmentId: user[0].dataValues.departmentId || null,
                createdAt: user[0].dataValues.createdAt,
                updatedAt: user[0].dataValues.updatedAt,
                licenseExpiry: user[0].dataValues.licenseExpiry,
                appExpiry: user[0].dataValues.appExpiry,
                store: user[0].dataValues.store,
                accessTo: currentBusiness?.access_to
                  ? currentBusiness.access_to
                      .split(",")
                      .filter((item) => item.trim())
                  : [],
                functionalities: currentBusiness?.functionalities
                  ? currentBusiness.functionalities
                      .split(",")
                      .filter((item) => item.trim())
                  : [],
              },
              business: business || [],
              businessesList: businessesList || [],
              businessCount: (businessesList || []).length,
            });
          },
          (profileErr) => {
            console.error(
              "[verifyUserToken] business profile failed:",
              profileErr,
            );
            return res.status(500).json({
              success: false,
              msg: "Unable to restore session profile.",
            });
          },
          user[0].dataValues.email,
        );
      })
      .catch((err) => {
        console.log({ err });
        res.status(500).json({ success: false, msg: err });
        console.log(err);
      });
  });
};

exports.profile = (req, res) => {
  const { userId } = req.params;

  User.findAll({
    where: {
      id: userId,
    },
  })
    .then((user) => {
      res.json({ success: true, user });
    })
    .catch((err) => res.json({ err }));
};

// ========================================
// USER MANAGEMENT
// ========================================
exports.verifyOTP = async (req, res) => {
  const { verify } = req.params;
  try {
    const kyc = await db.KycUser.findOne({ where: { code: verify } });
    if (!kyc || !kyc.code) {
      return res
        .status(404)
        .json({ success: false, message: "OTP is not correct" });
    }

    const codeStillValid = kyc.expiring_code
      ? moment.utc().isBefore(moment.utc(kyc.expiring_code))
      : false;

    if (codeStillValid) {
      return res.json({ arr: kyc, message: "OTP is valid" });
    }
    return res.json({ success: false, message: "OTP have expired" });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ err: err.message, message: "OTP is not correct" });
  }
};

exports.forgetPassword = async (req, res) => {
  const { phone } = req.params;
  console.log(phone);
  try {
    const kyc = await db.KycUser.findOne({ where: { phone } });
    if (!kyc) {
      return res
        .status(404)
        .json({ success: false, message: "Check your phone number" });
    }

    const time = moment.utc().add(65, "minute").format("YYYY-MM-DD HH:mm:ss");
    const number = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");

    kyc.code = number;
    kyc.expiring_code = time;
    await kyc.save();

    SMS.send(
      phone,
      smsTemplates.purchase(number),
      (_resp) => {
        console.log(_resp);
        res.json({
          success: true,
          _resp,
          message: "Successfully sent to your register phone number",
        });
      },
      (err) => {
        console.log(err);
        res.json({ success: false, err });
      },
    );
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, err: err.message });
  }
};

exports.getUserByFacility = async (req, res) => {
  try {
    const { facilityId } = req.params;

    // FROM membership WHERE business_id = :facilityId
    // LEFT JOIN users ON membership.email = users.email
    const rawQuery = `
      SELECT
        users.id,
        users.facilityId,
        users.firstname,
        users.lastname,
        users.username,
        users.email,
        users.password,
        users.image,
        users.verificationToken,
        users.verificationExpires,
        users.createdBy,
        users.status,
        users.referralId,
        users.lastLogin,
        users.address,
        users.signature,
        users.phone,
        users.departmentId,
        users.code,
        users.role,
        users.cashier_type,
        users.store,
        users.createdAt,
        users.updatedAt,
        membership.branch_id AS branchId,
        branches.branch_name,
        branches.branch_id AS branch_code,
        membership.user_id AS membership_user_id,
        membership.business_id AS membership_business_id,
        membership.access_to AS membership_access_to,
        membership.role AS membership_role,
        membership.functionalities AS membership_functionalities,
        membership.branch_id AS membership_branch_id
      FROM membership
      LEFT JOIN users ON membership.email = users.email
      LEFT JOIN branches ON membership.branch_id = branches.id
      WHERE membership.business_id = :facilityId
    `;

    const rows = await db.sequelize.query(rawQuery, {
      replacements: { facilityId },
      type: db.Sequelize.QueryTypes.SELECT,
    });

    const userIds = rows.map((r) => r.id).filter(Boolean);
    const branchMap = await getBranchesForUsers(userIds);

    const formattedResults = rows.map((row) => {
      const {
        membership_user_id,
        membership_business_id,
        membership_access_to,
        membership_role,
        membership_functionalities,
        membership_branch_id,
        ...userFields
      } = row;
      const branches = branchMap[row.id] || [];
      const branchIds = branches.map((b) => b.id);
      return {
        ...userFields,
        accessTo: membership_access_to ?? null,
        role: membership_role ?? userFields.role,
        functionalities: membership_functionalities ?? null,
        branchId: membership_branch_id ?? null,
        branches,
        branchIds,
        branch_names: branches.map((b) => b.branch_name).join(", "),
      };
    });

    res.json({ success: true, results: formattedResults });
  } catch (err) {
    console.error("Error fetching users by facility:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// fetch all users
// exports.findAllUsers = (req, res) => {
//   User.findAll()!
//     .then(user => {
//       res.json({ user });
//     })
//     .catch(err => res.status(500).json({ err }));
// };

//finding user
exports.findAllUsers = (req, res) => {
  // let { facilityId } = req.params;
  db.sequelize
    .query("call get_users()")
    .then((results) => res.status(200).json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.findAllUsersById = (req, res) => {
  let { id, facilityId } = req.params;
  db.sequelize
    .query("call get_all_user_byId(:id,:facilityId)", {
      replacements: { id, facilityId },
    })
    .then((results) => res.status(200).json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.findUsersRole = (req, res) => {
  let { facilityId } = req.params;
  db.sequelize
    .query("call select_admin_role()", {
      replacements: { facilityId },
    })
    .then((results) => res.status(200).json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

// fetch user by userId
exports.findById = (req, res) => {
  const id = req.params.userId;

  User.findAll({ where: { id } })
    .then((user) => {
      console.log("nome");
      if (!user.length) {
        return res.json({ msg: "user not found" });
      }
      res.json({ success: true, user });
    })
    .catch((err) => res.status(500).json({ err }));
};

// update a user's info
exports.update = (req, res) => {
  let { firstname, lastname, HospitalId, role, image } = req.body;
  const id = req.params.userId;

  User.update(
    {
      firstname,
      lastname,
      HospitalId,
      role,
      image,
    },
    { where: { id } },
  )
    .then((user) => res.status(200).json({ user }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updateDoctor = (req, res) => {
  let { firstname, lastname, speciality, email, serviceCost, phone, address } =
    req.body;
  const id = req.params.userId;
  // console.log(req.body)

  db.sequelize
    .query(
      `UPDATE users set firstname="${firstname}", lastname="${lastname}", speciality="${speciality}", email="${email}", phone="${phone}",address="${address}", serviceCost="${serviceCost}" where id="${id}"`,
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });

  // User.update(
  //   {
  //     firstname,
  //     lastname,
  //     speciality,
  //     email,
  //     serviceCost
  //   },
  //   { where: { id } }
  // )
  //   .then(user => res.status(200).json({ user }))
  //   .catch(err => {
  //     console.log('err', err)
  //     res.status(500).json({ err })
  //   });
};

// delete a user
exports.delete = (req, res) => {
  const id = req.params.userId;

  User.destroy({ where: { id } })
    .then(() =>
      res.status(200).json({ msg: "User has been deleted successfully!" }),
    )
    .catch((err) => res.status(500).json({ msg: "Failed to delete!" }));
};

exports.getRoles = (req, res) => {
  const { facilityId = "" } = req.query;
  db.sequelize
    .query("call get_roles(:facilityId)", {
      replacements: {
        facilityId,
      },
    })
    .then((results) => {
      const arr = [];
      results.forEach((i) => arr.push(i.role));
      res.status(200).json({ results: arr });
    })
    .catch((err) => res.status(500).json({ err }));
};

// ========================================
// ROLE MANAGEMENT CRUD OPERATIONS
// ========================================

// Get all roles for a facility
exports.getRolesList = async (req, res) => {
  try {
    const { facilityId, status, search } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    let whereClause = { facilityId };

    // Add status filter if provided
    if (status && status !== "all") {
      whereClause.status = status;
    }

    // Add search filter if provided
    if (search) {
      whereClause[db.Sequelize.Op.or] = [
        { name: { [db.Sequelize.Op.like]: `%${search}%` } },
        { description: { [db.Sequelize.Op.like]: `%${search}%` } },
      ];
      if (/^\d+$/.test(String(search).trim())) {
        whereClause[db.Sequelize.Op.or].push({
          id: Number(String(search).trim()),
        });
      }
    }

    const roles = await db.Role.findAll({
      where: whereClause,
      order: [["name", "ASC"]],
    });

    res.json({
      success: true,
      results: roles,
      count: roles.length,
    });
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching roles",
      error: error.message,
    });
  }
};

// Get roles for dropdown/select options
exports.getRolesForSelect = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const roles = await db.Role.findAll({
      where: {
        facilityId,
        status: "active", // Only get active roles for selection
      },
      attributes: ["id", "name", "description"],
      order: [["name", "ASC"]],
    });

    // Transform to the format expected by the frontend
    const formattedRoles = roles.map((role) => ({
      id: role.id,
      value: role.name,
      label: role.name,
    }));

    res.json({
      success: true,
      results: formattedRoles,
      count: formattedRoles.length,
    });
  } catch (error) {
    console.error("Error fetching roles for select:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching roles for select",
      error: error.message,
    });
  }
};

// Update role
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status, facilityId } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    if (!name || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Role name and facility ID are required",
      });
    }

    // Check if role exists
    const existingRole = await db.Role.findOne({
      where: { id, facilityId },
    });

    if (!existingRole) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Check if name is already taken by another role
    const duplicateRole = await db.Role.findOne({
      where: {
        name,
        facilityId,
        id: { [db.Sequelize.Op.ne]: id },
      },
    });

    if (duplicateRole) {
      return res.status(400).json({
        success: false,
        message: "Role name already exists",
      });
    }

    // Update the role
    await db.Role.update(
      {
        name,
        description: description || null,
        status: status || "active",
      },
      {
        where: { id, facilityId },
      },
    );

    // Get updated role
    const updatedRole = await db.Role.findOne({
      where: { id, facilityId },
    });

    res.json({
      success: true,
      message: "Role updated successfully",
      results: updatedRole,
    });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({
      success: false,
      message: "Error updating role",
      error: error.message,
    });
  }
};

// Toggle role status
exports.toggleRoleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    // Find the role
    const role = await db.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Toggle status
    const newStatus = role.status === "active" ? "inactive" : "active";

    await db.Role.update({ status: newStatus }, { where: { id } });

    res.json({
      success: true,
      message: `Role ${
        newStatus === "active" ? "activated" : "deactivated"
      } successfully`,
      results: { ...role.dataValues, status: newStatus },
    });
  } catch (error) {
    console.error("Error toggling role status:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling role status",
      error: error.message,
    });
  }
};

// Delete role
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    // Check if role exists
    const role = await db.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Check if role is being used by any users
    const usersWithRole = await db.User.count({
      where: { role: role.name },
    });

    if (usersWithRole > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role. ${usersWithRole} user(s) are currently assigned to this role.`,
      });
    }

    // Delete the role
    await db.Role.destroy({
      where: { id },
    });

    res.json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting role",
      error: error.message,
    });
  }
};

// Create role
exports.createRole = async (req, res) => {
  try {
    const { name, description, status, facilityId } = req.body;

    if (!name || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "Role name and facility ID are required",
      });
    }

    // Check if role name already exists
    const existingRole = await db.Role.findOne({
      where: { name, facilityId },
    });

    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: "Role name already exists",
      });
    }

    // Create the role
    const newRole = await db.Role.create({
      name,
      description: description || null,
      status: status || "active",
      facilityId,
    });

    res.status(201).json({
      success: true,
      message: "Role created successfully",
      results: newRole,
    });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({
      success: false,
      message: "Error creating role",
      error: error.message,
    });
  }
};

// Get single role by ID
exports.getRole = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    const role = await db.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    res.json({
      success: true,
      result: role,
    });
  } catch (error) {
    console.error("Error fetching role:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching role",
      error: error.message,
    });
  }
};

// Create new role
exports.createRole = async (req, res) => {
  try {
    const {
      facilityId,
      name,
      description,
      permissions,
      status = "active",
    } = req.body;

    // Validate required fields
    if (!facilityId || !name) {
      return res.status(400).json({
        success: false,
        message: "Facility ID and role name are required",
      });
    }

    // Check if role with same name already exists in facility
    const existingRole = await db.Role.findOne({
      where: {
        facilityId,
        name,
      },
    });

    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: "Role with this name already exists in this facility",
      });
    }

    const role = await db.Role.create({
      facilityId,
      name,
      description,
      permissions,
      status,
    });

    res.status(201).json({
      success: true,
      message: "Role created successfully",
      result: role,
    });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({
      success: false,
      message: "Error creating role",
      error: error.message,
    });
  }
};

// Update role
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    // Remove fields that shouldn't be updated
    delete updateData.id;
    delete updateData.created_at;

    const [updatedRowsCount] = await db.Role.update(updateData, {
      where: { id },
    });

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Fetch updated role
    const updatedRole = await db.Role.findByPk(id);

    res.json({
      success: true,
      message: "Role updated successfully",
      result: updatedRole,
    });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({
      success: false,
      message: "Error updating role",
      error: error.message,
    });
  }
};

// Toggle role status (activate/deactivate)
exports.toggleRoleStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    // Get current role
    const role = await db.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Toggle status
    const newStatus = role.status === "active" ? "inactive" : "active";

    const [updatedRowsCount] = await db.Role.update(
      { status: newStatus },
      { where: { id } },
    );

    if (updatedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Fetch updated role
    const updatedRole = await db.Role.findByPk(id);

    res.json({
      success: true,
      message: `Role ${
        newStatus === "active" ? "activated" : "deactivated"
      } successfully`,
      result: updatedRole,
    });
  } catch (error) {
    console.error("Error toggling role status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating role status",
      error: error.message,
    });
  }
};

// Delete role
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Role ID is required",
      });
    }

    // Check if role exists first
    const role = await db.Role.findByPk(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Check if role is being used by any users
    const usersWithRole = await db.User.count({
      where: { role: role.name },
    });

    if (usersWithRole > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role. ${usersWithRole} user(s) are currently assigned to this role.`,
      });
    }

    const deletedRowsCount = await db.Role.destroy({
      where: { id },
    });

    if (deletedRowsCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    res.json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting role",
      error: error.message,
    });
  }
};

// ========================================
// DOCTOR MANAGEMENT
// ========================================
exports.getDoctors = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_doctors(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => {
      res.status(200).json({ results });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.createDoctor = (req, res) => {
  const {
    fullname,
    firstname,
    lastname,
    username,
    email,
    phone,
    password,
    speciality,
    licenceNo,
    prefix,
    referralId,
  } = req.body;

  // let [firstname, lastname, ...others] = fullname.split(" ");

  User.findAll({ where: { username } }).then((user) => {
    if (user.length && username !== "") {
      return res
        .status(400)
        .json({ success: false, username: "Username already exists!" });
    } else {
      let newDoc = {
        firstname,
        lastname,
        facilityId: "doctors",
        role: "Doctor",
        privilege: 4,
        accessTo: "Doctors",
        username,
        speciality,
        email,
        phone,
        password,
        image:
          "https://res.cloudinary.com/emaitee/image/upload/v1593618169/mylikita/profile_images/docAvater.png",
        licenceNo,
        prefix,
        createdBy: referralId,
      };

      bcrypt.genSalt(10, (err, salt) => {
        bcrypt.hash(newDoc.password, salt, (err, hash) => {
          if (err) throw err;
          newDoc.password = hash;
          User.create(newDoc)
            .then((user) => {
              res.json({ success: true, user });
              transport
                .sendMail({
                  from: '"mylikita.clinic" <hello@mylikita.clinic>',
                  to: user.email,
                  subject: "Thank you for registering",
                  html: `
                    <center>
                      <img src='https://res.cloudinary.com/emaitee/image/upload/v1590845025/logo.png' height='30px' width='100px' />
                    </center>

                    <h1>Warm welcome,</h1>
                    <h4>Thank you for registering with mylikita.clinic</h4>

                    <p>
                      Our team are reviewing your account information you would be notified
                      once your account is activated and ready to be used.
                    </p>
                    <br />

                    <p>Best regards.</p>
                    <p>MyLikita Dev. Team</p>

                    <center>
                      <p style='text-align:center'>Follow us on: </p>
                      <a href="https://www.facebook.com/mylikitaNG" target="_blank">
                        <img src='https://cdn3.iconfinder.com/data/icons/capsocial-round/500/facebook-512.png' height='25px' width='25px' />
                      </a>
                      <a href="https://www.twitter.com/mylikitaNG" target="_blank">
                        <img src='https://cdn4.iconfinder.com/data/icons/social-media-icons-the-circle-set/48/twitter_circle-512.png' height='25px' width='25px' />
                      </a>
                      <a href="https://www.instagram.com/mylikitaNG" target="_blank" >
                        <img src='https://i.pinimg.com/originals/a2/5f/4f/a25f4f58938bbe61357ebca42d23866f.png' height='25px' width='25px' />
                      </a>
                    </center>
                  `,
                })
                .then((info) => {
                  console.log("Message sent: %s", info.messageId);
                })
                .catch((err) => console.log("Error", err));
            })
            .catch((err) => {
              res.status(500).json({ success: false, err });
            });
        });
      });
    }
  });
};

// ========================================
// VALIDATION & UTILITIES
// ========================================
exports.checkUsername = (req, res) => {
  const { username } = req.body;

  User.findAll({ where: { username } })
    .then((user) => {
      if (user.length && username !== "") {
        return res
          .status(400)
          .json({ success: false, username: "Username already exists!" });
      } else {
        return res.json({ success: true, username: "Username is available" });
      }
    })
    .catch((err) => {
      res.status(500).json({ err });
    });
};

// Check if email exists for registration validation
exports.checkEmailExists = async (req, res) => {
  const { email } = req.body;

  if (!email || email.trim() === "") {
    return res.status(400).json({
      success: false,
      exists: false,
      message: "Email is required",
    });
  }

  try {
    // KYC availability is sourced only from kyc_users (not the main users table).
    const trimmedEmail = email.trim();
    const kycUser = await db.KycUser.findOne({
      where: { email: trimmedEmail },
    });

    if (kycUser) {
      return res.json({
        success: false,
        exists: true,
        message: "Email already exists",
      });
    }

    return res.json({
      success: true,
      exists: false,
      message: "Email is available",
    });
  } catch (err) {
    console.error("Error checking email:", err);
    return res.status(500).json({
      success: false,
      exists: false,
      message: "Error checking email availability",
      error: err.message,
    });
  }
};

// exports.checkEmail = (req, res) => {
//   const { email } = req.body;

//   User.findAll({ where: { email } })
//     .then((user) => {
//       if (user.length && email !== "") {
//         return res
//           .status(400)
//           .json({ success: false, email: "Email is taken!" });
//       } else {
//         return res.json({ success: true, email: "Email is available" });
//       }
//     })
//     .catch((err) => {
//       res.status(500).json({ err });
//     });
// };

exports.checkPrefix = (req, res) => {
  const { prefix } = req.body;

  User.findAll({ where: { prefix } })
    .then((user) => {
      if (user.length && prefix !== "") {
        return res
          .status(400)
          .json({ success: false, prefix: "Prefix is taken!" });
      } else {
        return res.json({ success: true, prefix: "Prefix is available" });
      }
    })
    .catch((err) => {
      res.status(500).json({ err });
    });
};

exports.referral = (req, res) => {
  const { referer, refereeContact } = req.body;
  const newReferral = {
    referer: referer,
    referee: "",
    refereeContact: refereeContact,
  };

  Referral.create(newReferral)
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.getDoctorsSpecilities = (req, res) => {
  db.sequelize
    .query(
      "SELECT DISTINCT speciality FROM users where speciality!='' AND status='approved'",
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getDoctorsList = (req, res) => {
  db.sequelize
    .query(
      `SELECT id,
      IFNULL(firstname, '') AS firstname,
      IFNULL(lastname, '') AS lastname,
      IFNULL(speciality, '') AS speciality,
      IFNULL(address, '') AS address,
      IFNULL(serviceCost, 0) AS serviceCost ,
      IFNULL(phone, '') AS phone,
      IFNULL(email, '') AS email,
      IFNULL(availableDays, '') AS availableDays,
      IFNULL(availableFromTime, '') AS availableFromTime,
      IFNULL(availableToTime, '') AS availableToTime,
      IFNULL(image, '') AS image
        FROM users where role='doctor'
          AND status='approved'
          ORDER BY createdAt`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getDoctorsForAdmin = (req, res) => {
  db.sequelize
    .query(
      "SELECT id, firstname, lastname, speciality, licenceNo, userType, status, createdAt from users where role='doctor' ORDER BY createdAt DESC",
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getUnapprovedUsers = (req, res) => {
  db.sequelize
    .query(
      `SELECT
        a.id AS id,
        a.firstname AS firstname,
        a.lastname AS lastname,
        a.role AS role,
        IFNULL(a.userType, "") AS userType,
        a.status AS status,
        a.createdAt AS createdAt,
        b.name AS facility,
        b.type AS facilityType
      FROM users AS a
      JOIN hospitals AS b
      ON a.facilityId = b.id
      WHERE a.status IN ('pending', 'suspended')
      ORDER BY a.createdAt DESC`,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.submitContactForm = (req, res) => {
  const { firstname, lastname, message, email } = req.body;

  let contactform = {
    firstname,
    lastname,
    message,
    email,
  };

  Contact.create(contactform)
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.generateReferralLink = (req, res) => {
  const { id } = req.params;
  let referralId = cuid();

  User.update(
    {
      userType: "LEAD",
      referralId,
    },
    { where: { id } },
  )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.approveUser = (req, res) => {
  const { id } = req.params;

  User.update({ status: "approved " }, { where: { id } })
    .then((results) => {
      User.findAll({ where: { id } }).then((user) => {
        const u = user[0].dataValues;
        // sendMail(u.id, constants.WELCOME_MAIL);
        transport
          .sendMail({
            from: '"MyLikita" <hello@mylikita.clinic>',
            to: u.email,
            subject: "[MyLikita] Account Approval",
            html: `
          <center>
            <img src='https://res.cloudinary.com/emaitee/image/upload/v1590845025/logo.png' height='30px' width='100px' />
          </center>

          <h4>Dear ${u.firstname},</h4>

          <p>
            Thank you for registering on our platform, we are happy to inform you that your account is
            now active and you proceed to login <a href="https://app.mylikita.clinic/auth" target="_blank">here</a>
            with the credentials with which you registered.
          </p>
          <p>
            We welcome you onboard.
          </p>
          <p>
            Feel free to reach out to us for any complaints or questions by replying to this email or
            sending us an email to hello@mylikita.clinic
          </p>
          <br />

          <p>Best regards.</p>
          <p>MyLikita Dev. Team</p>

          <center>
            <p style='text-align:center'>Follow us on: </p>
            <a href="https://www.facebook.com/mylikitaNG" target="_blank">
              <img src='https://cdn3.iconfinder.com/data/icons/capsocial-round/500/facebook-512.png' height='25px' width='25px' />
            </a>
            <a href="https://www.twitter.com/mylikitaNG" target="_blank">
              <img src='https://cdn4.iconfinder.com/data/icons/social-media-icons-the-circle-set/48/twitter_circle-512.png' height='25px' width='25px' />
            </a>
            <a href="https://www.instagram.com/mylikitaNG" target="_blank" >
              <img src='https://i.pinimg.com/originals/a2/5f/4f/a25f4f58938bbe61357ebca42d23866f.png' height='25px' width='25px' />
            </a>
          </center>
          `,
          })
          .then((info) => {
            console.log("Message sent: %s", info.messageId);
            res.json({ success: true, results });
          })
          .catch((err) => console.log("Error", err));
      });
    })
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.suspendUser = (req, res) => {
  const { id } = req.params;
  User.update({ status: "suspended " }, { where: { id } })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.reportIssues = (req, res) => {
  const { userId, message } = req.body;

  Feedbacks.create({ userId, message })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.updateDocAvailability = (req, res) => {
  const id = req.params.docId;
  const { availableDays, availableFromTime, availableToTime } = req.body;

  User.update(
    {
      availableDays,
      availableFromTime,
      availableToTime,
    },
    { where: { id } },
  )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.countDoc = (req, res) => {
  db.sequelize
    .query(
      "SELECT count(*) AS doctors FROM users where role='Doctor' and status='approved';",
    )
    .then((results) =>
      res.json({ success: true, doctors: results[0][0].doctors }),
    )
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.testMail = (req, res) => {
  const { id } = req.params;

  sendMail(id, constants.WELCOME_MAIL);
};

exports.testApprovalMail = (req, res) => {
  const { id } = req.params;

  sendMail(id, constants.ACCOUNT_APPROVAL);
};

exports.uploadProfileImage = (req, res) => {
  const { id } = req.body;

  User.update({ image: req.file.path }, { where: { id } })
    .then(() => {
      res.json({ success: true });
    })
    .catch((error) => {
      console.log("Error", error);
      res.status(500).json({ success: false, error });
    });
};

exports.adminResetUser = (req, res) => {
  let { userId, newPassword } = req.body;

  bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(newPassword, salt, (err, hash) => {
      if (err) throw err;
      newPassword = hash;
      User.update({ password: newPassword }, { where: { id: userId } })
        .then((user) => {
          res.json({
            success: true,
            message: "Password Reset Successful",
            user,
          });
        })
        .catch((err) => {
          res.status(500).json({ err });
        });
    });
  });
};

exports.changeUserPassword = (req, res) => {
  const { id, oldPassword, newPassword } = req.body;

  User.findAll({
    where: {
      id,
    },
  })
    .then((user) => {
      //check for user
      if (!user.length) {
        let errors = "User not found!";
        return res.status(404).json(errors);
      }

      let originalPassword = user[0].dataValues.password;

      //check for password
      bcrypt
        .compare(oldPassword, originalPassword)
        .then((isMatch) => {
          if (isMatch) {
            const { id } = user[0].dataValues;

            bcrypt.genSalt(10, (err, salt) => {
              bcrypt.hash(newPassword, salt, (err, hash) => {
                if (err) throw err;
                // lehashedPassword = hash;
                User.update({ password: hash }, { where: { id } })
                  .then((user) => {
                    res.json({ success: true, user });
                  })
                  .catch((error) => {
                    res.status(500).json({ success: false, error });
                  });
              });
            });
          } else {
            errors.password = "Old Password not correct";
            return res.status(404).json(errors);
          }
        })
        .catch((error) => console.log(error));
    })
    .catch((error) => res.status(500).json({ success: false, error }));
};

exports.deleteUser = (req, res) => {
  const {
    params: { id, facilityId },
  } = req;
  db.sequelize
    .query("call delete_user(:id, :facilityId)", {
      replacements: { facilityId, id },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updateUsers = (req, res) => {
  const {
    accessTo,
    firstname,
    email,
    lastname,
    role,
    branch_name,
    functionalities,
    id,
    facilityId,
    userId,
    username,
    phone,
    address,
  } = req.body;
  db.sequelize
    .query(
      `CALL update_user(:accessTo,:functionalities,:id,:facilityId,:firstname,:lastname,
      :email,:branch_name,:userId,:role,:username,:phone,:address);`,
      {
        replacements: {
          accessTo: accessTo ? accessTo : "",
          functionalities: functionalities ? functionalities : "",
          id: id ? id : "",
          facilityId: facilityId ? facilityId : "",
          firstname: firstname ? firstname : "",
          lastname: lastname ? lastname : "",
          email: email ? email : "",
          branch_name: branch_name ? branch_name : "",
          userId: userId ? userId : "",
          role: role ? role : "",
          username: username ? username : "",
          phone: phone ? phone : "",
          address: address ? address : "",
        },
      },
    )
    .then((results) => res.json({ results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.createWithUsername = (req, res) => {
  const { errors, isValid } = validateRegisterForm(req.body);
  let {
    firstname,
    lastname,
    facilityId,
    role,
    privilege,
    accessTo,
    username,
    email,
    password,
    speciality,
    department,
    functionality,
    userId,
    image,
    branch_name,
  } = req.body;
  console.log(req.body);

  // check validations
  if (!isValid) {
    return res.status(400).json({ errors });
  }

  User.findAll({ where: { username } }).then((user) => {
    if (user.length && username !== "") {
      return res.status(400).json({ username: "Username already exists!" });
    } else {
      let newUser = {
        firstname,
        lastname,
        facilityId,
        role,
        privilege,
        accessTo,
        username,
        speciality,
        email,
        password,
        department,
        functionality,
        createdBy: userId,
        image:
          "https://res.cloudinary.com/emaitee/image/upload/v1593618169/mylikita/profile_images/docAvater.png",
        branch_name,
      };

      bcrypt.genSalt(10, (err, salt) => {
        bcrypt.hash(newUser.password, salt, (err, hash) => {
          if (err) throw err;
          newUser.password = hash;
          User.create(newUser)
            .then((user) => {
              res.json({ user });
            })
            .catch((err) => {
              console.log(err);
              res.status(500).json({ err });
            });
        });
      });
    }
  });
};

exports.businessProfile = (req, res) => {
  const profile = req.body;
  let uploaded = req.file ? req.file.path : null;
  if (uploaded) {
    profile.business_logo = uploaded;
  }
  userApi.createBusiness(
    profile,
    (results) => {
      // if(file.query_type === "new_business") {
      //   db.sequelize.query('UPDATE users set facilityId')
      // }
      res.json({ success: true, results });
    },
    (err) => {
      res.status(500).json({ success: false, err });
    },
  );
};

exports.getBusinessProfile = (req, res) => {
  const { email } = req.query;

  userApi.getBusinessProfile(
    (results) => {
      res.json({ success: true, results });
    },
    (err) => {
      res.status(500).json({ success: false, err });
    },
    email,
  );
};
