# AI Workflow Builder

An AI-powered workflow execution platform that allows users to build and run workflows containing AI calls, HTTP requests, conditional logic, and human approval.

## Features

- AI workflow execution
- LLM call step
- HTTP request step
- Conditional branching
- Human approval gate
- Pause and resume workflow execution
- Organisation-based quota enforcement
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

### Database

- PostgreSQL
- Hasura

### AI

- Gemini API
- Stub LLM provider for local testing

## Workflow

The demo workflow contains four steps:

1. **LLM Call** – Generates an AI response.
2. **HTTP Request** – Calls an external API.
3. **Conditional** – Evaluates the previous step and decides whether to continue.
4. **Approval Gate** – Requires approval from an organisation owner.

Workflow flow:

LLM Call → HTTP Request → Conditional → Approval Gate → Completed

## Approval Gate

When the workflow reaches the approval gate, the workflow changes from `running` to `paused`.

The workflow remains paused while waiting for approval.

An authorised organisation owner can approve the workflow through the approval endpoint.

After approval, the workflow changes from `paused` to `completed`.

The approval information is stored in the corresponding step run.

## Permissions

The application uses two permission layers.

### Layer 1 – Hasura Permissions

Hasura provides database-level permission rules based on organisation membership and user roles.

This provides organisation-level isolation when accessing the database.

### Layer 2 – Backend Action Validation

The backend independently validates the user's organisation membership and role before sensitive operations such as:

- Triggering workflows
- Approving workflows
- Accessing workflow run information

Workflow approval is restricted to organisation owners.

This provides an additional application-level security check instead of relying only on the frontend.

## Organisation Quota

Each organisation has a workflow execution quota.

Example:

`2 / 100`

means that 2 workflow executions have been used out of an allowed quota of 100.

Before creating a new workflow run, the backend checks:

`quota_used < quota_allowed`

After a successful workflow execution, the organisation's quota usage is incremented.

## Workflow Run History

The application provides workflow execution history.

Each workflow run contains:

- Run ID
- Status
- Start time
- Completion time
- Error information when applicable

Step execution details contain:

- Step ID
- Step status
- Input
- Output
- Attempt count
- Start time
- Completion time
- Approval information

## Retry and Failure Handling

Each step run tracks an attempt count and execution status.

Possible statuses include:

- `running`
- `paused`
- `completed`
- `failed`

Errors are stored with the workflow run or step run so failed executions can be inspected.

## API Endpoints

### Health Check

`GET /`

### Organisation

`GET /organization/:organizationId`

### Run Workflow

`POST /triggerWorkflowRun`

### Approve Workflow

`POST /approveWorkflowRun`

### Workflow Run History

`GET /workflow-runs/:workflowId`

### Step Execution Details

`GET /workflow-run/:workflowRunId/steps`

## Running Locally

### Backend

```bash
cd backend
npm install
node src/server.js

## Design Write-up

### Schema Reasoning

The database is organised around organisations, workflows, workflow steps, workflow runs, and step runs.

An organisation can contain multiple workflows, while each workflow belongs to one organisation. Workflow steps belong to a workflow and define the execution sequence. Workflow runs represent individual executions of a workflow, and step runs record the execution state, input, output, attempts, errors, and approval information for each step.

This structure separates the reusable workflow definition from individual executions. It also makes it possible to inspect complete workflow history and individual step execution details.

### Permission Layers

The application uses two separate permission layers.

**Hasura permission layer:** Hasura provides database-level access control based on organisation membership and role. This protects data access at the GraphQL/database layer and helps prevent users from accessing data belonging to another organisation.

**Backend Action layer:** The backend independently checks organisation membership and role before sensitive operations. Workflow triggering checks that the user has the required organisation role, while approval checks specifically require an organisation owner.

Using both layers means that frontend behaviour is not treated as a security boundary. Even if a user attempts to call an endpoint directly or guesses an ID, the backend performs its own authorisation checks before allowing the operation.

### Approval Gate Pause/Resume

The workflow executes its steps sequentially. When execution reaches the approval gate, the corresponding step run is changed to `paused` and the workflow run is also changed to `paused`.

The workflow does not continue until an authorised organisation owner calls the approval endpoint.

The approval handler verifies the workflow run, identifies the approval step, verifies the requesting user's organisation membership and owner role, records the approval information, and resumes the workflow execution.

After approval, the workflow continues and the workflow run is eventually marked `completed`.

This approach keeps the approval state persisted in the database, allowing the workflow to remain paused between requests instead of depending on an in-memory process.

### Quota and Failure Handling

The backend checks the organisation's `quota_used` against `quota_allowed` before creating a workflow run. A workflow cannot start when the organisation quota has been exhausted.

Step runs track execution status, attempt count, input, output, errors, and timestamps. This provides visibility into failed executions and individual step behaviour.