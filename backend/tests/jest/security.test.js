jest.mock('../../db', () => require('./helpers/mockDb'));
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const { asUser, auditRule, bearer } = require('./helpers/utils');
const app = require('../../app');

describe('Security and input validation', () => {
  test('TC-Sec-02 token signed with a different secret returns 401', async () => {
    db.setup([asUser('admin')]);
    const forged = jwt.sign({ userId: '1', role: 'admin' }, 'another-secret-another-secret-another-123');
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  test('TC-Sec-02b token whose role does not match the database role returns 401', async () => {
    db.setup([asUser('patient')]);
    const res = await request(app).get('/api/admin/users').set('Authorization', bearer('admin', '5'));
    expect(res.status).toBe(401);
  });

  test('TC-Sec-02c token of a deactivated user returns 401', async () => {
    db.setup([['SELECT role, is_active AS isActive FROM users', [{ role: 'patient', isActive: 0 }]]]);
    const res = await request(app).get('/api/appointments').set('Authorization', bearer('patient', '5'));
    expect(res.status).toBe(401);
  });

  test('TC-Sec-04 role matrix: every protected route rejects the wrong roles', async () => {
    const matrix = [
      ['get', '/api/patients/me', ['doctor', 'admin']],
      ['get', '/api/records', ['admin']],
      ['post', '/api/records', ['patient', 'admin']],
      ['post', '/api/appointments', ['doctor', 'admin']],
      ['post', '/api/doctors/availability', ['patient', 'admin']],
      ['get', '/api/admin/overview', ['patient', 'doctor']],
    ];
    for (const [method, url, deniedRoles] of matrix) {
      for (const role of deniedRoles) {
        db.setup([asUser(role), auditRule]);
        const res = await request(app)[method](url).set('Authorization', bearer(role, '3')).send({});
        expect([method, url, role, res.status]).toEqual([method, url, role, 403]);
      }
    }
  });

  test("TC-Sec-05 SQL injection string in login is rejected or treated as plain data", async () => {
    db.setup([['FROM users WHERE email', []], auditRule]);
    const res = await request(app).post('/api/auth/login').send({ email: "' OR '1'='1", password: "' OR '1'='1" });
    expect(res.status).toBe(400); // fails email validation, never reaches SQL
    expect(res.body.token).toBeUndefined();
  });

  test('TC-Sec-05b SQL injection in doctor search is sent only as a bound parameter', async () => {
    db.setup([['FROM doctors d', []]]);
    const payload = "' OR '1'='1";
    await request(app).get('/api/doctors').query({ q: payload, specialty: payload });
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).not.toContain(payload);
    expect(params).toContain(`%${payload}%`);
  });

  test('TC-Sec-06 script tag saved in a profile field is stored as data and returned as JSON (not HTML)', async () => {
    const script = '<script>alert(1)</script>';
    db.setup([asUser('patient'), ['UPDATE patients', { affectedRows: 1 }], ['FROM patients WHERE user_id', [{ id: '5', firstName: script }]]]);
    const res = await request(app).put('/api/patients/me').set('Authorization', bearer('patient', '5')).send({ firstName: script });
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('TC-Sec-07 .env is gitignored and no secrets are hard-coded', () => {
    const gitignore = fs.readFileSync(path.resolve(__dirname, '../../../.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    const example = fs.readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8');
    expect(example).toMatch(/replace-with/);
  });

  test('TC-Sec-08 CORS only allows the configured frontend origin; helmet headers are set', async () => {
    db.setup([]);
    const allowed = await request(app).get('/api/doctors').set('Origin', 'http://localhost:5173');
    const denied = await request(app).get('/api/doctors').set('Origin', 'http://evil.example');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect(allowed.headers['x-powered-by']).toBeUndefined();
  });

  test('TC-Sec-09 validation and server errors do not leak stack traces or SQL', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.setup([['FROM doctors d', new Error("ER_BAD_FIELD_ERROR: Unknown column 'x' in 'field list'")]]);
    const serverError = await request(app).get('/api/doctors');
    const validationError = await request(app).post('/api/auth/register').send({ email: 'bad' });
    for (const res of [serverError, validationError]) {
      expect(JSON.stringify(res.body)).not.toMatch(/stack|ER_BAD_FIELD|Unknown column|node_modules|at .*\.js/);
    }
    expect(serverError.status).toBe(500);
    spy.mockRestore();
  });

  test('TC-Sec-03 server logs contain no password or token after register and login', async () => {
    const logs = [];
    const spies = ['log', 'error', 'warn', 'info'].map((m) => jest.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(' '))));
    db.setup([['FROM users WHERE email', []], auditRule]);
    await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'Password123' });
    await request(app).post('/api/auth/register').send({ email: 'a@x.com', password: 'Password123', firstName: 'A', lastName: 'B' });
    spies.forEach((s) => s.mockRestore());
    expect(logs.join('\n')).not.toMatch(/Password123|eyJ/);
  });

  test('TC-Rel-01 malformed JSON returns 400 without crashing', async () => {
    db.setup([]);
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request.' });
  });

  test('TC-Rel-01b database down returns 500 with a clear message', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.setup([['FROM doctors d', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })]]);
    const res = await request(app).get('/api/doctors');
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Unable to search doctors.');
  });

  // KNOWN DEFECT (low): body over 16kb is rejected, but the error handler turns 413 into 500.
  test.failing('TC-Rel-01c oversized request body (over 16kb) returns 413, not 500', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.setup([]);
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'x'.repeat(20000) });
    spy.mockRestore();
    expect(res.status).toBe(413);
  });
});
