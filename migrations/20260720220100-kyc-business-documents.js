"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = await queryInterface
      .describeTable("kyc_business_documents")
      .then(() => true)
      .catch(() => false);
    if (exists) return;

    await queryInterface.createTable("kyc_business_documents", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      kyc_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "kyc_users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      doc_type: { type: Sequelize.STRING(60), allowNull: false },
      file_name: { type: Sequelize.STRING(255), allowNull: false },
      file_url: { type: Sequelize.STRING(500), allowNull: false },
      mime_type: { type: Sequelize.STRING(120), allowNull: true },
      file_size: { type: Sequelize.INTEGER, allowNull: true },
      storage_path: { type: Sequelize.STRING(500), allowNull: true },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("kyc_business_documents", ["kyc_user_id"], {
      name: "kyc_business_documents_user",
    });
    await queryInterface.addIndex(
      "kyc_business_documents",
      ["kyc_user_id", "doc_type"],
      { name: "kyc_business_documents_user_type" },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("kyc_business_documents");
  },
};
