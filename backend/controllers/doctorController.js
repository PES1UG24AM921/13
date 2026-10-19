const pool = require('../db');

const SLOT_MINUTES = 30;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timeToMinutes(value) {
  if (value === '24:00:00') {
    return 24 * 60;
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  if (minutes === 24 * 60) {
    return '24:00:00';
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}:00`;
}

function minuteToDateTime(date, minutes) {
  if (minutes === 24 * 60) {
    const nextDay = new Date(`${date}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return `${nextDay.toISOString().slice(0, 10)} 00:00:00`;
  }
  return `${date} ${minutesToTime(minutes)}`;
}

function parsePositiveInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function createAvailability(req, res) {
  const { dayOfWeek, startTime } = req.body || {};
  const effectiveFrom = req.body?.effectiveFrom || new Date().toISOString().slice(0, 10);
  const effectiveTo = req.body?.effectiveTo ?? null;
  if (
    !Number.isInteger(dayOfWeek)
    || dayOfWeek < 1
    || dayOfWeek > 7
    || typeof startTime !== 'string'
    || !TIME_PATTERN.test(startTime)
    || !isValidDate(effectiveFrom)
    || (effectiveTo !== null && !isValidDate(effectiveTo))
    || (effectiveTo !== null && effectiveTo < effectiveFrom)
  ) {
    return res.status(400).json({
      error: 'Provide dayOfWeek (1-7), startTime (HH:mm on a half-hour), and valid effective dates.',
    });
  }

  const normalizedStart = startTime.length === 5 ? `${startTime}:00` : startTime;
  const startMinutes = timeToMinutes(normalizedStart);
  if (startMinutes % SLOT_MINUTES !== 0 || startMinutes + SLOT_MINUTES > 24 * 60) {
    return res.status(400).json({ error: 'Availability must start on a half-hour and fit within the day.' });
  }
  const endTime = minutesToTime(startMinutes + SLOT_MINUTES);

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [doctors] = await connection.execute(
      'SELECT user_id FROM doctors WHERE user_id = ? FOR UPDATE',
      [req.user.id],
    );
    if (!doctors[0]) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Doctor profile not found.' });
    }

    const [overlaps] = await connection.execute(
      `SELECT id FROM availability
       WHERE doctor_id = ? AND day_of_week = ?
         AND (effective_to IS NULL OR effective_to >= ?)
         AND (? IS NULL OR effective_from <= ?)
         AND start_time < ? AND end_time > ?
       LIMIT 1 FOR UPDATE`,
      [req.user.id, dayOfWeek, effectiveFrom, effectiveTo, effectiveTo, endTime, normalizedStart],
    );
    if (overlaps[0]) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Availability overlaps an existing slot.' });
    }

    const [result] = await connection.execute(
      `INSERT INTO availability
         (doctor_id, day_of_week, start_time, end_time, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, dayOfWeek, normalizedStart, endTime, effectiveFrom, effectiveTo],
    );
    await connection.commit();
    transactionStarted = false;
    return res.status(201).json({
      availability: {
        id: String(result.insertId),
        doctorId: req.user.id,
        dayOfWeek,
        startTime: normalizedStart,
        endTime,
        effectiveFrom,
        effectiveTo,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error('Availability creation failed:', error.message);
    return res.status(500).json({ error: 'Unable to create availability.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function deleteAvailability(req, res) {
  const availabilityId = parsePositiveInteger(req.params.availabilityId);
  if (availabilityId === null) {
    return res.status(400).json({ error: 'availabilityId must be a positive integer.' });
  }

  try {
    const [result] = await pool.execute(
      'DELETE FROM availability WHERE id = ? AND doctor_id = ?',
      [availabilityId, req.user.id],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Availability slot not found.' });
    }
    return res.status(204).end();
  } catch (error) {
    console.error('Availability deletion failed:', error.message);
    return res.status(500).json({ error: 'Unable to delete availability.' });
  }
}

async function searchDoctors(req, res) {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const specialty = typeof req.query.specialty === 'string' ? req.query.specialty.trim() : '';
  const requestedLimit = parsePositiveInteger(req.query.limit);
  const requestedOffset = typeof req.query.offset === 'string' && /^\d+$/.test(req.query.offset)
    ? Number(req.query.offset)
    : 0;
  const limit = requestedLimit === null ? 20 : Math.min(requestedLimit, 100);
  const offset = Number.isSafeInteger(requestedOffset) ? requestedOffset : 0;
  const conditions = ['u.is_active = TRUE'];
  const values = [];

  if (query) {
    conditions.push('(d.specialty LIKE ? OR d.license_number LIKE ?)');
    values.push(`%${query}%`, `%${query}%`);
  }
  if (specialty) {
    conditions.push('d.specialty LIKE ?');
    values.push(`%${specialty}%`);
  }

  try {
    const [doctors] = await pool.execute(
      `SELECT CAST(d.user_id AS CHAR) AS id,
              d.license_number AS licenseNumber, d.specialty
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.specialty, d.license_number
       LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );
    return res.status(200).json({ doctors, limit, offset });
  } catch (error) {
    console.error('Doctor search failed:', error.message);
    return res.status(500).json({ error: 'Unable to search doctors.' });
  }
}

async function getFreeSlots(req, res) {
  const doctorId = parsePositiveInteger(req.params.doctorId);
  const date = req.query.date;
  if (doctorId === null || !isValidDate(date)) {
    return res.status(400).json({ error: 'Provide a valid doctorId and date (YYYY-MM-DD).' });
  }

  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
  try {
    const [doctors] = await pool.execute(
      `SELECT d.user_id FROM doctors d
       JOIN users u ON u.id = d.user_id
       WHERE d.user_id = ? AND u.is_active = TRUE`,
      [doctorId],
    );
    if (!doctors[0]) {
      return res.status(404).json({ error: 'Doctor not found.' });
    }

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
    const [appointments] = await pool.execute(
      `SELECT DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
              DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt
       FROM appointments
       WHERE doctor_id = ? AND status = 'Scheduled'
         AND starts_at < DATE_ADD(?, INTERVAL 1 DAY)
         AND ends_at > ?`,
      [doctorId, date, date],
    );

    const slots = new Map();
    for (const window of availability) {
      const windowStart = timeToMinutes(window.startTime);
      const windowEnd = timeToMinutes(window.endTime);
      for (let start = windowStart; start + SLOT_MINUTES <= windowEnd; start += SLOT_MINUTES) {
        const startsAt = minuteToDateTime(date, start);
        const endsAt = minuteToDateTime(date, start + SLOT_MINUTES);
        const hasAppointment = appointments.some((appointment) => (
          appointment.startsAt < endsAt && appointment.endsAt > startsAt
        ));
        if (!hasAppointment) {
          slots.set(minutesToTime(start), {
            startTime: minutesToTime(start),
            endTime: minutesToTime(start + SLOT_MINUTES),
          });
        }
      }
    }

    return res.status(200).json({ doctorId: String(doctorId), date, slots: [...slots.values()] });
  } catch (error) {
    console.error('Free slot lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to load free slots.' });
  }
}

module.exports = { createAvailability, deleteAvailability, searchDoctors, getFreeSlots };