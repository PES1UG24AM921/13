# Hospital Management System

Project Overview

The **Hospital Management System** is a software application designed to simplify and organize the management of patient records and hospital appointments.

The system provides a centralized platform for managing patient information, doctor details, medical records, and appointments while improving accessibility, organization, and efficiency.

Objectives

- Manage patient information and medical records efficiently.
- Allow patients to book, view, reschedule, and cancel appointments.
- Manage doctor information and availability.
- Provide role-based access for patients, doctors, and administrators.
- Maintain organized and secure healthcare records.
- Reduce manual work involved in appointment and record management.

## User Roles

### Patient
- Register and log in.
- Manage personal information.
- View medical records.
- Book appointments.
- View, reschedule, and cancel appointments.

### Doctor
- Log in securely.
- View appointments.
- View relevant patient information.
- Update medical records.
- Manage availability.

### Administrator
- Manage patients and doctors.
- Manage appointments.
- Manage system records.
- Monitor and maintain the system.

## System Components

The project consists of:

- **Frontend** – User interface for patients, doctors, and administrators.
- **Backend** – Application logic and REST APIs.
- **Database** – Storage of patient, doctor, appointment, and medical record information.
- **Authentication & Authorization** – Secure login and role-based access.
- **Testing** – Unit, integration, and system-level testing.

## Repository Structure

```text
Hospital-Patient-Management-System/
│
├── README.md
│
├── docs/
│   ├── SRS/
│   ├── SAD/
│   ├── TestPlan/
│   ├── RTM/
│   └── diagrams/
│       ├── use-case/
│       ├── class/
│       ├── sequence/
│       ├── activity/
│       ├── component/
│       └── ER/
│
├── frontend/
├── backend/
├── database/
│
└── tests/
    ├── unit/
    ├── integration/
    └── system/
```

## Documentation

The repository contains the following Software Engineering deliverables:

- **SRS** – Software Requirements Specification
- **SAD** – Software Architecture and Design Specification
- **UML Diagrams** – Use-case, class, sequence, activity, component and other system diagrams
- **Test Plan** – Testing strategy, test cases and test execution
- **RTM** – Requirements Traceability Matrix

## Testing

Testing will include:

- Unit Testing
- Integration Testing
- System Testing
- Acceptance Testing
- Functional Testing
- Regression Testing
- Performance Testing
- Usability Testing

## Doctor profiles and availability API

All doctor profile, doctor listing, and slot lookup endpoints require a bearer token for an active patient, doctor, or administrator account:

- `GET /api/doctors` searches doctors and includes `slots` for the requested `date` (`YYYY-MM-DD`); omitted dates default to the current UTC date. Supports `q`, `specialty`, `limit`, and `offset`.
- `GET /api/doctors/:doctorId` retrieves an active doctor's profile.
- `GET /api/doctors/:doctorId/slots?date=YYYY-MM-DD` retrieves unbooked 30-minute slots for that date.
- `POST /api/doctors/availability` creates an availability block.
- `PUT /api/doctors/availability/:availabilityId` updates a block owned by the authenticated doctor.
- `DELETE /api/doctors/availability/:availabilityId` deletes a block owned by the authenticated doctor.

Availability creation and updates are restricted to doctor accounts. The body requires `dayOfWeek` (1-7) and `startTime` on a half-hour boundary; each block represents one 30-minute appointment. `effectiveFrom` defaults to today and `effectiveTo` may be omitted or `null`. Invalid dates, times, and overlapping blocks are rejected.

## Security

The system will implement appropriate authentication and authorization mechanisms to protect patient and healthcare information.

Security requirements and objectives will be documented in the SRS and SAD.

## Project Status

**Status:** In Development

## Team

| SRN | Member Name | Responsibility |
|---|---|---|
| PES1UG24AM435 | Krishna Kaushik Reddy K | Implementation Part 1 |
| PES1UG24AM446 | Rolla N Harsha Vardhan | SRS |
| PES1UG24AM458 | Amulya P | Implementation Part 2 & SAD|
| PES1UG24AM921 | Rohan Agarwal | Testing & RTM |

## Course

**Software Engineering Project**


## Local setup

See [`SETUP_LOCAL.md`](SETUP_LOCAL.md) for macOS instructions to configure MySQL, the backend environment, development seed accounts, and the React frontend.

## Frontend

The React + Vite frontend uses a responsive dark navy and teal theme. To run it, follow the frontend section in `SETUP_LOCAL.md`.
