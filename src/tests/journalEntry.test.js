const request = require("supertest");
const app = require("../app"); // Adjust path to your Express app
const db = require("../models");
const {
  validateBalance,
  validateLineEntries,
  validateJournalEntry,
} = require("../utils/journalValidation");

describe("Journal Entry Module Tests", () => {
  let testFacilityId = "TEST_FACILITY_001";
  let testUserId = "test.user@example.com";
  let createdEntryId;

  // Setup: Clear test data before running tests
  beforeAll(async () => {
    await db.sequelize.sync({ force: false });

    // Clean up any existing test data
    await db.JournalEntry.destroy({
      where: { facility_id: testFacilityId },
    });
  });

  // Cleanup after all tests
  afterAll(async () => {
    await db.JournalEntry.destroy({
      where: { facility_id: testFacilityId },
    });
    await db.sequelize.close();
  });

  // ===== VALIDATION TESTS =====

  describe("Validation Tests", () => {
    test("should validate balanced journal entry", () => {
      const lines = [
        { debit: 100, credit: 0 },
        { debit: 0, credit: 100 },
      ];

      expect(() => validateBalance(lines)).not.toThrow();
      const result = validateBalance(lines);
      expect(result.totalDebit).toBe("100.00");
      expect(result.totalCredit).toBe("100.00");
    });

    test("should throw error for unbalanced journal entry", () => {
      const lines = [
        { debit: 100, credit: 0 },
        { debit: 0, credit: 50 },
      ];

      expect(() => validateBalance(lines)).toThrow("not balanced");
    });

    test("should validate line entries correctly", () => {
      const validLines = [
        { account_code: "1000", debit: 100, credit: 0 },
        { account_code: "2000", debit: 0, credit: 100 },
      ];

      expect(() => validateLineEntries(validLines)).not.toThrow();
    });

    test("should reject line with both debit and credit", () => {
      const invalidLines = [
        { account_code: "1000", debit: 100, credit: 50 },
      ];

      expect(() => validateLineEntries(invalidLines)).toThrow(
        "Cannot have both debit and credit"
      );
    });

    test("should reject line with no account code", () => {
      const invalidLines = [
        { account_code: "", debit: 100, credit: 0 },
      ];

      expect(() => validateLineEntries(invalidLines)).toThrow(
        "Account code is required"
      );
    });

    test("should reject amount less than 0.01", () => {
      const invalidLines = [
        { account_code: "1000", debit: 0.001, credit: 0 },
      ];

      expect(() => validateLineEntries(invalidLines)).toThrow(
        "must be at least 0.01"
      );
    });
  });

  // ===== API INTEGRATION TESTS =====

  describe("API Integration Tests", () => {
    test("POST /api/journals - should create a new journal entry", async () => {
      const newEntry = {
        reference_number: `TEST-JE-${Date.now()}`,
        entry_date: "2024-01-15",
        description: "Test journal entry",
        facility_id: testFacilityId,
        user_id: testUserId,
        user_role: "admin",
        currency: "NGN",
        exchange_rate: 1.0,
        lines: [
          {
            account_code: "1000",
            account_name: "Cash",
            description: "Cash receipt",
            debit: 1000,
            credit: 0,
          },
          {
            account_code: "4000",
            account_name: "Sales Revenue",
            description: "Sales income",
            debit: 0,
            credit: 1000,
          },
        ],
      };

      const response = await request(app)
        .post("/api/journals")
        .send(newEntry)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty("id");
      expect(response.body.data.status).toBe("draft");

      createdEntryId = response.body.data.id;
    });

    test("POST /api/journals - should reject unbalanced entry", async () => {
      const unbalancedEntry = {
        reference_number: `TEST-JE-UNBALANCED-${Date.now()}`,
        entry_date: "2024-01-15",
        description: "Unbalanced entry",
        facility_id: testFacilityId,
        user_id: testUserId,
        user_role: "admin",
        lines: [
          {
            account_code: "1000",
            debit: 1000,
            credit: 0,
          },
          {
            account_code: "4000",
            debit: 0,
            credit: 500,
          },
        ],
      };

      const response = await request(app)
        .post("/api/journals")
        .send(unbalancedEntry)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/balanced/i);
    });

    test("GET /api/journals - should retrieve journal entries", async () => {
      const response = await request(app)
        .get("/api/journals")
        .query({
          facility_id: testFacilityId,
          user_role: "admin",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test("GET /api/journals/:id - should retrieve specific journal entry", async () => {
      const response = await request(app)
        .get(`/api/journals/${createdEntryId}`)
        .query({
          facility_id: testFacilityId,
          user_role: "admin",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdEntryId);
      expect(response.body.data.lines).toBeDefined();
      expect(response.body.data.lines.length).toBeGreaterThan(0);
    });

    test("PUT /api/journals/:id - should update draft journal entry", async () => {
      const updatedData = {
        reference_number: `TEST-JE-UPDATED-${Date.now()}`,
        entry_date: "2024-01-16",
        description: "Updated test journal entry",
        facility_id: testFacilityId,
        user_id: testUserId,
        user_role: "admin",
        currency: "NGN",
        lines: [
          {
            account_code: "1000",
            account_name: "Cash",
            debit: 1500,
            credit: 0,
          },
          {
            account_code: "4000",
            account_name: "Sales Revenue",
            debit: 0,
            credit: 1500,
          },
        ],
      };

      const response = await request(app)
        .put(`/api/journals/${createdEntryId}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total_debit).toBe("1500.00");
    });

    test("POST /api/journals/:id/post - should post journal entry", async () => {
      const response = await request(app)
        .post(`/api/journals/${createdEntryId}/post`)
        .send({
          facility_id: testFacilityId,
          user_id: testUserId,
          user_role: "admin",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("posted");
      expect(response.body.data.posted_by).toBe(testUserId);
    });

    test("PUT /api/journals/:id - should not update posted entry", async () => {
      const updatedData = {
        description: "Trying to update posted entry",
        facility_id: testFacilityId,
        user_id: testUserId,
        user_role: "admin",
        lines: [
          {
            account_code: "1000",
            debit: 2000,
            credit: 0,
          },
          {
            account_code: "4000",
            debit: 0,
            credit: 2000,
          },
        ],
      };

      const response = await request(app)
        .put(`/api/journals/${createdEntryId}`)
        .send(updatedData)
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    test("POST /api/journals/:id/reverse - should reverse posted entry", async () => {
      const response = await request(app)
        .post(`/api/journals/${createdEntryId}/reverse`)
        .send({
          facility_id: testFacilityId,
          user_id: testUserId,
          user_role: "admin",
          reversal_date: "2024-01-20",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("posted");
      expect(response.body.data.reversal_of_id).toBe(createdEntryId);
    });

    test("GET /api/journals/export - should export to CSV", async () => {
      const response = await request(app)
        .get("/api/journals/export")
        .query({
          facility_id: testFacilityId,
          user_role: "admin",
          format: "csv",
        })
        .expect(200);

      expect(response.headers["content-type"]).toMatch(/csv/);
    });

    test("DELETE /api/journals/:id - should not delete posted entry", async () => {
      const response = await request(app)
        .delete(`/api/journals/${createdEntryId}`)
        .query({
          facility_id: testFacilityId,
          user_role: "admin",
        })
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    test("GET /api/journals - should filter by status", async () => {
      const response = await request(app)
        .get("/api/journals")
        .query({
          facility_id: testFacilityId,
          user_role: "admin",
          status: "posted",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      if (response.body.data.length > 0) {
        response.body.data.forEach((entry) => {
          expect(entry.status).toBe("posted");
        });
      }
    });

    test("GET /api/journals - should filter by date range", async () => {
      const response = await request(app)
        .get("/api/journals")
        .query({
          facility_id: testFacilityId,
          user_role: "admin",
          start_date: "2024-01-01",
          end_date: "2024-01-31",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  // ===== PERMISSION TESTS =====

  describe("Permission Tests", () => {
    test("should deny reader from creating journal entry", async () => {
      const newEntry = {
        reference_number: `TEST-JE-READER-${Date.now()}`,
        entry_date: "2024-01-15",
        facility_id: testFacilityId,
        user_id: "reader@example.com",
        user_role: "reader",
        lines: [
          { account_code: "1000", debit: 100, credit: 0 },
          { account_code: "4000", debit: 0, credit: 100 },
        ],
      };

      const response = await request(app)
        .post("/api/journals")
        .send(newEntry)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/permission/i);
    });

    test("should allow admin to create journal entry", async () => {
      const newEntry = {
        reference_number: `TEST-JE-ADMIN-${Date.now()}`,
        entry_date: "2024-01-15",
        facility_id: testFacilityId,
        user_id: "admin@example.com",
        user_role: "admin",
        lines: [
          { account_code: "1000", debit: 100, credit: 0 },
          { account_code: "4000", debit: 0, credit: 100 },
        ],
      };

      const response = await request(app)
        .post("/api/journals")
        .send(newEntry)
        .expect(201);

      expect(response.body.success).toBe(true);
    });
  });
});













