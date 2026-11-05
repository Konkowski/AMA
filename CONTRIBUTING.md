# Contributing to AMA

Thanks for wanting to help! You don't need to write code to contribute: bug reports, ideas and documentation fixes are just as valuable.

## Ways to help

- **Report a bug** or **suggest an idea**: open an [issue](https://github.com/Konkowski/AMA/issues/new/choose).
- **Improve the docs**: typos, clearer explanations, translations.
- **Fix a bug or add a feature**: send a pull request (steps below).

## Before you post anything

**Never attach confidential material** to an issue or pull request: real machine projects, customer `.L5X`/`.ACD` files, proprietary block code or screenshots showing them. Public means public. If you need to show a problem, reduce it to a small invented example.

## Sending a pull request

1. Click **Fork** on the repository page to get your own copy.
2. Clone your fork (GitHub Desktop: *File → Clone repository*).
3. Create a branch with a short name, e.g. `fix-l5x-import`.
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

5. Make your change, then check that everything still passes:

   ```bash
   npm run typecheck
   npm test
   ```

6. Commit, push to your fork and click **Create pull request**. Say what changed and why. Screenshots help for UI changes.

## Guidelines

- Keep pull requests small and focused on one thing.
- Match the style of the surrounding code (TypeScript, React function components).
- Add or update a test in `tests/` when you change behaviour in `lib/`.
- Don't commit build output, `node_modules`, `.exe` files or exported PLC projects (the `.gitignore` already covers most of these).
- Demo data must be invented. No real machine, customer or company data.

## Licensing

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
