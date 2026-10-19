const pool = require('../db');

const PROFILE_FIELDS = Object.freeze({
  firstName: { column: 'first_name', maxLength: 100, required: true },
  lastName: { column: 'last_name', maxLength: 100, required: true },
  dateOfBirth: { column: 'date_of_birth', type: 'date' },
  phone: { column: 'phone', maxLength: 32 },
  address: { column: 'address', maxLength: 500 },
});
const ID_FIELDS = ['id', 'userId', 'patientId'];

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requestedAnotherPatient(req) {
  if (
    req.params.patientId !== undefined
    && String(req.params.patientId) !== String(req.user.id)
  ) {
    return true;
  }
  return ID_FIELDS.some((field) => (
    req.body?.[field] !== undefined
    && String(req.body[field]) !== String(req.user.id)
  ));
}

async function getProfile(req, res) {
  if (requestedAnotherPatient(req)) {
    return res.status(403).json({ error: 'You may only access your own patient profile.' });
  }

  try {
    const [patients] = await pool.execute(
      `SELECT CAST(user_id AS CHAR) AS id, first_name AS firstName,
              last_name AS lastName,
              DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS dateOfBirth,
              phone, address
       FROM patients WHERE user_id = ?`,
      [req.user.id],
    );
    if (!patients[0]) {
      return res.status(404).json({ error: 'Patient profile not found.' });
    }
    return res.status(200).json({ patient: patients[0] });
  } catch (error) {
    console.error('Patient profile lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to load patient profile.' });
  }
}

async function updateProfile(req, res) {
  if (requestedAnotherPatient(req)) {
    return res.status(403).json({ error: 'You may only update your own patient profile.' });
  }

  const body = req.body || {};
  const fields = Object.keys(body).filter((field) => !ID_FIELDS.includes(field));
  if (fields.length === 0 || fields.some((field) => !PROFILE_FIELDS[field])) {
    return res.status(400).json({ error: 'Provide one or more supported profile fields.' });
  }

  const assignments = [];
  const values = [];
  for (const field of fields) {
    const definition = PROFILE_FIELDS[field];
    const value = body[field];
    if (definition.type === 'date') {
      if (value !== null && !isValidDate(value)) {
        return res.status(400).json({ error: 'dateOfBirth must be a valid YYYY-MM-DD date or null.' });
      }
    } else if (value === null && !definition.required) {
      // Nullable profile fields can be cleared explicitly.
    } else if (
      typeof value !== 'string'
      || (definition.required && value.trim().length === 0)
      || value.trim().length > definition.maxLength
    ) {
      return res.status(400).json({ error: `${field} has an invalid value.` });
    }

    assignments.push(`${definition.column} = ?`);
    values.push(typeof value === 'string' && definition.required ? value.trim() : value);
  }

  try {
    values.push(req.user.id);
    const [result] = await pool.execute(
      `UPDATE patients SET ${assignments.join(', ')} WHERE user_id = ?`,
      values,
    );
    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(
        'SELECT user_id FROM patients WHERE user_id = ?',
        [req.user.id],
      );
      if (!existing[0]) {
        return res.status(404).json({ error: 'Patient profile not found.' });
      }
    }
    return getProfile(req, res);
  } catch (error) {
    console.error('Patient profile update failed:', error.message);
    return res.status(500).json({ error: 'Unable to update patient profile.' });
  }
}

module.exports = { getProfile, updateProfile };