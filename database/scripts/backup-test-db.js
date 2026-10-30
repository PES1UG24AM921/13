const { backupTestDatabase } = require('./testDatabaseTools');

backupTestDatabase(process.argv[2])
  .then((filePath) => {
    console.log(`Test database backup created: ${filePath}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
