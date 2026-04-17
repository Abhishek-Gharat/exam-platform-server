// server/src/routes/execute.js
const express = require('express');
const router = express.Router();
const vm = require('vm');
const { authenticate } = require('../middleware/auth');

router.post('/', authenticate, async (req, res) => {
  try {
    const { code, language } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }

    // Only support JavaScript for now
    if (language && language.toLowerCase() !== 'javascript') {
      return res.status(400).json({ error: 'Only JavaScript is supported' });
    }

    // Capture console.log output
    const logs = [];
    const mockConsole = {
      log: (...args) => logs.push(args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch { return String(a); }
      }).join(' ')),
      error: (...args) => logs.push('[ERROR] ' + args.map(a => String(a)).join(' ')),
      warn: (...args) => logs.push('[WARN] ' + args.map(a => String(a)).join(' ')),
      info: (...args) => logs.push(args.map(a => String(a)).join(' ')),
    };

    // Create a sandbox
    const sandbox = {
      console: mockConsole,
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      process: undefined,
      require: undefined,
      __dirname: undefined,
      __filename: undefined,
      module: undefined,
      exports: undefined,
      global: undefined,
      // Common JS utilities
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise: undefined, // block async for safety
      Error,
      TypeError,
      RangeError,
      SyntaxError,
    };

    const context = vm.createContext(sandbox);
    const startTime = Date.now();

    try {
      const script = new vm.Script(code, { filename: 'user-code.js' });
      const result = script.runInContext(context, {
        timeout: 5000, // 5 second timeout
        displayErrors: true,
      });

      const executionTime = Date.now() - startTime;

      // If there's a return value and no logs, show the result
      if (result !== undefined && logs.length === 0) {
        try {
          logs.push(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
        } catch {
          logs.push(String(result));
        }
      }

      res.json({
        success: true,
        output: logs.join('\n'),
        executionTime: executionTime + 'ms',
        error: null,
      });
    } catch (execError) {
      const executionTime = Date.now() - startTime;
      res.json({
        success: false,
        output: logs.join('\n'),
        executionTime: executionTime + 'ms',
        error: execError.message,
      });
    }
  } catch (error) {
    console.error('[Execute] error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;