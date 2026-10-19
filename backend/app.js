const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { getJwtSecret } = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const medicalRecordRoutes = require('./routes/medicalRecordRoutes');
const adminRoutes = require('./routes/adminRoutes');

getJwtSecret();

const app = express();

app.use(helmet());
app.use(cors({
	origin(origin, callback) {
		const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
		callback(null, !origin || origin === frontendOrigin);
	},
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '16kb' }));
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/records', medicalRecordRoutes);
app.use('/api/admin', adminRoutes);

app.use((error, req, res, next) => {
	if (res.headersSent) {
		return next(error);
	}
	const status = error.status === 400 ? 400 : 500;
	if (status === 400) {
		return res.status(400).json({ error: 'Invalid request.' });
	}
	console.error('Unhandled request error:', error.message);
	return res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;