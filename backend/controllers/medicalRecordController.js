const medicalRecordModel = require('../models/medicalRecordModel');

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

function logDatabaseError(action, error) {
  console.error(`Medical record ${action} failed:`, error.message);
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
    const appointment = await medicalRecordModel.findAppointmentForDoctor(appointmentId, req.user.id);
    if (!appointment) {
      return res.status(403).json({ error: 'You are not authorized to create a record for this appointment.' });
    }

    const id = await medicalRecordModel.create({
      appointmentId,
      patientId: appointment.patientId,
      doctorId: req.user.id,
      diagnosis: diagnosis.trim(),
      treatment: typeof treatment === 'string' ? treatment.trim() : treatment,
      notes: typeof notes === 'string' ? notes.trim() : notes,
    });
    return res.status(201).json({
      medicalRecord: {
        id: String(id),
        appointmentId,
        patientId: appointment.patientId,
        doctorId: String(req.user.id),
        diagnosis: diagnosis.trim(),
        treatment: typeof treatment === 'string' ? treatment.trim() : treatment,
        notes: typeof notes === 'string' ? notes.trim() : notes,
      },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A medical record already exists for this appointment.' });
    }
    logDatabaseError('creation', error);
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
    const patientId = await medicalRecordModel.findPatientId(recordId);
    if (!patientId) {
      return res.status(404).json({ error: 'Medical record not found.' });
    }
    if (!(await medicalRecordModel.hasTreatingRelationship(patientId, req.user.id))) {
      return res.status(403).json({ error: 'You are not authorized to update this patient\'s records.' });
    }

    await medicalRecordModel.update(recordId, patientId, {
      diagnosis: diagnosis.trim(),
      treatment: typeof treatment === 'string' ? treatment.trim() : treatment,
      notes: typeof notes === 'string' ? notes.trim() : notes,
    });
    const record = await medicalRecordModel.findById(recordId);
    if (!record) {
      return res.status(404).json({ error: 'Medical record not found.' });
    }
    return res.status(200).json({ medicalRecord: record });
  } catch (error) {
    logDatabaseError('update', error);
    return res.status(500).json({ error: 'Unable to update medical record.' });
  }
}

async function getMedicalRecord(req, res) {
  const recordId = parsePositiveId(req.params.recordId);
  if (!recordId) {
    return res.status(400).json({ error: 'recordId must be a positive integer.' });
  }

  try {
    const patientId = await medicalRecordModel.findPatientId(recordId);
    if (!patientId) {
      return res.status(404).json({ error: 'Medical record not found.' });
    }
    if (req.user.role === 'patient' && patientId !== String(req.user.id)) {
      return res.status(403).json({ error: 'You may only view your own medical records.' });
    }
    if (
      req.user.role === 'doctor'
      && !(await medicalRecordModel.hasTreatingRelationship(patientId, req.user.id))
    ) {
      return res.status(403).json({ error: 'You are not authorized to view this patient\'s records.' });
    }

    const record = await medicalRecordModel.findById(recordId);
    if (!record) {
      return res.status(404).json({ error: 'Medical record not found.' });
    }
    return res.status(200).json({ medicalRecord: record });
  } catch (error) {
    logDatabaseError('lookup', error);
    return res.status(500).json({ error: 'Unable to load medical record.' });
  }
}

async function getMedicalRecords(req, res) {
  let patientId;
  if (req.user.role === 'patient') {
    if (
      req.query.patientId !== undefined
      && String(req.query.patientId) !== String(req.user.id)
    ) {
      return res.status(403).json({ error: 'You may only view your own medical records.' });
    }
    patientId = String(req.user.id);
  } else if (req.user.role === 'doctor') {
    if (req.query.patientId !== undefined) {
      patientId = parsePositiveId(String(req.query.patientId));
      if (!patientId) {
        return res.status(400).json({ error: 'patientId must be a positive integer.' });
      }
    }
  } else {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  try {
    if (
      req.user.role === 'doctor'
      && patientId
      && !(await medicalRecordModel.hasTreatingRelationship(patientId, req.user.id))
    ) {
      return res.status(403).json({ error: 'You are not authorized to view this patient\'s records.' });
    }

    const records = req.user.role === 'patient'
      ? await medicalRecordModel.listForPatient(patientId)
      : await medicalRecordModel.listForDoctor(req.user.id, patientId);
    return res.status(200).json({ medicalRecords: records });
  } catch (error) {
    logDatabaseError('lookup', error);
    return res.status(500).json({ error: 'Unable to load medical records.' });
  }
}

module.exports = {
  createMedicalRecord,
  getMedicalRecord,
  getMedicalRecords,
  updateMedicalRecord,
};
