const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.query('SELECT NOW()')
  .then(() => console.log('Connected to PostgreSQL (Neon)'))
  .catch(err => console.error('PostgreSQL connection error:', err.message));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};