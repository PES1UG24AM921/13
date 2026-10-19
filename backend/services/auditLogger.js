async function writeAudit(executor, {
  req,
  actorId = null,
  actorRole = null,
  actorEmail = null,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
}) {
  let email = actorEmail;
  if (!email && actorId !== null) {
    const [actors] = await executor.execute(
      'SELECT email FROM users WHERE id = ?',
      [actorId],
    );
    email = actors[0]?.email || null;
  }

  await executor.execute(
    `INSERT INTO audit_logs
       (actor_user_id, actor_role, actor_email, action, target_type, target_id,
        metadata, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorId,
      actorRole,
      typeof email === 'string' ? email.slice(0, 254) : null,
      action,
      targetType,
      targetId === null ? null : String(targetId),
      metadata === null ? null : JSON.stringify(metadata),
      req?.ip || null,
      typeof req?.get === 'function' ? (req.get('user-agent') || '').slice(0, 500) || null : null,
    ],
  );
}

module.exports = { writeAudit };