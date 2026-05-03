/**
 * config/db.js — BACKEND
 */

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      tls:                         true,
      tlsAllowInvalidCertificates: false,
      serverSelectionTimeoutMS:    10000,
      socketTimeoutMS:             45000,
      maxPoolSize:                 10,
    });
    console.log('[DB] MongoDB Atlas connecté ✓ :', mongoose.connection.host);
  } catch (err) {
    console.error('[DB] Erreur connexion :', err.message);
    console.log('[DB] Retry dans 5s...');
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('[DB] Déconnecté — reconnexion...');
  setTimeout(connectDB, 5000);
});

mongoose.connection.on('error', (err) => {
  console.error('[DB] Erreur MongoDB :', err.message);
});

module.exports = connectDB;