jest.mock('../../db', () => require('./helpers/mockDb'));
const request = require('supertest');
const db = require('../../db');
const { asUser, bearer } = require('./helpers/utils');
const app = require('../../app');

describe('Doctor management', () => {
  test('TC-Doc-02 doctor adds a future availability slot', async () => {
    db.setup([
      asUser('doctor'),
      ['SELECT user_id FROM doctors', [{ user_id: 9 }]],
      ['SELECT id FROM availability', []],
      ['INSERT INTO availability', { insertId: 3 }],
    ]);
    const res = await request(app).post('/api/doctors/availability').set('Authorization', bearer('doctor', '9'))
      .send({ dayOfWeek: 1, startTime: '09:00', effectiveFrom: '2030-01-01' });
    expect(res.status).toBe(201);
    expect(res.body.availability).toMatchObject({ id: '3', startTime: '09:00:00', endTime: '09:30:00' });
  });

  test('TC-Doc-03 overlapping availability returns 409 and nothing is inserted', async () => {
    const conn = db.setup([
      asUser('doctor'),
      ['SELECT user_id FROM doctors', [{ user_id: 9 }]],
      ['SELECT id FROM availability', [{ id: 1 }]],
    ]);
    const res = await request(app).post('/api/doctors/availability').set('Authorization', bearer('doctor', '9'))
      .send({ dayOfWeek: 1, startTime: '09:00', effectiveFrom: '2030-01-01' });
    expect(res.status).toBe(409);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO availability'))).toBe(false);
  });

  test('TC-Doc-04 search by specialty and by name only passes matching filters (parameterised)', async () => {
    db.setup([['FROM doctors d', [{ id: '9', licenseNumber: 'L1', specialty: 'Cardiology' }]]]);
    const res = await request(app).get('/api/doctors').query({ specialty: 'Cardio', q: 'L1' });
    expect(res.status).toBe(200);
    expect(res.body.doctors).toHaveLength(1);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).toContain('d.specialty LIKE ?');
    expect(params).toEqual(expect.arrayContaining(['%Cardio%', '%L1%']));
  });

  test('TC-Doc-05 booked slot is not shown as free', async () => {
    db.setup([
      ['FROM doctors d', [{ user_id: 9 }]],
      ['FROM availability', [{ startTime: '09:00:00', endTime: '10:00:00' }]],
      ['FROM appointments', [{ startsAt: '2030-01-07 09:00:00', endsAt: '2030-01-07 09:30:00' }]],
    ]);
    const res = await request(app).get('/api/doctors/9/slots').query({ date: '2030-01-07' });
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ startTime: '09:30:00', endTime: '10:00:00' }]);
  });

  test('TC-Doc-06 patient cannot add availability (403)', async () => {
    db.setup([asUser('patient')]);
    const res = await request(app).post('/api/doctors/availability').set('Authorization', bearer('patient', '5'))
      .send({ dayOfWeek: 1, startTime: '09:00' });
    expect(res.status).toBe(403);
  });

  test('Doctor slot lookup rejects a bad date with 400', async () => {
    db.setup([]);
    const res = await request(app).get('/api/doctors/9/slots').query({ date: '2030-13-45' });
    expect(res.status).toBe(400);
  });
});
