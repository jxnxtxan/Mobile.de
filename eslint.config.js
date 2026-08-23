import globals from 'globals';

/**
 * Bewusst minimal: kein Style-Regelwerk, sondern genau die Prüfungen, die
 * beim Herauslösen der Module aus dem Monolithen gefehlt haben. `no-undef`
 * hätte alle sechs ReferenceErrors aus Commit 4b77b9c beim Commit gefangen.
 */
export default [
    {
        files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'vite.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.greasemonkey,
            },
        },
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', {
                args: 'none',
                varsIgnorePattern: '^_',
                caughtErrors: 'none',
            }],
            'no-redeclare': 'error',
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-dupe-else-if': 'error',
            'no-duplicate-case': 'error',
            'no-unsafe-negation': 'error',
            'no-unreachable': 'error',
            'no-fallthrough': 'error',
            'no-self-assign': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'use-isnan': 'error',
            'valid-typeof': 'error',
            eqeqeq: ['warn', 'smart'],
        },
    },
    {
        files: ['scripts/**/*.js', 'test/**/*.js', 'vite.config.js'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
];
