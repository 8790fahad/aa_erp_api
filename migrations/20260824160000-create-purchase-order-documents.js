"use strict";

/**
 * Documents attached to purchase orders / requisitions
 * (waybills, delivery notes, and other delivery docs).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pr_no VARCHAR(100) NOT NULL,
        po_no VARCHAR(100) NULL,
        facilityId VARCHAR(50) NOT NULL,
        document_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        original_name VARCHAR(255) NULL,
        file_size INT NULL,
        mime_type VARCHAR(100) NULL,
        doc_type VARCHAR(50) NULL DEFAULT 'delivery',
        uploaded_by VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_po_docs_pr (pr_no, facilityId),
        INDEX idx_po_docs_po (po_no, facilityId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("purchase_order_documents");
  },
};
