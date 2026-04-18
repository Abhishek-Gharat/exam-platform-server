const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');
const aiService = require('../services/aiService');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID);
const backendUrl = process.env.BACKEND_URL || 'https://exam-platform-server.onrender.com';

const bot = new TelegramBot(TELEGRAM_TOKEN);

function isAdmin(chatId) {
  return chatId === ADMIN_CHAT_ID;
}

// Helper: find exam by short ID prefix
async function findExamByShortId(shortId) {
  const result = await db.query(
    `SELECT * FROM exams WHERE id::text LIKE \$1`,
    [shortId + '%']
  );
  return result.rows[0] || null;
}

// Helper: find question by short ID prefix
async function findQuestionByShortId(shortId) {
  const result = await db.query(
    `SELECT * FROM questions WHERE id::text LIKE \$1`,
    [shortId + '%']
  );
  return result.rows[0] || null;
}

// ========================================
// /start — Show all commands
// ========================================
bot.onText(/\/start/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id,
    `🎓 *Exam Platform Bot*\n\n` +
    `📊 *Dashboard:*\n` +
    `/stats — Platform statistics\n` +
    `/exams — List all exams\n` +
    `/students — List all students\n` +
    `/results — Recent results\n` +
    `/leaderboard — Top students\n\n` +
    `🤖 *Create Exam:*\n` +
    `/createexam <topic> [options]\n` +
    `  Options: mcq=N code=N explain=N\n` +
    `  time=N pass=N lang=<language>\n\n` +
    `📝 *Manage Exams:*\n` +
    `/examdetails <id> — View questions\n` +
    `/editexam <id> [key=value] — Edit exam\n` +
    `/publishexam <id> — Publish exam\n` +
    `/unpublish <id> — Unpublish exam\n` +
    `/deleteexam <id> — Delete exam\n\n` +
    `❓ *Manage Questions:*\n` +
    `/viewq <id> — View question details\n` +
    `/editq <id> <field> <value> — Edit question\n` +
    `/deleteq <id> — Delete question\n\n` +
    `🔧 *Utility:*\n` +
    `/chatid — Get your chat ID`,
    { parse_mode: 'Markdown' }
  );
});

// ========================================
// /chatid
// ========================================
bot.onText(/\/chatid/, (msg) => {
  bot.sendMessage(msg.chat.id, `Your Chat ID: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

// ========================================
// /stats — Dashboard statistics
// ========================================
bot.onText(/\/stats/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const students = await db.query(`SELECT COUNT(*) FROM users WHERE role = 'STUDENT'`);
    const exams = await db.query(`SELECT COUNT(*) FROM exams`);
    const questions = await db.query(`SELECT COUNT(*) FROM questions`);
    const attempts = await db.query(`SELECT COUNT(*) FROM attempts WHERE status = 'COMPLETED'`);
    const avgScore = await db.query(`SELECT ROUND(AVG(score)::numeric, 1) as avg FROM attempts WHERE status = 'COMPLETED'`);
    const passRate = await db.query(`SELECT ROUND(COUNT(*) FILTER(WHERE passed = true) * 100.0 / NULLIF(COUNT(*), 0), 1) as rate FROM attempts WHERE status = 'COMPLETED'`);

    bot.sendMessage(msg.chat.id,
      `📊 *Platform Stats*\n\n` +
      `👥 Students: ${students.rows[0].count}\n` +
      `📝 Exams: ${exams.rows[0].count}\n` +
      `❓ Questions: ${questions.rows[0].count}\n` +
      `📋 Attempts: ${attempts.rows[0].count}\n` +
      `📈 Avg Score: ${avgScore.rows[0].avg || 0}%\n` +
      `✅ Pass Rate: ${passRate.rows[0].rate || 0}%`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /exams — List all exams
// ========================================
bot.onText(/\/exams/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query(`SELECT id, title, status, total_questions, time_limit_secs, passing_score FROM exams ORDER BY created_at DESC LIMIT 20`);
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '📭 No exams yet.');
    }
    let text = '📝 *All Exams:*\n\n';
    result.rows.forEach((e, i) => {
      const icon = e.status === 'PUBLISHED' ? '🟢' : '🔴';
      const shortId = e.id.substring(0, 8);
      const timeMin = Math.round(e.time_limit_secs / 60);
      text += `${i + 1}. ${icon} *${e.title}*\n`;
      text += `   ❓ ${e.total_questions} questions | ⏱ ${timeMin}min | 🎯 ${e.passing_score}%\n`;
      text += `   🆔 \`${shortId}\`\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /students — List all students
// ========================================
bot.onText(/\/students/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query(`SELECT name, email, total_attempts FROM users WHERE role = 'STUDENT' ORDER BY joined_at DESC LIMIT 20`);
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '📭 No students yet.');
    }
    let text = '👥 *Students:*\n\n';
    result.rows.forEach((s, i) => {
      text += `${i + 1}. *${s.name}* — ${s.email} (${s.total_attempts} attempts)\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /results — Recent exam results
// ========================================
bot.onText(/\/results/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query(
      `SELECT a.score, a.passed, a.exam_title, a.submitted_at, u.name
       FROM attempts a JOIN users u ON a.user_id = u.id
       WHERE a.status = 'COMPLETED'
       ORDER BY a.submitted_at DESC LIMIT 15`
    );
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '📭 No results yet.');
    }
    let text = '📋 *Recent Results:*\n\n';
    result.rows.forEach((r, i) => {
      const icon = r.passed ? '✅' : '❌';
      text += `${i + 1}. ${icon} *${r.name}* — ${r.exam_title}\n   Score: ${r.score}%\n\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /leaderboard — Top students
// ========================================
bot.onText(/\/leaderboard/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const result = await db.query(
      `SELECT u.name, ROUND(AVG(a.score)::numeric, 1) as avg_score, COUNT(a.id) as total
       FROM attempts a JOIN users u ON a.user_id = u.id
       WHERE a.status = 'COMPLETED'
       GROUP BY u.id, u.name
       ORDER BY avg_score DESC LIMIT 10`
    );
    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, '📭 No data yet.');
    }
    const medals = ['🥇', '🥈', '🥉'];
    let text = '🏆 *Leaderboard:*\n\n';
    result.rows.forEach((r, i) => {
      const medal = medals[i] || `${i + 1}.`;
      text += `${medal} *${r.name}* — ${r.avg_score}% avg (${r.total} exams)\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /createexam <topic> [mcq=N] [code=N] [explain=N] [time=N] [pass=N] [lang=X]
// ========================================
bot.onText(/\/createexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;

  const input = match[1].trim();
  const words = input.split(/\s+/);

  let mcqCount = null;
  let codeCount = null;
  let explainCount = null;
  let timeMin = null;
  let passScore = null;
  let language = null;
  const topicWords = [];

  for (const word of words) {
    if (/^mcq=\d+$/i.test(word)) {
      mcqCount = parseInt(word.split('=')[1]);
    } else if (/^code=\d+$/i.test(word)) {
      codeCount = parseInt(word.split('=')[1]);
    } else if (/^explain=\d+$/i.test(word)) {
      explainCount = parseInt(word.split('=')[1]);
    } else if (/^time=\d+$/i.test(word)) {
      timeMin = parseInt(word.split('=')[1]);
    } else if (/^pass=\d+$/i.test(word)) {
      passScore = parseInt(word.split('=')[1]);
    } else if (/^lang=\S+$/i.test(word)) {
      language = word.split('=')[1].trim();
    } else {
      topicWords.push(word);
    }
  }

  // If last topic word is a number and no key=value params, treat as total count
  let totalFromNumber = null;
  if (topicWords.length > 0 && mcqCount === null && codeCount === null && explainCount === null) {
    const lastWord = topicWords[topicWords.length - 1];
    if (/^\d+$/.test(lastWord)) {
      totalFromNumber = parseInt(lastWord);
      topicWords.pop();
    }
  }

  let topic = topicWords.join(' ').replace(/\s+(questions?|qs)$/i, '').trim();

  if (!topic) {
    return bot.sendMessage(msg.chat.id,
      `❌ Please provide a topic.\n\n` +
      `*Usage:*\n` +
      `\`/createexam JavaScript Basics\`\n` +
      `\`/createexam JavaScript Basics 10\`\n` +
      `\`/createexam JavaScript Basics mcq=5 code=3 explain=2\`\n` +
      `\`/createexam Python lang=python mcq=5 code=3\`\n` +
      `\`/createexam React Hooks mcq=10 time=60 pass=80 lang=javascript\`\n\n` +
      `*Parameters:*\n` +
      `• \`mcq=N\` — MCQ questions\n` +
      `• \`code=N\` — WRITE\\_CODE questions\n` +
      `• \`explain=N\` — EXPLAIN\\_ME questions\n` +
      `• \`time=N\` — time limit (minutes)\n` +
      `• \`pass=N\` — passing score %\n` +
      `• \`lang=X\` — programming language (javascript, python, java, etc.)`,
      { parse_mode: 'Markdown' }
    );
  }

  // Determine question counts
  if (mcqCount !== null || codeCount !== null || explainCount !== null) {
    mcqCount = mcqCount || 0;
    codeCount = codeCount || 0;
    explainCount = explainCount || 0;
  } else if (totalFromNumber) {
    const total = Math.min(Math.max(totalFromNumber, 1), 20);
    mcqCount = Math.max(1, Math.round(total * 0.5));
    codeCount = Math.max(1, Math.round(total * 0.3));
    explainCount = Math.max(0, total - mcqCount - codeCount);
  } else {
    mcqCount = 3;
    codeCount = 1;
    explainCount = 1;
  }

  mcqCount = Math.min(Math.max(mcqCount, 0), 15);
  codeCount = Math.min(Math.max(codeCount, 0), 10);
  explainCount = Math.min(Math.max(explainCount, 0), 10);
  const totalCount = mcqCount + codeCount + explainCount;

  if (totalCount === 0) return bot.sendMessage(msg.chat.id, '❌ Total questions must be at least 1.');
  if (totalCount > 20) return bot.sendMessage(msg.chat.id, '❌ Maximum 20 questions. Reduce the count.');

  if (!timeMin) timeMin = Math.max(10, totalCount * 2);
  timeMin = Math.min(Math.max(timeMin, 5), 180);
  if (!passScore) passScore = 60;
  passScore = Math.min(Math.max(passScore, 10), 100);

  const timeLimitSecs = timeMin * 60;
  const langDisplay = language ? language.charAt(0).toUpperCase() + language.slice(1) : 'Auto';

  bot.sendMessage(msg.chat.id,
    `🤖 Generating exam on *"${topic}"*...\n\n` +
    `❓ Questions: ${totalCount}\n` +
    `🔵 MCQ: ${mcqCount} | 🟡 Code: ${codeCount} | 🟢 Explain: ${explainCount}\n` +
    `💻 Language: ${langDisplay}\n` +
    `⏱ Time: ${timeMin} min | 🎯 Pass: ${passScore}%\n\n` +
    `⏳ This takes 30-60 seconds...`,
    { parse_mode: 'Markdown' }
  );

  try {
    console.log(`[Telegram] Creating exam: topic=${topic}, lang=${language}, MCQ=${mcqCount}, CODE=${codeCount}, EXPLAIN=${explainCount}`);

    const questions = await aiService.generateQuestions({
      topic,
      difficulty: 'MEDIUM',
      mcqCount,
      codeCount,
      explainCount,
      language: language || null
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
        console.error(`[Telegram] Insert fail:`, insertErr.message);
        failed++;
      }
    }

    if (questionIds.length === 0) {
      return bot.sendMessage(msg.chat.id, '❌ All questions failed to save. Check logs.');
    }

    const examResult = await db.query(
      `INSERT INTO exams (title, description, status, time_limit_secs, total_questions, passing_score, question_ids)
       VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7) RETURNING id, title`,
      [
        `${topic} Exam`,
        `AI-generated exam on ${topic} (${langDisplay}) with ${questionIds.length} questions`,
        'DRAFT',
        timeLimitSecs,
        questionIds.length,
        passScore,
        JSON.stringify(questionIds)
      ]
    );

    const shortId = examResult.rows[0].id.substring(0, 8);

    const typeCounts = {};
    questions.forEach(q => {
      const t = q.type || 'MCQ';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const typeStr = Object.entries(typeCounts).map(([k, v]) => {
      const icon = k === 'MCQ' ? '🔵' : k === 'WRITE_CODE' ? '🟡' : '🟢';
      return `${icon} ${k}: ${v}`;
    }).join('\n');

    let resultMsg =
      `✅ *Exam Created!*\n\n` +
      `📝 ${examResult.rows[0].title}\n` +
      `💻 Language: ${langDisplay}\n` +
      `❓ ${questionIds.length} questions\n` +
      `${typeStr}\n` +
      `⏱ ${timeMin} min | 🎯 Pass: ${passScore}%\n` +
      `📋 Status: DRAFT\n` +
      `🆔 \`${shortId}\`\n\n` +
      `▶️ /publishexam ${shortId}\n` +
      `👁 /examdetails ${shortId}\n` +
      `✏️ /editexam ${shortId} title=... time=N pass=N\n` +
      `🗑 /deleteexam ${shortId}`;

    if (failed > 0) resultMsg += `\n\n⚠️ ${failed} questions failed to save`;

    bot.sendMessage(msg.chat.id, resultMsg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[Telegram] createexam error:', err);
    bot.sendMessage(msg.chat.id, '❌ Failed: ' + err.message);
  }
});

// ========================================
// /publishexam <id>
// ========================================
bot.onText(/\/publishexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const exam = await findExamByShortId(match[1].trim());
    if (!exam) return bot.sendMessage(msg.chat.id, '❌ Exam not found.');

    await db.query(`UPDATE exams SET status = 'PUBLISHED', updated_at = NOW() WHERE id = \$1`, [exam.id]);
    bot.sendMessage(msg.chat.id,
      `🟢 *Published!*\n📝 ${exam.title}\n🆔 \`${exam.id.substring(0, 8)}\`\n\nStudents can now take this exam.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /unpublish <id>
// ========================================
bot.onText(/\/unpublish (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const exam = await findExamByShortId(match[1].trim());
    if (!exam) return bot.sendMessage(msg.chat.id, '❌ Exam not found.');

    await db.query(`UPDATE exams SET status = 'DRAFT', updated_at = NOW() WHERE id = \$1`, [exam.id]);
    bot.sendMessage(msg.chat.id,
      `🔴 *Unpublished!*\n📝 ${exam.title}\n🆔 \`${exam.id.substring(0, 8)}\`\n\nExam is now in DRAFT.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /editexam <id> [title=...] [time=N] [pass=N] [status=DRAFT/PUBLISHED]
// ========================================
bot.onText(/\/editexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;

  const input = match[1].trim();
  const words = input.split(/\s+/);
  const shortId = words[0];

  try {
    const exam = await findExamByShortId(shortId);
    if (!exam) return bot.sendMessage(msg.chat.id, '❌ Exam not found.');

    // If no params, show current values
    if (words.length === 1) {
      const timeMin = Math.round(exam.time_limit_secs / 60);
      return bot.sendMessage(msg.chat.id,
        `✏️ *Edit Exam:* ${exam.title}\n\n` +
        `*Current values:*\n` +
        `📝 Title: ${exam.title}\n` +
        `⏱ Time: ${timeMin} min\n` +
        `🎯 Pass: ${exam.passing_score}%\n` +
        `📋 Status: ${exam.status}\n` +
        `❓ Questions: ${exam.total_questions}\n` +
        `🆔 \`${exam.id.substring(0, 8)}\`\n\n` +
        `*Edit with:*\n` +
        `\`/editexam ${shortId} title=New Title\`\n` +
        `\`/editexam ${shortId} time=30\`\n` +
        `\`/editexam ${shortId} pass=70\`\n` +
        `\`/editexam ${shortId} time=45 pass=80\`\n` +
        `\`/editexam ${shortId} status=PUBLISHED\``,
        { parse_mode: 'Markdown' }
      );
    }

    // Parse params
    const rest = input.substring(shortId.length).trim();
    let newTitle = null;
    let newTime = null;
    let newPass = null;
    let newStatus = null;

    // Extract title= (can contain spaces, so grab everything after title= until next param)
    const titleMatch = rest.match(/title=([^]*?)(?=\s+(?:time|pass|status)=|$)/i);
    if (titleMatch) {
      newTitle = titleMatch[1].trim();
    }

    const timeMatch = rest.match(/time=(\d+)/i);
    if (timeMatch) newTime = parseInt(timeMatch[1]);

    const passMatch = rest.match(/pass=(\d+)/i);
    if (passMatch) newPass = parseInt(passMatch[1]);

    const statusMatch = rest.match(/status=(DRAFT|PUBLISHED)/i);
    if (statusMatch) newStatus = statusMatch[1].toUpperCase();

    if (!newTitle && !newTime && !newPass && !newStatus) {
      return bot.sendMessage(msg.chat.id,
        `❌ No valid parameters.\n\nUse: \`/editexam ${shortId} title=... time=N pass=N status=DRAFT/PUBLISHED\``,
        { parse_mode: 'Markdown' }
      );
    }

    // Build update query
    const updates = [];
    const values = [];
    let idx = 1;

    if (newTitle) {
      updates.push(`title = 
$$
{idx++}`);
      values.push(newTitle);
    }
    if (newTime) {
      const clamped = Math.min(Math.max(newTime, 5), 180);
      updates.push(`time_limit_secs =
$$
{idx++}`);
      values.push(clamped * 60);
    }
    if (newPass) {
      const clamped = Math.min(Math.max(newPass, 10), 100);
      updates.push(`passing_score = 
$$
{idx++}`);
      values.push(clamped);
    }
    if (newStatus) {
      updates.push(`status =
$$
{idx++}`);
      values.push(newStatus);
    }
    updates.push(`updated_at = NOW()`);

    values.push(exam.id);
    await db.query(
      `UPDATE exams SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    const changes = [];
    if (newTitle) changes.push(`📝 Title → ${newTitle}`);
    if (newTime) changes.push(`⏱ Time → ${newTime} min`);
    if (newPass) changes.push(`🎯 Pass → ${newPass}%`);
    if (newStatus) changes.push(`📋 Status → ${newStatus}`);

    bot.sendMessage(msg.chat.id,
      `✅ *Exam Updated!*\n\n` +
      `${changes.join('\n')}\n\n` +
      `🆔 \`${exam.id.substring(0, 8)}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /examdetails <id> — View all questions in exam
// ========================================
bot.onText(/\/examdetails (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const exam = await findExamByShortId(match[1].trim());
    if (!exam) return bot.sendMessage(msg.chat.id, '❌ Exam not found.');

    const qIds = exam.question_ids || [];
    if (qIds.length === 0) return bot.sendMessage(msg.chat.id, '📭 No questions in this exam.');

    const result = await db.query(
      `SELECT id, type, content, difficulty, points FROM questions WHERE id = ANY(\$1)`,
      [qIds]
    );

    const timeMin = Math.round(exam.time_limit_secs / 60);
    let text = `📝 *${exam.title}*\n`;
    text += `📋 ${exam.status} | ⏱ ${timeMin}min | 🎯 ${exam.passing_score}%\n`;
    text += `❓ ${result.rows.length} questions\n\n`;

    result.rows.forEach((q, i) => {
      const icon = q.type === 'MCQ' ? '🔵' : q.type === 'WRITE_CODE' ? '🟡' : '🟢';
      const shortQId = q.id.substring(0, 8);
      const preview = (q.content || '').substring(0, 80).replace(/\n/g, ' ');
      text += `${i + 1}. ${icon} *${q.type}* (${q.difficulty}, ${q.points}pts)\n`;
      text += `   ${preview}${q.content && q.content.length > 80 ? '...' : ''}\n`;
      text += `   🆔 \`${shortQId}\` — /viewq ${shortQId}\n\n`;
    });

    // Split long messages (Telegram limit 4096 chars)
    if (text.length > 4000) {
      const mid = text.lastIndexOf('\n\n', 2000);
      bot.sendMessage(msg.chat.id, text.substring(0, mid), { parse_mode: 'Markdown' });
      bot.sendMessage(msg.chat.id, text.substring(mid), { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /viewq <id> — View full question details
// ========================================
bot.onText(/\/viewq (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const q = await findQuestionByShortId(match[1].trim());
    if (!q) return bot.sendMessage(msg.chat.id, '❌ Question not found.');

    const shortId = q.id.substring(0, 8);
    const icon = q.type === 'MCQ' ? '🔵' : q.type === 'WRITE_CODE' ? '🟡' : '🟢';

    let text = `${icon} *${q.type}* — ${q.difficulty} (${q.points}pts)\n`;
    text += `📂 Topic: ${q.topic || 'N/A'}\n`;
    text += `🆔 \`${shortId}\`\n\n`;
    text += `*Question:*\n${q.content}\n\n`;

    // Show options for MCQ and WRITE_CODE
    const options = q.options || [];
    if (options.length > 0) {
      text += `*Options:*\n`;
      options.forEach((opt, i) => {
        const label = opt.label || String.fromCharCode(65 + i);
        const optText = opt.text || opt;
        const isCorrect = i === q.correct_option ? ' ✅' : '';
        text += `  ${label}. ${optText}${isCorrect}\n`;
      });
      text += `\n`;
    }

    if (q.correct_option != null) {
      text += `✅ Correct: Option ${String.fromCharCode(65 + q.correct_option)}\n`;
    }
    if (q.explanation) {
      text += `💡 *Explanation:* ${q.explanation}\n`;
    }
    if (q.model_answer) {
      text += `📝 *Model Answer:* ${q.model_answer}\n`;
    }
    if (q.starter_code) {
      text += `\n💻 *Code:*\n\`\`\`\n${q.starter_code}\n\`\`\`\n`;
    }

    text += `\n*Edit:*\n`;
    text += `/editq ${shortId} content New question text\n`;
    text += `/editq ${shortId} correct 0-3 (A=0 B=1 C=2 D=3)\n`;
    text += `/editq ${shortId} option\\_a New option A text\n`;
    text += `/editq ${shortId} explanation New explanation\n`;
    text += `/editq ${shortId} difficulty EASY/MEDIUM/HARD\n`;
    text += `/editq ${shortId} points 20\n`;
    text += `/deleteq ${shortId}`;

    if (text.length > 4000) {
      const mid = text.lastIndexOf('\n\n', 2000);
      bot.sendMessage(msg.chat.id, text.substring(0, mid), { parse_mode: 'Markdown' });
      bot.sendMessage(msg.chat.id, text.substring(mid), { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /editq <id> <field> <value> — Edit a question
// Fields: content, option_a, option_b, option_c, option_d, correct, explanation, model_answer, difficulty, points, code
// ========================================
bot.onText(/\/editq (\S+)\s+(\S+)\s+([\s\S]+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;

  const shortId = match[1].trim();
  const field = match[2].trim().toLowerCase();
  const value = match[3].trim();

  try {
    const q = await findQuestionByShortId(shortId);
    if (!q) return bot.sendMessage(msg.chat.id, '❌ Question not found.');

    let updateQuery = '';
    let updateValue = value;
    let displayField = field;

    switch (field) {
      case 'content':
        updateQuery = `UPDATE questions SET content = \$1, updated_at = NOW() WHERE id = \$2`;
        displayField = 'Content';
        break;

      case 'option_a':
      case 'option_b':
      case 'option_c':
      case 'option_d': {
        const optIndex = field.charCodeAt(7) - 97; // a=0, b=1, c=2, d=3
        const options = q.options || [];
        while (options.length <= optIndex) {
          options.push({ label: String.fromCharCode(65 + options.length), text: '' });
        }
        options[optIndex] = { label: String.fromCharCode(65 + optIndex), text: value };
        updateQuery = `UPDATE questions SET options = \$1, updated_at = NOW() WHERE id = \$2`;
        updateValue = JSON.stringify(options);
        displayField = `Option ${field.charAt(7).toUpperCase()}`;
        break;
      }

      case 'correct': {
        const num = parseInt(value);
        if (isNaN(num) || num < 0 || num > 3) {
          return bot.sendMessage(msg.chat.id, '❌ Correct option must be 0-3 (A=0, B=1, C=2, D=3)');
        }
        updateQuery = `UPDATE questions SET correct_option = \$1, updated_at = NOW() WHERE id = \$2`;
        updateValue = num;
        displayField = `Correct Answer → ${String.fromCharCode(65 + num)}`;
        break;
      }

      case 'explanation':
        updateQuery = `UPDATE questions SET explanation = \$1, updated_at = NOW() WHERE id = \$2`;
        displayField = 'Explanation';
        break;

      case 'model_answer':
        updateQuery = `UPDATE questions SET model_answer = \$1, updated_at = NOW() WHERE id = \$2`;
        displayField = 'Model Answer';
        break;

      case 'difficulty': {
        const diff = value.toUpperCase();
        if (!['EASY', 'MEDIUM', 'HARD'].includes(diff)) {
          return bot.sendMessage(msg.chat.id, '❌ Difficulty must be EASY, MEDIUM, or HARD');
        }
        updateQuery = `UPDATE questions SET difficulty = \$1, updated_at = NOW() WHERE id = \$2`;
        updateValue = diff;
        displayField = 'Difficulty';
        break;
      }

      case 'points': {
        const pts = parseInt(value);
        if (isNaN(pts) || pts < 1 || pts > 100) {
          return bot.sendMessage(msg.chat.id, '❌ Points must be 1-100');
        }
        updateQuery = `UPDATE questions SET points = \$1, updated_at = NOW() WHERE id = \$2`;
        updateValue = pts;
        displayField = 'Points';
        break;
      }

      case 'code':
        updateQuery = `UPDATE questions SET starter_code = \$1, updated_at = NOW() WHERE id = \$2`;
        displayField = 'Code Snippet';
        break;

      case 'title':
        updateQuery = `UPDATE questions SET title = \$1, updated_at = NOW() WHERE id = \$2`;
        displayField = 'Title';
        break;

      case 'topic':
        updateQuery = `UPDATE questions SET topic = \$1, updated_at = NOW() WHERE id = \$2`;
        displayField = 'Topic';
        break;

      case 'type': {
        const t = value.toUpperCase();
        if (!['MCQ', 'WRITE_CODE', 'EXPLAIN_ME'].includes(t)) {
          return bot.sendMessage(msg.chat.id, '❌ Type must be MCQ, WRITE\\_CODE, or EXPLAIN\\_ME');
        }
        updateQuery = `UPDATE questions SET type = \$1, updated_at = NOW() WHERE id = \$2`;
        updateValue = t;
        displayField = 'Type';
        break;
      }

      default:
        return bot.sendMessage(msg.chat.id,
          `❌ Unknown field: \`${field}\`\n\n` +
          `*Available fields:*\n` +
          `content, option\\_a, option\\_b, option\\_c, option\\_d,\n` +
          `correct (0-3), explanation, model\\_answer,\n` +
          `difficulty, points, code, title, topic, type`,
          { parse_mode: 'Markdown' }
        );
    }

    await db.query(updateQuery, [updateValue, q.id]);

    bot.sendMessage(msg.chat.id,
      `✅ *Question Updated!*\n\n` +
      `📝 ${displayField} changed\n` +
      `🆔 \`${q.id.substring(0, 8)}\`\n\n` +
      `View: /viewq ${q.id.substring(0, 8)}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /deleteq <id> — Delete a question (and remove from exams)
// ========================================
bot.onText(/\/deleteq (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const q = await findQuestionByShortId(match[1].trim());
    if (!q) return bot.sendMessage(msg.chat.id, '❌ Question not found.');

    // Remove from any exams that reference this question
    const examsWithQ = await db.query(
      `SELECT id, title, question_ids FROM exams WHERE question_ids::jsonb @> \$1::jsonb`,
      [JSON.stringify([q.id])]
    );

    for (const exam of examsWithQ.rows) {
      const newIds = (exam.question_ids || []).filter(qid => qid !== q.id);
      await db.query(
        `UPDATE exams SET question_ids = \$1, total_questions = \$2, updated_at = NOW() WHERE id = \$3`,
        [JSON.stringify(newIds), newIds.length, exam.id]
      );
    }

    // Delete the question
    await db.query(`DELETE FROM questions WHERE id = \$1`, [q.id]);

    const preview = (q.content || '').substring(0, 60);
    let text = `🗑 *Question Deleted!*\n\n`;
    text += `${q.type}: ${preview}...\n`;
    text += `🆔 \`${q.id.substring(0, 8)}\`\n`;

    if (examsWithQ.rows.length > 0) {
      text += `\n📝 Removed from ${examsWithQ.rows.length} exam(s):\n`;
      examsWithQ.rows.forEach(e => {
        text += `  • ${e.title}\n`;
      });
    }

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// /deleteexam <id> — Delete exam + its attempts
// ========================================
bot.onText(/\/deleteexam (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    const exam = await findExamByShortId(match[1].trim());
    if (!exam) return bot.sendMessage(msg.chat.id, '❌ Exam not found.');

    // Delete attempts for this exam
    const attResult = await db.query(`DELETE FROM attempts WHERE exam_id = \$1`, [exam.id]);

    // Optionally delete the questions too
    const qIds = exam.question_ids || [];
    let deletedQ = 0;
    if (qIds.length > 0) {
      // Only delete questions NOT used by other exams
      for (const qid of qIds) {
        const otherExams = await db.query(
          `SELECT COUNT(*) FROM exams WHERE id != \$1 AND question_ids::jsonb @> \$2::jsonb`,
          [exam.id, JSON.stringify([qid])]
        );
        if (parseInt(otherExams.rows[0].count) === 0) {
          await db.query(`DELETE FROM questions WHERE id = \$1`, [qid]);
          deletedQ++;
        }
      }
    }

    // Delete the exam
    await db.query(`DELETE FROM exams WHERE id = \$1`, [exam.id]);

    bot.sendMessage(msg.chat.id,
      `🗑 *Exam Deleted!*\n\n` +
      `📝 ${exam.title}\n` +
      `❓ ${deletedQ} questions deleted (${qIds.length - deletedQ} shared with other exams)\n` +
      `📋 ${attResult.rowCount} attempts removed\n` +
      `🆔 \`${exam.id.substring(0, 8)}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + err.message);
  }
});

// ========================================
// Webhook setup
// ========================================
function setupWebhook(app) {
  app.post('/api/telegram/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  const webhookUrl = `${backendUrl}/api/telegram/webhook`;
  bot.setWebHook(webhookUrl).then(() => {
    console.log(`[Telegram] Webhook set: ${webhookUrl}`);
  }).catch(err => {
    console.error('[Telegram] Webhook error:', err.message);
  });
}

module.exports = { bot, setupWebhook };