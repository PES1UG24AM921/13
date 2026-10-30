CREATE DATABASE IF NOT EXISTS hms
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE hms;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('patient', 'doctor', 'admin') NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_id_role (id, role)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS patients (
    user_id BIGINT UNSIGNED NOT NULL,
    role ENUM('patient', 'doctor', 'admin') NOT NULL DEFAULT 'patient',
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NULL,
    phone VARCHAR(32) NULL,
    address VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_patients_user FOREIGN KEY (user_id, role)
        REFERENCES users (id, role) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctors (
    user_id BIGINT UNSIGNED NOT NULL,
    role ENUM('patient', 'doctor', 'admin') NOT NULL DEFAULT 'doctor',
    license_number VARCHAR(100) NOT NULL,
    specialty VARCHAR(150) NOT NULL,
    phone VARCHAR(32) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_doctors_license_number (license_number),
    CONSTRAINT fk_doctors_user FOREIGN KEY (user_id, role)
        REFERENCES users (id, role) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS availability (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    doctor_id BIGINT UNSIGNED NOT NULL,
    day_of_week TINYINT UNSIGNED NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_availability_doctor_day (doctor_id, day_of_week, effective_from),
    CONSTRAINT chk_availability_day CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT chk_availability_time CHECK (start_time < end_time),
    CONSTRAINT chk_availability_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT fk_availability_doctor FOREIGN KEY (doctor_id)
        REFERENCES doctors (user_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    patient_id BIGINT UNSIGNED NOT NULL,
    doctor_id BIGINT UNSIGNED NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    status ENUM('Scheduled', 'Completed', 'Cancelled', 'NoShow') NOT NULL DEFAULT 'Scheduled',
    reason VARCHAR(1000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- Half-hour alignment plus the 30-minute check makes this unique key an overlap guard.
    active_doctor_start DATETIME GENERATED ALWAYS AS (
        CASE WHEN status = 'Scheduled' THEN starts_at ELSE NULL END
    ) STORED,
    active_patient_start DATETIME GENERATED ALWAYS AS (
        CASE WHEN status = 'Scheduled' THEN starts_at ELSE NULL END
    ) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_appointments_active_doctor_start (doctor_id, active_doctor_start),
    UNIQUE KEY uq_appointments_active_patient_start (patient_id, active_patient_start),
    UNIQUE KEY uq_appointments_id_patient_doctor (id, patient_id, doctor_id),
    KEY ix_appointments_patient_start (patient_id, starts_at),
    KEY ix_appointments_doctor_start (doctor_id, starts_at),
    CONSTRAINT chk_appointments_time CHECK (starts_at < ends_at),
    CONSTRAINT chk_appointments_half_hour CHECK (
        TIMESTAMPDIFF(MINUTE, starts_at, ends_at) = 30
        AND MINUTE(starts_at) IN (0, 30)
        AND SECOND(starts_at) = 0
        AND SECOND(ends_at) = 0
    ),
    CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id)
        REFERENCES patients (user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_doctor FOREIGN KEY (doctor_id)
        REFERENCES doctors (user_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medical_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    appointment_id BIGINT UNSIGNED NOT NULL,
    patient_id BIGINT UNSIGNED NOT NULL,
    doctor_id BIGINT UNSIGNED NOT NULL,
    diagnosis TEXT NOT NULL,
    treatment TEXT NULL,
    notes TEXT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_medical_records_appointment (appointment_id),
    KEY ix_medical_records_patient_recorded (patient_id, recorded_at),
    CONSTRAINT fk_medical_records_patient FOREIGN KEY (patient_id)
        REFERENCES patients (user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_medical_records_doctor FOREIGN KEY (doctor_id)
        REFERENCES doctors (user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_medical_records_appointment FOREIGN KEY (appointment_id, patient_id, doctor_id)
        REFERENCES appointments (id, patient_id, doctor_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id BIGINT UNSIGNED NULL,
    actor_role ENUM('patient', 'doctor', 'admin') NULL,
    actor_email VARCHAR(254) NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NULL,
    target_id VARCHAR(64) NULL,
    metadata JSON NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_audit_logs_created (created_at),
    KEY ix_audit_logs_action_created (action, created_at),
    KEY ix_audit_logs_actor_created (actor_user_id, created_at),
    CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;