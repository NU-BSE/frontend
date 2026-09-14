# Contributing to Creepy.IM

Thank you for your interest in contributing to Creepy.IM!

## Prerequisites

Before contributing, make sure you have:

- Node.js
- npm
- Android Studio and Android SDK
- An Android emulator or physical Android device
- Git

## Getting Started

1. Fork the repository.
2. Clone your fork.
3. Run `npm install --legacy-peer-deps`.
4. Copy `.env.example` to `.env`.
5. Run `npm run android`.

Do not commit personal credentials or secrets.

## Verification

Before submitting a pull request, run:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run verify`

Make sure the relevant checks pass before submitting your changes.

## Contribution Workflow

### 1. Fork the repository

Create a fork under your GitHub account.

### 2. Create a branch

Create a separate branch instead of making changes directly on `main`.

Example branch names:

- `add-contributing-guide`
- `fix/login-error`
- `docs/update-setup`
- `feature/new-connector`

### 3. Make your changes

Make the required changes and test them locally.

### 4. Commit your changes

Use a clear commit message such as:

`git commit -m "docs: add contributor guide"`

### 5. Push your branch

Push your branch to your fork.

### 6. Open a Pull Request

Open a pull request from your branch to the repository's `main` branch.

Explain what you changed and how you tested it.

Reference the related issue using:

`Closes #36`

## Large Changes

For large architectural changes, please discuss the proposed change in an Issue before starting implementation.

## Pull Request Checklist

Before submitting a pull request:

- [ ] Changes are related to the issue.
- [ ] The project builds or runs correctly.
- [ ] Type checking passes.
- [ ] Linting passes.
- [ ] Tests pass.
- [ ] No personal credentials or secrets are committed.
- [ ] The pull request references the related issue.

Thank you for contributing to Creepy.IM!
