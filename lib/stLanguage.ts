// ============================================================
// AMA — IEC 61131-3 Structured Text Language Definition for Monaco
// ============================================================
import type { languages } from 'monaco-editor';

export const ST_LANGUAGE_ID = 'iec-st';

export const stLanguageConfig: languages.LanguageConfiguration = {
    comments: {
        lineComment: '//',
        blockComment: ['(*', '*)'],
    },
    brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
    ],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: "'", close: "'", notIn: ['string'] },
        { open: '"', close: '"', notIn: ['string'] },
        { open: '(*', close: '*)' },
    ],
    surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: "'", close: "'" },
        { open: '"', close: '"' },
    ],
    folding: {
        markers: {
            start: /^\s*(FUNCTION_BLOCK|FUNCTION|PROGRAM|IF|CASE|FOR|WHILE|REPEAT|VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|STRUCT)/i,
            end: /^\s*(END_FUNCTION_BLOCK|END_FUNCTION|END_PROGRAM|END_IF|END_CASE|END_FOR|END_WHILE|END_REPEAT|END_VAR|END_STRUCT)/i,
        },
    },
};

export const stTokensProvider: languages.IMonarchLanguage = {
    defaultToken: '',
    ignoreCase: true,
    keywords: [
        'PROGRAM', 'END_PROGRAM',
        'FUNCTION', 'END_FUNCTION',
        'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
        'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL',
        'VAR_EXTERNAL', 'END_VAR',
        'CONSTANT', 'RETAIN', 'PERSISTENT',
        'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
        'CASE', 'OF', 'END_CASE',
        'FOR', 'TO', 'BY', 'DO', 'END_FOR',
        'WHILE', 'END_WHILE',
        'REPEAT', 'UNTIL', 'END_REPEAT',
        'RETURN', 'EXIT', 'CONTINUE',
        'METHOD', 'END_METHOD',
        'PROPERTY', 'END_PROPERTY',
        'INTERFACE', 'END_INTERFACE',
        'IMPLEMENTS', 'EXTENDS',
        'STRUCT', 'END_STRUCT',
        'TYPE', 'END_TYPE',
        'ARRAY',
        'AT',
        'AND', 'OR', 'XOR', 'NOT', 'MOD',
        'TRUE', 'FALSE',
        'ACTION', 'END_ACTION',
        'TRANSITION', 'END_TRANSITION',
        'STEP', 'END_STEP',
        'INITIAL_STEP',
    ],
    typeKeywords: [
        'BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD',
        'SINT', 'USINT', 'INT', 'UINT', 'DINT', 'UDINT', 'LINT', 'ULINT',
        'REAL', 'LREAL',
        'STRING', 'WSTRING',
        'TIME', 'DATE', 'TIME_OF_DAY', 'DATE_AND_TIME',
        'TOD', 'DT',
        'LTIME', 'LDATE', 'LTOD', 'LDT',
    ],
    operators: [
        ':=', '=>', '<=', '>=', '<>', '=', '<', '>',
        '+', '-', '*', '/', '**',
    ],
    tokenizer: {
        root: [
            // Comments
            [/\/\/.*$/, 'comment'],
            [/\(\*/, 'comment', '@comment'],

            // String
            [/'[^']*'/, 'string'],
            [/"[^"]*"/, 'string'],

            // Numbers
            [/\b\d+\.\d+\b/, 'number.float'],
            [/\b(?:16#[0-9A-Fa-f_]+|8#[0-7_]+|2#[01_]+|\d+)\b/, 'number'],

            // Time literals
            [/\b[Tt]#[\d_dhms.]+\b/, 'number'],

            // Identifiers & keywords
            [/[a-zA-Z_]\w*/, {
                cases: {
                    '@keywords': 'keyword',
                    '@typeKeywords': 'type',
                    '@default': 'identifier',
                },
            }],

            // Operators
            [/:=|=>|<>|<=|>=|[+\-*/=<>]/, 'operator'],

            // Delimiters
            [/[{}()\[\]]/, '@brackets'],
            [/[;,.]/, 'delimiter'],

            // Pragmas
            [/\{.*?\}/, 'annotation'],
        ],
        comment: [
            [/[^(*]+/, 'comment'],
            [/\*\)/, 'comment', '@pop'],
            [/./, 'comment'],
        ],
    },
};

export const stTheme = {
    base: 'vs-dark' as const,
    inherit: true,
    rules: [
        { token: 'keyword', foreground: 'C586C0', fontStyle: 'bold' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'identifier', foreground: '9CDCFE' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'number.float', foreground: 'B5CEA8' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'delimiter', foreground: 'D4D4D4' },
        { token: 'annotation', foreground: '808080' },
    ],
    colors: {
        'editor.background': '#1e1e2e',
        'editor.foreground': '#cdd6f4',
        'editorLineNumber.foreground': '#585b70',
        'editorLineNumber.activeForeground': '#cdd6f4',
        'editor.selectionBackground': '#45475a',
        'editor.lineHighlightBackground': '#313244',
        'editorCursor.foreground': '#f5e0dc',
    },
};
