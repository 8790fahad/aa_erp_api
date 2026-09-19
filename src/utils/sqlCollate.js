/** Mixed dump collations (utf8mb4_unicode_ci vs utf8mb4_general_ci) break '='. */
const sqlEq = (a, b) =>
  `CONVERT(${a} USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(${b} USING utf8mb4) COLLATE utf8mb4_general_ci`;

const sqlCol = (expr) =>
  `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_general_ci`;

module.exports = { sqlEq, sqlCol };
