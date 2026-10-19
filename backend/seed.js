require('dotenv').config();

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function seed() {
  requiredEnv('JWT_SECRET');
  const seedPassword = requiredEnv('SEED_PASSWORD');
  const databaseConfig = {
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
  };
  const accounts = [
    {
      email: process.env.SEED_ADMIN_EMAIL || 'admin@example.test',
      role: 'admin',
    },
    {
      email: 'doctor.one@example.test',
      role: 'doctor',
      profile: { licenseNumber: 'HMS-DOC-001', specialty: 'Cardiology', phone: '555-0101' },
    },
    {
      email: 'doctor.two@example.test',
      role: 'doctor',
      profile: { licenseNumber: 'HMS-DOC-002', specialty: 'Pediatrics', phone: '555-0102' },
    },
    {
      email: 'patient.one@example.test',
      role: 'patient',
      profile: { firstName: 'Alex', lastName: 'Morgan', dateOfBirth: '1990-04-12', phone: '555-0201' },
    },
    {
      email: 'patient.two@example.test',
      role: 'patient',
      profile: { firstName: 'Jamie', lastName: 'Taylor', dateOfBirth: '1985-09-23', phone: '555-0202' },
    },
  ];

  const passwordHashes = await Promise.all(accounts.map(() => bcrypt.hash(seedPassword, 12)));
  const connection = await mysql.createConnection(databaseConfig);
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    for (const [index, account] of accounts.entries()) {
      await connection.execute(
        `INSERT INTO users (email, password_hash, role)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
             password_hash = VALUES(password_hash),
             updated_at = CURRENT_TIMESTAMP`,
        [account.email, passwordHashes[index], account.role],
      );

      const [userRows] = await connection.execute(
        'SELECT id, role FROM users WHERE email = ?',
        [account.email],
      );
      const user = userRows[0];
      if (!user || user.role !== account.role) {
        throw new Error(`Seed account has an unexpected role: ${account.email}`);
      }

      if (account.role === 'doctor') {
        await connection.execute(
          `INSERT INTO doctors (user_id, license_number, specialty, phone)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE license_number = VALUES(license_number),
                                   specialty = VALUES(specialty), phone = VALUES(phone)`,
          [user.id, account.profile.licenseNumber, account.profile.specialty, account.profile.phone],
        );
      } else if (account.role === 'patient') {
        await connection.execute(
          `INSERT INTO patients (user_id, first_name, last_name, date_of_birth, phone)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE first_name = VALUES(first_name),
                                   last_name = VALUES(last_name),
                                   date_of_birth = VALUES(date_of_birth), phone = VALUES(phone)`,
          [user.id, account.profile.firstName, account.profile.lastName,
            account.profile.dateOfBirth, account.profile.phone],
        );
      }
    }

    await connection.commit();
    transactionStarted = false;
    console.log('Seeded one administrator, two doctors, and two patients.');
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    await connection.end();
  }
}

seed().catch((error) => {
  console.error('Database seeding failed:', error.message);
  process.exitCode = 1;
});