const env = {
  database: 'db_aa_erp',
  username: 'root',
  password: '',
  host: 'localhost',
  // dialect: 'mysql',
  dialect: 'db_aa_erp',
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
};

module.exports = env;
