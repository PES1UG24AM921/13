const { restoreTestDatabase } = require('./testDatabaseTools');

restoreTestDatabase(process.argv[2])
  .then((filePath) => {
    console.log(`Test database restored from: ${filePath}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
