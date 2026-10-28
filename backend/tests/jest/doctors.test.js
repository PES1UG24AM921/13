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
    db.setup([asUser('patient'), ['FROM doctors d', [{ id: '9', licenseNumber: 'L1', specialty: 'Cardiology' }]]]);
    const res = await request(app).get('/api/doctors').set('Authorization', bearer('patient', '5'))
      .query({ specialty: 'Cardio', q: 'L1', date: '2030-01-07' });
    expect(res.status).toBe(200);
    expect(res.body.doctors).toHaveLength(1);
    expect(res.body.doctors[0].slots).toEqual([]);
    const [sql, params] = db.execute.mock.calls.find(([statement]) => statement.includes('FROM doctors d'));
    expect(sql).toContain('d.specialty LIKE ?');
    expect(params).toEqual(expect.arrayContaining(['%Cardio%', '%L1%']));
  });

  test('TC-Doc-05 booked slot is not shown as free', async () => {
    db.setup([
      asUser('patient'),
      ['FROM doctors d', [{ user_id: 9 }]],
      ['FROM availability', [{ startTime: '09:00:00', endTime: '10:00:00' }]],
      ['FROM appointments', [{ startsAt: '2030-01-07 09:00:00', endsAt: '2030-01-07 09:30:00' }]],
    ]);
    const res = await request(app).get('/api/doctors/9/slots').set('Authorization', bearer('patient', '5'))
      .query({ date: '2030-01-07' });
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ startTime: '09:30:00', endTime: '10:00:00' }]);
  });

  test('doctor search includes unbooked appointment slots for the requested date', async () => {
    db.setup([
      asUser('patient'),
      ['FROM doctors d', [{ id: '9', licenseNumber: 'L1', specialty: 'Cardiology' }]],
      ['FROM availability', [{ startTime: '09:00:00', endTime: '10:00:00' }]],
      ['FROM appointments', [{ startsAt: '2030-01-07 09:00:00', endsAt: '2030-01-07 09:30:00' }]],
    ]);
    const res = await request(app).get('/api/doctors')
      .set('Authorization', bearer('patient', '5')).query({ date: '2030-01-07' });
    expect(res.status).toBe(200);
    expect(res.body.doctors[0].slots).toEqual([{ startTime: '09:30:00', endTime: '10:00:00' }]);
  });

  test('TC-Doc-06 patient cannot add availability (403)', async () => {
    db.setup([asUser('patient')]);
    const res = await request(app).post('/api/doctors/availability').set('Authorization', bearer('patient', '5'))
      .send({ dayOfWeek: 1, startTime: '09:00' });
    expect(res.status).toBe(403);
  });

  test('Doctor slot lookup rejects a bad date with 400', async () => {
    db.setup([asUser('patient')]);
    const res = await request(app).get('/api/doctors/9/slots').set('Authorization', bearer('patient', '5'))
      .query({ date: '2030-13-45' });
    expect(res.status).toBe(400);
  });

  test('authorized user can retrieve a doctor profile', async () => {
    db.setup([
      asUser('patient'),
      ['FROM doctors d', [{ id: '9', licenseNumber: 'L1', specialty: 'Cardiology', phone: '123' }]],
    ]);
    const res = await request(app).get('/api/doctors/9').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(200);
    expect(res.body.doctor).toMatchObject({ id: '9', licenseNumber: 'L1', specialty: 'Cardiology' });
  });

  test('doctor can update their own availability', async () => {
    const conn = db.setup([
      asUser('doctor', '9'),
      ['WHERE id = ? AND doctor_id = ? FOR UPDATE', [{ id: 3 }]],
      ['SELECT id FROM availability', []],
      ['UPDATE availability', { affectedRows: 1 }],
    ]);
    const res = await request(app).put('/api/doctors/availability/3')
      .set('Authorization', bearer('doctor', '9'))
      .send({ dayOfWeek: 2, startTime: '10:00', effectiveFrom: '2030-01-01', effectiveTo: null });
    expect(res.status).toBe(200);
    expect(res.body.availability).toMatchObject({
      id: '3', dayOfWeek: 2, startTime: '10:00:00', endTime: '10:30:00',
    });
    expect(conn.commit).toHaveBeenCalled();
  });

  test('availability update rejects invalid dates and times', async () => {
    db.setup([asUser('doctor', '9')]);
    const invalidDate = await request(app).put('/api/doctors/availability/3')
      .set('Authorization', bearer('doctor', '9'))
      .send({ dayOfWeek: 2, startTime: '10:00', effectiveFrom: '2030-02-31' });
    const invalidTime = await request(app).put('/api/doctors/availability/3')
      .set('Authorization', bearer('doctor', '9'))
      .send({ dayOfWeek: 2, startTime: '10:15', effectiveFrom: '2030-01-01' });
    expect(invalidDate.status).toBe(400);
    expect(JSON.stringify(invalidDate.body)).toMatch(/effectiveFrom|effective dates/);
    expect(invalidTime.status).toBe(400);
    expect(invalidTime.body.errors[0].field).toBe('startTime');
  });

  test('availability management requires authentication', async () => {
    db.setup([]);
    const res = await request(app).put('/api/doctors/availability/3')
      .send({ dayOfWeek: 2, startTime: '10:00' });
    expect(res.status).toBe(401);
  });

  test('doctor profiles and slot listings require authentication', async () => {
    db.setup([]);
    const profile = await request(app).get('/api/doctors/9');
    const listing = await request(app).get('/api/doctors');
    const slots = await request(app).get('/api/doctors/9/slots').query({ date: '2030-01-07' });
    expect([profile.status, listing.status, slots.status]).toEqual([401, 401, 401]);
  });
});
