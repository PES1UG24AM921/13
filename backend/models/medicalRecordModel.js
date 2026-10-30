const pool = require('../db');

const RECORD_FIELDS = `CAST(mr.id AS CHAR) AS id,
  CAST(mr.appointment_id AS CHAR) AS appointmentId,
  CAST(mr.patient_id AS CHAR) AS patientId,
  CAST(mr.doctor_id AS CHAR) AS doctorId,
  d.specialty AS doctorSpecialty,
  mr.diagnosis, mr.treatment, mr.notes,
  DATE_FORMAT(mr.recorded_at, '%Y-%m-%d %H:%i:%s') AS recordedAt`;

async function findAppointmentForDoctor(appointmentId, doctorId) {
  const [appointments] = await pool.execute(
    `SELECT CAST(id AS CHAR) AS id, CAST(patient_id AS CHAR) AS patientId
     FROM appointments
     WHERE id = ? AND doctor_id = ?`,
    [appointmentId, doctorId],
  );
  return appointments[0] || null;
}

async function hasTreatingRelationship(patientId, doctorId) {
  const [appointments] = await pool.execute(
    `SELECT id FROM appointments
     WHERE patient_id = ? AND doctor_id = ?
     LIMIT 1`,
    [patientId, doctorId],
  );
  return Boolean(appointments[0]);
}

async function findPatientId(recordId) {
  const [records] = await pool.execute(
    'SELECT CAST(patient_id AS CHAR) AS patientId FROM medical_records WHERE id = ?',
    [recordId],
  );
  return records[0]?.patientId || null;
}

async function create(record) {
  const [result] = await pool.execute(
    `INSERT INTO medical_records
       (appointment_id, patient_id, doctor_id, diagnosis, treatment, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.appointmentId,
      record.patientId,
      record.doctorId,
      record.diagnosis,
      record.treatment,
      record.notes,
    ],
  );
  return result.insertId;
}

async function update(recordId, patientId, changes) {
  const [result] = await pool.execute(
    `UPDATE medical_records
     SET diagnosis = ?, treatment = ?, notes = ?
     WHERE id = ? AND patient_id = ?`,
    [changes.diagnosis, changes.treatment, changes.notes, recordId, patientId],
  );
  return result.affectedRows;
}

async function findById(recordId) {
  const [records] = await pool.execute(
    `SELECT ${RECORD_FIELDS}
     FROM medical_records mr
     JOIN doctors d ON d.user_id = mr.doctor_id
     WHERE mr.id = ?`,
    [recordId],
  );
  return records[0] || null;
}

async function listForPatient(patientId) {
  const [records] = await pool.execute(
    `SELECT ${RECORD_FIELDS}
     FROM medical_records mr
     JOIN doctors d ON d.user_id = mr.doctor_id
     WHERE mr.patient_id = ?
     ORDER BY mr.recorded_at DESC, mr.id DESC`,
    [patientId],
  );
  return records;
}

async function listForDoctor(doctorId, patientId) {
  const patientCondition = patientId ? 'AND mr.patient_id = ?' : '';
  const values = patientId ? [doctorId, patientId] : [doctorId];
  const [records] = await pool.execute(
    `SELECT ${RECORD_FIELDS}
     FROM medical_records mr
     JOIN doctors d ON d.user_id = mr.doctor_id
     WHERE EXISTS (
       SELECT 1 FROM appointments a
       WHERE a.patient_id = mr.patient_id AND a.doctor_id = ?
     )
       ${patientCondition}
     ORDER BY mr.recorded_at DESC, mr.id DESC`,
    values,
  );
  return records;
}

module.exports = {
  create,
  findAppointmentForDoctor,
  findById,
  findPatientId,
  hasTreatingRelationship,
  listForDoctor,
  listForPatient,
  update,
};
