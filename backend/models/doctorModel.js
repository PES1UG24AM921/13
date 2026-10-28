const pool = require('../db');

async function findProfileById(doctorId) {
  const [doctors] = await pool.execute(
    `SELECT CAST(d.user_id AS CHAR) AS id,
            d.license_number AS licenseNumber, d.specialty, d.phone
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     WHERE d.user_id = ? AND u.is_active = TRUE`,
    [doctorId],
  );
  return doctors[0] || null;
}

async function search(filters) {
  const conditions = ['u.is_active = TRUE'];
  const values = [];
  if (filters.query) {
    conditions.push('(d.specialty LIKE ? OR d.license_number LIKE ?)');
    values.push(`%${filters.query}%`, `%${filters.query}%`);
  }
  if (filters.specialty) {
    conditions.push('d.specialty LIKE ?');
    values.push(`%${filters.specialty}%`);
  }

  const [doctors] = await pool.execute(
    `SELECT CAST(d.user_id AS CHAR) AS id,
            d.license_number AS licenseNumber, d.specialty, d.phone
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.specialty, d.license_number
     LIMIT ? OFFSET ?`,
    [...values, filters.limit, filters.offset],
  );
  return doctors;
}

async function findAvailabilityForDate(doctorId, weekday, date) {
  const [availability] = await pool.execute(
    `SELECT TIME_FORMAT(start_time, '%H:%i:%s') AS startTime,
            TIME_FORMAT(end_time, '%H:%i:%s') AS endTime
     FROM availability
     WHERE doctor_id = ? AND day_of_week = ?
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY start_time`,
    [doctorId, weekday, date, date],
  );
  return availability;
}

async function findAppointmentsForDate(doctorId, date) {
  const [appointments] = await pool.execute(
    `SELECT DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
            DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt
     FROM appointments
     WHERE doctor_id = ? AND status = 'Scheduled'
       AND starts_at < DATE_ADD(?, INTERVAL 1 DAY)
       AND ends_at > ?`,
    [doctorId, date, date],
  );
  return appointments;
}

async function findDoctorForUpdate(connection, doctorId) {
  const [doctors] = await connection.execute(
    'SELECT user_id FROM doctors WHERE user_id = ? FOR UPDATE',
    [doctorId],
  );
  return doctors[0] || null;
}

async function findOverlappingAvailability(connection, {
  doctorId, dayOfWeek, effectiveFrom, effectiveTo, endTime, startTime, excludeId,
}) {
  const excludeClause = excludeId === undefined ? '' : 'AND id <> ?';
  const values = [
    doctorId, dayOfWeek, effectiveFrom, effectiveTo, effectiveTo, endTime, startTime,
  ];
  if (excludeId !== undefined) values.push(excludeId);

  const [overlaps] = await connection.execute(
    `SELECT id FROM availability
     WHERE doctor_id = ? AND day_of_week = ?
       AND (effective_to IS NULL OR effective_to >= ?)
       AND (? IS NULL OR effective_from <= ?)
       AND start_time < ? AND end_time > ?
       ${excludeClause}
     LIMIT 1 FOR UPDATE`,
    values,
  );
  return overlaps[0] || null;
}

async function findOwnedAvailabilityForUpdate(connection, availabilityId, doctorId) {
  const [availability] = await connection.execute(
    'SELECT id FROM availability WHERE id = ? AND doctor_id = ? FOR UPDATE',
    [availabilityId, doctorId],
  );
  return availability[0] || null;
}

async function createAvailability(connection, availability) {
  const [result] = await connection.execute(
    `INSERT INTO availability
       (doctor_id, day_of_week, start_time, end_time, effective_from, effective_to)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      availability.doctorId,
      availability.dayOfWeek,
      availability.startTime,
      availability.endTime,
      availability.effectiveFrom,
      availability.effectiveTo,
    ],
  );
  return result.insertId;
}

async function updateAvailability(connection, availability) {
  const [result] = await connection.execute(
    `UPDATE availability
     SET day_of_week = ?, start_time = ?, end_time = ?, effective_from = ?, effective_to = ?
     WHERE id = ? AND doctor_id = ?`,
    [
      availability.dayOfWeek,
      availability.startTime,
      availability.endTime,
      availability.effectiveFrom,
      availability.effectiveTo,
      availability.id,
      availability.doctorId,
    ],
  );
  return result.affectedRows;
}

async function deleteAvailability(availabilityId, doctorId) {
  const [result] = await pool.execute(
    'DELETE FROM availability WHERE id = ? AND doctor_id = ?',
    [availabilityId, doctorId],
  );
  return result.affectedRows;
}

module.exports = {
  createAvailability,
  deleteAvailability,
  findAppointmentsForDate,
  findAvailabilityForDate,
  findDoctorForUpdate,
  findOwnedAvailabilityForUpdate,
  findOverlappingAvailability,
  findProfileById,
  search,
  updateAvailability,
};
