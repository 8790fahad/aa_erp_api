"use strict";

const fs = require("fs");

const path = require("path");
const Sequelize = require("sequelize");
const basename = path.basename(__filename);
require("dotenv").config();

const env = process.env.NODE_ENV || "development";
// const config = require("../config/config.json")[env];
const config = {
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  dialect: process.env.DB_DIALECT || "mysql",
  dialectOptions: {
    charset: "utf8mb4",
  },
  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  hooks: {
    afterConnect: async (connection) => {
      // Align session collation with number_generator / mixed utf8mb4 tables
      await new Promise((resolve, reject) => {
        connection.query(
          "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
          (err) => (err ? reject(err) : resolve()),
        );
      });
    },
  },
};
const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(
    config.database,
    config.username,
    config.password,
    config
  );
}

// Load all models
const modelFiles = fs.readdirSync(__dirname).filter((file) => {
  return (
    file.indexOf(".") !== 0 &&
    file !== basename &&
    file.slice(-3) === ".js" &&
    file !== "phisherman.sql" &&
    file !== "readme.md"
  );
});

// Import all models
modelFiles.forEach((file) => {
  try {
    const modelPath = path.join(__dirname, file);
    const modelModule = require(modelPath);

    // Check if the module exports a function (Sequelize model)
    if (typeof modelModule === "function") {
      const model = modelModule(sequelize, Sequelize.DataTypes);
      if (model && model.name) {
        db[model.name] = model;
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not load model ${file}:`, error.message);
  }
});

// Set up associations
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
