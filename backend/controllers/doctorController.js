const pool = require('../db');
const doctorModel = require('../models/doctorModel');

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

function parseAvailability(body) {
  const { dayOfWeek, startTime } = body || {};
  const effectiveFrom = body?.effectiveFrom || new Date().toISOString().slice(0, 10);
  const effectiveTo = body?.effectiveTo ?? null;
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
    return { error: 'Provide dayOfWeek (1-7), startTime (HH:mm on a half-hour), and valid effective dates.' };
  }

  const normalizedStart = startTime.length === 5 ? `${startTime}:00` : startTime;
  const startMinutes = timeToMinutes(normalizedStart);
  if (startMinutes % SLOT_MINUTES !== 0 || startMinutes + SLOT_MINUTES > 24 * 60) {
    return { error: 'Availability must start on a half-hour and fit within the day.' };
  }
  return {
    value: {
      dayOfWeek,
      startTime: normalizedStart,
      endTime: minutesToTime(startMinutes + SLOT_MINUTES),
      effectiveFrom,
      effectiveTo,
    },
  };
}

async function createAvailability(req, res) {
  const parsed = parseAvailability(req.body);
  if (!parsed.value) return res.status(400).json({ error: parsed.error });
  const { dayOfWeek, startTime: normalizedStart, endTime, effectiveFrom, effectiveTo } = parsed.value;

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const doctor = await doctorModel.findDoctorForUpdate(connection, req.user.id);
    if (!doctor) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Doctor profile not found.' });
    }

    const overlaps = await doctorModel.findOverlappingAvailability(connection, {
      doctorId: req.user.id, dayOfWeek, effectiveFrom, effectiveTo, endTime, startTime: normalizedStart,
    });
    if (overlaps) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Availability overlaps an existing slot.' });
    }

    const id = await doctorModel.createAvailability(connection, {
      doctorId: req.user.id, dayOfWeek, startTime: normalizedStart, endTime, effectiveFrom, effectiveTo,
    });
    await connection.commit();
    transactionStarted = false;
    return res.status(201).json({
      availability: {
        id: String(id),
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

async function updateAvailability(req, res) {
  const availabilityId = parsePositiveInteger(req.params.availabilityId);
  if (availabilityId === null) {
    return res.status(400).json({ error: 'availabilityId must be a positive integer.' });
  }
  const parsed = parseAvailability(req.body);
  if (!parsed.value) return res.status(400).json({ error: parsed.error });
  const { dayOfWeek, startTime, endTime, effectiveFrom, effectiveTo } = parsed.value;

  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const ownedAvailability = await doctorModel.findOwnedAvailabilityForUpdate(
      connection,
      availabilityId,
      req.user.id,
    );
    if (!ownedAvailability) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Availability slot not found.' });
    }
    const overlaps = await doctorModel.findOverlappingAvailability(connection, {
      doctorId: req.user.id,
      dayOfWeek,
      effectiveFrom,
      effectiveTo,
      endTime,
      startTime,
      excludeId: availabilityId,
    });
    if (overlaps) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ error: 'Availability overlaps an existing slot.' });
    }

    const affectedRows = await doctorModel.updateAvailability(connection, {
      id: availabilityId,
      doctorId: req.user.id,
      dayOfWeek,
      startTime,
      endTime,
      effectiveFrom,
      effectiveTo,
    });
    if (affectedRows === 0) {
      const [existing] = await connection.execute(
        'SELECT id FROM availability WHERE id = ? AND doctor_id = ?',
        [availabilityId, req.user.id],
      );
      if (!existing[0]) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ error: 'Availability slot not found.' });
      }
    }
    await connection.commit();
    transactionStarted = false;
    return res.status(200).json({
      availability: {
        id: String(availabilityId),
        doctorId: req.user.id,
        dayOfWeek,
        startTime,
        endTime,
        effectiveFrom,
        effectiveTo,
      },
    });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    console.error('Availability update failed:', error.message);
    return res.status(500).json({ error: 'Unable to update availability.' });
  } finally {
    if (connection) connection.release();
  }
}

async function deleteAvailability(req, res) {
  const availabilityId = parsePositiveInteger(req.params.availabilityId);
  if (availabilityId === null) {
    return res.status(400).json({ error: 'availabilityId must be a positive integer.' });
  }

  try {
    const affectedRows = await doctorModel.deleteAvailability(availabilityId, req.user.id);
    if (affectedRows === 0) {
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
  const date = req.query.date === undefined ? new Date().toISOString().slice(0, 10) : req.query.date;
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD date.' });
  }

  try {
    const doctors = await doctorModel.search({ query, specialty, limit, offset });
    for (const doctor of doctors) {
      doctor.slots = await loadFreeSlots(doctor.id, date);
    }
    return res.status(200).json({ doctors, limit, offset, date });
  } catch (error) {
    console.error('Doctor search failed:', error.message);
    return res.status(500).json({ error: 'Unable to search doctors.' });
  }
}

async function getDoctorProfile(req, res) {
  const doctorId = parsePositiveInteger(req.params.doctorId);
  if (doctorId === null) {
    return res.status(400).json({ error: 'doctorId must be a positive integer.' });
  }
  try {
    const doctor = await doctorModel.findProfileById(doctorId);
    if (!doctor) return res.status(404).json({ error: 'Doctor not found.' });
    return res.status(200).json({ doctor });
  } catch (error) {
    console.error('Doctor profile lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to load doctor profile.' });
  }
}

async function loadFreeSlots(doctorId, date) {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
  const [availability, appointments] = await Promise.all([
    doctorModel.findAvailabilityForDate(doctorId, weekday, date),
    doctorModel.findAppointmentsForDate(doctorId, date),
  ]);
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
  return [...slots.values()];
}

async function getFreeSlots(req, res) {
  const doctorId = parsePositiveInteger(req.params.doctorId);
  const date = req.query.date;
  if (doctorId === null || !isValidDate(date)) {
    return res.status(400).json({ error: 'Provide a valid doctorId and date (YYYY-MM-DD).' });
  }

  try {
    const doctor = await doctorModel.findProfileById(doctorId);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found.' });
    }

    const slots = await loadFreeSlots(doctorId, date);
    return res.status(200).json({ doctorId: String(doctorId), date, slots });
  } catch (error) {
    console.error('Free slot lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to load free slots.' });
  }
}

module.exports = {
  createAvailability,
  deleteAvailability,
  getDoctorProfile,
  getFreeSlots,
  searchDoctors,
  updateAvailability,
};