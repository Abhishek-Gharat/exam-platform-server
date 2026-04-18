const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

if (!TELEGRAM_TOKEN) {
  console.log('No Telegram token found, bot disabled');
  module.exports = null;
  return;
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('Telegram bot started');

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
    `📊 /stats - Dashboard stats\n` +
    `📝 /exams - List exams\n` +
    `👨‍🎓 /students - List students\n` +
    `📋 /results - Recent results\n` +
    `🤖 /createexam <topic> - AI generate exam\n` +
    `✅ /publishexam <id> - Publish exam\n` +
    `📝 /unpublish <id> - Unpublish exam\n` +
    `🆔 /chatid - Get your chat ID`,
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

    bot.sendMessage(msg.chat.id,
      `📊 *Dashboard Stats*\n\n` +
      `👨‍🎓 Students: ${users.rows[0].count}\n` +
      `📝 Total Exams: ${exams.rows[0].count}\n` +
      `✅ Published: ${published.rows[0].count}\n` +
      `📋 Completed Attempts: ${attempts.rows[0].count}\n` +
      `❓ Questions: ${questions.rows[0].count}`,
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
      text += `${i + 1}. ${r.name}\n   📝 ${r.exam_title}\n   🎯 Score: ${r.score}/${r.max_score} ${icon}\n\n`;
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
      'UPDATE exams SET status = \$1, updated_at = NOW() WHERE id::text LIKE \$2 RETURNING title, id',
      ['PUBLISHED', searchId + '%']
    );
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ Exam not found with ID: ' + searchId);
    }
    bot.sendMessage(msg.chat.id, `✅ *Published:* ${result.rows[0].title}`, { parse_mode: 'Markdown' });
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

// /createexam <topic>
bot.onText(/\/createexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const topic = match[1].trim();
  bot.sendMessage(msg.chat.id, `🤖 Generating exam on *"${topic}"*...\n⏳ This takes 30-60 seconds`, { parse_mode: 'Markdown' });

  try {
    const aiService = require('../services/aiService');
    const questions = await aiService.generateQuestions({
      topic: topic,
      count: 10,
      difficulty: 'MIXED',
      types: ['MCQ', 'WRITE_CODE', 'EXPLAIN_ME']
    });

    const questionIds = [];
    for (const q of questions) {
      const result = await db.query(
        `INSERT INTO questions (type, title, topic, difficulty, content, options, correct_option, explanation, model_answer, starter_code, expected_output, points)
         VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12) RETURNING id`,
        [
          q.type,
          q.title || q.content.substring(0, 100),
          topic,
          q.difficulty || 'MEDIUM',
          q.content,
          JSON.stringify(q.options || []),
          q.correct_option,
          q.explanation,
          q.model_answer,
          q.starter_code,
          q.expected_output,
          q.points || 10
        ]
      );
      questionIds.push(result.rows[0].id);
    }

    const examResult = await db.query(
      `INSERT INTO exams (title, description, status, time_limit_secs, total_questions, passing_score, question_ids)
       VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7) RETURNING id, title`,
      [
        `${topic} Exam`,
        `AI-generated exam on ${topic}`,
        'DRAFT',
        1800,
        questionIds.length,
        60,
        JSON.stringify(questionIds)
      ]
    );

    const shortId = examResult.rows[0].id.substring(0, 8);
    bot.sendMessage(msg.chat.id,
      `✅ *Exam Created!*\n\n` +
      `📝 ${examResult.rows[0].title}\n` +
      `❓ ${questionIds.length} questions\n` +
      `⏱ 30 minutes\n` +
      `📋 Status: DRAFT\n` +
      `🆔 ID: \`${shortId}\`\n\n` +
      `To publish: /publishexam ${shortId}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Failed: ' + err.message);
  }
});

module.exports = bot;