const db = require('../models');

const getYearSuffix = () => {
  return new Date().getFullYear().toString().slice(-2);
};

exports.generateCode = async (req, res) => {
  try {
    const { prefix } = req.body;
    if (!prefix) return res.status(400).json({ message: "Prefix is required" });

    const year = parseInt(getYearSuffix());

    // Upsert logic
    const [result] = await db.sequelize.query(
      `
        INSERT INTO id_sequence (prefix, year, count)
        VALUES (:prefix, :year, 1)
        ON DUPLICATE KEY UPDATE count = count + 1;
      `,
      {
        replacements: { prefix, year },
      }
    );

    // Fetch updated count
    const [[row]] = await db.sequelize.query(
      `SELECT count FROM id_sequence WHERE prefix = :prefix AND year = :year`,
      {
        replacements: { prefix, year },
      }
    );

    const code = `${prefix}/${year}/${row.count}`;
    return res.status(200).json({ code });

  } catch (err) {
    console.error('generateCode error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
