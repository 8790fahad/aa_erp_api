-- Journal Entries Number Generator Setup
-- Run this SQL to set up the JE prefix for journal entry reference numbers

-- Insert JE prefix for each facility
-- Replace 'YOUR_FACILITY_ID' with your actual facility IDs

-- Example for a single facility:
INSERT INTO number_generator (prefix, code_no, facilityId, createdAt, updatedAt)
VALUES ('JE', 1, 'YOUR_FACILITY_ID', NOW(), NOW())
ON DUPLICATE KEY UPDATE updatedAt = NOW();

-- Example for multiple facilities:
-- INSERT INTO number_generator (prefix, code_no, facilityId, createdAt, updatedAt)
-- SELECT 'JE', 1, id, NOW(), NOW()
-- FROM business
-- WHERE id NOT IN (
--   SELECT facilityId FROM number_generator WHERE prefix = 'JE'
-- );

-- Verify the setup
SELECT * FROM number_generator WHERE prefix = 'JE';

-- Expected output:
-- prefix | code_no | facilityId
-- -------|---------|------------
-- JE     | 1       | FAC001
-- JE     | 1       | FAC002
-- etc...

-- The system will generate reference numbers like:
-- JE-000001, JE-000002, JE-000003, etc.

