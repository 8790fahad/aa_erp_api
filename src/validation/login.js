const Validator = require("validator");
const isEmpty = require("./isEmpty");

module.exports = function validateLoginForm(data) {
  let errors = {};

  data.username = !isEmpty(data.username) ? data.username : "";
  data.password = !isEmpty(data.password) ? data.password : "";

  if (Validator.isEmpty(data.username)) {
    errors.username = "Email is require";
  }

  if (Validator.isEmpty(data.password)) {
    errors.password = "Password is require";
  }

  return {
    errors,
    isValid: isEmpty(errors),
  };
};
