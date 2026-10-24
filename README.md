# ESG-Aware Receivables Risk & Collection Prioritization for Malaysian SMEs

An AI-powered receivables management solution designed to help Malaysian small and medium-sized enterprises (SMEs) understand payment risks, prioritize collection activities, and make more informed financial decisions.

---

## Team Information

| Field | Details |
|---|---|
| **Team Name** | JJ |
| **Team Domain** | Domain 2 |
| **SDG Track** | SDG 8 – Decent Work and Economic Growth |
| **Team Leader** | Lyu Qiuyao |
| **University** | Xiamen University Malaysia |
| **Number of Members** | 2 |

## Project Links

| Resource | Link |
|---|---|
| GitHub Repository | [sdc-hackathon-JJ](https://github.com/Lyuqiuyao/sdc-hackathon-JJ) |
| Replit Project | [ESG AI Advisor](https://replit.com/@lwjishereee/ESG-AI-Advisor) |
| Live Demo | [Launch ESG AI Advisor](https://esg-ai-advisor.replit.app) |
| Slide Deck | [View Presentation](https://khsj.cn/pfwzpg5hbt12kgt) |
| Demo Video | [To be added](https://youtu.be/uoJu1BRrbKI?feature=shared) |

---

## Overview

### Problem

Malaysian SMEs often face cash-flow uncertainty caused by delayed payments, limited visibility into customer payment behaviour, and resource constraints in managing accounts receivable. Without effective risk assessment and collection prioritization, businesses may struggle to identify which outstanding invoices require attention first. These challenges can affect working capital, operational stability, and sustainable business growth.

### Solution

ESG AI Advisor is an AI-assisted receivables management system designed to help SMEs organize receivables information, assess payment-related risks, and prioritize collection activities.

The platform combines receivables management workflows with AI-assisted analysis and advisory capabilities. It aims to support more informed collection decisions, improve operational efficiency, and encourage responsible, sustainable financial management.

The project aligns with **United Nations Sustainable Development Goal 8 (SDG 8)** by supporting SME resilience, productivity, and sustainable economic growth.

### Key Features

- **Receivables Risk Assessment** — Support the review of receivables and payment-related risk information to help users identify accounts requiring attention.
- **AI-Assisted Advisory** — Generate analytical insights and advisory snapshots to support financial review and collection planning.
- **AI-Driven Correspondence Analysis** — Assist users in interpreting customer correspondence and extracting information relevant to receivables management.
- **Collection Prioritization** — Help users organize collection activities based on available receivables information and risk-related insights.
- **Approval and Review Workflows** — Support customer-review decisions, approval status updates, draft preservation, and review navigation.
- **Collection Notice Management** — Provide a collection notice editor to support the preparation and management of collection communications.
- **Administrative Dashboard** — Bring receivables information and operational workflows together in an administrative interface.

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend | TypeScript-based web application |
| Backend | Node.js, TypeScript, Express |
| AI Integration | OpenAI API |
| Database / Data Access | Drizzle ORM |
| Package Management | pnpm |
| Development and Hosting | Replit |

*The stack above reflects the current repository structure and known dependencies. Specific database providers and deployment configurations depend on the project's environment settings.*

---

## System Architecture

The project separates the administrative interface, API service, and shared application logic.

```text
                 Users
                   |
                   v
       Receivables Admin Interface
                   |
                   v
          API Server (Express)
                   |
          +--------+--------+
          |                 |
          v                 v
   Receivables Logic    AI Integration
          |                 |
          v                 v
   Data / ORM Layer    OpenAI API
          |                 |
          +--------+--------+
                   |
                   v
       Insights and Review Workflows
```

The API server handles application requests and receivables-related logic. AI integration supports analysis and advisory functionality, while the administrative interface provides the workflows through which users review information and make decisions.

---

## Project Structure

```text
.
├── .agents/                     # Project agent guidance and memory
├── artifacts/
│   ├── api-server/              # Node.js / TypeScript API service
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── index.ts
│   │   │   └── lib/
│   │   │       └── receivables/ # Receivables and AI-related modules
│   │   ├── build.mjs
│   │   └── package.json
│   ├── receivables-admin/       # Administrative web application
│   └── mockup-sandbox/          # UI mockup / sandbox project
├── attached_assets/             # Project assets
├── docs/                        # Project documentation
├── lib/                         # Shared application logic
├── scripts/                     # Development and utility scripts
├── package.json                 # Root project configuration
├── pnpm-lock.yaml               # Dependency lockfile
├── pnpm-workspace.yaml          # Workspace configuration
├── tsconfig.json                # TypeScript configuration
├── .replit                      # Replit configuration
└── README.md
```

---

## How to Run

### Option 1 — Use the Hosted Demo

The simplest way to explore the application is through the live demo:

[https://esg-ai-advisor.replit.app](https://esg-ai-advisor.replit.app)

Availability depends on the current deployment status.

### Option 2 — Open the Replit Project

1. Open the [ESG AI Advisor Replit project](https://replit.com/@lwjishereee/ESG-AI-Advisor).
2. Review the project's configuration and workspace.
3. Ensure the required environment variables are configured through **Replit Secrets**.
4. Start the application using the project's configured run workflow.

### Option 3 — Run Locally

**Prerequisites**

- Node.js compatible with the project dependencies
- pnpm
- The required environment variables and service credentials

Clone the repository and install dependencies:

```bash
git clone https://github.com/Lyuqiuyao/sdc-hackathon-JJ.git
cd sdc-hackathon-JJ
pnpm install
```

Build the project:

```bash
pnpm run build
```

Configure the required environment variables before running the application. Refer to the package scripts and configuration files for the appropriate development and server startup commands.

**Security note:** Never commit API keys, passwords, or production credentials to the repository. Store secrets in Replit Secrets or an appropriate local environment configuration.

---

## How We Use Replit

Replit is the development and hosting environment used for this project.

- **Development:** The project is organized as a multi-part application with an API server, administrative interface, shared libraries, and supporting documentation.
- **Application Hosting:** The project is deployed through Replit, with the hosted demo available at the link above.
- **Configuration:** Application configuration is managed through project settings and environment variables.
- **Secret Management:** API credentials should be stored in Replit Secrets rather than committed to source control.
- **Version Control:** The complete project source is maintained in GitHub to support code review, collaboration, and project evaluation.

---

## Challenges & Learnings

### Challenges

- Integrating AI-assisted analysis into practical receivables management workflows.
- Designing approval and review processes that preserve user decisions and drafts during navigation.
- Organizing the API service, administrative interface, and shared logic into a maintainable project structure.
- Making AI-generated insights useful for financial review while keeping business decisions under human control.

### Learnings

- AI is most useful in business workflows when its outputs support, rather than replace, human decision-making.
- Reliable state management and approval workflows are essential for financial applications.
- Clear separation between frontend, backend, AI integration, and shared logic improves maintainability.
- Secure configuration and version control are important parts of delivering a usable application.

---

## Future Improvements

- [ ] Enhance receivables risk scoring and collection-priority recommendations.
- [ ] Incorporate more structured ESG-related indicators into risk analysis where reliable data is available.
- [ ] Add clearer explanations and supporting evidence for AI-generated recommendations.
- [ ] Expand reporting and receivables performance analytics.
- [ ] Improve testing, monitoring, and deployment documentation.
- [ ] Evaluate the system using representative SME receivables scenarios.

---

## Team

| Name | Role |
|---|---|
| Lyu Qiuyao | Team Leader |
| Li Wenjie| Project Development |


---

## Submission Checklist

- [x] Team name, domain, and SDG track included
- [x] GitHub repository link added
- [x] Replit project and live demo links added
- [x] Project overview and architecture documented
- [x] Main source directories and technology stack described
- [ ] Add the demo video link, if required
- [ ] Confirm the team member names and roles
- [ ] Verify that the live demo is accessible to judges
- [ ] Confirm the required hackathon submission documents are included
- [ ] Check that no API keys, passwords, or other secrets are committed
- [ ] Verify the local setup instructions against the current Replit configuration

---

## License

This project includes the license provided in the repository. Refer to the [`LICENSE`](LICENSE) file for the applicable terms.
