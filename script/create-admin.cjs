// init-users-direct.js
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const pool = new Pool({
  host: process.env.DB_HOST || '192.168.1.200',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'scormDb',
  user: process.env.DB_USER || 'scormDbUser',
  password: process.env.DB_PASSWORD || 'sc0rmDbUserP@ssword',
});

async function createUsers() {
  const client = await pool.connect();
  
  try {
    const users = [
      { email: 'admin@rt.ru', password: 'admin123', name: 'Администратор', role: 'author' },
      { email: 'learner@test.com', password: 'learner123', name: 'Тестовый ученик', role: 'learner' },
      { email: 'zubkov.evgeniy@rt.ru', password: 'learner123', name: 'Ирина Зубкова', role: 'learner' },
    ];

    console.log('Создание тестовых пользователей...\n');

    for (const user of users) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      const emailHash = crypto.createHash('sha256').update(user.email).digest('hex');
      
      // Простое шифрование email (в проде используйте pgcrypto)
      const emailEncrypted = Buffer.from(user.email).toString('base64');

      const query = `
        INSERT INTO users (
          id, email, email_hash, password_hash, name, role, 
          status, must_change_password, gdpr_consent, 
          gdpr_consent_at, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, 
          'active', false, true, NOW(), NOW()
        ) ON CONFLICT (email_hash) DO NOTHING
        RETURNING id, name, role;
      `;

      const values = [emailEncrypted, emailHash, passwordHash, user.name, user.role];
      
      const result = await client.query(query, values);
      
      if (result.rows.length > 0) {
        console.log(`✅ Создан: ${user.name} (${user.email})`);
        console.log(`   ID: ${result.rows[0].id}, Роль: ${result.rows[0].role}\n`);
      } else {
        console.log(`ℹ️  Уже существует: ${user.name} (${user.email})\n`);
      }
    }

    console.log('Готово! Проверка списка пользователей:');
    
    const checkQuery = `
      SELECT 
        id, 
        name, 
        role, 
        status,
        TO_CHAR(created_at, 'DD.MM.YYYY HH24:MI') as created
      FROM users 
      ORDER BY created_at;
    `;
    
    const checkResult = await client.query(checkQuery);
    console.table(checkResult.rows);

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

createUsers();