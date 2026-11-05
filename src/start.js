/**
 * src/start.js — process entry point.
 *
 * Separated from src/app.js so tests can import the Express app without
 * triggering a real MongoDB connection or server.listen().
 *
 * Usage:
 *   node src/start.js        (production / development)
 *   npm start                (alias)
 */
'use strict';

require('dotenv').config();
const { app, server } = require('./app');
const mongoose = require('mongoose');

const isProd = process.env.NODE_ENV === 'production';

mongoose.set('strictQuery', true);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      if (!isProd) console.log(`Application available at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION — shutting down:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — shutting down:', err);
  process.exit(1);
});

