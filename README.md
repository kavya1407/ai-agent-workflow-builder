# AI Workflow Builder

An AI-powered workflow execution platform that allows users to run workflows containing AI calls, HTTP requests, conditional logic, and human approval.

## Features

- AI workflow execution
- LLM call step
- HTTP request step
- Conditional branching
- Human approval gate
- Organisation-based quota
- Workflow run history
- Step execution details
- Workflow status tracking
- Owner-only workflow approval
- Hasura/PostgreSQL database integration
- React dashboard

## Tech Stack

### Frontend
- React
- Vite
- JavaScript
- CSS

### Backend
- Node.js
- Express
- GraphQL
- Hasura
- PostgreSQL

## Workflow

The demo workflow contains four steps:

1. LLM Call
2. HTTP Request
3. Conditional
4. Approval Gate

The workflow pauses at the approval gate and requires approval from an organisation owner.

## Quota

Each successfully completed workflow consumes one organisation quota.

Example:

`2 / 100`

means 2 workflow runs have been consumed from a quota of 100.

## API Endpoints

### Health Check

GET `/`

### Organisation

GET `/organization/:organizationId`

### Run Workflow

POST `/triggerWorkflowRun`

### Approve Workflow

POST `/approveWorkflowRun`

### Workflow History

GET `/workflow-runs/:workflowId`

### Step Details

GET `/workflow-run/:workflowRunId/steps`

## Running Locally

### Backend

```bash
cd backend
npm install
node src/server.js