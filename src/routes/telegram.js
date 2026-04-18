const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || '';

if (!TELEGRAM_TOKEN) {
  console.log('No Telegram token found, bot disabled');
  module.exports = { setupWebhook: () => {} };
  return;
}

// Create bot WITHOUT polling
const bot = new TelegramBot(TELEGRAM_TOKEN);
console.log('Telegram bot initialized (webhook mode)');

function isAdmin(chatId) {
  return String(chatId) === String(ADMIN_CHAT_ID);
}

// /start
bot.onText(/\/start/, (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return bot.sendMessage(msg.chat.id, '❌ Unauthorized. Your ID: ' + msg.chat.id);
  }
  bot.sendMessage(msg.chat.id,
    `🎓 *Exam Platform Bot*\n\n` +
    `📊 /stats — Dashboard stats\n` +
    `📝 /exams — List all exams\n` +
    `👨‍🎓 /students — List students\n` +
    `📋 /results — Recent results\n` +
    `🤖 /createexam <topic> [count] — AI generate exam\n` +
    `   Example: /createexam JavaScript Basics 10\n` +
    `   Default: 5 questions if no count given\n` +
    `✅ /publishexam <id> — Publish exam\n` +
    `📝 /unpublish <id> — Unpublish exam\n` +
    `🗑 /deleteexam <id> — Delete exam\n` +
    `❓ /examdetails <id> — View exam questions\n` +
    `🏆 /leaderboard — Top students\n` +
    `🆔 /chatid — Get your chat ID`,
    { parse_mode: 'Markdown' }
  );
});

// /chatid
bot.onText(/\/chatid/, (msg) => {
  bot.sendMessage(msg.chat.id, `Your Chat ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

// /stats
bot.onText(/\/stats/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const users = await db.query('SELECT COUNT(*) FROM users WHERE role = \$1', ['STUDENT']);
    const exams = await db.query('SELECT COUNT(*) FROM exams');
    const published = await db.query('SELECT COUNT(*) FROM exams WHERE status = \$1', ['PUBLISHED']);
    const attempts = await db.query('SELECT COUNT(*) FROM attempts WHERE status = \$1', ['COMPLETED']);
    const questions = await db.query('SELECT COUNT(*) FROM questions');

    const avgScore = await db.query(
      `SELECT ROUND(AVG(CASE WHEN max_score > 0 THEN (score::float / max_score) * 100 ELSE 0 END)) as avg
       FROM attempts WHERE status = 'COMPLETED'`
    );
    const avg = avgScore.rows[0].avg || 0;

    const passRate = await db.query(
      `SELECT ROUND(AVG(CASE WHEN passed THEN 100 ELSE 0 END)) as rate
       FROM attempts WHERE status = 'COMPLETED'`
    );
    const rate = passRate.rows[0].rate || 0;

    bot.sendMessage(msg.chat.id,
      `📊 *Dashboard Stats*\n\n` +
      `👨‍🎓 Students: ${users.rows[0].count}\n` +
      `📝 Total Exams: ${exams.rows[0].count}\n` +
      `✅ Published: ${published.rows[0].count}\n` +
      `📋 Completed Attempts: ${attempts.rows[0].count}\n` +
      `❓ Questions in Bank: ${questions.rows[0].count}\n` +
      `🎯 Avg Score: ${avg}%\n` +
      `✅ Pass Rate: ${rate}%`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /exams
bot.onText(/\/exams$/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query('SELECT id, title, status, total_questions FROM exams ORDER BY created_at DESC LIMIT 10');
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '📝 No exams found');
    }
    let text = '📝 *Exams:*\n\n';
    result.rows.forEach((exam, i) => {
      const shortId = exam.id.substring(0, 8);
      const icon = exam.status === 'PUBLISHED' ? '✅' : '📝';
      text += `${i + 1}. ${icon} ${exam.title}\n   Status: ${exam.status} | Qs: ${exam.total_questions}\n   ID: \`${shortId}\`\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /students
bot.onText(/\/students/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query(
      'SELECT name, email, total_attempts FROM users WHERE role = \$1 ORDER BY joined_at DESC LIMIT 20',
      ['STUDENT']
    );
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '👨‍🎓 No students found');
    }
    let text = '👨‍🎓 *Students:*\n\n';
    result.rows.forEach((s, i) => {
      text += `${i + 1}. ${s.name}\n   📧 ${s.email}\n   📋 ${s.total_attempts} attempts\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /results
bot.onText(/\/results/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query(`
      SELECT a.exam_title, u.name, a.score, a.max_score, a.passed, a.submitted_at
      FROM attempts a JOIN users u ON a.user_id = u.id
      WHERE a.status = 'COMPLETED'
      ORDER BY a.submitted_at DESC LIMIT 10
    `);
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '📊 No results yet');
    }
    let text = '📊 *Recent Results:*\n\n';
    result.rows.forEach((r, i) => {
      const icon = r.passed ? '✅' : '❌';
      const pct = r.max_score > 0 ? Math.round((r.score / r.max_score) * 100) : 0;
      text += `${i + 1}. ${r.name}\n   📝 ${r.exam_title}\n   🎯 ${r.score}/${r.max_score} (${pct}%) ${icon}\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /leaderboard
bot.onText(/\/leaderboard/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query(`
      SELECT u.name, u.email,
        COUNT(a.id) as total_exams,
        ROUND(AVG(CASE WHEN a.max_score > 0 THEN (a.score::float / a.max_score) * 100 ELSE 0 END)) as avg_score,
        SUM(CASE WHEN a.passed THEN 1 ELSE 0 END) as passed_count
      FROM users u
      JOIN attempts a ON u.id = a.user_id
      WHERE a.status = 'COMPLETED' AND u.role = 'STUDENT'
      GROUP BY u.id, u.name, u.email
      ORDER BY avg_score DESC
      LIMIT 10
    `);
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '🏆 No results yet');
    }
    let text = '🏆 *Leaderboard (Top Students):*\n\n';
    const medals = ['🥇', '🥈', '🥉'];
    result.rows.forEach((s, i) => {
      const medal = medals[i] || `${i + 1}.`;
      text += `${medal} *${s.name}*\n   📧 ${s.email}\n   🎯 Avg: ${s.avg_score}% | Exams: ${s.total_exams} | Passed: ${s.passed_count}\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /publishexam <id>
bot.onText(/\/publishexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const searchId = match[1].trim();
  try {
    const result = await db.query(
      'UPDATE exams SET status = \$1, updated_at = NOW() WHERE id::text LIKE \$2 RETURNING title, id, total_questions',
      ['PUBLISHED', searchId + '%']
    );
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ Exam not found with ID: ' + searchId);
    }
    bot.sendMessage(msg.chat.id,
      `✅ *Published!*\n\n📝 ${result.rows[0].title}\n❓ ${result.rows[0].total_questions} questions\n🔗 Students can now see this exam`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /unpublish <id>
bot.onText(/\/unpublish (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const searchId = match[1].trim();
  try {
    const result = await db.query(
      'UPDATE exams SET status = \$1, updated_at = NOW() WHERE id::text LIKE \$2 RETURNING title',
      ['DRAFT', searchId + '%']
    );
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ Exam not found');
    }
    bot.sendMessage(msg.chat.id, `📝 *Unpublished:* ${result.rows[0].title}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /deleteexam <id>
bot.onText(/\/deleteexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const searchId = match[1].trim();
  try {
    const exam = await db.query('SELECT id, title FROM exams WHERE id::text LIKE \$1', [searchId + '%']);
    if (exam.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ Exam not found with ID: ' + searchId);
    }

    const examId = exam.rows[0].id;
    const title = exam.rows[0].title;

    await db.query('DELETE FROM attempts WHERE exam_id = \$1', [examId]);
    await db.query('DELETE FROM exams WHERE id = \$1', [examId]);

    bot.sendMessage(msg.chat.id, `🗑 *Deleted:* ${title}\n(Attempts also removed)`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /examdetails <id>
bot.onText(/\/examdetails (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const searchId = match[1].trim();
  try {
    const exam = await db.query('SELECT * FROM exams WHERE id::text LIKE \$1', [searchId + '%']);
    if (exam.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ Exam not found');
    }
    const e = exam.rows[0];
    const qIds = e.question_ids || [];

    let text = `📝 *${e.title}*\n\n` +
      `📋 Status: ${e.status}\n` +
      `❓ Questions: ${e.total_questions}\n` +
      `⏱ Time: ${Math.round(e.time_limit_secs / 60)} min\n` +
      `🎯 Pass: ${e.passing_score}%\n` +
      `📊 Attempts: ${e.total_attempts}\n\n`;

    if (qIds.length > 0) {
      const questions = await db.query('SELECT type, title, difficulty, content FROM questions WHERE id = ANY(\$1)', [qIds]);
      text += `*Questions:*\n\n`;
      questions.rows.forEach((q, i) => {
        const typeIcon = q.type === 'MCQ' ? '🔵' : q.type === 'WRITE_CODE' ? '🟡' : '🟢';
        const preview = (q.title || q.content || '').substring(0, 60);
        text += `${i + 1}. ${typeIcon} [${q.type}] ${q.difficulty}\n   ${preview}...\n\n`;
      });
    } else {
      text += '⚠️ No questions linked';
    }

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// /createexam <topic> [count]
bot.onText(/\/createexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;

  const input = match[1].trim();

  let topic = input;
  let count = 5;
  const words = input.split(/\s+/);
  const lastWord = words[words.length - 1];

  if (/^\d+$/.test(lastWord)) {
    count = Math.min(Math.max(parseInt(lastWord), 1), 20);
    topic = words.slice(0, -1).join(' ');
  }

  topic = topic.replace(/\s+(questions?|qs)$/i, '').trim();

  if (!topic) {
    return bot.sendMessage(msg.chat.id, '❌ Please provide a topic.\nExample: `/createexam JavaScript Basics 10`', { parse_mode: 'Markdown' });
  }

  // Split count across question types: 50% MCQ, 30% CODE, 20% EXPLAIN
  const mcqCount = Math.max(1, Math.round(count * 0.5));
  const codeCount = Math.max(1, Math.round(count * 0.3));
  const explainCount = Math.max(0, count - mcqCount - codeCount);

  bot.sendMessage(msg.chat.id,
    `🤖 Generating exam on *"${topic}"*...\n` +
    `❓ ${count} questions (MCQ: ${mcqCount}, Code: ${codeCount}, Explain: ${explainCount})\n` +
    `⏳ This takes 30-60 seconds`,
    { parse_mode: 'Markdown' }
  );

  try {
    const aiService = require('../services/aiService');

    const questions = await aiService.generateQuestions({
      topic: topic,
      difficulty: 'MEDIUM',
      mcqCount: mcqCount,
      codeCount: codeCount,
      explainCount: explainCount
    });

    console.log(`[Telegram] AI returned ${questions.length} questions`);

    if (!questions || questions.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ AI returned no questions. Try again or use a different topic.');
    }

    const questionIds = [];
    let inserted = 0;
    let failed = 0;

    for (const q of questions) {
      try {
        const result = await db.query(
          `INSERT INTO questions (type, title, topic, difficulty, content, options, correct_option, explanation, model_answer, starter_code, expected_output, points)
           VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12) RETURNING id`,
          [
            q.type || 'MCQ',
            q.title || (q.content || '').substring(0, 100),
            topic,
            q.difficulty || 'MEDIUM',
            q.content || '',
            JSON.stringify(q.options || []),
            q.correct_option != null ? q.correct_option : null,
            q.explanation || '',
            q.model_answer || '',
            q.starter_code || '',
            q.expected_output || '',
            q.points || 10
          ]
        );
        questionIds.push(result.rows[0].id);
        inserted++;
      } catch (insertErr) {
        console.error(`[Telegram] Failed to insert question:`, insertErr.message);
        failed++;
      }
    }

    console.log(`[Telegram] Inserted ${inserted} questions, failed ${failed}`);

    if (questionIds.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ AI generated questions but all failed to save. Check logs.');
    }

    const timePerQ = 2 * 60;
    const timeLimitSecs = Math.max(questionIds.length * timePerQ, 600);

    const examResult = await db.query(
      `INSERT INTO exams (title, description, status, time_limit_secs, total_questions, passing_score, question_ids)
       VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7) RETURNING id, title`,
      [
        `${topic} Exam`,
        `AI-generated exam on ${topic} with ${questionIds.length} questions`,
        'DRAFT',
        timeLimitSecs,
        questionIds.length,
        60,
        JSON.stringify(questionIds)
      ]
    );

    const shortId = examResult.rows[0].id.substring(0, 8);
    const timeMin = Math.round(timeLimitSecs / 60);

    const typeCounts = {};
    questions.forEach(q => {
      const t = q.type || 'MCQ';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const typeStr = Object.entries(typeCounts).map(([k, v]) => `${k}: ${v}`).join(', ');

    let resultMsg =
      `✅ *Exam Created!*\n\n` +
      `📝 ${examResult.rows[0].title}\n` +
      `❓ ${questionIds.length} questions\n` +
      `📊 Types: ${typeStr}\n` +
      `⏱ ${timeMin} minutes\n` +
      `🎯 Pass: 60%\n` +
      `📋 Status: DRAFT\n` +
      `🆔 ID: \`${shortId}\`\n\n` +
      `To publish: /publishexam ${shortId}\n` +
      `To view: /examdetails ${shortId}\n` +
      `To delete: /deleteexam ${shortId}`;

    if (failed > 0) {
      resultMsg += `\n\n⚠️ ${failed} questions failed to save`;
    }

    bot.sendMessage(msg.chat.id, resultMsg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[Telegram] createexam error:', err);
    bot.sendMessage(msg.chat.id, '❌ Failed: ' + err.message);
  }
});

// Setup webhook route on Express app
function setupWebhook(app) {
  const webhookPath = `/api/telegram/webhook`;

  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  // Set webhook URL with Telegram
  const backendUrl = process.env.BACKEND_URL || 'https://exam-platform-server.onrender.com';
  const webhookUrl = `${backendUrl}${webhookPath}`;

  bot.setWebHook(webhookUrl)
    .then(() => console.log(`Telegram webhook set: ${webhookUrl}`))
    .catch(err => console.error('Failed to set webhook:', err.message));
}

module.exports = { bot, setupWebhook };