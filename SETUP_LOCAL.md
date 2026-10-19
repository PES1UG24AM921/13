# Local setup: Hospital Patient Record and Appointment Management System

This guide sets up the supplied React frontend, Express backend and MySQL database on macOS.

## 1. Prerequisites

- Node.js 20 or newer
- MySQL 8.0.16+ (MySQL 8.4/9.x is fine)
- MySQL service running

## 2. Create the schema

From the repository root, run:

```bash
mysql -u root -p < database/schema.sql
```

The schema removes redundant `CHECK (role = ...)` constraints from `patients` and `doctors`. The composite foreign keys `(user_id, role) -> users(id, role)` already enforce the role relationship and avoid MySQL error 3823 when those columns participate in cascading foreign keys.

Create a local application account (choose your own password):

```sql
CREATE USER IF NOT EXISTS 'hms_app'@'localhost' IDENTIFIED BY 'CHOOSE_A_LOCAL_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON hms.* TO 'hms_app'@'localhost';
FLUSH PRIVILEGES;
```

Run those SQL statements inside `mysql -u root -p`, or execute them using your MySQL client. Replace the example password before running.

## 3. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and set:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=hms_app
DB_PASSWORD=YOUR_LOCAL_PASSWORD
DB_NAME=hms
PORT=3000
FRONTEND_ORIGIN=http://localhost:5173
JWT_SECRET=replace-this-with-a-random-secret-at-least-32-characters-long
JWT_EXPIRES_IN=1h
SEED_PASSWORD=Choose-A-Development-Password
SEED_ADMIN_EMAIL=admin@example.test
```

Use a private random JWT secret of at least 32 characters and a local-only seed password. Do not commit `.env` or use seed credentials in production.

Install dependencies and seed development accounts:

```bash
npm install
npm run seed
npm start
```

The API runs at `http://localhost:3000`. The seed script creates an admin, two doctors and two patients. Their shared password is the value you set in `SEED_PASSWORD`; the emails are `admin@example.test`, `doctor.one@example.test`, `doctor.two@example.test`, `patient.one@example.test`, and `patient.two@example.test`.

## 4. Run the frontend

Open a second Terminal window from the repository root:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. `frontend/.env` uses `VITE_API_URL=http://localhost:3000/api` by default.

## 5. Build the frontend

```bash
cd frontend
npm run build
```

## Important notes

- The browser talks to Express; it must never connect directly to MySQL.
- The frontend implements the routes present in this source archive. Run the team's assigned tests and verify integration after the backend teammate's final changes.
- This is a development setup. Do not use sample accounts or development secrets with real patient data.
