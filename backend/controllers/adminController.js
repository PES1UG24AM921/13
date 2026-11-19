const bcrypt = require('bcrypt');
const pool = require('../db');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseId(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

function parseLimit(value, defaultValue = 50) {
  if (!(typeof value === 'string' && /^\d+$/.test(value)) && !Number.isSafeInteger(value)) {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : defaultValue;
}

function parseOffset(value) {
  if (!(typeof value === 'string' && /^\d+$/.test(value)) && !Number.isSafeInteger(value)) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateAccount({ email, password }) {
  return typeof email === 'string'
    && email.trim().length <= 254
    && EMAIL_PATTERN.test(email.trim())
    && typeof password === 'string'
    && password.length >= 8
    && Buffer.byteLength(password, 'utf8') <= 72;
}

function databaseError(res, error, action) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'The email or unique account detail is already in use.' });
  }
  console.error(`${action} failed:`, error.message);
  return res.status(500).json({ error: `Unable to ${action}.` });
}

async function listUsers(req, res) {
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);
  const filters = [];
  const values = [];
  if (req.query.role) {
    filters.push('u.role = ?');
    values.push(req.query.role);
  }
  values.push(limit, offset);
  try {
    const [users] = await pool.execute(
      `SELECT CAST(u.id AS CHAR) AS id, u.email, u.role, u.is_active AS isActive,
              DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
              p.first_name AS firstName, p.last_name AS lastName,
              DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS dateOfBirth,
              COALESCE(p.phone, d.phone) AS phone,
              d.license_number AS licenseNumber, d.specialty
       FROM users u
       LEFT JOIN patients p ON p.user_id = u.id
       LEFT JOIN doctors d ON d.user_id = u.id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ? OFFSET ?`,
      values,
    );
    return res.status(200).json({ users, limit, offset });
  } catch (error) {
    return databaseError(res, error, 'list users');
  }
}

async function getMyProfile(req, res) {
  try {
    const [users] = await pool.execute(
      `SELECT CAST(u.id AS CHAR) AS id, u.email, u.role,
              DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
       FROM users u WHERE u.id = ? AND u.role = 'admin'`,
      [req.user.id],
    );
    if (!users[0]) return res.status(404).json({ error: 'Administrator profile not found.' });
    return res.status(200).json({ user: users[0] });
  } catch (error) {
    return databaseError(res, error, 'load administrator profile');
  }
}

async function updateUser(req, res) {
  const userId = parseId(String(req.params.id ?? ''));
  const body = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId must be a positive integer.' });
  const allowed = ['email', 'firstName', 'lastName', 'dateOfBirth', 'phone', 'licenseNumber', 'specialty'];
  const fields = Object.keys(body);
  if (!fields.length || fields.some((field) => !allowed.includes(field))) {
    return res.status(400).json({ error: 'Provide one or more supported account fields.' });
  }
  if (body.dateOfBirth != null && !isValidDate(body.dateOfBirth)) {
    return res.status(400).json({ error: 'dateOfBirth must be a valid YYYY-MM-DD date or null.' });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [users] = await connection.execute(
      'SELECT role FROM users WHERE id = ? FOR UPDATE',
      [userId],
    );
    if (!users[0]) {
      await connection.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'User not found.' });
    }
    const role = users[0].role;
    const email = body.email?.trim().toLowerCase();
    if (email) await connection.execute('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
    const patientFields = ['firstName', 'lastName', 'dateOfBirth', 'phone'];
    const doctorFields = ['licenseNumber', 'specialty', 'phone'];
    const profileFields = role === 'patient' ? patientFields : role === 'doctor' ? doctorFields : [];
    const profileUpdates = fields.filter((field) => profileFields.includes(field));
    const mismatched = fields.some((field) => field !== 'email' && !profileFields.includes(field));
    if (mismatched || (role === 'admin' && fields.some((field) => field !== 'email'))) {
      await connection.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'Fields do not match this account role.' });
    }
    if (profileUpdates.length) {
      const table = role === 'patient' ? 'patients' : 'doctors';
      const columns = {
        firstName: 'first_name', lastName: 'last_name', dateOfBirth: 'date_of_birth',
        phone: 'phone', licenseNumber: 'license_number', specialty: 'specialty',
      };
      const assignments = profileUpdates.map((field) => `${columns[field]} = ?`).join(', ');
      const values = profileUpdates.map((field) => (
        ['firstName', 'lastName', 'licenseNumber', 'specialty'].includes(field) && typeof body[field] === 'string'
          ? body[field].trim() : body[field]
      ));
      await connection.execute(`UPDATE ${table} SET ${assignments} WHERE user_id = ?`, [...values, userId]);
    }
    await connection.commit(); transactionStarted = false;
    const [updated] = await pool.execute(
      `SELECT CAST(u.id AS CHAR) AS id, u.email, u.role, u.is_active AS isActive,
              p.first_name AS firstName, p.last_name AS lastName,
              DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS dateOfBirth, COALESCE(p.phone, d.phone) AS phone,
              d.license_number AS licenseNumber, d.specialty
       FROM users u LEFT JOIN patients p ON p.user_id = u.id
       LEFT JOIN doctors d ON d.user_id = u.id WHERE u.id = ?`,
      [userId],
    );
    return res.status(200).json({ user: updated[0] });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    return databaseError(res, error, 'update user details');
  } finally {
    if (connection) connection.release();
  }
}

async function createAccount(req, res, role) {
  const body = req.body || {};
  if (!validateAccount(body)) {
    return res.status(400).json({ error: 'Provide a valid email and password (8-72 UTF-8 bytes).' });
  }

  const normalizedEmail = body.email.trim().toLowerCase();
  let profileValues;
  let profileSql;
  if (role === 'doctor') {
    const { licenseNumber, specialty, phone = null } = body;
    if (
      typeof licenseNumber !== 'string'
      || licenseNumber.trim().length === 0
      || licenseNumber.trim().length > 100
      || typeof specialty !== 'string'
      || specialty.trim().length === 0
      || specialty.trim().length > 150
      || (phone !== null && (typeof phone !== 'string' || phone.length > 32))
    ) {
      return res.status(400).json({ error: 'Provide a valid licenseNumber, specialty, and optional phone.' });
    }
    profileSql = 'INSERT INTO doctors (user_id, license_number, specialty, phone) VALUES (?, ?, ?, ?)';
    profileValues = [null, licenseNumber.trim(), specialty.trim(), phone];
  } else {
    const { firstName, lastName, dateOfBirth = null, phone = null } = body;
    if (
      typeof firstName !== 'string' || firstName.trim().length === 0 || firstName.trim().length > 100
      || typeof lastName !== 'string' || lastName.trim().length === 0 || lastName.trim().length > 100
      || (dateOfBirth !== null && !isValidDate(dateOfBirth))
      || (phone !== null && (typeof phone !== 'string' || phone.length > 32))
    ) {
      return res.status(400).json({ error: 'Provide valid firstName and lastName, plus optional dateOfBirth and phone.' });
    }
    profileSql = `INSERT INTO patients (user_id, first_name, last_name, date_of_birth, phone)
                  VALUES (?, ?, ?, ?, ?)`;
    profileValues = [null, firstName.trim(), lastName.trim(), dateOfBirth, phone];
  }

  let connection;
  let transactionStarted = false;
  try {
    const passwordHash = await bcrypt.hash(body.password, 12);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [userResult] = await connection.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      [normalizedEmail, passwordHash, role],
    );
    const userId = String(userResult.insertId);
    profileValues[0] = userId;
    await connection.execute(profileSql, profileValues);

    await connection.commit();
    transactionStarted = false;
    return res.status(201).json({ user: { id: userId, email: normalizedEmail, role } });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    return databaseError(res, error, `create ${role.toLowerCase()} account`);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function createUser(req, res) {
  const role = req.body?.role;
  if (!['doctor', 'patient'].includes(role)) {
    return res.status(400).json({ error: 'role must be doctor or patient.' });
  }
  return createAccount(req, res, role);
}

async function setUserActive(req, res, isActive) {
  const userId = parseId(String(req.params.id ?? req.params.userId ?? ''));
  if (!userId) {
    return res.status(400).json({ error: 'userId must be a positive integer.' });
  }
  if (!isActive && userId === String(req.user.id)) {
    return res.status(409).json({ error: 'You cannot deactivate your own administrator account.' });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [users] = await connection.execute(
      'SELECT is_active AS isActive FROM users WHERE id = ? FOR UPDATE',
      [userId],
    );
    if (!users[0]) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'User not found.' });
    }
    if (Boolean(users[0].isActive) === isActive) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: `User is already ${isActive ? 'active' : 'inactive'}.` });
    }

    await connection.execute('UPDATE users SET is_active = ? WHERE id = ?', [isActive, userId]);
    await connection.commit();
    transactionStarted = false;
    return res.status(200).json({ userId, isActive });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    return databaseError(res, error, `${isActive ? 'reactivate' : 'deactivate'} user`);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function updateUserStatus(req, res) {
  const isActive = req.body?.is_active ?? req.body?.isActive;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be a boolean.' });
  }
  return setUserActive(req, res, isActive);
}

async function listAppointments(req, res) {
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);
  const filters = [];
  const values = [];
  if (req.query.doctorId) {
    filters.push('a.doctor_id = ?');
    values.push(req.query.doctorId);
  }
  if (req.query.patientId) {
    filters.push('a.patient_id = ?');
    values.push(req.query.patientId);
  }
  if (req.query.date) {
    filters.push('a.starts_at >= ? AND a.starts_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(req.query.date, req.query.date);
  }
  if (req.query.status) {
    filters.push('a.status = ?');
    values.push(req.query.status);
  }
  values.push(limit, offset);
  try {
    const [appointments] = await pool.execute(
      `SELECT CAST(a.id AS CHAR) AS id,
              CAST(a.patient_id AS CHAR) AS patientId,
              CONCAT(p.first_name, ' ', p.last_name) AS patientName,
              CAST(a.doctor_id AS CHAR) AS doctorId,
              d.specialty AS doctorSpecialty,
              DATE_FORMAT(a.starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
              DATE_FORMAT(a.ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt,
              a.status, a.reason
       FROM appointments a
       JOIN patients p ON p.user_id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY a.starts_at DESC
       LIMIT ? OFFSET ?`,
      values,
    );
    return res.status(200).json({ appointments, limit, offset });
  } catch (error) {
    return databaseError(res, error, 'list appointments');
  }
}

async function getAppointment(req, res) {
  const appointmentId = parseId(req.params.appointmentId);
  if (!appointmentId) {
    return res.status(400).json({ error: 'appointmentId must be a positive integer.' });
  }
  try {
    const [appointments] = await pool.execute(
      `SELECT CAST(a.id AS CHAR) AS id,
              CAST(a.patient_id AS CHAR) AS patientId,
              CONCAT(p.first_name, ' ', p.last_name) AS patientName,
              CAST(a.doctor_id AS CHAR) AS doctorId,
              d.specialty AS doctorSpecialty,
              DATE_FORMAT(a.starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
              DATE_FORMAT(a.ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt,
              a.status, a.reason
       FROM appointments a
       JOIN patients p ON p.user_id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       WHERE a.id = ?`,
      [appointmentId],
    );
    if (!appointments[0]) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    return res.status(200).json({ appointment: appointments[0] });
  } catch (error) {
    return databaseError(res, error, 'load appointment');
  }
}

async function cancelAppointment(req, res) {
  const appointmentId = parseId(req.params.appointmentId);
  if (!appointmentId) {
    return res.status(400).json({ error: 'appointmentId must be a positive integer.' });
  }
  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [appointments] = await connection.execute(
      'SELECT status FROM appointments WHERE id = ? FOR UPDATE',
      [appointmentId],
    );
    if (!appointments[0]) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    if (appointments[0].status !== 'Scheduled') {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Only scheduled appointments can be cancelled.' });
    }
    await connection.execute(
      "UPDATE appointments SET status = 'Cancelled' WHERE id = ? AND status = 'Scheduled'",
      [appointmentId],
    );
    await connection.commit();
    transactionStarted = false;
    return res.status(200).json({ appointmentId, status: 'Cancelled' });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    return databaseError(res, error, 'cancel appointment');
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function getOverview(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT (SELECT COUNT(*) FROM patients) AS patients,
              (SELECT COUNT(*) FROM doctors) AS doctors,
              (SELECT COUNT(*) FROM appointments) AS appointments`,
    );
    return res.status(200).json({
      patients: Number(rows[0].patients),
      doctors: Number(rows[0].doctors),
      appointments: Number(rows[0].appointments),
    });
  } catch (error) {
    return databaseError(res, error, 'load system overview');
  }
}

async function listAuditLogs(req, res) {
  const limit = parseLimit(req.query.limit, 50);
  try {
    const [auditLogs] = await pool.execute(
      `SELECT CAST(id AS CHAR) AS id,
              CAST(actor_user_id AS CHAR) AS actorUserId,
              actor_role AS actorRole, actor_email AS actorEmail,
              action, target_type AS targetType, target_id AS targetId,
              metadata, ip_address AS ipAddress, user_agent AS userAgent,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
       FROM audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [limit],
    );
    return res.status(200).json({ auditLogs });
  } catch (error) {
    return databaseError(res, error, 'load audit logs');
  }
}

module.exports = {
  listUsers,
  getMyProfile,
  updateUser,
  createUser,
  updateUserStatus,
  listAppointments,
  getAppointment,
  cancelAppointment,
  getOverview,
  listAuditLogs,
};
