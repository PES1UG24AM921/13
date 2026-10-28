async function lockBookingActors(connection, patientId, doctorId) {
  // The doctor row serializes all bookings for that doctor until transaction completion.
  const [doctors] = await connection.execute(
    `SELECT d.user_id FROM doctors d
     JOIN users u ON u.id = d.user_id
     WHERE d.user_id = ? AND u.is_active = TRUE
     FOR UPDATE`,
    [doctorId],
  );
  if (!doctors[0]) return { error: 'Doctor not found.' };

  const [patients] = await connection.execute(
    `SELECT p.user_id FROM patients p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? AND u.is_active = TRUE
     FOR UPDATE`,
    [patientId],
  );
  if (!patients[0]) return { error: 'Patient profile not found.' };
  return {};
}

async function lockAvailableSlot(connection, doctorId, slot) {
  const [availability] = await connection.execute(
    `SELECT id FROM availability
     WHERE doctor_id = ? AND day_of_week = ?
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
       AND start_time <= ? AND end_time >= ?
     LIMIT 1 FOR UPDATE`,
    [doctorId, slot.weekday, slot.date, slot.date, slot.startTime, slot.endTime],
  );
  return availability.length > 0;
}

async function lockConflictingAppointment(connection, patientId, doctorId, slot, excludeId = null) {
  const exclusion = excludeId === null ? '' : 'AND id <> ?';
  const values = [
    doctorId, slot.endsAt, slot.startsAt,
    patientId, slot.endsAt, slot.startsAt,
  ];
  if (excludeId !== null) values.push(excludeId);
  const [appointments] = await connection.execute(
    `SELECT id FROM appointments
     WHERE status = 'Scheduled'
       AND ((doctor_id = ? AND starts_at < ? AND ends_at > ?)
         OR (patient_id = ? AND starts_at < ? AND ends_at > ?))
       ${exclusion}
     LIMIT 1 FOR UPDATE`,
    values,
  );
  return appointments.length > 0;
}

async function create(connection, patientId, doctorId, slot, reason) {
  const [result] = await connection.execute(
    `INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [patientId, doctorId, slot.startsAt, slot.endsAt, reason],
  );
  return result.insertId;
}

module.exports = {
  create,
  lockAvailableSlot,
  lockBookingActors,
  lockConflictingAppointment,
};
