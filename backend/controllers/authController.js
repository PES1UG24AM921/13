const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { getJwtSecret, USER_ROLES } = require('../config/env');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_MAX_PASSWORD_BYTES = 72;

function isValidRegistration({ email, password, firstName, lastName }) {
  return typeof email === 'string'
    && email.trim().length <= 254
    && EMAIL_PATTERN.test(email.trim())
    && typeof password === 'string'
    && password.length >= 8
    && Buffer.byteLength(password, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES
    && typeof firstName === 'string'
    && firstName.trim().length > 0
    && firstName.trim().length <= 100
    && typeof lastName === 'string'
    && lastName.trim().length > 0
    && lastName.trim().length <= 100;
}

async function register(req, res) {
  const { email, password, firstName, lastName } = req.body || {};
  if (!isValidRegistration({ email, password, firstName, lastName })) {
    return res.status(400).json({
      error: 'Provide a valid email, password (8-72 UTF-8 bytes), first name, and last name.',
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  let connection;
  let transactionStarted = false;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [userResult] = await connection.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      [normalizedEmail, passwordHash, 'patient'],
    );
    const userId = String(userResult.insertId);

    await connection.execute(
      'INSERT INTO patients (user_id, first_name, last_name) VALUES (?, ?, ?)',
      [userId, firstName.trim(), lastName.trim()],
    );

    await connection.commit();
    transactionStarted = false;
    return res.status(201).json({
      user: { id: userId, email: normalizedEmail, role: 'patient' },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('Registration failed:', error.message);
    return res.status(500).json({ error: 'Unable to register account.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const [users] = await pool.execute(
      'SELECT CAST(id AS CHAR) AS id, email, password_hash, role, is_active FROM users WHERE email = ?',
      [email.trim().toLowerCase()],
    );
    const user = users[0];
    if (!user || !user.is_active || !USER_ROLES.includes(user.role)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      getJwtSecret(),
      {
        subject: user.id,
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      },
    );

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Login failed:', error.message);
    return res.status(500).json({ error: 'Unable to log in.' });
  }
}

module.exports = { register, login };