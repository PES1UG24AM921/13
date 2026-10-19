# Careflow frontend

A responsive React + Vite frontend for the Hospital Patient Record and Appointment Management System. The UI uses a premium dark navy / teal theme and integrates with the Express API in `../backend`.

## Requirements
- Node.js 20+ recommended
- Backend API running locally (default `http://localhost:3000`)
- MySQL schema and backend environment configured by the backend teammate

## Run locally
From the repository root:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

The API base URL is configured by `VITE_API_URL` in `.env`. It defaults to `http://localhost:3000/api`.

## Included screens
- Login and patient registration
- Role-aware overview dashboard
- Doctor directory and appointment booking
- Appointment list and cancellation
- Medical records
- Patient profile editing
- Doctor availability management
- Admin user status management and audit log

## API integration notes
The frontend follows the routes currently present in the supplied backend archive: `/api/auth`, `/api/patients`, `/api/doctors`, `/api/appointments`, `/api/records`, and `/api/admin`. It expects login to return `{ token, user }` and stores the JWT in local storage for this student project. The API helper attaches `Authorization: Bearer <token>` to authenticated requests.

Some response fields can differ depending on the exact controller query aliases. If a screen displays blanks after the backend teammate's final changes, compare its API response with the relevant page and update the field mapping. This frontend is a complete starting implementation, but the final integration must be confirmed against the pushed backend and the team's test results.

## Build
```bash
npm run build
```
