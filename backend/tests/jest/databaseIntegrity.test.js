const fs = require('node:fs');
const path = require('node:path');
const {
  backupTestDatabase,
  getTestDatabaseConfig,
  initializeTestDatabase,
  restoreTestDatabase,
} = require('../../../database/scripts/testDatabaseTools');
const mysql = require('mysql2/promise');

const schema = fs.readFileSync(
  path.resolve(__dirname, '../../../database/schema.sql'),
  'utf8',
);

function makeChild() {
  const { PassThrough } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  return child;
}

describe('Database integrity and test database tools', () => {
  test('patient, doctor, appointment, and record tables have referential constraints', () => {
    expect(schema).toMatch(/CONSTRAINT fk_patients_user FOREIGN KEY \(user_id, role\)/);
    expect(schema).toMatch(/CONSTRAINT fk_doctors_user FOREIGN KEY \(user_id, role\)/);
    expect(schema).toMatch(/CONSTRAINT fk_appointments_patient FOREIGN KEY \(patient_id\)/);
    expect(schema).toMatch(/CONSTRAINT fk_appointments_doctor FOREIGN KEY \(doctor_id\)/);
    expect(schema).toMatch(/CONSTRAINT fk_medical_records_patient FOREIGN KEY \(patient_id\)/);
    expect(schema).toMatch(/CONSTRAINT fk_medical_records_doctor FOREIGN KEY \(doctor_id\)/);
    expect(schema).toMatch(/FOREIGN KEY \(appointment_id, patient_id, doctor_id\)/);
  });

  test('half-hour checks and active unique keys prevent overlapping doctor slots', () => {
    expect(schema).toMatch(/UNIQUE KEY uq_appointments_active_doctor_start \(doctor_id, active_doctor_start\)/);
    expect(schema).toMatch(/TIMESTAMPDIFF\(MINUTE, starts_at, ends_at\) = 30/);
    expect(schema).toMatch(/MINUTE\(starts_at\) IN \(0, 30\)/);
    expect(schema).toMatch(/SECOND\(starts_at\) = 0/);
  });

  test('backup/restore refuse every database name except hms_test', () => {
    expect(() => getTestDatabaseConfig({
      DB_NAME: 'hms',
      DB_HOST: 'localhost',
      DB_USER: 'tester',
      DB_PASSWORD: 'test-password',
    })).toThrow('DB_NAME=hms_test');
    expect(getTestDatabaseConfig({
      DB_NAME: 'hms_test',
      DB_HOST: 'localhost',
      DB_USER: 'tester',
      DB_PASSWORD: 'test-password',
    }).database).toBe('hms_test');
  });

  test('test schema initialization targets only hms_test', () => {
    const spawnCommand = jest.fn(() => ({ status: 0, stderr: '' }));
    initializeTestDatabase({
      database: 'hms_test',
      host: 'localhost',
      password: 'test-password',
      port: '3306',
      user: 'tester',
      mysqlBinary: 'mysql',
    }, spawnCommand);
    const [binary, args, options] = spawnCommand.mock.calls[0];
    expect(binary).toBe('mysql');
    expect(args).not.toContain('hms');
    expect(options.input).toContain('CREATE DATABASE IF NOT EXISTS hms_test');
    expect(options.input).toContain('USE hms_test;');
    expect(options.input).not.toMatch(/^USE hms;$/m);
  });

  test('backup output can be restored only into hms_test', async () => {
    const os = require('node:os');
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hms-db-test-'));
    const dumpPath = path.join(tempDir, 'backup.sql');
    const config = {
      database: 'hms_test',
      host: 'localhost',
      port: '3306',
      user: 'tester',
      password: 'test-password',
      dumpBinary: 'mysqldump',
      mysqlBinary: 'mysql',
    };

    try {
      const dumpProcess = jest.fn(() => {
        const child = makeChild();
        process.nextTick(() => {
          child.stdout.end('CREATE TABLE integrity_probe (id INT PRIMARY KEY);');
          child.stderr.end();
          child.emit('close', 0);
        });
        return child;
      });
      await backupTestDatabase(dumpPath, config, dumpProcess);
      expect(await fs.promises.readFile(dumpPath, 'utf8'))
        .toContain('CREATE TABLE integrity_probe');
      expect(dumpProcess.mock.calls[0][1]).toContain('hms_test');
      expect(dumpProcess.mock.calls[0][1]).toContain('--single-transaction');

      let restoredSql = '';
      const restoreProcess = jest.fn(() => {
        const child = makeChild();
        const restoreChunks = [];
        child.stdin.on('data', (chunk) => restoreChunks.push(chunk));
        child.stdin.on('end', () => {
          restoredSql = Buffer.concat(restoreChunks).toString('utf8');
          child.stderr.end();
          child.emit('close', 0);
        });
        return child;
      });
      await restoreTestDatabase(dumpPath, config, restoreProcess);
      expect(restoredSql).toContain('CREATE TABLE integrity_probe');
      expect(restoreProcess.mock.calls[0][1]).toEqual([
        '--host', 'localhost',
        '--port', '3306',
        '--user', 'tester',
        '--database', 'hms_test',
      ]);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});

const runMySqlIntegration = process.env.HMS_RUN_DB_INTEGRATION === 'true';
const mysqlSuite = runMySqlIntegration ? describe : describe.skip;

mysqlSuite('MySQL hms_test integration', () => {
  let connection;
  let config;

  beforeAll(async () => {
    config = getTestDatabaseConfig();
    connection = await mysql.createConnection({
      host: config.host,
      port: Number(config.port),
      user: config.user,
      password: config.password,
      database: config.database,
    });
  });

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  test('foreign keys reject orphan rows and active duplicate slots', async () => {
    await connection.beginTransaction();
    try {
      const suffix = `${process.pid}_${Date.now()}`;
      const [doctorUser] = await connection.execute(
        'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
        [`integrity-doctor-${suffix}@example.test`, 'not-used-in-test', 'doctor'],
      );
      const [patientUser] = await connection.execute(
        'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
        [`integrity-patient-${suffix}@example.test`, 'not-used-in-test', 'patient'],
      );
      await connection.execute(
        'INSERT INTO doctors (user_id, license_number, specialty) VALUES (?, ?, ?)',
        [doctorUser.insertId, `license-${suffix}`, 'Test'],
      );
      await connection.execute(
        'INSERT INTO patients (user_id, first_name, last_name) VALUES (?, ?, ?)',
        [patientUser.insertId, 'Test', 'Patient'],
      );
      const appointmentValues = [
        patientUser.insertId,
        doctorUser.insertId,
        '2030-01-07 09:00:00',
        '2030-01-07 09:30:00',
      ];
      await connection.execute(
        'INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at) VALUES (?, ?, ?, ?)',
        appointmentValues,
      );

      await expect(connection.execute(
        `INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at)
         VALUES (?, ?, ?, ?)`,
        [9223372036854775807n.toString(), doctorUser.insertId, ...appointmentValues.slice(2)],
      )).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
      await expect(connection.execute(
        `INSERT INTO medical_records (appointment_id, patient_id, doctor_id, diagnosis)
         VALUES (?, ?, ?, ?)`,
        [9223372036854775807n.toString(), patientUser.insertId, doctorUser.insertId, 'orphan'],
      )).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
      await expect(connection.execute(
        'INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at) VALUES (?, ?, ?, ?)',
        appointmentValues,
      )).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    } finally {
      await connection.rollback();
    }
  });

  test('restore recovers database state from a generated backup', async () => {
    const os = require('node:os');
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hms-restore-integration-'));
    const tableName = `backup_restore_probe_${process.pid}_${Date.now()}`;
    const backupPath = path.join(tempDir, 'hms_test.sql');
    try {
      await connection.execute(
        `CREATE TABLE \`${tableName}\` (id INT NOT NULL PRIMARY KEY, marker VARCHAR(50) NOT NULL) ENGINE=InnoDB`,
      );
      await connection.execute(
        `INSERT INTO \`${tableName}\` (id, marker) VALUES (1, 'before-backup')`,
      );
      await backupTestDatabase(backupPath, config);
      await connection.execute(
        `UPDATE \`${tableName}\` SET marker = 'changed-after-backup' WHERE id = 1`,
      );
      await restoreTestDatabase(backupPath, config);
      const [rows] = await connection.execute(
        `SELECT marker FROM \`${tableName}\` WHERE id = 1`,
      );
      expect(rows).toEqual([{ marker: 'before-backup' }]);
    } finally {
      await connection.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
