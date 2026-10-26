jest.mock('../../db', () => require('./helpers/mockDb'));
const request = require('supertest');
const db = require('../../db');
const { asUser, bearer } = require('./helpers/utils');
const app = require('../../app');

const profile = { id: '5', firstName: 'A', lastName: 'B', dateOfBirth: '2000-01-01', phone: null, address: null };

describe('Patient management', () => {
  test('TC-Pat-01 patient views own profile', async () => {
    db.setup([asUser('patient'), ['FROM patients WHERE user_id', [profile]]]);
    const res = await request(app).get('/api/patients/me').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(200);
    expect(res.body.patient.id).toBe('5');
  });

  test('TC-Pat-02 patient updates name, phone and address', async () => {
    db.setup([asUser('patient'), ['UPDATE patients', { affectedRows: 1 }], ['FROM patients WHERE user_id', [{ ...profile, phone: '9876543210' }]]]);
    const res = await request(app).put('/api/patients/me').set('Authorization', bearer('patient', '5'))
      .send({ firstName: 'New', phone: '9876543210', address: 'Bangalore' });
    expect(res.status).toBe(200);
    const update = db.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE patients'));
    expect(update[1]).toEqual(['New', '9876543210', 'Bangalore', '5']);
  });

  test('TC-Pat-03 role or id in the update request is rejected and never written', async () => {
    db.setup([asUser('patient'), ['UPDATE patients', { affectedRows: 1 }]]);
    const withRole = await request(app).put('/api/patients/me').set('Authorization', bearer('patient', '5'))
      .send({ role: 'admin' });
    const withOtherId = await request(app).put('/api/patients/me').set('Authorization', bearer('patient', '5'))
      .send({ id: '99', firstName: 'X' });
    expect(withRole.status).toBe(400);
    expect(withOtherId.status).toBe(403);
    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });

  test('TC-Pat-04a invalid first name (empty) returns 400', async () => {
    db.setup([asUser('patient')]);
    const res = await request(app).put('/api/patients/me').set('Authorization', bearer('patient', '5'))
      .send({ firstName: '' });
    expect(res.status).toBe(400);
  });

  // KNOWN DEFECT: phone format is not validated (only length) -> letters accepted.
  test.failing('TC-Pat-04b invalid phone number returns 400', async () => {
    db.setup([asUser('patient'), ['UPDATE patients', { affectedRows: 1 }], ['FROM patients WHERE user_id', [profile]]]);
    const res = await request(app).put('/api/patients/me').set('Authorization', bearer('patient', '5'))
      .send({ phone: 'abc-not-a-phone' });
    expect(res.status).toBe(400);
  });

  // KNOWN DEFECT: a future date of birth is accepted.
  test.failing('TC-Pat-04c future date of birth returns 400', async () => {
    db.setup([asUser('patient'), ['UPDATE patients', { affectedRows: 1 }], ['FROM patients WHERE user_id', [profile]]]);
    const res = await request(app).put('/api/patients/me').set('Authorization', bearer('patient', '5'))
      .send({ dateOfBirth: '2999-01-01' });
    expect(res.status).toBe(400);
  });

  test('TC-Pat-05 patient1 requesting patient2 data gets 403', async () => {
    db.setup([asUser('patient')]);
    const res = await request(app).get('/api/patients/6').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(403);
  });

  // KNOWN DEFECT: SRS says a doctor with an appointment can view the patient (200). Route is patient-only.
  test.failing('TC-Pat-06 doctor can view a patient who has an appointment with them', async () => {
    db.setup([asUser('doctor'), ['FROM patients WHERE user_id', [profile]], ['FROM appointments', [{ id: 1 }]]]);
    const res = await request(app).get('/api/patients/5').set('Authorization', bearer('doctor', '9'));
    expect(res.status).toBe(200);
  });

  // KNOWN DEFECT: SRS says an administrator can view any patient profile. Route is patient-only.
  test.failing('TC-Pat-07 administrator can view any patient profile', async () => {
    db.setup([asUser('admin'), ['FROM patients WHERE user_id', [profile]]]);
    const res = await request(app).get('/api/patients/5').set('Authorization', bearer('admin', '1'));
    expect(res.status).toBe(200);
  });
});
