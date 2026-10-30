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

  test('TC-Rec-01b record for an appointment that is not the doctor\'s returns 403', async () => {
    db.setup([asUser('doctor'), ['FROM appointments', []]]);
    const res = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11, diagnosis: 'Flu' });
    expect(res.status).toBe(403);
  });

  test('TC-Rec-01c second record for the same appointment returns 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    db.setup([asUser('doctor'), ['FROM appointments', [{ id: '11', patientId: '5' }]], ['INSERT INTO medical_records', dup]]);
    const res = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11, diagnosis: 'Flu' });
    expect(res.status).toBe(409);
  });

  test('TC-Rec-02 doctor retrieves records for a patient they are authorized to treat', async () => {
    db.setup([
      asUser('doctor'),
      ['FROM appointments', [{ id: '11' }]],
      ['FROM medical_records mr', [record]],
    ]);
    const res = await request(app).get('/api/records?patientId=5').set('Authorization', bearer('doctor', '9'));
    expect(res.status).toBe(200);
    expect(res.body.medicalRecords).toHaveLength(1);
    const [sql, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM medical_records mr'));
    expect(sql).toContain('a.patient_id = mr.patient_id AND a.doctor_id = ?');
    expect(params).toEqual(['9', '5']);
  });

  test('TC-Rec-02b doctor retrieves an individual record for an authorized patient', async () => {
    db.setup([
      asUser('doctor'),
      ['FROM medical_records WHERE id', [{ patientId: '5' }]],
      ['FROM appointments', [{ id: '11' }]],
      ['FROM medical_records mr', [record]],
    ]);
    const res = await request(app).get('/api/records/1').set('Authorization', bearer('doctor', '9'));
    expect(res.status).toBe(200);
    expect(res.body.medicalRecord).toMatchObject({ id: '1', diagnosis: 'Flu' });
  });

  test('TC-Rec-02c doctor cannot retrieve an individual record for an unauthorized patient', async () => {
    db.setup([
      asUser('doctor'),
      ['FROM medical_records WHERE id', [{ patientId: '77' }]],
      ['FROM appointments', []],
    ]);
    const res = await request(app).get('/api/records/1').set('Authorization', bearer('doctor', '9'));
    expect(res.status).toBe(403);
    expect(res.body.medicalRecord).toBeUndefined();
  });

  test('TC-Rec-03 doctor updates diagnosis and notes (200)', async () => {
    db.setup([
      asUser('doctor'),
      ['FROM medical_records WHERE id', [{ patientId: '5' }]],
      ['FROM appointments', [{ id: '11' }]],
      ['UPDATE medical_records', { affectedRows: 1 }],
      ['FROM medical_records mr', [{ ...record, diagnosis: 'Cold' }]],
    ]);
    const res = await request(app).put('/api/records/1').set('Authorization', bearer('doctor', '9'))
      .send({ diagnosis: 'Cold', notes: 'rest' });
    expect(res.status).toBe(200);
    expect(res.body.medicalRecord.diagnosis).toBe('Cold');
  });

  test('TC-Rec-04 doctor without a treating relationship receives 403', async () => {
    db.setup([asUser('doctor'), ['FROM appointments', []]]);
    const res = await request(app).get('/api/records?patientId=77').set('Authorization', bearer('doctor', '9'));
    expect(res.status).toBe(403);
  });

  test('TC-Rec-04b doctor without a treating relationship cannot update a patient record', async () => {
    db.setup([
      asUser('doctor'),
      ['FROM medical_records WHERE id', [{ patientId: '77' }]],
      ['FROM appointments', []],
    ]);
    const res = await request(app).put('/api/records/1').set('Authorization', bearer('doctor', '9'))
      .send({ diagnosis: 'Changed' });
    expect(res.status).toBe(403);
  });

  test('TC-Rec-05 patient cannot request another patient\'s records', async () => {
    db.setup([asUser('patient')]);
    const res = await request(app).get('/api/records?patientId=6').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(403);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  test('TC-Rec-06 patient can only view own records and cannot create, update, or delete', async () => {
    db.setup([
      asUser('patient'),
      ['FROM medical_records WHERE id', [{ patientId: '5' }]],
      ['FROM medical_records mr', [record]],
    ]);
    const list = await request(app).get('/api/records').set('Authorization', bearer('patient', '5'));
    const detail = await request(app).get('/api/records/1').set('Authorization', bearer('patient', '5'));
    const create = await request(app).post('/api/records').set('Authorization', bearer('patient', '5'))
      .send({ appointmentId: 11, diagnosis: 'x' });
    const update = await request(app).put('/api/records/1').set('Authorization', bearer('patient', '5'))
      .send({ diagnosis: 'x' });
    const remove = await request(app).delete('/api/records/1').set('Authorization', bearer('patient', '5'));
    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(create.status).toBe(403);
    expect(update.status).toBe(403);
    expect(remove.status).toBe(403);
  });

  test('TC-Rec-06b patient cannot view another patient\'s individual record', async () => {
    db.setup([asUser('patient'), ['FROM medical_records WHERE id', [{ patientId: '77' }]]]);
    const res = await request(app).get('/api/records/1').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(403);
    expect(res.body.medicalRecord).toBeUndefined();
  });

  test('TC-Rec-06c unauthenticated record requests return 401', async () => {
    db.setup([]);
    const res = await request(app).get('/api/records');
    expect(res.status).toBe(401);
  });

  test('TC-Rec-07 record without diagnosis returns 400', async () => {
    db.setup([asUser('doctor')]);
    const res = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11 });
    expect(res.status).toBe(400);
  });

  test('TC-Rec-08 invalid record identifiers and text fields return 400', async () => {
    db.setup([asUser('doctor')]);
    const invalidId = await request(app).get('/api/records/not-an-id')
      .set('Authorization', bearer('doctor', '9'));
    const emptyDiagnosis = await request(app).post('/api/records').set('Authorization', bearer('doctor', '9'))
      .send({ appointmentId: 11, diagnosis: '   ' });
    expect(invalidId.status).toBe(400);
    expect(emptyDiagnosis.status).toBe(400);
  });
});
