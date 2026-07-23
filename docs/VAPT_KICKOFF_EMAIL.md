Subject: FlowBooks E-Invoicing API — VAPT kickoff pack (questionnaire + access)

---

Dear [Assessor Name],

Please find attached our completed VAPT questionnaire for the **FlowBooks NRS / FIRS E-Invoicing API** engagement.

**Scope**
- In scope: E-Invoicing REST APIs only (OAuth token, create invoice, status, payment notify, transmit).
- Out of scope (unless expanded): KYC Connect UI, general FlowBooks ERP APIs, and frontend applications.

**Documentation**
- API docs: https://server.brainstorm.ng/inventria_new/e-invoicing-api-docs
- OpenAPI: https://server.brainstorm.ng/inventria_new/e-invoicing-api-docs.json
- Postman: https://server.brainstorm.ng/inventria_new/e-invoicing-api-docs/postman.json

**Authentication**
- OAuth 2.0 Client Credentials → short-lived JWT Bearer token.
- We will issue sandbox `client_id` / `client_secret` (`fbk_test_*`) and NRS `business_id`.
- Credentials will be shared in a **separate password-protected file**; the file password will be sent via a second channel (e.g. SMS / phone).

**Test environment**
- Preferred: UAT / sandbox against `https://server.brainstorm.ng/inventria_new`
- Please share your scanner source IP addresses so we can allow-list them if required.

**Attachments**
1. `FlowBooks_E-Invoicing_VAPT_Questionnaire_Responses.xlsx`
2. `[Password-protected credentials file — to follow / attached separately]`

Kindly confirm receipt and proposed start date. We are available for a short kickoff call if helpful.

Best regards,  
[Your Name]  
[Title]  
FlowBooks / Brainstorm  
[Phone] | [Email]
