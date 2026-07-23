const Validator = require("validator");
const isEmpty = require("./isEmpty");

module.exports = function validateRegisterForm(data) {
  let errors = {};

  data.firstname = !isEmpty(data.firstname) ? data.firstname : "";
  data.lastname = !isEmpty(data.lastname) ? data.lastname : "";
  data.username = !isEmpty(data.username) ? data.username : "";
  data.password = !isEmpty(data.password) ? data.password : "";
  // data.HospitalId = !isEmpty(data.HospitalId) ? data.HospitalId : '';

  if (!Validator.isLength(data.firstname, { min: 2, max: 30 })) {
    errors.firstname = "First Name must be between 2 and 30 character long";
  }

  if (!Validator.isLength(data.lastname, { min: 2, max: 30 })) {
    errors.lastname = "Last Name must be between 2 and 30 character long";
  }

  if (Validator.isEmpty(data.firstname)) {
    errors.firstname = "First Name field is require";
  }

  if (Validator.isEmpty(data.lastname)) {
    errors.lastname = "Last Name field is require";
  }

  // if (Validator.isEmpty(data.privilege)) {
  //   errors.privilege = 'Privilege field is require';
  // }

  if (Validator.isEmpty(data.accessTo)) {
    errors.accessTo = "You need to give user access";
  }

  if (Validator.isEmpty(data.username)) {
    errors.username = "username field is require";
  }

  // if (Validator.isEmpty(data.HospitalId)) {
  //   errors.hospital = 'Hospital not found';
  // }

  if (Validator.isEmpty(data.password)) {
    errors.password = "password field is require";
  }

  if (!Validator.isLength(data.password, { min: 6, max: 30 })) {
    errors.password = "password must be at least 6 characters long";
  }

  return {
    errors,
    isValid: isEmpty(errors),
  };
};
