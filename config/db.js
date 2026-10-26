const mongoose = require('mongoose');

module.exports = async function connectDB() {
  mongoose.set('strictQuery', true);
  const conn = await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
};
