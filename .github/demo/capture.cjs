'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { chromium, request } = require(path.resolve('capture-run/node_modules/playwright'));

const [sprintText, snapshot, lengthText] = process.argv.slice(2);
const sprint = Number(sprintText);
const seconds = Number(lengthText);
const web = 'http://localhost:5173';
const api = 'http://localhost:3000/api';
const password = process.env.SEED_PASSWORD;
const user1 = 'patient.one@example.test';
const user2 = 'patient.two@example.test';
const doctorEmail = 'doctor.one@example.test';
const branchDates = { 1: '19–23 October 2026', 2: '26–30 October 2026' };
const outcome = { 1: 'Patient profiles and doctor availability', 2: 'Appointment booking and medical records' };
const shownPhone = '+1 415 555 0198';
const diagnosis = 'Routine checkup – synthetic example';

const later = new Date(Date.now() + 3 * 86400000);
const date = later.toISOString().slice(0, 10);
const weekday = later.getUTCDay() || 7;

async function tokenFrom(http, email) {
  const res = await http.post(api + '/auth/login', { data: { email, password } });
  assert.equal(res.status(), 200, 'Demo account login');
  return (await res.json()).token;
}

async function call(http, auth, method, endpoint, data, expected) {
  const response = await http.fetch(api + endpoint, {
    method,
    headers: { Authorization: 'Bearer ' + auth },
    ...(data === undefined ? {} : { data }),
  });
  const status = response.status();
  const body = await response.json();
  assert.equal(status, expected, method + ' ' + endpoint + ' returned ' + status + ' (' + (body.error || body.message || 'no message') + ')');
  console.log(method, endpoint, status);
  return body;
}

async function caption(page, label, detail = '') {
  await page.evaluate(({ label, detail }) => {
    document.getElementById('hms-demo-overlay')?.remove();
    const panel = document.createElement('section');
    panel.id = 'hms-demo-overlay';
    panel.setAttribute('aria-hidden', 'true');
    panel.style.cssText = 'position:fixed;z-index:2147483647;bottom:22px;left:26px;right:26px;min-height:72px;pointer-events:none;box-sizing:border-box;padding:14px 22px;border:1px solid #4f7c8f;border-left:5px solid #2dd4bf;border-radius:12px;background:#092638;color:white;box-shadow:0 5px 18px #0005;font:18px/1.3 Arial,sans-serif;';
    const heading = document.createElement('strong');
    heading.style.cssText = 'display:block;color:#92eee0;font:700 14px/1.5 Arial,sans-serif;letter-spacing:1.1px;text-transform:uppercase';
    heading.textContent = label;
    const body = document.createElement('div');
    body.textContent = detail;
    panel.append(heading, body);
    document.body.append(panel);
  }, { label, detail });
}

function card(small, heading, body, extra) {
  return '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#081f2e;color:#fff;font-family:Arial,sans-serif}main{display:flex;flex-direction:column;justify-content:center;height:100vh;padding:0 10vw;border-left:14px solid #2dd4bf}strong{color:#7de9d5;letter-spacing:.17em;font-size:18px}h1{font-size:56px;line-height:1.1;margin:20px 0 18px;max-width:1040px}p{font-size:27px;color:#d9e9f0;line-height:1.4;margin:0 0 26px;max-width:940px}footer{font-size:16px;color:#b1c8d5;border-top:1px solid #41616d;max-width:960px;padding-top:20px}</style><main><strong>' + small + '</strong><h1>' + heading + '</h1><p>' + body + '</p><footer>' + extra + '</footer></main>';
}

async function showCard(page, small, heading, body, extra) {
  await page.goto('about:blank');
  await page.setContent(card(small, heading, body, extra));
}

async function login(page, email, onBeforeSubmit = async () => {}) {
  await page.goto(web + '/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await onBeforeSubmit();
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('button', { name: /sign out/i }).waitFor();
}
async function logout(page) {
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.waitForURL('**/login');
}

async function sprintOne(page, http, at) {
  await at(6);
  await login(page, user1, async () => {
    await caption(page, 'Patient sign-in', 'A seeded synthetic patient signs in to the role-specific workspace.');
    await at(12);
  });
  await caption(page, 'Patient workspace', 'The patient lands on a dashboard with appointments, doctor discovery and medical records.');
  await at(18);
  await page.getByRole('button', { name: 'Open profile' }).click();
  await page.waitForURL('**/profile');
  const phone = page.getByLabel('Phone number');
  await phone.waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('input[type=date]')?.value));
  await caption(page, 'Patient profile', 'The signed-in patient can view and update their own contact details.');
  await at(23);
  await phone.fill(shownPhone);
  await page.getByRole('button', { name: /save changes/i }).click();
  await page.getByText('Profile updated.', { exact: true }).waitFor();
  await caption(page, 'Profile saved', 'The app confirms the update and stores the synthetic phone number.');
  await at(30);
  await page.reload();
  await page.waitForFunction(value => [...document.querySelectorAll('input')].some(el => el.value === value), shownPhone);
  await caption(page, 'Persistence verified', 'After reloading, the updated number is still saved on the profile.');
  await at(36);
  await logout(page);
  await login(page, doctorEmail, () => caption(page, 'Doctor sign-in', 'The doctor account has a different workspace and permissions.'));
  await caption(page, 'Doctor workspace', 'The doctor can access their appointment schedule and availability.');
  await at(43);
  await page.locator('nav a[href="/availability"]').click();
  await page.getByLabel('Day of week').selectOption(String(weekday));
  await page.getByLabel('Start time').selectOption('09:00');
  await page.getByLabel('Effective from').fill(date);
  await caption(page, 'Recurring availability', 'The doctor selects a weekday, start time and effective date.');
  await at(49);
  await page.getByRole('button', { name: /add availability/i }).click();
  await page.getByText('Availability slot added.', { exact: true }).waitFor();
  const doctor = await tokenFrom(http, doctorEmail);
  const result = await call(http, doctor, 'GET', '/doctors', undefined, 200);
  const cardiologist = result.doctors.find(d => d.licenseNumber === 'HMS-DOC-001') || result.doctors.find(d => d.specialty === 'Cardiology');
  assert(cardiologist?.id, 'Synthetic cardiologist was seeded');
  const slots = await call(http, doctor, 'GET', '/doctors/' + cardiologist.id + '/slots?date=' + date, undefined, 200);
  assert(slots.slots.some(slot => slot.startTime.startsWith('09:00')), 'The saved availability is discoverable as a slot');
  await caption(page, 'Availability saved', 'The new 30-minute slot is returned by the availability API.');
  await at(55);
  await showCard(page, 'Sprint 1 outcome', 'Working patient and doctor workflows', 'Sign-in, patient profile updates and recurring doctor availability.', 'Hospital Management System · Snapshot ' + snapshot.slice(0, 7));
}

async function sprintTwo(page, http, at, doctor, patient, otherPatient, doctorId, startsAt) {
  await at(8);
  await login(page, user1, async () => {
    await caption(page, 'Patient sign-in', 'A synthetic patient signs in to book a consultation.');
    await at(13);
  });
  await caption(page, 'Patient workspace', 'The appointment workflow starts from the doctor directory.');
  await at(18);
  await page.locator('nav a[href="/doctors"]').click();
  const cardiology = page.locator('.doctor-card').filter({ hasText: 'Cardiology' });
  await cardiology.waitFor();
  await caption(page, 'Choose a doctor', 'The directory lists the seeded cardiology service.');
  await at(25);
  await cardiology.getByRole('link', { name: /view slots/i }).click();
  await page.getByLabel('Appointment date').fill(date);
  const slot = page.locator('.slot-button').first();
  await slot.waitFor();
  await slot.click();
  await page.getByPlaceholder('Share a short note for your care team (optional)').fill('Routine checkup (synthetic demo)');
  await caption(page, 'Choose an available time', 'The page loads real slots from MySQL through the API.');
  await at(34);
  const booked = page.waitForResponse(res => res.url() === api + '/appointments' && res.request().method() === 'POST');
  await page.getByRole('button', { name: /confirm appointment/i }).click();
  const booking = await booked;
  assert.equal(booking.status(), 201, 'Booking succeeds');
  const { appointment } = await booking.json();
  assert.equal(appointment.status, 'Scheduled');
  await page.getByText('Appointment booked successfully.', { exact: true }).waitFor();
  await caption(page, 'Booking confirmed', 'POST /api/appointments returned 201. The appointment is Scheduled.');
  await at(45);
  await page.locator('nav a[href="/appointments"]').click();
  await page.getByText('Scheduled', { exact: true }).waitFor();
  await caption(page, 'Saved appointment', 'The new consultation appears in the patient’s appointment list.');
  await at(53);
  await call(http, otherPatient, 'POST', '/appointments', { doctorId: Number(doctorId), startsAt }, 409);
  await caption(page, 'Double booking check · API', 'A second patient tried the same time. The running API returned 409 Conflict and rejected the booking.');
  await at(64);
  await call(http, doctor, 'POST', '/records', { appointmentId: Number(appointment.id), diagnosis,
    treatment: 'No treatment needed', notes: 'Synthetic demonstration record.' }, 201);
  await caption(page, 'Doctor creates a record · API', 'The assigned doctor created a record linked to this appointment. POST /api/records returned 201.');
  await at(75);
  await page.locator('nav a[href="/records"]').click();
  await page.getByRole('heading', { name: diagnosis }).waitFor();
  await caption(page, 'Patient reads the record', 'The saved diagnosis appears in the patient’s read-only medical records screen.');
  await at(88);
  await page.locator('nav a[href="/appointments"]').click();
  await page.getByText('Scheduled', { exact: true }).waitFor();
  await caption(page, 'Cancel the consultation', 'The patient can release a slot from the appointment list.');
  await at(96);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /^cancel$/i }).click();
  await page.getByText('Appointment cancelled.', { exact: true }).waitFor();
  await page.getByText('Cancelled', { exact: true }).waitFor();
  await caption(page, 'Cancellation saved', 'The appointment changes to Cancelled.');
  await at(103);
  const slots = await call(http, patient, 'GET', '/doctors/' + doctorId + '/slots?date=' + date, undefined, 200);
  assert(slots.slots.some(item => item.startTime.startsWith('09:00')), 'Cancellation frees the original slot');
  await caption(page, 'Slot available again · API', 'The original 09:00 slot is returned after the patient cancels.');
  await at(113);
  await showCard(page, 'Sprint 2 outcome', 'Booking, records and cancellation', 'The app rejects a double booking, displays a saved medical record and releases a cancelled slot.', 'Hospital Management System · Snapshot ' + snapshot.slice(0, 7));
}

async function main() {
  assert((sprint === 1 && seconds === 60) || (sprint === 2 && seconds === 120));
  await fs.mkdir('capture-output', { recursive: true });
  const http = await request.newContext({ timeout: 10000 });
  let doctor;
  let patient;
  let otherPatient;
  let doctorId;
  const startsAt = date + ' 09:00';
  if (sprint === 2) {
    [doctor, patient, otherPatient] = await Promise.all([doctorEmail, user1, user2].map(email => tokenFrom(http, email)));
    const listing = await call(http, patient, 'GET', '/doctors', undefined, 200);
    doctorId = listing.doctors.find(d => d.licenseNumber === 'HMS-DOC-001')?.id ||
      listing.doctors.find(d => d.specialty === 'Cardiology')?.id;
    assert(doctorId, 'Synthetic cardiologist was seeded');
    await call(http, doctor, 'POST', '/doctors/availability', { dayOfWeek: weekday, startTime: '09:00', effectiveFrom: date }, 201);
  }
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, timezoneId: 'UTC',
    recordVideo: { dir: 'capture-output', size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const start = performance.now();
  const at = async time => {
    const left = start + time * 1000 - performance.now();
    if (left > 0) await new Promise(resolve => setTimeout(resolve, left));
  };
  try {
    page.setDefaultTimeout(9000);
    await showCard(page, 'Hospital Management System · Sprint ' + sprint, outcome[sprint],
      'Sprint dates: ' + branchDates[sprint],
      'Re-recorded from Git commit ' + snapshot.slice(0, 7) + ' · Synthetic demo data · Captions throughout');
    if (sprint === 1) await sprintOne(page, http, at);
    else await sprintTwo(page, http, at, doctor, patient, otherPatient, doctorId, startsAt);
    await at(seconds + 1);
    const video = page.video();
    await context.close();
    await video.saveAs(path.resolve('capture-output/sprint.webm'));
  } catch (error) {
    await page.screenshot({ path: 'capture-output/error.png' }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await http.dispose();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });