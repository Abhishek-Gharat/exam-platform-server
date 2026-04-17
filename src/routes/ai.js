// server/src/routes/ai.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const aiService = require('../services/aiService');

// POST /api/ai/generate-questions (Preview only)
router.post('/generate-questions', authenticate, requireAdmin, async (req, res) => {
  try {
    const { topic, difficulty, mcqCount, codeCount, explainCount } = req.body;

    if (!topic) return res.status(400).json({ error: 'Topic is required' });

    const total = (mcqCount || 0) + (codeCount || 0) + (explainCount || 0);
    if (total === 0) return res.status(400).json({ error: 'At least one question type count must be > 0' });
    if (total > 20) return res.status(400).json({ error: 'Maximum 20 questions per generation' });

    const result = await aiService.generateQuestions({
      topic, difficulty: difficulty || 'MEDIUM',
      mcqCount: mcqCount || 0, codeCount: codeCount || 0, explainCount: explainCount || 0,
    });

    const questions = Array.isArray(result) ? result : result.questions;
    const usage = Array.isArray(result) ? null : result.usage;

    res.json({
      success: true,
      questions,
      count: questions.length,
      usage,
    });
  } catch (error) {
    console.error('[AI] generate-questions error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ai/generate-exam (Generate + Save)
router.post('/generate-exam', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      topic, difficulty, mcqCount, codeCount, explainCount,
      timeLimit, passingScore, examTitle, examDescription,
    } = req.body;

    if (!topic) return res.status(400).json({ error: 'Topic is required' });

    const total = (mcqCount || 0) + (codeCount || 0) + (explainCount || 0);
    if (total === 0) return res.status(400).json({ error: 'At least one question type count must be > 0' });

    const result = await aiService.generateQuestions({
      topic, difficulty: difficulty || 'MEDIUM',
      mcqCount: mcqCount || 0, codeCount: codeCount || 0, explainCount: explainCount || 0,
    });

    const questions = Array.isArray(result) ? result : result.questions;
    const usage = Array.isArray(result) ? null : result.usage;

    // Save questions to DB
    const questionIds = [];
    for (const q of questions) {
      const qId = uuidv4();
      questionIds.push(qId);
      await pool.query(
        `INSERT INTO questions
          (id, type, title, topic, difficulty, tags, points, content,
           options, correct_option, explanation, model_answer,
           starter_code, expected_output, test_cases, created_at, updated_at)
         VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,\$14,\$15, NOW(), NOW())`,
        [
          qId, q.type, q.title, q.topic, q.difficulty,
          JSON.stringify(q.tags || []), q.points, q.content,
          q.options ? JSON.stringify(q.options) : null,
          q.correct_option !== undefined ? q.correct_option : null,
          q.explanation || null, q.model_answer || null,
          q.starter_code || null, q.expected_output || null,
          q.test_cases ? JSON.stringify(q.test_cases) : null,
        ]
      );
    }

    // Create exam
    const examId = uuidv4();
    const title = examTitle || `${topic} Exam (AI Generated)`;
    const description = examDescription || `Auto-generated ${difficulty} exam on ${topic} with ${total} questions.`;
    const maxScore = questions.reduce((sum, q) => sum + (q.points || 10), 0);
    const difficultyMix = { MCQ: mcqCount || 0, WRITE_CODE: codeCount || 0, EXPLAIN_ME: explainCount || 0 };

    await pool.query(
      `INSERT INTO exams
        (id, title, description, status, time_limit_secs, total_questions,
         passing_score, randomize, question_ids, difficulty_mix,
         total_attempts, created_at, updated_at)
       VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11, NOW(), NOW())`,
      [
        examId, title, description, 'PUBLISHED',
        timeLimit || 1800, total, passingScore || 70, true,
        JSON.stringify(questionIds), JSON.stringify(difficultyMix), 0,
      ]
    );

    console.log(`[AI] Created exam "${title}" (${examId}) with ${total} questions`);

    res.status(201).json({
      success: true,
      exam: { id: examId, title, description, totalQuestions: total, maxScore, questionIds },
      questions,
      usage,
    });
  } catch (error) {
    console.error('[AI] generate-exam error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;