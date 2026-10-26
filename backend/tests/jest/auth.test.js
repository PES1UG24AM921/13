jest.mock('../../db', () => require('./helpers/mockDb'));
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../../db');
const { asUser, auditRule, bearer, tokenFor } = require('./helpers/utils');
const app = require('../../app');

const hash = bcrypt.hashSync('Password123', 4);
const userRow = { id: '5', email: 'a@x.com', password_hash: hash, role: 'patient', is_active: 1 };

describe('Authentication (Sprint 1)', () => {
  test('TC-Auth-01 register a new patient returns 201 and no password in response', async () => {
    const conn = db.setup([
      ['INSERT INTO users', { insertId: 7 }],
      ['INSERT INTO patients', { affectedRows: 1 }],
    ]);
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'New@Mail.com', password: 'Password123', firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: '7', email: 'new@mail.com', role: 'patient' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    const insertUser = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'));
    expect(insertUser[1][1]).toMatch(/^\$2[aby]\$/); // stored value is a bcrypt hash
    expect(insertUser[1][1]).not.toBe('Password123');
    expect(conn.commit).toHaveBeenCalled();
  });

  test('TC-Auth-02 register with an existing email returns 409', async () => {
    const duplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    const conn = db.setup([['INSERT INTO users', duplicate]]);
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'a@x.com', password: 'Password123', firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(409);
    expect(conn.rollback).toHaveBeenCalled();
  });

  test.each([
    ['invalid email', { email: 'not-an-email', password: 'Password123' }],
    ['short password', { email: 'a@x.com', password: 'short' }],
  ])('TC-Auth-03 register with %s returns 400', async (_name, creds) => {
    db.setup([]);
    const res = await request(app).post('/api/auth/register')
      .send({ ...creds, firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(400);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('TC-Auth-04 login with valid credentials returns a JWT with id, role and expiry', async () => {
    db.setup([['FROM users WHERE email', [userRow]], auditRule]);
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'Password123' });
    expect(res.status).toBe(200);
    const payload = jwt.decode(res.body.token);
    expect(payload.userId).toBe('5');
    expect(payload.role).toBe('patient');
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(res.body.user).toEqual({ id: '5', email: 'a@x.com', role: 'patient' });
    expect(JSON.stringify(res.body)).not.toContain(hash);
  });

  test('TC-Auth-05 / TC-Auth-06 wrong password and unknown email give the same 401 message', async () => {
    db.setup([['FROM users WHERE email', [userRow]], auditRule]);
    const wrongPassword = await request(app).post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'WrongPass1' });
    db.setup([['FROM users WHERE email', []], auditRule]);
    const unknownEmail = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@x.com', password: 'Password123' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error).toBe(wrongPassword.body.error);
  });

  test('TC-Auth-07 protected endpoint without a token returns 401', async () => {
    db.setup([]);
    const res = await request(app).get('/api/appointments');
    expect(res.status).toBe(401);
  });

  test('TC-Auth-08 expired and tampered tokens return 401', async () => {
    db.setup([asUser('patient')]);
    const expired = tokenFor('patient', '5', { expiresIn: -10 });
    const tampered = `${tokenFor('patient', '5').slice(0, -3)}abc`;
    const r1 = await request(app).get('/api/appointments').set('Authorization', `Bearer ${expired}`);
    const r2 = await request(app).get('/api/appointments').set('Authorization', `Bearer ${tampered}`);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
  });

  test('TC-Auth-09 patient token gets 403 on admin and doctor-only routes', async () => {
    db.setup([asUser('patient')]);
    const admin = await request(app).get('/api/admin/users').set('Authorization', bearer('patient', '5'));
    const doctor = await request(app).post('/api/doctors/availability')
      .set('Authorization', bearer('patient', '5')).send({ dayOfWeek: 1, startTime: '09:00' });
    expect(admin.status).toBe(403);
    expect(doctor.status).toBe(403);
  });

  test('TC-Auth-11 failed and successful logins are both written to the audit log, without password', async () => {
    db.setup([['FROM users WHERE email', [userRow]], auditRule]);
    await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'Password123' });
    await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'WrongPass1' });
    await new Promise((resolve) => setImmediate(resolve));
    const audits = db.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO audit_logs'));
    const actions = audits.map(([, params]) => params[3]);
    expect(actions).toEqual(['login_success', 'login_failure']);
    expect(JSON.stringify(audits)).not.toMatch(/Password123|WrongPass1/);
  });

  test('TC-Auth-12 deactivated user cannot log in', async () => {
    db.setup([['FROM users WHERE email', [{ ...userRow, is_active: 0 }]], auditRule]);
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'Password123' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });
});
