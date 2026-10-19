USE hms;

ALTER TABLE patients
    DROP FOREIGN KEY fk_patients_user,
    DROP CHECK chk_patients_role;

ALTER TABLE doctors
    DROP FOREIGN KEY fk_doctors_user,
    DROP CHECK chk_doctors_role;

ALTER TABLE users
    MODIFY role ENUM('Patient', 'Doctor', 'Administrator', 'patient', 'doctor', 'admin') NOT NULL;

ALTER TABLE patients
    MODIFY role ENUM('Patient', 'Doctor', 'Administrator', 'patient', 'doctor', 'admin') NOT NULL DEFAULT 'patient';

ALTER TABLE doctors
    MODIFY role ENUM('Patient', 'Doctor', 'Administrator', 'patient', 'doctor', 'admin') NOT NULL DEFAULT 'doctor';

ALTER TABLE audit_logs
    MODIFY actor_role ENUM('Patient', 'Doctor', 'Administrator', 'patient', 'doctor', 'admin') NULL;

UPDATE users
SET role = CASE role
    WHEN 'Patient' THEN 'patient'
    WHEN 'Doctor' THEN 'doctor'
    WHEN 'Administrator' THEN 'admin'
    ELSE role
END;

UPDATE patients SET role = 'patient' WHERE role = 'Patient';
UPDATE doctors SET role = 'doctor' WHERE role = 'Doctor';
UPDATE audit_logs
SET actor_role = CASE actor_role
    WHEN 'Patient' THEN 'patient'
    WHEN 'Doctor' THEN 'doctor'
    WHEN 'Administrator' THEN 'admin'
    ELSE actor_role
END
WHERE actor_role IS NOT NULL;

ALTER TABLE users
    MODIFY role ENUM('patient', 'doctor', 'admin') NOT NULL;

ALTER TABLE patients
    MODIFY role ENUM('patient', 'doctor', 'admin') NOT NULL DEFAULT 'patient',
    ADD CONSTRAINT chk_patients_role CHECK (role = 'patient'),
    ADD CONSTRAINT fk_patients_user FOREIGN KEY (user_id, role)
        REFERENCES users (id, role) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE doctors
    MODIFY role ENUM('patient', 'doctor', 'admin') NOT NULL DEFAULT 'doctor',
    ADD CONSTRAINT chk_doctors_role CHECK (role = 'doctor'),
    ADD CONSTRAINT fk_doctors_user FOREIGN KEY (user_id, role)
        REFERENCES users (id, role) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE audit_logs
    MODIFY actor_role ENUM('patient', 'doctor', 'admin') NULL;
