export function uploadMany(req, res) {
    const files = req.files;
    const { propertyId } = req.body;
  
    let filesArray = [];
  
    files.forEach((item) =>
      filesArray.push({
        file_name: item.filename,
        cloud_url: item.path,
        image_title: item.originalname,
        property_id: propertyId,
      }),
    );
  }
  
  export function uploadImage(req, res) {
    const { propertyId } = req.body;
  
    res.json({ success: results });
  }