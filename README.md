# 🛡️ Sentinel API

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)
![Google Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

**Sentinel API** is an AI-powered OSINT (Open Source Intelligence) investigation platform that aggregates intelligence from multiple public data sources, performs automated investigations, and generates actionable reports using AI.

Designed for security professionals, investigators, journalists, researchers, and developers, Sentinel API provides a unified interface for API key management, intelligence gathering, OSINT workflows, and AI-assisted analysis.

---

# Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Getting Help](#getting-help)
- [Contributing](#contributing)
- [Maintainer](#maintainer)
- [License](#license)

---

# Overview

Sentinel API simplifies open-source intelligence investigations by combining AI reasoning with multiple intelligence connectors.

The platform enables users to:

- Conduct AI-assisted investigations
- Query multiple OSINT providers
- Manage API credentials securely
- Generate structured investigation reports
- Explore historical investigations
- Validate intelligence inputs
- Build custom intelligence workflows

---

# Features

## 🔍 AI Investigation Engine

Perform automated investigations powered by Google Gemini.

Generate:

- Executive summaries
- Intelligence reports
- Risk assessments
- Investigation timelines
- Key findings
- Recommendations

---

## 🌐 Multi-Source Intelligence Connectors

Built-in integrations include:

- Google Search
- GitHub
- DNS
- WHOIS
- News sources

Additional providers can be added through the connector architecture.

---

## 🔑 API Key Management

Securely manage credentials for supported intelligence providers through the integrated dashboard.

---

## 📚 Investigation History

Track and revisit previous investigations from a centralized history view.

---

## 🧪 Playground

Experiment with prompts, intelligence queries, and AI workflows before running full investigations.

---

## 📄 Documentation Center

Built-in documentation helps developers configure and extend the platform.

---

## 🔐 Authentication

Integrated authentication powered by Better Auth for secure access control.

---

## ⚡ Validation & Rate Limiting

Includes request validation and rate limiting utilities to improve reliability and protect backend resources.

---

# Architecture

```text
                 User
                   │
                   ▼
          Sentinel Dashboard
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
 Authentication  Playground   History
                   │
                   ▼
        AI Investigation Engine
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
 Google       GitHub        WHOIS
      ▼            ▼            ▼
 DNS         News APIs     Other Sources
                   │
                   ▼
        Investigation Report
```

---

# Tech Stack

## Frontend

- React 19
- TypeScript
- Vite

## Backend

- Next.js App Router
- Node.js
- Better Auth
- Prisma ORM

## AI

- Google Gemini

## Database

- Prisma

---

# Getting Started

## Prerequisites

Install:

- Node.js 18+
- npm
- A supported database for Prisma
- Google Gemini API Key

---

## Installation

Clone the repository.

```bash
git clone https://github.com/JOSEPHIWE/sentinel-api.git

cd sentinel-api
```

Install dependencies.

```bash
npm install
```

---

# Configuration

Copy the example environment file.

```bash
cp .env.example .env
```

Configure your environment variables.

```env
DATABASE_URL=

GEMINI_API_KEY=

BETTER_AUTH_SECRET=

BETTER_AUTH_URL=
```

Generate Prisma client.

```bash
npx prisma generate
```

Run database migrations.

```bash
npx prisma migrate dev
```

---

# Start Development Server

```bash
npm run dev
```

Visit:

```
http://localhost:3000
```

---

# Usage

1. Sign in.
2. Configure API keys.
3. Start a new investigation.
4. Select intelligence sources.
5. Run AI analysis.
6. Review the generated investigation report.
7. Access previous investigations from History.

---

# Project Structure

```text
.
├── app/
│   ├── api/
│   │   ├── auth/
│   │   └── keys/
│   ├── layout.tsx
│   └── page.tsx
│
├── src/
│   ├── components/
│   │   ├── LandingView.tsx
│   │   ├── DashboardView.tsx
│   │   ├── PlaygroundView.tsx
│   │   ├── HistoryView.tsx
│   │   ├── DocsView.tsx
│   │   ├── InvestigationReport.tsx
│   │   └── AuthView.tsx
│   │
│   ├── connectors/
│   │   ├── dns.ts
│   │   ├── github.ts
│   │   ├── google.ts
│   │   ├── news.ts
│   │   └── whois.ts
│   │
│   ├── services/
│   ├── utils/
│   └── types.ts
│
├── prisma/
├── hooks/
├── lib/
├── actions/
├── utils/
├── server.ts
├── package.json
└── README.md
```

---

# Roadmap

Planned enhancements include:

- Additional OSINT providers
- VirusTotal integration
- Shodan integration
- Have I Been Pwned integration
- Threat intelligence feeds
- PDF report export
- IOC extraction
- Case management
- Team collaboration
- Scheduled investigations
- Graph visualization
- REST API
- Docker deployment

---

# Getting Help

If you need assistance:

- Review the project documentation.
- Search existing GitHub Issues.
- Open a new Issue for bugs or feature requests.

If available, additional documentation can be found in the `docs/` directory.

---

# Contributing

Contributions are welcome.

1. Fork the repository.

2. Create a feature branch.

```bash
git checkout -b feature/my-feature
```

3. Commit your changes.

```bash
git commit -m "Add new feature"
```

4. Push your branch.

```bash
git push origin feature/my-feature
```

5. Open a Pull Request.

Please review `CONTRIBUTING.md` before submitting contributions.

---

# Maintainer

## Joseph Iwe

**AI Governance • Technology Policy • AI Product Strategy • Project Management**

Building AI-powered investigation platforms, agentic AI systems, and security tooling for researchers, developers, and public-interest technology.

### Connect

- GitHub: https://github.com/JOSEPHIWE
- Portfolio: https://JosephIwe.com
- LinkedIn: https://linkedin.com/in/JosephIwe
- Email: ijosephiwe@gmail.com

---

# License

This project is licensed under the MIT License.

See the `LICENSE` file for details.

---

## ⭐ Support the Project

If Sentinel API helps your investigations:

- ⭐ Star the repository
- 🍴 Fork the project
- 🐞 Report bugs
- 💡 Suggest new features
- 🤝 Contribute improvements

Together, we can build more accessible, AI-powered open-source intelligence tools.