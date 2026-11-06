import { useEffect, useState } from 'react';
import { get, patch, post } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import './AdminPages.css';

function Notice({ error, success }) {
  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}
    </>
  );
}

function PageHead({ eyebrow, title, description }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
    </div>
  );
}

function Status({ value }) {
  return (
    <span className={`pill ${value === 'Active' || value === 'Scheduled' ? '' : 'pill-muted'}`}>
      {value || '—'}
    </span>
  );
}

export function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyUser, setBusyUser] = useState('');
  const [form, setForm] = useState({
    role: 'patient',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    licenseNumber: '',
    specialty: '',
  });

  async function loadUsers(selectedRole = role) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (selectedRole) params.set('role', selectedRole);
      const data = await get(`/admin/users?${params}`);
      setUsers(data.users || []);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers(role);
  }, [role]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function createUser(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    const { role: accountRole, ...account } = form;
    const payload = accountRole === 'patient'
      ? {
        role: accountRole,
        email: account.email,
        password: account.password,
        firstName: account.firstName,
        lastName: account.lastName,
      }
      : {
        role: accountRole,
        email: account.email,
        password: account.password,
        licenseNumber: account.licenseNumber,
        specialty: account.specialty,
      };

    try {
      await post('/admin/users', payload);
      setSuccess(`${accountRole === 'patient' ? 'Patient' : 'Doctor'} account created.`);
      setForm({
        role: accountRole,
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        licenseNumber: '',
        specialty: '',
      });
      await loadUsers(role);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(user) {
    const isActive = Boolean(user.isActive);
    if (!window.confirm(`${isActive ? 'Deactivate' : 'Activate'} ${user.email}?`)) return;
    setError('');
    setSuccess('');
    setBusyUser(user.id);
    try {
      await patch(`/admin/users/${user.id}/status`, { is_active: !isActive });
      setSuccess(`${user.email} is now ${isActive ? 'inactive' : 'active'}.`);
      await loadUsers(role);
    } catch (statusError) {
      setError(statusError.message);
    } finally {
      setBusyUser('');
    }
  }

  return (
    <>
      <PageHead
        eyebrow="ACCOUNT DIRECTORY"
        title="People & permissions."
        description="Create accounts, review account details, and manage activation status."
      />
      <Notice error={error} success={success} />

      <section className="panel admin-panel">
        <div className="panel-heading">
          <div>
            <div className="section-kicker">NEW ACCOUNT</div>
            <h2>Create a patient or doctor account</h2>
          </div>
        </div>
        <form className="admin-form" onSubmit={createUser}>
          <label>
            Account type
            <select name="role" value={form.role} onChange={updateForm}>
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
            </select>
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required value={form.email} onChange={updateForm} />
          </label>
          <label>
            Temporary password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength="8"
              maxLength="72"
              required
              value={form.password}
              onChange={updateForm}
            />
          </label>
          {form.role === 'patient' ? (
            <>
              <label>
                First name
                <input name="firstName" required value={form.firstName} onChange={updateForm} />
              </label>
              <label>
                Last name
                <input name="lastName" required value={form.lastName} onChange={updateForm} />
              </label>
            </>
          ) : (
            <>
              <label>
                License number
                <input name="licenseNumber" required value={form.licenseNumber} onChange={updateForm} />
              </label>
              <label>
                Specialty
                <input name="specialty" required value={form.specialty} onChange={updateForm} />
              </label>
            </>
          )}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </section>

      <section className="panel table-panel admin-panel">
        <div className="admin-toolbar">
          <div>
            <div className="section-kicker">REGISTERED USERS</div>
            <h2>Account directory</h2>
          </div>
          <label className="admin-filter">
            Filter by role
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="">All roles</option>
              <option value="patient">Patients</option>
              <option value="doctor">Doctors</option>
              <option value="admin">Administrators</option>
            </select>
          </label>
        </div>
        {loading ? (
          <div className="empty-state">Loading registered users…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name / details</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {users.length ? users.map((user) => {
                  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
                  return (
                    <tr key={user.id}>
                      <td>{name || user.specialty || user.licenseNumber || user.email}</td>
                      <td>{user.email}</td>
                      <td><Status value={user.role} /></td>
                      <td><Status value={user.isActive ? 'Active' : 'Inactive'} /></td>
                      <td>
                        {user.id === currentUser?.id ? 'Current account' : (
                          <button
                            className="table-action"
                            type="button"
                            disabled={busyUser === user.id}
                            onClick={() => toggleStatus(user)}
                          >
                            {busyUser === user.id ? 'Saving…' : user.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan="5"><div className="empty-state compact">No accounts found.</div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function AdminAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  async function loadAppointments() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (doctorId) params.set('doctorId', doctorId);
      if (patientId) params.set('patientId', patientId);
      if (date) params.set('date', date);
      if (status) params.set('status', status);
      const data = await get(`/admin/appointments?${params}`);
      setAppointments(data.appointments || []);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointments();
  }, [doctorId, patientId, date, status]);

  async function cancelAppointment(appointment) {
    if (!window.confirm(`Cancel appointment #${appointment.id}?`)) return;
    setError('');
    setSuccess('');
    setBusyId(appointment.id);
    try {
      await patch(`/admin/appointments/${appointment.id}/cancel`, {});
      setSuccess(`Appointment #${appointment.id} cancelled.`);
      await loadAppointments();
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <PageHead
        eyebrow="HOSPITAL SCHEDULE"
        title="Appointments."
        description="Review and manage appointments across the hospital."
      />
      <Notice error={error} success={success} />
      <section className="panel admin-panel">
        <div className="admin-filters">
          <label>
            Doctor ID
            <input type="number" min="1" value={doctorId} onChange={(event) => setDoctorId(event.target.value)} />
          </label>
          <label>
            Patient ID
            <input type="number" min="1" value={patientId} onChange={(event) => setPatientId(event.target.value)} />
          </label>
          <label>
            Appointment date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="NoShow">No show</option>
            </select>
          </label>
        </div>
      </section>
      <section className="panel table-panel admin-panel">
        {loading ? (
          <div className="empty-state">Loading appointments…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th><th>Doctor</th><th>Date & time</th><th>Reason</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {appointments.length ? appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{appointment.patientName} <span className="admin-subtext">#{appointment.patientId}</span></td>
                    <td>{appointment.doctorSpecialty || 'Doctor'} <span className="admin-subtext">#{appointment.doctorId}</span></td>
                    <td>{appointment.startsAt ? new Date(appointment.startsAt.replace(' ', 'T')).toLocaleString() : '—'}</td>
                    <td>{appointment.reason || '—'}</td>
                    <td><Status value={appointment.status} /></td>
                    <td>
                      {appointment.status === 'Scheduled' ? (
                        <button
                          className="table-action danger-text"
                          type="button"
                          disabled={busyId === appointment.id}
                          onClick={() => cancelAppointment(appointment)}
                        >
                          {busyId === appointment.id ? 'Saving…' : 'Cancel'}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                )) : <tr><td colSpan="6"><div className="empty-state compact">No appointments match these filters.</div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function Audit() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get('/admin/audit-logs?limit=100')
      .then((data) => setLogs(data.auditLogs || []))
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHead
        eyebrow="SYSTEM ACTIVITY"
        title="Audit trail."
        description="Administrative events recorded by the system."
      />
      <Notice error={error} />
      <section className="panel table-panel admin-panel">
        {loading ? <div className="empty-state">Loading audit events…</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
              <tbody>
                {logs.length ? logs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.createdAt ? new Date(log.createdAt.replace(' ', 'T')).toLocaleString() : '—'}</td>
                    <td>{log.actorEmail || log.actorRole || 'System'}</td>
                    <td>{log.action}</td>
                    <td>{[log.targetType, log.targetId].filter(Boolean).join(' #') || '—'}</td>
                  </tr>
                )) : <tr><td colSpan="4"><div className="empty-state compact">No audit events returned.</div></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
