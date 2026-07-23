const env = {
  database: 'db_inventria',
  username: 'root',
  password: '',
  host: 'localhost',
  // dialect: 'mysql',
  dialect: 'db_inventria',
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
};

module.exports = env;
