const passport = require("passport");
const transport = require("../config/nodemailer");
const { profileStorage, logoStorage } = require("../config/multer");

module.exports = (app) => {
  const users = require("../controller/users");
  const config = require("../config/config");
  const allowOnly = require("../services/routesHelper").allowOnly;

  // create a new user
  app.post(
    "/api/auth/sign-up",
    // passport.authenticate('jwt', { session: false }),
    // allowOnly(config.accessLevels.admin,
    users.create
    // )
  );
  //adding a new user
  app.post("/api/auth/add-new-staff", users.createNewUser);
  app.post("/api/auth/bulk-staff", users.bulkCreateStaff);
  app.post(
    "/api/auth/create-staff",
    // passport.authenticate('jwt', { session: false }),
    // allowOnly(config.accessLevels.admin,
    users.createStaff
    // )
  );

  app.get("/api/auth/verify-user", users.verifyUser);
  app.post("/api/auth/update-status", users.updateStatus);
  app.get("/api/auth/verify", users.verifyEmail);
  app.post("/api/auth/check-mail", users.checkEmail);
  app.post("/api/auth/reset-password", users.resetPassword);

  app.post("/api/auth/update/:id", users.updateUser);

  // create a new user
  app.post(
    "/api/auth/sign-up/userName",
    // passport.authenticate('jwt', { session: false }),
    // allowOnly(config.accessLevels.admin,
    users.createWithUsername
    // )
  );
 
  app.post("/api/auth/login", users.login);
  app.post("/api/auth/username-login", users.loginWithUsername);

  app.get("/auth/verify-token", users.verifyUserToken);

  app.post(
    "/api/v1/business-profile",
    logoStorage.single("logo"),
    users.businessProfile
  );
  app.get("/api/v1/business-profile", users.getBusinessProfile);

  //retrieve all users
  app.get(
    "/users",
    // passport.authenticate('jwt', {
    //   session: false
    // }),
    // allowOnly(config.accessLevels.admin,
    users.findAllUsers
    // )
  );

  app.get("/users/getById/:id/:facilityId", users.findAllUsersById);
  app.get("/users/roles", users.getRoles);

  // ==================== ROLE MANAGEMENT ROUTES ====================
  app.get("/users/roles-list", users.getRolesList);
  app.get("/users/roles-for-select", users.getRolesForSelect);
  app.get("/users/roles/:id", users.getRole);
  app.post("/users/roles", users.createRole);
  app.put("/users/roles/:id", users.updateRole);
  app.put("/users/roles/:id/toggle-status", users.toggleRoleStatus);
  app.delete("/users/roles/:id", users.deleteRole);

  // routes/staffRoutes.js
  app.post("/users/update-signature", users.updateSignature);

  app.get("/users/doctors/:facilityId", users.getDoctors);

  app.post("/users/doctors/create", users.createDoctor);

  app.put("/users/profile/:userId", users.updateDoctor);

  app.get("/users/profile/:userId", users.profile);

  app.post("/users/check/username", users.checkUsername);

  app.post("/users/check/email", users.checkEmail);
  app.post("/api/auth/check-email-exists", users.checkEmailExists);
  app.post("/users/invite-staff", users.inviteStaff);
  app.post("/users/accept-invite", users.acceptInvite);
  app.post("/users/check/prefix", users.checkPrefix);

  app.post("/referrals/doctor/new", users.referral);

  app.get("/doctors/speciality/list", users.getDoctorsSpecilities);

  app.get("/doctors/all/list", users.getDoctorsList);

  app.get("/doctors/admin/all", users.getDoctorsForAdmin);
  app.get("/admin/unapprovedUsers", users.getUnapprovedUsers);

  app.get("/admin/manageadminrole", users.findUsersRole);

  app.get("/doctors/count", users.countDoc);
  app.get("/api/v1/forget/password/:phone", users.forgetPassword);
  app.get("/api/v1/verify/otp/:verify", users.verifyOTP);
  app.get("/api/v1/reset/password/:phone/:password", users.resetPassword);
  app.get("/api/v1/get-users-by-facility/:facilityId", users.getUserByFacility);

  app.post("/guests/contactform", users.submitContactForm);

  app.put("/users/lead/referrallink/:id", users.generateReferralLink);

  app.put("/users/approve/:id", users.approveUser);

  app.put("/users/doctor/availability/:docId", users.updateDocAvailability);
  app.post("/admin/reset-user-pass", users.adminResetUser);
  app.post(
    "/api/users/changepassword",
    // passport.authenticate('jwt', {
    //   session: false,
    // }),
    // allowOnly(config.accessLevels.user,
    users.changeUserPassword
    // ),
  );

  app.put("/users/suspend/:id", users.suspendUser);
  app.post("/users/reportissues", users.reportIssues);
  app.post("/users/testmail/:id", users.testMail);
  app.post("/users/testmail/approval/:id", users.testApprovalMail);
  app.delete("/users/delete/:id/:facilityId", users.deleteUser);
  app.post("/users/access/update", users.updateUsers);

  app.post(
    "/users/profile/image",
    profileStorage.single("image"),
    users.uploadProfileImage
  );

  // retrieve user by id
  app.get(
    "/users/:userId",
    passport.authenticate("jwt", {
      session: false,
    }),
    allowOnly(config.accessLevels.admin, users.findById)
  );

  // update a user with id
  app.put(
    "/users/:userId",
    passport.authenticate("jwt", {
      session: false,
    }),
    allowOnly(config.accessLevels.user, users.update)
  );

  // delete a user
  app.delete(
    "/users/:userId",
    passport.authenticate("jwt", {
      session: false,
    }),
    allowOnly(config.accessLevels.admin, users.delete)
  );
};
