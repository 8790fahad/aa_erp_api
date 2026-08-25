// const nodemailer = require('nodemailer');
// const Email = require('email-templates');
const path = require('path');
const fs = require("fs");
const ejs = require("ejs");
const db = require('../models');
const User = db.user;
const constants = require('./constants').constants;

const transport = require('../config/nodemailer');

// Company-wide contact details for email footers
const COMPANY_NAME = process.env.COMPANY_NAME || "AaErp";
const COMPANY_WEBSITE =
  process.env.COMPANY_WEBSITE || "https://app.aa_erp.org";
const COMPANY_EMAIL =
  process.env.COMPANY_EMAIL || "hello@aa_erp.app";
const COMPANY_PHONE =
  process.env.COMPANY_PHONE || "+234 000 000 0000";
const COMPANY_TWITTER =
  process.env.COMPANY_TWITTER || "@yourcompany";
const COMPANY_INSTAGRAM =
  process.env.COMPANY_INSTAGRAM || "@yourcompany";
const COMPANY_LINKEDIN =
  process.env.COMPANY_LINKEDIN || "linkedin.com/company/yourcompany";

const mylikitaMail = COMPANY_EMAIL;

// const welcomeMailDir = path.join(__dirname, '../templates', 'welcome');
// // console.log(welcomeMailDir)
// const welcomeMail = new EmailTemplate(welcomeMailDir);

// const email = new Email({
//   message: {
//     from: mylikitaMail,
//   },
//   // send: true,
//   transport,
//   views: {
//     options: {
//       extension: 'ejs', // <---- HERE
//     },
//   },
// });

function sendMail(userId, type) {
  User.findAll({ where: { id: userId } })
    .then(async (user) => {
      const userObj = user[0];
      const mailData = {
        firstname: userObj.firstname,
        lastname: userObj.lastname,
        userType: userObj.userType,
      };

      let templateFile;
      let subject;

      switch (type) {
        case constants.WELCOME_MAIL:
          templateFile = "welcome.ejs";
          subject = "Welcome to AaErp!";
          break;
        case constants.ACCOUNT_APPROVAL:
          templateFile = "accountApproval.ejs";
          subject = "Your Account is Approved!";
          break;
        default:
          return;
      }

      const templatePath = path.join(__dirname, "../templates", templateFile);
      let htmlContent = await ejs.renderFile(templatePath, {
        data: mailData,
      });

      // Append unified footer with website, email, and social handles
      const footerHtml = `
        <hr style="margin: 24px 0;" />
        <p style="font-size: 12px; color: #666; line-height: 1.6;">
          Website:
          <a href="${COMPANY_WEBSITE}" style="color: #4267B2; text-decoration: none;">
            ${COMPANY_WEBSITE}
          </a><br/>
          Email:
          <a href="mailto:${COMPANY_EMAIL}" style="color: #4267B2; text-decoration: none;">
            ${COMPANY_EMAIL}
          </a><br/>
          Phone: ${COMPANY_PHONE}<br/>
          Follow us:
          <span>${COMPANY_TWITTER}</span> |
          <span>${COMPANY_INSTAGRAM}</span> |
          <span>${COMPANY_LINKEDIN}</span>
        </p>
      `;

      htmlContent = `${htmlContent}${footerHtml}`;

      const mailOptions = {
        from: mylikitaMail,
        to: userObj.email,
        subject,
        html: htmlContent,
      };

      transport.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.log("Email sending error:", error);
        } else {
          console.log("Email sent:", info.messageId);
        }
      });
    })
    .catch((err) => {
      console.log("DB error:", err);
    });
}

// function sendMail(userId, type) {
//   User.findAll({ where: { id: userId } })
//     .then((user) => {
//       const userObj = user[0];
//     //   console.log(userObj);
//       switch (type) {
//         case constants.WELCOME_MAIL: {
//           welcomeMail.render(
//             {
//               data: {
//                 firstname: userObj.firstname,
//                 lastname: userObj.lastname,
//                 userType: userObj.userType,
//               },
//             },
//             (err, results) => {
//               if (err) {
//                 console.log(err);
//               }

//               const mailOptions = {
//                 from: mylikitaMail, // sender address
//                 to: userObj.email, // list of receivers
//                 subject: 'Welcome', // Subject line
//                 text: results.text, // plain text body
//                 html: results.html, // html body
//               };

//               transport.sendMail(mailOptions, (error, info) => {
//                 if (error) {
//                   console.log('error in emailApi', error);
//                   return error;
//                 }
//                 console.log('result in emailApi', info);
//                 // console.log('Message sent: %s', info.messageId);
//                 return info;
//               });
//             },
//           );
//         }
//         default:
//           return null;
//       }
//     })
//     .catch((err) => {
//       console.log(err);
//     });
// }

exports.sendMail = sendMail;

exports.newMail = (recipient, subject, content) => {
  transport
    .sendMail({
      from: `"${COMPANY_NAME}" <${COMPANY_EMAIL}>`,
      to: recipient,
      subject,
      html: `${content}
        <hr style="margin: 24px 0;" />
        <p style="font-size: 12px; color: #666; line-height: 1.6;">
          Website:
          <a href="${COMPANY_WEBSITE}" style="color: #4267B2; text-decoration: none;">
            ${COMPANY_WEBSITE}
          </a><br/>
          Email:
          <a href="mailto:${COMPANY_EMAIL}" style="color: #4267B2; text-decoration: none;">
            ${COMPANY_EMAIL}
          </a><br/>
          Phone: ${COMPANY_PHONE}<br/>
          Follow us:
          <span>${COMPANY_TWITTER}</span> |
          <span>${COMPANY_INSTAGRAM}</span> |
          <span>${COMPANY_LINKEDIN}</span>
        </p>
      `,
    })
    .then((info) => {
      console.log('Message sent: %s', info.messageId);
    })
    .catch((err) => console.log('Error', err));
};
