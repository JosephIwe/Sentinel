# Contributing to Sentinel API

Thank you for your interest in contributing to Sentinel API! We welcome contributions that help secure, stabilize, and improve the platform.

---

## 💻 Development Setup

1. **Prerequisites**:
   - Node.js (v18 or higher)
   - npm (v9 or higher)

2. **Clone and Install**:
   ```bash
   git clone https://github.com/your-org/sentinel-api.git
   cd sentinel-api
   npm install
   ```

3. **Configure Environment**:
   - Copy `.env.example` to `.env`
   - Provide a valid `GEMINI_API_KEY` for AI meta-analysis features.

4. **Run Development Server**:
   ```bash
   npm run dev
   ```

5. **Run Tests**:
   ```bash
   npm run test
   ```

---

## 🎨 Coding Standards

- **TypeScript**: All new code must be fully type-safe. Avoid using `any` unless absolutely necessary; use `unknown` or specific type definitions.
- **Modularity**: Keep components, services, and connectors in their respective folders (`/src/components`, `/src/services`, `/src/connectors`).
- **Resiliency & Observability**:
  - Implement structured JSON logging using our custom logger.
  - Wrap downstream integrations with retry mechanisms and circuit breakers.
  - Ensure sensitive credentials or secrets are sanitised and masked in logs.
- **Linting**: Ensure code passes linter checks before committing:
  ```bash
  npm run lint
  ```

---

## 🚀 Pull Request Process

1. **Branch Naming**:
   - Use descriptive branch names: `feature/your-feature-name`, `bugfix/issue-description`, `docs/update-docs`.
2. **Commit Changes**:
   - Commit logically grouped modifications. Ensure test coverage is added or updated.
3. **Submit PR**:
   - Fill out the Pull Request template comprehensively.
   - Link any associated issues or tickets.
4. **Code Review**:
   - All PRs require at least one approval from the core maintainer team.
   - Maintainers will run the automated test suite and check code quality before merging.

---

## 📝 Commit Message Guidelines

We follow a structured commit style similar to Conventional Commits:

- `feat`: A new feature (e.g., `feat: add rate limiter sliding window tracker`)
- `fix`: A bug fix (e.g., `fix: resolve credential masking edge case`)
- `docs`: Documentation only changes (e.g., `docs: complete contribution guide`)
- `style`: Changes that do not affect the meaning of the code (formatting, missing semi-colons, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process, auxiliary tools, or libraries

**Example**:
```text
feat: add connection timeout on DNS query lookups

Resolves unresponsive network connections by adding a configurable 5-second 
timeout threshold for the authoritative query loop.
```
