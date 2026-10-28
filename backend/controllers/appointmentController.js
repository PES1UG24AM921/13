const pool = require('../db');
const appointmentModel = require('../models/appointmentModel');

const SLOT_MINUTES = 30;
const START_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseAppointmentStart(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = START_PATTERN.exec(value);
  if (!match || !isValidDate(match[1])) {
    return null;
  }
  const [, date, hoursText, minutesText, secondsText = '00'] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (hours > 23 || ![0, 30].includes(minutes) || seconds !== 0) {
    return null;
  }

  const startsAt = `${date} ${hoursText}:${minutesText}:00`;
  const end = new Date(`${date}T${hoursText}:${minutesText}:00.000Z`);
  end.setUTCMinutes(end.getUTCMinutes() + SLOT_MINUTES);
  const endsAt = `${end.toISOString().slice(0, 10)} ${end.toISOString().slice(11, 19)}`;
  const startTime = `${hoursText}:${minutesText}:00`;
  const endTime = endsAt.startsWith(`${date} `)
    ? `${endsAt.slice(11, 19)}`
    : '24:00:00';
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;

  return { date, startsAt, endsAt, startTime, endTime, weekday };
}

function parsePositiveId(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function sendDatabaseError(res, error, action) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'The patient or doctor already has an appointment at that time.' });
  }
  console.error(`${action} failed:`, error.message);
  return res.status(500).json({ error: `Unable to ${action}.` });
}

async function bookAppointment(req, res) {
  const doctorId = parsePositiveId(String(req.body?.doctorId ?? ''));
  const slot = parseAppointmentStart(req.body?.startsAt);
  if (req.body?.patientId !== undefined && String(req.body.patientId) !== String(req.user.id)) {
    return res.status(403).json({ error: 'You may only book appointments for yourself.' });
  }
  if (!doctorId || !slot) {
    return res.status(400).json({ error: 'Provide a valid doctorId and half-hour-aligned startsAt.' });
  }
  const requestedStart = new Date(`${slot.startsAt.replace(' ', 'T')}Z`);
  if (requestedStart <= new Date()) {
    return res.status(400).json({ error: 'startsAt must be a future date and time.' });
  }
  const reason = req.body?.reason ?? null;
  if (reason !== null && (typeof reason !== 'string' || reason.length > 1000)) {
    return res.status(400).json({ error: 'reason must be a string of at most 1000 characters.' });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const actorError = await appointmentModel.lockBookingActors(connection, req.user.id, doctorId);
    if (actorError.error) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: actorError.error });
    }
    if (!(await appointmentModel.lockAvailableSlot(connection, doctorId, slot))) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'The doctor is not available for that time.' });
    }
    if (await appointmentModel.lockConflictingAppointment(connection, req.user.id, doctorId, slot)) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'The patient or doctor already has an appointment at that time.' });
    }

    const appointmentId = await appointmentModel.create(connection, req.user.id, doctorId, slot, reason);
    await connection.commit();
    transactionStarted = false;
    return res.status(201).json({
      appointment: {
        id: String(appointmentId),
        patientId: String(req.user.id),
        doctorId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'Scheduled',
        reason,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'book appointment');
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function getMyAppointments(req, res) {
  const filters = {
    patient: ['a.patient_id = ?', req.user.id],
    doctor: ['a.doctor_id = ?', req.user.id],
    admin: ['1 = 1', null],
  };
  const [condition, value] = filters[req.user.role];
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const values = value === null ? [limit, offset] : [value, limit, offset];

  try {
    const [appointments] = await pool.execute(
      `SELECT CAST(a.id AS CHAR) AS id,
              CAST(a.patient_id AS CHAR) AS patientId,
              CAST(a.doctor_id AS CHAR) AS doctorId,
              DATE_FORMAT(a.starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
              DATE_FORMAT(a.ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt,
              a.status, a.reason
       FROM appointments a
       WHERE ${condition}
       ORDER BY a.starts_at DESC
       LIMIT ? OFFSET ?`,
      values,
    );
    return res.status(200).json({ appointments, limit, offset });
  } catch (error) {
    return sendDatabaseError(res, error, 'load appointments');
  }
}

function appointmentOwnership(req) {
  if (req.user.role === 'patient') {
    return ['patient_id = ?', [req.user.id]];
  }
  if (req.user.role === 'doctor') {
    return ['doctor_id = ?', [req.user.id]];
  }
  return ['1 = 1', []];
}

async function getAppointment(req, res) {
  const appointmentId = parsePositiveId(req.params.appointmentId);
  if (!appointmentId) {
    return res.status(400).json({ error: 'appointmentId must be a positive integer.' });
  }
  const [condition, values] = appointmentOwnership(req);
  try {
    const [appointments] = await pool.execute(
      `SELECT CAST(id AS CHAR) AS id,
              CAST(patient_id AS CHAR) AS patientId,
              CAST(doctor_id AS CHAR) AS doctorId,
              DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
              DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt,
              status, reason
       FROM appointments
       WHERE id = ? AND ${condition}`,
      [appointmentId, ...values],
    );
    if (!appointments[0]) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    return res.status(200).json({ appointment: appointments[0] });
  } catch (error) {
    return sendDatabaseError(res, error, 'load appointment');
  }
}

async function rescheduleAppointment(req, res) {
  const appointmentId = parsePositiveId(req.params.appointmentId);
  const slot = parseAppointmentStart(req.body?.startsAt);
  if (!appointmentId || !slot) {
    return res.status(400).json({ error: 'Provide a valid appointmentId and half-hour-aligned startsAt.' });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [appointments] = await connection.execute(
      `SELECT id, doctor_id AS doctorId, status
       FROM appointments
       WHERE id = ? AND patient_id = ?
       FOR UPDATE`,
      [appointmentId, req.user.id],
    );
    const appointment = appointments[0];
    if (!appointment) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    if (appointment.status !== 'Scheduled') {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Only scheduled appointments can be rescheduled.' });
    }

    const actorError = await appointmentModel.lockBookingActors(
      connection,
      req.user.id,
      String(appointment.doctorId),
    );
    if (actorError.error) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: actorError.error });
    }
    if (!(await appointmentModel.lockAvailableSlot(connection, String(appointment.doctorId), slot))) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'The doctor is not available for that time.' });
    }
    if (await appointmentModel.lockConflictingAppointment(
      connection,
      req.user.id,
      String(appointment.doctorId),
      slot,
      appointmentId,
    )) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'The patient or doctor already has an appointment at that time.' });
    }

    await connection.execute(
      'UPDATE appointments SET starts_at = ?, ends_at = ? WHERE id = ? AND patient_id = ?',
      [slot.startsAt, slot.endsAt, appointmentId, req.user.id],
    );
    await connection.commit();
    transactionStarted = false;
    return res.status(200).json({
      appointment: {
        id: appointmentId,
        patientId: String(req.user.id),
        doctorId: String(appointment.doctorId),
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'Scheduled',
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'reschedule appointment');
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function cancelAppointment(req, res) {
  const appointmentId = parsePositiveId(req.params.appointmentId);
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
      `SELECT status FROM appointments
       WHERE id = ? AND patient_id = ?
       FOR UPDATE`,
      [appointmentId, req.user.id],
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
      `UPDATE appointments SET status = 'Cancelled'
       WHERE id = ? AND patient_id = ? AND status = 'Scheduled'`,
      [appointmentId, req.user.id],
    );
    await connection.commit();
    transactionStarted = false;
    return res.status(200).json({ id: appointmentId, status: 'Cancelled' });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    return sendDatabaseError(res, error, 'cancel appointment');
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

module.exports = {
  bookAppointment,
  getMyAppointments,
  getAppointment,
  rescheduleAppointment,
  cancelAppointment,
};