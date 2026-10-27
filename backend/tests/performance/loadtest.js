// Load test for TC-Perf-01 (HMS-NF-001): 50 concurrent users, 95% of requests under 2 seconds.
// Needs Node 18+ (built-in fetch). No extra packages.
//
// Run (backend and MySQL must be running and seeded):
//   cd backend
//   SEED_PASSWORD=<your seed password> node tests/performance/loadtest.js
// Windows PowerShell:
//   $env:SEED_PASSWORD="<your seed password>"; node tests/performance/loadtest.js
//
// Optional: BASE_URL (default http://localhost:3000), USERS (default 50), DURATION (seconds, default 30)

const os = require('node:os');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const USERS = Number(process.env.USERS || 50);
const DURATION = Number(process.env.DURATION || 30);
const PASSWORD = process.env.SEED_PASSWORD;
const LIMIT_MS = 2000;

if (!PASSWORD) {
  console.error('Set SEED_PASSWORD to the password you used in backend/.env, then run again.');
  process.exit(1);
}

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const start = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    await res.text();
    return { status: res.status, ms: performance.now() - start };
  } catch (error) {
    return { status: 0, ms: performance.now() - start, error: error.message };
  }
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email} (status ${res.status}). Check SEED_PASSWORD and that the database is seeded.`);
  return (await res.json()).token;
}

const pad = (n) => String(n).padStart(2, '0');
const dateOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const TIMES = [];
for (let h = 9; h < 17; h += 1) TIMES.push(`${pad(h)}:00`, `${pad(h)}:30`);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function main() {
  console.log(`Setting up against ${BASE} ...`);
  const doctorToken = await login('doctor.one@example.test');
  const patientTokens = [await login('patient.one@example.test'), await login('patient.two@example.test')];

  const doctorsRes = await fetch(`${BASE}/api/doctors`);
  const doctor = (await doctorsRes.json()).doctors.find((d) => d.licenseNumber === 'HMS-DOC-001');
  if (!doctor) throw new Error('Seeded doctor HMS-DOC-001 not found. Run npm run seed.');

  // Give the doctor availability on every weekday, 09:00 to 17:00. 409 means it already exists.
  const effectiveFrom = dateOffset(0);
  const setup = [];
  for (let day = 1; day <= 7; day += 1) {
    for (const startTime of TIMES) {
      setup.push(call('POST', '/api/doctors/availability', { token: doctorToken, body: { dayOfWeek: day, startTime, effectiveFrom } }));
    }
  }
  await Promise.all(setup);

  const results = [];
  const operations = [
    { name: 'GET /api/doctors (search)', weight: 40, run: () => call('GET', '/api/doctors?specialty=Cardio') },
    { name: 'GET /api/doctors/:id/slots', weight: 30, run: () => call('GET', `/api/doctors/${doctor.id}/slots?date=${dateOffset(1 + Math.floor(Math.random() * 7))}`) },
    { name: 'GET /api/appointments', weight: 15, run: () => call('GET', '/api/appointments', { token: pick(patientTokens) }) },
    { name: 'POST /api/appointments (book)', weight: 15, run: () => call('POST', '/api/appointments', { token: pick(patientTokens), body: { doctorId: Number(doctor.id), startsAt: `${dateOffset(1 + Math.floor(Math.random() * 7))} ${pick(TIMES)}`, reason: 'load test' } }) },
  ];
  const bag = operations.flatMap((op) => Array(op.weight).fill(op));

  console.log(`Running ${USERS} concurrent users for ${DURATION} seconds ...`);
  const startedAt = performance.now();
  const endAt = startedAt + DURATION * 1000;
  async function virtualUser() {
    while (performance.now() < endAt) {
      const op = pick(bag);
      const r = await op.run();
      results.push({ op: op.name, ...r });
    }
  }
  await Promise.all(Array.from({ length: USERS }, virtualUser));
  const elapsed = (performance.now() - startedAt) / 1000;

  const pct = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] || 0;
  };
  const rows = [];
  for (const name of [...new Set(results.map((r) => r.op))]) {
    const own = results.filter((r) => r.op === name);
    const ms = own.map((r) => r.ms);
    const statuses = {};
    own.forEach((r) => { statuses[r.status] = (statuses[r.status] || 0) + 1; });
    rows.push({ endpoint: name, requests: own.length, 'p50 ms': Math.round(pct(ms, 50)), 'p95 ms': Math.round(pct(ms, 95)), 'max ms': Math.round(Math.max(...ms)), statuses: JSON.stringify(statuses) });
  }
  console.log('\nPer endpoint:');
  console.table(rows);

  const all = results.map((r) => r.ms);
  const within = all.filter((ms) => ms <= LIMIT_MS).length;
  const serverErrors = results.filter((r) => r.status === 0 || r.status >= 500).length;
  const p95 = Math.round(pct(all, 95));
  const share = (within / all.length) * 100;
  console.log('\nEnvironment');
  console.log(`  OS: ${os.type()} ${os.release()}, CPU: ${os.cpus()[0].model} x${os.cpus().length}, RAM: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB, Node: ${process.version}`);
  console.log('\nResult');
  console.log(`  Concurrent users: ${USERS}, duration: ${elapsed.toFixed(1)} s, total requests: ${all.length} (${(all.length / elapsed).toFixed(1)} per second)`);
  console.log(`  Requests under ${LIMIT_MS} ms: ${share.toFixed(2)}%   95th percentile: ${p95} ms   slowest: ${Math.round(Math.max(...all))} ms`);
  console.log(`  Network errors or 5xx responses: ${serverErrors}`);
  console.log('  (409 and 400 on bookings are expected: slots fill up or are not on offer.)');
  console.log(`\nTC-Perf-01 (95% under 2 s): ${share >= 95 && serverErrors === 0 ? 'PASS' : 'FAIL'}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
