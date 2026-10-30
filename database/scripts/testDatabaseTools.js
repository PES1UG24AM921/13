const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
require('../../backend/config/env');

function getTestDatabaseConfig(env = process.env) {
  if (env.DB_NAME !== 'hms_test') {
    throw new Error('Database backup and restore are restricted to DB_NAME=hms_test.');
  }
  for (const name of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[name]) {
      throw new Error(`${name} must be set for the hms_test database.`);
    }
  }

  const port = Number(env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }

  return {
    database: env.DB_NAME,
    host: env.DB_HOST,
    password: env.DB_PASSWORD,
    port: String(port),
    user: env.DB_USER,
    dumpBinary: env.MYSQLDUMP_BIN || 'mysqldump',
    mysqlBinary: env.MYSQL_BIN || 'mysql',
  };
}

function commandEnvironment(config) {
  return { ...process.env, MYSQL_PWD: config.password };
}

function waitForExit(child, action) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${action} failed: ${stderr.trim() || `exit code ${code ?? signal}`}`));
    });
  });
}

function connectionArgs(config) {
  return [
    '--host', config.host,
    '--port', config.port,
    '--user', config.user,
  ];
}

function initializeTestDatabase(config = getTestDatabaseConfig(), spawnCommand = spawnSync) {
  const schemaPath = path.resolve(__dirname, '..', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8')
    .replace('CREATE DATABASE IF NOT EXISTS hms', 'CREATE DATABASE IF NOT EXISTS hms_test')
    .replace(/^USE hms;$/m, 'USE hms_test;');
  const result = spawnCommand(
    config.mysqlBinary,
    connectionArgs(config),
    {
      encoding: 'utf8',
      env: commandEnvironment(config),
      input: schema,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Test database initialization failed: ${(result.stderr || '').trim()}`);
  }
}

async function backupTestDatabase(outputPath, config = getTestDatabaseConfig(), spawnProcess = spawn) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resolvedPath = path.resolve(
    outputPath || path.join(__dirname, '..', 'backups', `hms_test-${timestamp}.sql`),
  );
  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
  const outputFile = await fs.promises.open(resolvedPath, 'wx');

  try {
    const child = spawnProcess(
      config.dumpBinary,
      [
        ...connectionArgs(config),
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--add-drop-table',
        config.database,
      ],
      { env: commandEnvironment(config), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const results = await Promise.allSettled([
      pipeline(child.stdout, outputFile.createWriteStream()),
      waitForExit(child, 'Database backup'),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
      throw failure.reason;
    }
  } catch (error) {
    await outputFile.close().catch(() => {});
    await fs.promises.rm(resolvedPath, { force: true });
    throw error;
  }
  return resolvedPath;
}

async function restoreTestDatabase(inputPath, config = getTestDatabaseConfig(), spawnProcess = spawn) {
  if (!inputPath) {
    throw new Error('Provide the path to a database backup.');
  }
  const resolvedPath = path.resolve(inputPath);
  const file = await fs.promises.stat(resolvedPath);
  if (!file.isFile()) {
    throw new Error('The database backup path must be a file.');
  }

  const child = spawnProcess(
    config.mysqlBinary,
    [...connectionArgs(config), '--database', config.database],
    { env: commandEnvironment(config), stdio: ['pipe', 'ignore', 'pipe'] },
  );
  const results = await Promise.allSettled([
    pipeline(fs.createReadStream(resolvedPath), child.stdin),
    waitForExit(child, 'Database restore'),
  ]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
  return resolvedPath;
}

module.exports = {
  backupTestDatabase,
  getTestDatabaseConfig,
  initializeTestDatabase,
  restoreTestDatabase,
};
