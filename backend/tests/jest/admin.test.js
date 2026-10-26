jest.mock('../../db', () => require('./helpers/mockDb'));
const request = require('supertest');
const db = require('../../db');
const { asUser, auditRule, bearer } = require('./helpers/utils');
const app = require('../../app');

const adminAuth = () => bearer('admin', '1');

describe('Administration', () => {
  test('TC-Adm-02 admin routes: patient 403, doctor 403, no token 401', async () => {
    db.setup([asUser('patient'), auditRule]);
    const patient = await request(app).get('/api/admin/users').set('Authorization', bearer('patient', '5'));
    db.setup([asUser('doctor'), auditRule]);
    const doctor = await request(app).get('/api/admin/users').set('Authorization', bearer('doctor', '9'));
    const anonymous = await request(app).get('/api/admin/users');
    expect([patient.status, doctor.status, anonymous.status]).toEqual([403, 403, 401]);
  });

  test('TC-Adm-03 admin lists users with pagination', async () => {
    db.setup([asUser('admin'), ['FROM users u', [{ id: '1', email: 'a@x.com', role: 'admin' }]], auditRule]);
    const res = await request(app).get('/api/admin/users?limit=5&offset=10').set('Authorization', adminAuth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 5, offset: 10 });
    const [, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM users u'));
    expect(params).toEqual([5, 10]);
  });

  // KNOWN DEFECT: there is no role filter on GET /api/admin/users (SRS HMS-F-051).
  test.failing('TC-Adm-03b admin lists users filtered by role', async () => {
    db.setup([asUser('admin'), ['FROM users u', []], auditRule]);
    await request(app).get('/api/admin/users?role=doctor').set('Authorization', adminAuth());
    const [sql, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM users u'));
    expect(sql).toMatch(/WHERE/i);
    expect(params).toContain('doctor');
  });

  test('TC-Adm-04 no password or hash in the users list query or response', async () => {
    db.setup([asUser('admin'), ['FROM users u', [{ id: '1', email: 'a@x.com', role: 'admin', isActive: 1 }]], auditRule]);
    const res = await request(app).get('/api/admin/users').set('Authorization', adminAuth());
    const [sql] = db.execute.mock.calls.find(([s]) => s.includes('FROM users u'));
    expect(sql).not.toMatch(/password/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  });

  test('TC-Adm-05 admin creates a doctor and a patient account', async () => {
    db.setup([asUser('admin'), ['INSERT INTO users', { insertId: 20 }], ['INSERT INTO doctors', {}], ['INSERT INTO patients', {}], auditRule]);
    const doctor = await request(app).post('/api/admin/users').set('Authorization', adminAuth())
      .send({ role: 'doctor', email: 'doc@x.com', password: 'Password123', licenseNumber: 'L9', specialty: 'ENT' });
    const patient = await request(app).post('/api/admin/users').set('Authorization', adminAuth())
      .send({ role: 'patient', email: 'pat@x.com', password: 'Password123', firstName: 'P', lastName: 'Q' });
    expect(doctor.status).toBe(201);
    expect(doctor.body.user).toEqual({ id: '20', email: 'doc@x.com', role: 'doctor' });
    expect(patient.status).toBe(201);
    expect(JSON.stringify([doctor.body, patient.body])).not.toMatch(/password|hash/i);
  });

  test('TC-Adm-05b admin cannot create an admin account through the API', async () => {
    db.setup([asUser('admin'), auditRule]);
    const res = await request(app).post('/api/admin/users').set('Authorization', adminAuth())
      .send({ role: 'admin', email: 'x@x.com', password: 'Password123' });
    expect(res.status).toBe(400);
  });

  test('TC-Adm-06 / TC-Adm-07 admin deactivates then reactivates a user', async () => {
    db.setup([asUser('admin'), ['SELECT is_active AS isActive FROM users WHERE id = ? FOR UPDATE', [{ isActive: 1 }]], ['UPDATE users SET is_active', {}], auditRule]);
    const off = await request(app).patch('/api/admin/users/5/status').set('Authorization', adminAuth()).send({ is_active: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ userId: '5', isActive: false });
    db.setup([asUser('admin'), ['SELECT is_active AS isActive FROM users WHERE id = ? FOR UPDATE', [{ isActive: 0 }]], ['UPDATE users SET is_active', {}], auditRule]);
    const on = await request(app).patch('/api/admin/users/5/status').set('Authorization', adminAuth()).send({ is_active: true });
    expect(on.status).toBe(200);
    expect(on.body.isActive).toBe(true);
  });

  test('TC-Adm-06b admin cannot deactivate own account (409)', async () => {
    db.setup([asUser('admin'), auditRule]);
    const res = await request(app).patch('/api/admin/users/1/status').set('Authorization', adminAuth()).send({ is_active: false });
    expect(res.status).toBe(409);
  });

  // KNOWN DEFECT: GET /api/admin/appointments has no doctor/patient/date/status filters (SRS HMS-F-054).
  test.failing('TC-Adm-08 admin lists appointments filtered by doctor, patient, date and status', async () => {
    db.setup([asUser('admin'), ['FROM appointments a', []], auditRule]);
    await request(app).get('/api/admin/appointments?status=Cancelled&doctorId=9').set('Authorization', adminAuth());
    const [sql, params] = db.execute.mock.calls.find(([s]) => s.includes('FROM appointments a'));
    expect(`${sql} ${JSON.stringify(params)}`).toMatch(/a\.status\s*=|Cancelled/);
  });

  test('TC-Adm-09 admin cancels an appointment', async () => {
    db.setup([asUser('admin'), ['SELECT status FROM appointments', [{ status: 'Scheduled' }]], ["UPDATE appointments SET status = 'Cancelled'", {}], auditRule]);
    const res = await request(app).patch('/api/admin/appointments/11/cancel').set('Authorization', adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Cancelled');
  });

  test('TC-Adm-10 overview returns counts from the database', async () => {
    db.setup([asUser('admin'), ['SELECT (SELECT COUNT(*)', [{ patients: '4', doctors: '2', appointments: '9' }]], auditRule]);
    const res = await request(app).get('/api/admin/overview').set('Authorization', adminAuth());
    expect(res.body).toEqual({ patients: 4, doctors: 2, appointments: 9 });
  });

  test('TC-Adm-11 audit log lists events with time and actor, no passwords', async () => {
    db.setup([asUser('admin'), ['FROM audit_logs', [{ id: '1', actorEmail: 'a@x.com', action: 'login_success', createdAt: '2026-10-26 10:00:00' }]], auditRule]);
    const res = await request(app).get('/api/admin/audit-logs').set('Authorization', adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.auditLogs[0]).toMatchObject({ actorEmail: 'a@x.com', createdAt: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  test('TC-Aud-01 admin actions write an audit entry', async () => {
    db.setup([asUser('admin'), ['SELECT is_active AS isActive FROM users WHERE id = ? FOR UPDATE', [{ isActive: 1 }]], ['UPDATE users SET is_active', {}], auditRule]);
    await request(app).patch('/api/admin/users/5/status').set('Authorization', adminAuth()).send({ is_active: false });
    await new Promise((resolve) => setImmediate(resolve));
    const audits = db.execute.mock.calls.filter(([s]) => s.includes('INSERT INTO audit_logs'));
    expect(audits.length).toBe(1);
    expect(audits[0][1][3]).toMatch(/^admin_patch/);
  });
});
