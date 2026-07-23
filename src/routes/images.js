module.exports = (app) => {
  const images = require('../controller/images');

  app.post('/upload/many', upload.array('images'), images.uploadMany);
  app.post('/upload/single', upload.single('image'), images.uploadImage);
};
