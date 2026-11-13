// Helper used by seed, export and tests: run work inside ONE transaction with a signed session context.
// This is the pattern the API adapter must follow: BEGIN; SELECT portal.begin_session(user, role); ...; COMMIT.
export async function withSession(pool, { userId = null, role }, fn, { commit = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT portal.begin_session($1, $2)', [userId, role]);
    const out = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
