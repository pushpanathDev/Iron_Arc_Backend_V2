// npm run lint. ESLint's recommended rules for Node (CommonJS), plus double quotes.
const js = require("@eslint/js");
const globals = require("globals");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      // `_name` marks a value that's left out on purpose, e.g. ({ planData: _, ...rest }) or ({ _chatHistory, ...plan }).
      // `next` and `req`/`res` stay in Express handlers whose signature needs them.
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_|^next$|^req$|^res$", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
      ],
      quotes: ["error", "double", { avoidEscape: true }],
    },
  },
]);
