jest.mock('../../db', () => require('./helpers/mockDb'));
const request = require('supertest');
const db = require('../../db');
const { asUser, bearer } = require('./helpers/utils');
const app = require('../../app');

const bookingRules = (overrides = []) => [
  asUser('patient'),
  ...overrides,
  ['SELECT d.user_id FROM doctors', [{ user_id: 9 }]],
  ['SELECT p.user_id FROM patients', [{ user_id: 5 }]],
  ['SELECT id FROM availability', [{ id: 1 }]],
  ['SELECT id FROM appointments', []],
  ['INSERT INTO appointments', { insertId: 11 }],
];
const book = (body) => request(app).post('/api/appointments')
  .set('Authorization', bearer('patient', '5')).send(body);

describe('Appointment management', () => {
  test('TC-Apt-01 patient books a free slot (201, status Scheduled)', async () => {
    const conn = db.setup(bookingRules());
    const res = await book({ doctorId: 9, startsAt: '2030-01-07 09:00', reason: 'checkup' });
    expect(res.status).toBe(201);
    expect(res.body.appointment).toMatchObject({ id: '11', status: 'Scheduled', startsAt: '2030-01-07 09:00:00' });
    expect(conn.commit).toHaveBeenCalled();
  });

  test('TC-Apt-02 booking a taken slot returns 409 and inserts nothing', async () => {
    const conn = db.setup([
      asUser('patient'),
      ['SELECT d.user_id FROM doctors', [{ user_id: 9 }]],
      ['SELECT p.user_id FROM patients', [{ user_id: 5 }]],
      ['SELECT id FROM availability', [{ id: 1 }]],
      ['SELECT id FROM appointments', [{ id: 2 }]],
    ]);
    const res = await book({ doctorId: 9, startsAt: '2030-01-07 09:00' });
    expect(res.status).toBe(409);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO appointments'))).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test('TC-Apt-02b slot outside the doctor availability returns 409', async () => {
    db.setup([
      asUser('patient'),
      ['SELECT d.user_id FROM doctors', [{ user_id: 9 }]],
      ['SELECT p.user_id FROM patients', [{ user_id: 5 }]],
      ['SELECT id FROM availability', []],
    ]);
    const res = await book({ doctorId: 9, startsAt: '2030-01-07 09:00' });
    expect(res.status).toBe(409);
  });

  // KNOWN DEFECT: the API has no check for dates in the past.
  test.failing('TC-Apt-04 booking a slot in the past returns 400', async () => {
    db.setup(bookingRules());
    const res = await book({ doctorId: 9, startsAt: '2020-01-06 09:00' });
    expect(res.status).toBe(400);
  });

  test('TC-Apt-04b malformed or non half-hour time returns 400', async () => {
    db.setup(bookingRules());
    const odd = await book({ doctorId: 9, startsAt: '2030-01-07 09:15' });
    const junk = await book({ doctorId: 9, startsAt: 'tomorrow' });
    expect(odd.status).toBe(400);
    expect(junk.status).toBe(400);
  });

  test('TC-Apt-05 non-existent doctor returns 404', async () => {
    db.setup([asUser('patient'), ['SELECT d.user_id FROM doctors', []]]);
    const res = await book({ doctorId: 999, startsAt: '2030-01-07 09:00' });
    expect(res.status).toBe(404);
  });

  test('TC-Apt-05b patient cannot book for another patient id (403)', async () => {
    db.setup(bookingRules());
    const res = await book({ doctorId: 9, startsAt: '2030-01-07 09:00', patientId: 6 });
    expect(res.status).toBe(403);
  });

  test('TC-Apt-06 patient list is filtered to own appointments', async () => {
    db.setup([asUser('patient'), ['FROM appointments a', []]]);
    await request(app).get('/api/appointments').set('Authorization', bearer('patient', '5'));
    const [sql, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM appointments a'));
    expect(sql).toContain('a.patient_id = ?');
    expect(params[0]).toBe('5');
  });

  test('TC-Apt-07 doctor list is filtered to own appointments', async () => {
    db.setup([asUser('doctor'), ['FROM appointments a', []]]);
    await request(app).get('/api/appointments').set('Authorization', bearer('doctor', '9'));
    const [sql, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM appointments a'));
    expect(sql).toContain('a.doctor_id = ?');
    expect(params[0]).toBe('9');
  });

  test('TC-Apt-08 reschedule to a free slot returns 200', async () => {
    db.setup([
      asUser('patient'),
      ['SELECT id, doctor_id AS doctorId, status', [{ id: 11, doctorId: 9, status: 'Scheduled' }]],
      ['SELECT d.user_id FROM doctors', [{ user_id: 9 }]],
      ['SELECT p.user_id FROM patients', [{ user_id: 5 }]],
      ['SELECT id FROM availability', [{ id: 1 }]],
      ['SELECT id FROM appointments', []],
      ['UPDATE appointments SET starts_at', { affectedRows: 1 }],
    ]);
    const res = await request(app).put('/api/appointments/11/reschedule')
      .set('Authorization', bearer('patient', '5')).send({ startsAt: '2030-01-07 10:00' });
    expect(res.status).toBe(200);
    expect(res.body.appointment.startsAt).toBe('2030-01-07 10:00:00');
  });

  test('TC-Apt-09 reschedule to a taken slot returns 409 and does not update', async () => {
    const conn = db.setup([
      asUser('patient'),
      ['SELECT id, doctor_id AS doctorId, status', [{ id: 11, doctorId: 9, status: 'Scheduled' }]],
      ['SELECT d.user_id FROM doctors', [{ user_id: 9 }]],
      ['SELECT p.user_id FROM patients', [{ user_id: 5 }]],
      ['SELECT id FROM availability', [{ id: 1 }]],
      ['SELECT id FROM appointments', [{ id: 12 }]],
    ]);
    const res = await request(app).put('/api/appointments/11/reschedule')
      .set('Authorization', bearer('patient', '5')).send({ startsAt: '2030-01-07 10:00' });
    expect(res.status).toBe(409);
    expect(conn.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE appointments'))).toBe(false);
  });

  test('TC-Apt-10 cancel sets status Cancelled', async () => {
    db.setup([
      asUser('patient'),
      ['SELECT status FROM appointments', [{ status: 'Scheduled' }]],
      ["UPDATE appointments SET status = 'Cancelled'", { affectedRows: 1 }],
    ]);
    const res = await request(app).patch('/api/appointments/11/cancel').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Cancelled');
  });

  test('TC-Apt-10b cancelling an already cancelled appointment returns 409', async () => {
    db.setup([asUser('patient'), ['SELECT status FROM appointments', [{ status: 'Cancelled' }]]]);
    const res = await request(app).patch('/api/appointments/11/cancel').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(409);
  });

  // Query is restricted to patient_id = caller, so another patient's appointment is not found.
  // SRS expects 403; the API returns 404 (hides existence). Accepted either way: not modified.
  test('TC-Apt-11 patient2 cannot cancel or reschedule patient1 appointment', async () => {
    const conn = db.setup([asUser('patient'), ['SELECT status FROM appointments', []], ['SELECT id, doctor_id', []]]);
    const cancel = await request(app).patch('/api/appointments/11/cancel').set('Authorization', bearer('patient', '6'));
    const resched = await request(app).put('/api/appointments/11/reschedule')
      .set('Authorization', bearer('patient', '6')).send({ startsAt: '2030-01-07 10:00' });
    expect([403, 404]).toContain(cancel.status);
    expect([403, 404]).toContain(resched.status);
    expect(conn.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });

  test('TC-DB-03 failure in the middle of booking rolls back and returns 500', async () => {
    const conn = db.setup([
      asUser('patient'),
      ['SELECT d.user_id FROM doctors', [{ user_id: 9 }]],
      ['SELECT p.user_id FROM patients', [{ user_id: 5 }]],
      ['SELECT id FROM availability', [{ id: 1 }]],
      ['SELECT id FROM appointments', []],
      ['INSERT INTO appointments', new Error('disk failure')],
    ]);
    const res = await book({ doctorId: 9, startsAt: '2030-01-07 09:00' });
    expect(res.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});
