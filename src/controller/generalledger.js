const db = require("../models");

exports.getTrailBalance = (req, res) => {
  const { from= '', to='' } = req.params;
  const { query_type = "",code='' , account_description = "", subhead = ""} = req.query;
  const { facilityId = '' } = req.body;

  db.sequelize
    .query(
      `call account_reports(:query_type,:from,:to,:facilityId,:code, :account_description,:subhead)`,
      {
        replacements: {
          query_type,
         from,
           to,
          facilityId,
          code,
          account_description,
          subhead,
        },
      }
    )
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.insertLedger = async (req, res) => {
  const { data, facilityId, query_type = "Expenditure" } = req.body;

  console.log(req.body);

  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "Invalid input, expected an array" });
  }

  try {
    for (const entry of data) {
      const {
        expenditure_type,
        expenditure_head,
        date,
        select_source_account,
        head_description,
        amount,
        narration,
        reference_number = `REF/${moment().format("YY")}/${Math.floor(Math.random() * 1000)}`,
        mode_code,
        collected_by,
        mode_of_payment,
        bank_name,
        cheque_number,
      } = entry;

      await db.sequelize.query(
        `CALL general_ledger(
          :query_type, 
          :entries_date, 
          :source_name, 
          :amount, 
          :destination_name, 
          :head, 
          :account_num, 
          :source_acc_num, 
          :mode_of_payment, 
          :account_description, 
          :facilityId,
          :refrence_number,
          :bank_name,
          :cheque_no,
          :payee
        )`,
        {
          replacements: {
            query_type,
            entries_date: date,
            source_name: expenditure_type,
            amount,
            destination_name: head_description ? head_description : "",
            collected_by,
            head: expenditure_head,
            account_num: select_source_account,
            refrence_number: reference_number,
            source_acc_num: mode_code ? mode_code : 0,
            mode_of_payment,
            account_description: narration,
            facilityId,     
            bank_name,
            cheque_no: cheque_number,
            payee: "",
          },
        }
      );
    }

    res.json({ success: true, message: "All entries processed successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getExpences = (req, res) => {
  Contact.findAll()
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};
