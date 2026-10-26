// Fake MySQL pool used by all Jest tests, so tests run without a real database.
const pool = {
  execute: jest.fn(),
  getConnection: jest.fn(),
};

// Build a fake transaction connection that answers queries from `rules`.
function makeConnection(rules) {
  const connection = {
    execute: jest.fn((sql, params) => answer(rules, sql, params)),
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
  return connection;
}

// rules = [[ 'text found in SQL', result | (sql, params) => result | Error ], ...]
// First matching rule wins. Result for SELECT is an array of rows, otherwise an object.
function answer(rules, sql, params) {
  for (const [fragment, result] of rules) {
    if (sql.includes(fragment)) {
      const value = typeof result === 'function' ? result(sql, params) : result;
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve([value]);
    }
  }
  return Promise.resolve([[]]);
}

// Install rules on pool.execute and pool.getConnection. Returns the connection.
function setup(rules) {
  pool.execute.mockReset();
  pool.getConnection.mockReset();
  pool.execute.mockImplementation((sql, params) => answer(rules, sql, params));
  const connection = makeConnection(rules);
  pool.getConnection.mockResolvedValue(connection);
  return connection;
}

module.exports = pool;
module.exports.setup = setup;
