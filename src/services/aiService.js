// server/src/services/aiService.js
const axios = require('axios');
const config = require('../config');

class AIService {
  constructor() {
    this.apiKey = config.openRouter.apiKey;
    this.baseUrl = config.openRouter.baseUrl;
    this.model = config.openRouter.model;
  }

  /**
   * Grade an EXPLAIN_ME answer using AI
   */
  async gradeExplainAnswer(question, userAnswer) {
    try {
      if (!userAnswer || userAnswer.trim().length < 10) {
        return { score: 0, feedback: 'Answer is too short or empty to evaluate.' };
      }

      var prompt = `You are a fair exam grader for a JavaScript programming course.

QUESTION:
${question.content}

MODEL ANSWER (the ideal/correct answer):
${question.model_answer}

STUDENT'S ANSWER:
${userAnswer}

MAXIMUM POINTS: ${question.points}

GRADING CRITERIA:
1. **Accuracy (40%)** - Are the key technical concepts correct?
2. **Completeness (30%)** - Are all major points from the model answer covered?
3. **Understanding (20%)** - Does the student demonstrate genuine understanding?
4. **Clarity (10%)** - Is the answer well-written and clear?

SCORING GUIDE:
- 90-100% points: Excellent answer covering all key concepts accurately
- 70-89% points: Good answer covering most key concepts with minor gaps
- 50-69% points: Decent answer covering core concept but missing several points
- 30-49% points: Partial answer with some correct ideas but significant gaps
- 10-29% points: Minimal relevant content, mostly incomplete
- 0 points: ONLY for gibberish, completely irrelevant, empty, or nonsense answers

IMPORTANT:
- If the student explains the core concept correctly, they deserve at LEAST 50% points
- Shorter but accurate answers should still get good scores
- Don't penalize for not using exact same words as model answer
- Focus on whether the student UNDERSTANDS the concept
- Gibberish like "what isi teh" or random characters = 0 points
- Copying the question back without answering = 0 points

Respond in EXACTLY this JSON format (no extra text):
{
  "score": <integer between 0 and ${question.points}>,
  "feedback": "<brief 1-2 sentence explanation of why this score was given>"
}`;

      var response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a fair but thorough exam grader. Grade based on understanding, not exact wording. Always respond with valid JSON only. No markdown, no extra text.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 200,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      var text = response.data?.choices?.[0]?.message?.content?.trim();
      console.log('AI Grading raw response:', text);

      if (!text) return { score: 0, feedback: 'Could not evaluate answer.' };

      var jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        var result = JSON.parse(jsonMatch[0]);
        var score = Math.min(Math.max(0, Math.round(result.score)), question.points);
        return { score: score, feedback: result.feedback || 'Graded by AI.' };
      }

      return { score: 0, feedback: 'Could not evaluate answer.' };
    } catch (error) {
      console.error('AI grading error:', error.message);
      return { score: 0, feedback: 'Grading error — please contact admin.' };
    }
  }

  /**
   * Build the prompt for question generation
   */
  buildPrompt({ topic, difficulty, mcqCount, codeCount, explainCount }) {
    const totalQuestions = (mcqCount || 0) + (codeCount || 0) + (explainCount || 0);

    let prompt = `You are an expert exam question generator for a JavaScript/programming exam platform.

Generate exactly ${totalQuestions} questions about "${topic}" at ${difficulty} difficulty level.

Return ONLY a valid JSON array (no markdown, no explanation, no code fences). Each element must be an object.

`;

    if (mcqCount > 0) {
      prompt += `
Generate ${mcqCount} MCQ (multiple-choice) questions about concepts/theory. Each MCQ object must have:
{
  "type": "MCQ",
  "title": "Short question title",
  "topic": "${topic}",
  "difficulty": "${difficulty}",
  "tags": ["${topic.toLowerCase()}", "${difficulty.toLowerCase()}"],
  "points": ${difficulty === 'EASY' ? 5 : difficulty === 'MEDIUM' ? 10 : 15},
  "content": "The full question text",
  "options": [
    {"label": "A", "text": "First option"},
    {"label": "B", "text": "Second option"},
    {"label": "C", "text": "Third option"},
    {"label": "D", "text": "Fourth option"}
  ],
  "correct_option": <0|1|2|3>,
  "explanation": "Detailed explanation of why the correct answer is right"
}
IMPORTANT: correct_option is a 0-based INTEGER index (0=A, 1=B, 2=C, 3=D).
`;
    }

    if (codeCount > 0) {
      prompt += `
Generate ${codeCount} WRITE_CODE (output prediction) questions. Show a JavaScript code snippet and ask "What will be the output?". Student picks from 4 options.

Each WRITE_CODE object must have:
{
  "type": "WRITE_CODE",
  "title": "Short title about the concept tested",
  "topic": "${topic}",
  "difficulty": "${difficulty}",
  "tags": ["${topic.toLowerCase()}", "coding", "${difficulty.toLowerCase()}"],
  "points": ${difficulty === 'EASY' ? 10 : difficulty === 'MEDIUM' ? 20 : 30},
  "content": "What will be the output of the following code?",
  "starter_code": "const x = 5;\\nconsole.log(x + '5');",
  "options": [
    {"label": "A", "text": "55"},
    {"label": "B", "text": "10"},
    {"label": "C", "text": "NaN"},
    {"label": "D", "text": "Error"}
  ],
  "correct_option": <0|1|2|3>,
  "explanation": "Detailed explanation of why this is the correct output"
}
RULES FOR WRITE_CODE:
- correct_option is INTEGER 0-3
- Code must be valid JS with a definite output
- Keep code 3-8 lines max
- Include tricky JS behaviors (hoisting, closures, type coercion, scope, etc.)
- Wrong options should be common misconceptions
- Do NOT include backticks inside starter_code strings
`;
    }

    if (explainCount > 0) {
      prompt += `
Generate ${explainCount} EXPLAIN_ME (written explanation) questions. Each EXPLAIN_ME object must have:
{
  "type": "EXPLAIN_ME",
  "title": "Short descriptive title",
  "topic": "${topic}",
  "difficulty": "${difficulty}",
  "tags": ["${topic.toLowerCase()}", "conceptual", "${difficulty.toLowerCase()}"],
  "points": ${difficulty === 'EASY' ? 10 : difficulty === 'MEDIUM' ? 15 : 25},
  "content": "The question asking for an explanation",
  "model_answer": "A comprehensive model answer (3-5 sentences minimum)",
  "explanation": "Additional notes or grading criteria"
}
`;
    }

    prompt += `
CRITICAL RULES:
1. Return ONLY the JSON array. No markdown, no backticks, no extra text.
2. All strings must be properly escaped (especially quotes and newlines).
3. The array must contain exactly ${totalQuestions} objects.
4. correct_option must be an integer 0-3, NOT a string.
5. Every question must have ALL specified fields.
6. Make sure the entire JSON array is complete and properly closed with ].
7. Each question must be unique.
8. Keep code snippets SHORT (3-8 lines) to save space.
`;

    return prompt;
  }

  /**
   * Call OpenRouter API with dynamic token limits
   */
  async callOpenRouter(prompt, questionCount) {
    if (!this.apiKey || this.apiKey === 'your-key-here-from-openrouter') {
      throw new Error('OpenRouter API key is not configured.');
    }

    // Dynamic token limit: more questions = more tokens
    var tokensPerQuestion = 350;
    var baseTokens = 500;
    var maxTokens = Math.min(baseTokens + (questionCount || 10) * tokensPerQuestion, 8000);
    console.log('[AI] Using max_tokens:', maxTokens, 'for', questionCount, 'questions');

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a JSON generator. You ONLY output valid JSON arrays. Never include markdown. Make sure ALL JSON is complete and properly closed with ].' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'JS Exam Platform',
          },
          timeout: 90000,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from AI model');

      var finishReason = response.data?.choices?.[0]?.finish_reason;
      if (finishReason === 'length') {
        console.warn('[AI] WARNING: Response was truncated (hit token limit). Will attempt JSON repair.');
      }

      return content;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const msg = error.response.data?.error?.message || error.message;
        if (status === 401) throw new Error('Invalid OpenRouter API key');
        if (status === 429) throw new Error('Rate limit exceeded. Wait a moment and try again.');
        if (status === 402) throw new Error('Insufficient credits on OpenRouter account');
        throw new Error(`OpenRouter API error (${status}): ${msg}`);
      }
      if (error.code === 'ECONNABORTED') {
        throw new Error('AI request timed out. Try generating fewer questions.');
      }
      throw error;
    }
  }

  /**
   * Repair truncated JSON — recovers as many complete questions as possible
   */
  repairJSON(text) {
    var cleaned = text.trim();

    // Remove markdown fences
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // Find array start
    var firstBracket = cleaned.indexOf('[');
    if (firstBracket === -1) throw new Error('No JSON array found in response');
    cleaned = cleaned.slice(firstBracket);

    // Try parsing as-is first
    try {
      var parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // Continue to repair
    }

    // Repair: find the last complete object in the array
    console.log('[AI] Attempting JSON repair...');
    var depth = 0;
    var inString = false;
    var escape = false;
    var lastCompleteObjEnd = -1;

    for (var i = 0; i < cleaned.length; i++) {
      var ch = cleaned[i];

      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 1 && ch === '}') {
          lastCompleteObjEnd = i;
        }
      }
    }

    if (lastCompleteObjEnd > 0) {
      var repaired = cleaned.slice(0, lastCompleteObjEnd + 1) + ']';
      repaired = repaired.replace(/,\s*\]$/, ']');

      try {
        var parsed = JSON.parse(repaired);
        if (Array.isArray(parsed)) {
          console.log('[AI] JSON repair successful! Recovered ' + parsed.length + ' questions.');
          return parsed;
        }
      } catch (e2) {
        console.error('[AI] JSON repair also failed:', e2.message);
      }
    }

    throw new Error('Failed to parse AI response as JSON. Try generating fewer questions (max 10-12).');
  }

  /**
   * Parse JSON from AI response
   */
  parseJSON(raw) {
    return this.repairJSON(raw);
  }

  /**
   * Validate & sanitize each generated question
   */
  validateQuestions(questions) {
    return questions.map((q, index) => {
      if (!q.type || !['MCQ', 'WRITE_CODE', 'EXPLAIN_ME'].includes(q.type)) {
        throw new Error(`Question ${index + 1}: invalid or missing type "${q.type}"`);
      }
      if (!q.content || q.content.trim().length === 0) {
        throw new Error(`Question ${index + 1}: missing content`);
      }

      const base = {
        type: q.type,
        title: q.title || `Question ${index + 1}`,
        topic: q.topic || 'General',
        difficulty: q.difficulty || 'MEDIUM',
        tags: Array.isArray(q.tags) ? q.tags : [],
        points: typeof q.points === 'number' ? q.points : 10,
        content: q.content,
        explanation: q.explanation || '',
      };

      if (q.type === 'MCQ') {
        if (!Array.isArray(q.options) || q.options.length !== 4) {
          throw new Error(`Question ${index + 1} (MCQ): must have exactly 4 options`);
        }
        const options = q.options.map((opt, i) => {
          const labels = ['A', 'B', 'C', 'D'];
          if (typeof opt === 'string') return { label: labels[i], text: opt };
          return { label: opt.label || labels[i], text: opt.text || String(opt) };
        });
        let correctOption = q.correct_option;
        if (typeof correctOption === 'string') correctOption = parseInt(correctOption, 10);
        if (typeof correctOption !== 'number' || correctOption < 0 || correctOption > 3) correctOption = 0;
        return { ...base, options, correct_option: correctOption };
      }

      if (q.type === 'WRITE_CODE') {
        if (!Array.isArray(q.options) || q.options.length !== 4) {
          throw new Error(`Question ${index + 1} (WRITE_CODE): must have exactly 4 options`);
        }
        const options = q.options.map((opt, i) => {
          const labels = ['A', 'B', 'C', 'D'];
          if (typeof opt === 'string') return { label: labels[i], text: opt };
          return { label: opt.label || labels[i], text: opt.text || String(opt) };
        });
        let correctOption = q.correct_option;
        if (typeof correctOption === 'string') correctOption = parseInt(correctOption, 10);
        if (typeof correctOption !== 'number' || correctOption < 0 || correctOption > 3) correctOption = 0;

        return {
          ...base,
          options,
          correct_option: correctOption,
          starter_code: q.starter_code || '',
          expected_output: q.expected_output || '',
          test_cases: Array.isArray(q.test_cases) ? q.test_cases : [],
          model_answer: q.model_answer || '',
        };
      }

      if (q.type === 'EXPLAIN_ME') {
        return { ...base, model_answer: q.model_answer || '' };
      }

      return base;
    });
  }

  /**
   * Main entry: generate questions
   */
  async generateQuestions({ topic, difficulty, mcqCount, codeCount, explainCount }) {
    var totalQuestions = (mcqCount || 0) + (codeCount || 0) + (explainCount || 0);
    console.log(`[AI] Generating questions: topic=${topic}, difficulty=${difficulty}, MCQ=${mcqCount}, CODE=${codeCount}, EXPLAIN=${explainCount}, TOTAL=${totalQuestions}`);

    if (totalQuestions > 15) {
      console.warn('[AI] Warning: More than 15 questions may cause truncation. Consider reducing count.');
    }

    const prompt = this.buildPrompt({ topic, difficulty, mcqCount: mcqCount || 0, codeCount: codeCount || 0, explainCount: explainCount || 0 });
    const rawResponse = await this.callOpenRouter(prompt, totalQuestions);
    console.log('[AI] Received response, parsing JSON...');

    const parsed = this.parseJSON(rawResponse);
    console.log(`[AI] Parsed ${parsed.length} questions, validating...`);

    const validated = this.validateQuestions(parsed);
    console.log(`[AI] Validated ${validated.length} questions`);

    return validated;
  }
}

module.exports = new AIService();