const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const USER_ROLES = Object.freeze(['patient', 'doctor', 'admin']);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters.');
  }
  return secret;
}

module.exports = { getJwtSecret, USER_ROLES };