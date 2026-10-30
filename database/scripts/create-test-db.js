const { initializeTestDatabase } = require('./testDatabaseTools');

try {
  initializeTestDatabase();
  console.log('The hms_test database schema is ready.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
