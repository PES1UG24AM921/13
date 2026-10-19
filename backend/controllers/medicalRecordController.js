const pool = require('../db');

const MAX_TEXT_BYTES = 65000;

function parsePositiveId(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function isValidText(value, required = false) {
  if (value === null && !required) {
    return true;
  }
  return typeof value === 'string'
    && (!required || value.trim().length > 0)
    && Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES;
}

async function createMedicalRecord(req, res) {
  const appointmentId = parsePositiveId(String(req.body?.appointmentId ?? ''));
  const { diagnosis, treatment = null, notes = null } = req.body || {};
  if (
    !appointmentId
    || !isValidText(diagnosis, true)
    || !isValidText(treatment)
    || !isValidText(notes)
  ) {
    return res.status(400).json({ error: 'Provide a valid appointmentId, diagnosis, treatment, and notes.' });
  }

  try {
    const [appointments] = await pool.execute(
      `SELECT CAST(id AS CHAR) AS id, CAST(patient_id AS CHAR) AS patientId
       FROM appointments
       WHERE id = ? AND doctor_id = ?`,
      [appointmentId, req.user.id],
    );
    if (!appointments[0]) {
      return res.status(404).json({ error: 'Appointment not found for this doctor.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO medical_records
         (appointment_id, patient_id, doctor_id, diagnosis, treatment, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [appointmentId, appointments[0].patientId, req.user.id, diagnosis.trim(), treatment, notes],
    );
    return res.status(201).json({
      medicalRecord: {
        id: String(result.insertId),
        appointmentId,
        patientId: appointments[0].patientId,
        doctorId: String(req.user.id),
        diagnosis: diagnosis.trim(),
        treatment,
        notes,
      },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A medical record already exists for this appointment.' });
    }
    console.error('Medical record creation failed:', error.message);
    return res.status(500).json({ error: 'Unable to create medical record.' });
  }
}

async function updateMedicalRecord(req, res) {
  const recordId = parsePositiveId(req.params.recordId);
  const { diagnosis, treatment = null, notes = null } = req.body || {};
  if (
    !recordId
    || !isValidText(diagnosis, true)
    || !isValidText(treatment)
    || !isValidText(notes)
  ) {
    return res.status(400).json({ error: 'Provide a valid record ID, diagnosis, treatment, and notes.' });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE medical_records
       SET diagnosis = ?, treatment = ?, notes = ?
       WHERE id = ? AND doctor_id = ?`,
      [diagnosis.trim(), treatment, notes, recordId, req.user.id],
    );
    if (result.affectedRows === 0) {
      const [records] = await pool.execute(
        'SELECT id FROM medical_records WHERE id = ? AND doctor_id = ?',
        [recordId, req.user.id],
      );
      if (!records[0]) {
        return res.status(404).json({ error: 'Medical record not found.' });
      }
    }

    const [records] = await pool.execute(
      `SELECT CAST(id AS CHAR) AS id,
              CAST(appointment_id AS CHAR) AS appointmentId,
              CAST(patient_id AS CHAR) AS patientId,
              CAST(doctor_id AS CHAR) AS doctorId,
              diagnosis, treatment, notes,
              DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') AS recordedAt
       FROM medical_records WHERE id = ? AND doctor_id = ?`,
      [recordId, req.user.id],
    );
    return res.status(200).json({ medicalRecord: records[0] });
  } catch (error) {
    console.error('Medical record update failed:', error.message);
    return res.status(500).json({ error: 'Unable to update medical record.' });
  }
}

async function getMedicalRecords(req, res) {
  const conditions = [];
  const values = [];
  if (req.user.role === 'patient') {
    conditions.push('mr.patient_id = ?');
    values.push(req.user.id);
  } else if (req.user.role === 'doctor') {
    conditions.push('mr.doctor_id = ?');
    values.push(req.user.id);
    if (req.query.patientId !== undefined) {
      const patientId = String(req.query.patientId);
      if (!/^\d+$/.test(patientId) || Number(patientId) < 1) {
        return res.status(400).json({ error: 'patientId must be a positive integer.' });
      }
      conditions.push('mr.patient_id = ?');
      values.push(patientId);
    }
  } else {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  try {
    const [records] = await pool.execute(
      `SELECT CAST(mr.id AS CHAR) AS id,
              CAST(mr.appointment_id AS CHAR) AS appointmentId,
              CAST(mr.doctor_id AS CHAR) AS doctorId,
              d.specialty AS doctorSpecialty,
              mr.diagnosis, mr.treatment, mr.notes,
              DATE_FORMAT(mr.recorded_at, '%Y-%m-%d %H:%i:%s') AS recordedAt
       FROM medical_records mr
       JOIN doctors d ON d.user_id = mr.doctor_id
      WHERE ${conditions.join(' AND ')}
       ORDER BY mr.recorded_at DESC, mr.id DESC`,
          values,
    );
    return res.status(200).json({ medicalRecords: records });
  } catch (error) {
    console.error('Medical record lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to load medical records.' });
  }
}

module.exports = { createMedicalRecord, updateMedicalRecord, getMedicalRecords };