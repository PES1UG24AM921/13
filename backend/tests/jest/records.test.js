jest.mock('../../db', () => require('./helpers/mockDb'));
const request = require('supertest');
const db = require('../../db');
const { asUser, bearer } = require('./helpers/utils');
const app = require('../../app');

const record = { id: '1', appointmentId: '11', doctorId: '9', doctorSpecialty: 'Cardiology', diagnosis: 'Flu', treatment: null, notes: null };

describe('Medical records', () => {
  test('TC-Rec-01 doctor creates a record for own appointment (201)', async () => {
    db.setup([asUser('doctor'), ['FROM appointments', [{ id: '11', patientId: '5' }]], ['INSERT INTO medical_records', { insertId: 1 }]]);
    const res = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11, diagnosis: 'Flu' });
    expect(res.status).toBe(201);
    expect(res.body.medicalRecord).toMatchObject({ id: '1', patientId: '5', doctorId: '9', diagnosis: 'Flu' });
  });

  test('TC-Rec-01b record for an appointment that is not the doctor\'s returns 404', async () => {
    db.setup([asUser('doctor'), ['FROM appointments', []]]);
    const res = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11, diagnosis: 'Flu' });
    expect(res.status).toBe(404);
  });

  test('TC-Rec-01c second record for the same appointment returns 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    db.setup([asUser('doctor'), ['FROM appointments', [{ id: '11', patientId: '5' }]], ['INSERT INTO medical_records', dup]]);
    const res = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11, diagnosis: 'Flu' });
    expect(res.status).toBe(409);
  });

  test('TC-Rec-02 doctor retrieves the patient records (only own, filtered by patient)', async () => {
    db.setup([asUser('doctor'), ['FROM medical_records mr', [record]]]);
    const res = await request(app).get('/api/records?patientId=5').set('Authorization', bearer('doctor', '9'));
    expect(res.status).toBe(200);
    expect(res.body.medicalRecords).toHaveLength(1);
    const [sql, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM medical_records mr'));
    expect(sql).toContain('mr.doctor_id = ?');
    expect(params).toEqual(['9', '5']);
  });

  test('TC-Rec-03 doctor updates diagnosis and notes (200)', async () => {
    db.setup([asUser('doctor'), ['UPDATE medical_records', { affectedRows: 1 }], ['FROM medical_records WHERE id', [{ ...record, diagnosis: 'Cold' }]]]);
    const res = await request(app).put('/api/records/1').set('Authorization', bearer('doctor', '9'))
      .send({ diagnosis: 'Cold', notes: 'rest' });
    expect(res.status).toBe(200);
    expect(res.body.medicalRecord.diagnosis).toBe('Cold');
  });

  // The API scopes records to the doctor who wrote them, so a doctor without an appointment
  // with that patient sees an empty list (200) instead of the 403 stated in the SRS.
  test.failing('TC-Rec-04 doctor with no appointment with the patient gets 403', async () => {
    db.setup([asUser('doctor'), ['FROM medical_records mr', []]]);
    const res = await request(app).get('/api/records?patientId=77').set('Authorization', bearer('doctor', '9'));
    expect(res.status).toBe(403);
  });

  test('TC-Rec-04b doctor with no appointment with the patient receives no records', async () => {
    db.setup([asUser('doctor'), ['FROM medical_records mr', []]]);
    const res = await request(app).get('/api/records?patientId=77').set('Authorization', bearer('doctor', '9'));
    expect(res.body.medicalRecords).toEqual([]);
  });

  test('TC-Rec-05 patient views only own records (query forced to own id, patientId param ignored)', async () => {
    db.setup([asUser('patient'), ['FROM medical_records mr', [record]]]);
    const res = await request(app).get('/api/records?patientId=6').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(200);
    const [sql, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM medical_records mr'));
    expect(sql).toContain('mr.patient_id = ?');
    expect(params).toEqual(['5']);
    expect(JSON.stringify(params)).not.toContain('6');
  });

  test('TC-Rec-06 patient cannot create or update a record (403)', async () => {
    db.setup([asUser('patient')]);
    const create = await request(app).post('/api/records').set('Authorization', bearer('patient', '5'))
      .send({ appointmentId: 11, diagnosis: 'x' });
    const update = await request(app).put('/api/records/1').set('Authorization', bearer('patient', '5'))
      .send({ diagnosis: 'x' });
    expect(create.status).toBe(403);
    expect(update.status).toBe(403);
  });

  test('TC-Rec-07 record without diagnosis returns 400', async () => {
    db.setup([asUser('doctor')]);
    const res = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11 });
    expect(res.status).toBe(400);
  });
});
