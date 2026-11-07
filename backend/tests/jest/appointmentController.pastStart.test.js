jest.mock('../../db', () => ({ getConnection: jest.fn() }));

const pool = require('../../db');
const appointmentController = require('../../controllers/appointmentController');

function response() {
  return {
    status: jest.fn(function setStatus(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function setJson(body) {
      this.body = body;
      return this;
    }),
  };
}

describe('appointment start time validation', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-06T13:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([
    ['booking', (req, res) => appointmentController.bookAppointment(req, res), {
      user: { id: '10', role: 'patient' },
      body: { doctorId: '2', startsAt: '2026-11-06 12:30' },
    }],
    ['rescheduling', (req, res) => appointmentController.rescheduleAppointment(req, res), {
      user: { id: '10', role: 'patient' },
      params: { appointmentId: '91' },
      body: { startsAt: '2026-11-06 12:30' },
    }],
  ])('rejects past start times when %s', async (_action, action, req) => {
    const res = response();

    await action(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
