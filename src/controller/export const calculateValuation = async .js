export const calculateValuation = async (
    product_id,
    facility_id,
    qty_out,
    valuation_method
  ) => {
    try {
      // --- VALIDATION ---
      if (!product_id || !facility_id || !qty_out || !valuation_method) {
        return { totalCost: 0, avgCost: 0, error: "Missing required fields" };
      }
  
      // ================================
      // STEP 1: GET STORE LAYERS (SQL)
      // ================================
      // For FIFO: order ASC
      // For LIFO: order DESC
      const order = valuation_method === "LIFO" ? "DESC" : "ASC";
  
      const [layersRaw] = await db.sequelize.query(
        `
        SELECT
          (qty_in - qty_out) AS qty,
          cost_price AS cost
        FROM store_entries
        WHERE product_id = :product_id
          AND facilityId = :facility_id
          AND (qty_in - qty_out) > 0
        ORDER BY createdAt ${order}
        `,
        {
          replacements: { product_id, facility_id },
        }
      );
  
      let layers = layersRaw.map((x) => ({
        qty: Number(x.qty),
        cost: Number(x.cost),
      }));
  
      if (layers.length === 0) {
        return  { totalCost: 0, avgCost: 0, error: "No inventory available" };
      }
  
      // ================================
      // STEP 2: VALUATION METHODS
      // ================================
  
      function fifoValuation(layers, qtyOut) {
        let remaining = qtyOut;
        let totalCost = 0;
  
        for (let layer of layers) {
          if (remaining <= 0) break;
          const take = Math.min(layer.qty, remaining);
          totalCost += take * layer.cost;
          layer.qty -= take;
          remaining -= take;
        }
  
        return { totalCost, updatedLayers: layers };
      }
  
      function lifoValuation(layers, qtyOut) {
        let remaining = qtyOut;
        let totalCost = 0;
  
        for (let i = layers.length - 1; i >= 0; i--) {
          if (remaining <= 0) break;
          const layer = layers[i];
          const take = Math.min(layer.qty, remaining);
          totalCost += take * layer.cost;
          layer.qty -= take;
          remaining -= take;
        }
  
        return { totalCost, updatedLayers: layers };
      }
  
      function weightedAverageValuation(layers, qtyOut) {
        let totalQty = 0;
        let totalValue = 0;
  
        layers.forEach((x) => {
          totalQty += x.qty;
          totalValue += x.qty * x.cost;
        });
  
        const avgCost = totalValue / totalQty;
        const totalCost = qtyOut * avgCost;
  
        return { totalCost, avgCost };
      }
  
      // ================================
      // STEP 3: APPLY THE METHOD
      // ================================
  
      let result;
  
      if (valuation_method === "FIFO") {
        result = fifoValuation(layers, qty_out);
      } else if (valuation_method === "LIFO") {
        result = lifoValuation(layers, qty_out);
      } else if (valuation_method === "WAC") {
        result = weightedAverageValuation(layers, qty_out);
      } else {
         return { totalCost: 0, avgCost: 0, error: "Invalid valuation method" };
      }
  
      // ================================
      // RESPONSE
      // ================================
      return { totalCost: result.totalCost, avgCost: result.avgCost };
    } catch (error) {
      console.log("valuation error:", error);
      return { totalCost: 0, avgCost: 0, error: error.message };
    }
  };