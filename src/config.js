require('dotenv').config();

module.exports = {
    port: process.env.PORT || 5000,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    openRouter: {
       apiKey: process.env.OPENROUTER_API_KEY,
       baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
       model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-68b:free',
     },
};