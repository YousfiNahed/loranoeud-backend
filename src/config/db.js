const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser:    true,
      useUnifiedTopology: true,
    });
    console.log(`[DB] MongoDB connecté : ${conn.connection.host}`);
  } catch (err) {
    console.error('[DB] Erreur de connexion MongoDB :', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
