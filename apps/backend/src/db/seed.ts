// Seed the first admin user. Phone is read from BOOTSTRAP_ADMIN_PHONE env;
// after this user logs in via WhatsApp OTP they can create the rest.

import { pool } from './client.js';

async function main() {
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE;
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Master Admin';

  if (!phone) {
    console.error('Set BOOTSTRAP_ADMIN_PHONE in your .env (e.g. +919999999999)');
    process.exit(1);
  }

  const result = await pool.query(
    `INSERT INTO users (phone_e164, name, role, active)
     VALUES ($1, $2, 'admin', TRUE)
     ON CONFLICT (phone_e164) DO UPDATE
       SET role = 'admin', active = TRUE
     RETURNING id, phone_e164, name, role`,
    [phone, name]
  );

  console.log('✓ admin user ready:', result.rows[0]);

  // Seed a default 'manual' lead source so the system is usable out of the box.
  await pool.query(
    `INSERT INTO lead_sources (name, slug, assignment_strategy)
     VALUES ('Manual Entry', 'manual', 'manual')
     ON CONFLICT (slug) DO NOTHING`
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
