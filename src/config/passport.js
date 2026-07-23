// import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");

// import { placeholder } from "sequelize/types/lib/operators";
const models = require("../models");
const Users = models.users;

// Role to Designation mapping function
const mapRoleToDesignation = (role) => {
  const roleDesignationMap = {
    'admin': 'Administrator',
    'manager': 'Manager',
    'staff': 'Staff',
    'viewer': 'Viewer',
    'cashier': 'Cashier',
    'inventory_manager': 'Inventory Manager',
    'sales_rep': 'Sales Representative',
    'superAdmin': 'Super Administrator',
    'user': 'User',
    'guest': 'Guest'
  };
  
  return roleDesignationMap[role] || role; // Return mapped designation or original role if not found
};

const opts = {};
opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
const jwtSecret = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;
if (!jwtSecret || String(jwtSecret).length < 16) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET_KEY is missing or too short (>=16 chars required in production).",
    );
  }
  console.warn(
    "[passport] JWT_SECRET_KEY unset/weak — using insecure dev-only secret. Do not expose this host publicly.",
  );
}
opts.secretOrKey =
  jwtSecret && String(jwtSecret).length >= 16
    ? jwtSecret
    : "insecure-dev-only-secret-change-me";
opts.algorithms = ["HS256"];
// opts.issuer = 'accounts.examplesoft.com';
// opts.audience = 'yoursite.net';

// create jwt strategy
module.exports = (passport) => {
  passport.use(
    new JwtStrategy(opts, (jwt_payload, done) => {
      Users.findOne({ where: { id: jwt_payload.id } })
        .then((user) => {
          if (user) {
            const userRole = user.dataValues.role;
            const designation = mapRoleToDesignation(userRole);

            const userObj = {
              id: user.dataValues.id,
              facilityId: user.dataValues.facilityId,
              username: user.dataValues.username,
              firstname: user.dataValues.firstname,
              lastname: user.dataValues.lastname,
              email: user.dataValues.email,
              phone: user.dataValues.phone,
              role: userRole,
              designation: designation,
              departmentId: user.dataValues.departmentId,
              status: user.dataValues.status,
            };
            return done(null, userObj);
          }
          return done(null, false);
        })
        .catch((err) => {
          console.error("[passport] JWT user lookup failed:", err.message);
          return done(err, false);
        });
    })
  );
};
