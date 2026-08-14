const express = require("express");
const cors = require("cors");
const { GraphQLClient, gql } = require("graphql-request");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const hasura = new GraphQLClient(
  process.env.HASURA_GRAPHQL_URL,
  {
    headers: {
      "x-hasura-admin-secret":
        process.env.HASURA_ADMIN_SECRET,
    },
  }
);

// ======================================================
// HELPERS
// ======================================================

function now() {
  return new Date().toISOString();
}

async function executeWithRetry(fn, attempts = 2) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return {
        result: await fn(),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000)
        );
      }
    }
  }

  throw lastError;
}

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {
  res.json({
    message: "AI Workflow Backend is running",
  });
});

// ======================================================
// TEST HASURA CONNECTION
// ======================================================

app.get("/test-db", async (req, res) => {
  try {
    const query = gql`
      query TestOrganizations {
        organizations {
          id
          name
          quota_allowed
          quota_used
        }
      }
    `;

    const data = await hasura.request(query);

    return res.json(data);
  } catch (error) {
    console.error("test-db error:", error);

    return res.status(500).json({
      status: "failed",
      message: "Failed to connect to Hasura",
      error: error.message,
    });
  }
});

// ======================================================
// ORGANISATION / QUOTA
// ======================================================

app.get(
  "/organization/:organizationId",
  async (req, res) => {
    try {
      const { organizationId } = req.params;

      const query = gql`
        query GetOrganization($id: uuid!) {
          organizations_by_pk(id: $id) {
            id
            name
            quota_allowed
            quota_used
          }
        }
      `;

      const data = await hasura.request(query, {
        id: organizationId,
      });

      if (!data.organizations_by_pk) {
        return res.status(404).json({
          status: "failed",
          message: "Organisation not found",
        });
      }

      return res.json({
        status: "success",
        organization: data.organizations_by_pk,
      });
    } catch (error) {
      console.error(
        "Organization endpoint error:",
        error
      );

      return res.status(500).json({
        status: "failed",
        message: error.message,
      });
    }
  }
);
// ======================================================
// WORKFLOW RUN STEP DETAILS
// ======================================================

app.get(
  "/workflow-run/:runId/steps",
  async (req, res) => {
    try {
      const { runId } = req.params;

      const query = gql`
        query GetWorkflowRunSteps(
          $runId: uuid!
        ) {
          step_runs(
            where: {
              workflow_run_id: {
                _eq: $runId
              }
            }
            order_by: {
              started_at: asc
            }
          ) {
            id
            workflow_step_id
            status
            output
            error
            attempt_count
            started_at
            completed_at
            approved_by
            approved_at

            workflow_step {
              id
              position
              type
              config
            }
          }
        }
      `;

      const data = await hasura.request(
        query,
        {
          runId,
        }
      );

      return res.json({
        status: "success",
        steps: data.step_runs,
      });
    } catch (error) {
      console.error(
        "Workflow run steps error:",
        error
      );

      return res.status(500).json({
        status: "failed",
        message: error.message,
      });
    }
  }
);
// ======================================================
// WORKFLOW RUN HISTORY
// ======================================================

app.get(
  "/workflow-runs/:workflowId",
  async (req, res) => {
    try {
      const { workflowId } = req.params;

      const query = gql`
        query GetWorkflowRuns(
          $workflowId: uuid!
        ) {
          workflow_runs(
            where: {
              workflow_id: {
                _eq: $workflowId
              }
            }
            order_by: {
              started_at: desc
            }
          ) {
            id
            status
            started_at
            completed_at
            error
          }
        }
      `;

      const data = await hasura.request(
        query,
        {
          workflowId,
        }
      );

      return res.json({
        status: "success",
        runs: data.workflow_runs,
      });
    } catch (error) {
      console.error(
        "Workflow runs error:",
        error
      );

      return res.status(500).json({
        status: "failed",
        message: error.message,
      });
    }
  }
);
// ======================================================
// LLM
// ======================================================

async function runLLM(config) {
  if (process.env.LLM_PROVIDER === "stub") {
    await new Promise((resolve) =>
      setTimeout(resolve, 1500)
    );

    return {
      text: "YES",
      provider: "stub",
      artificial_delay_ms: 1500,
    };
  }

  throw new Error(
    "LLM provider is not configured. Use LLM_PROVIDER=stub for this assignment."
  );
}

// ======================================================
// HTTP REQUEST
// ======================================================

async function runHttpRequest(config) {
  const method = config.method || "GET";
  const url = config.url;

  if (!url) {
    throw new Error(
      "http_request step has no URL"
    );
  }

  const response = await fetch(url, {
    method,
    headers: config.headers || {},
    body:
      method !== "GET" && method !== "HEAD"
        ? JSON.stringify(config.body || {})
        : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${text}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status: response.status,
    data,
  };
}

// ======================================================
// TRIGGER WORKFLOW RUN
// ======================================================

app.post("/triggerWorkflowRun", async (req, res) => {
  console.log("triggerWorkflowRun received");

  try {
    const input = req.body.input || {};
    const sessionVariables =
      req.body.session_variables || {};

    const workflowId = input.workflow_id;
    const userId =
      sessionVariables["x-hasura-user-id"];

    // --------------------------------------------------
    // Validate input
    // --------------------------------------------------

    if (!workflowId) {
      return res.status(400).json({
        status: "failed",
        message: "workflow_id is required",
        workflow_run_id: null,
      });
    }

    if (!userId) {
      return res.status(401).json({
        status: "failed",
        message: "Authentication required",
        workflow_run_id: null,
      });
    }

    // --------------------------------------------------
    // Get workflow + organisation
    // --------------------------------------------------

    const workflowQuery = gql`
      query GetWorkflow(
        $workflowId: uuid!
        $userId: uuid!
      ) {
        workflows_by_pk(id: $workflowId) {
          id
          name
          organization_id

          organization {
            id
            name
            quota_allowed
            quota_used

            org_members(
              where: {
                user_id: { _eq: $userId }
              }
            ) {
              user_id
              role
            }
          }

          workflow_steps(
            order_by: { position: asc }
          ) {
            id
            position
            type
            config
          }
        }
      }
    `;

    const workflowData =
      await hasura.request(workflowQuery, {
        workflowId,
        userId,
      });

    const workflow =
      workflowData.workflows_by_pk;

    if (!workflow) {
      return res.status(404).json({
        status: "failed",
        message: "Workflow not found",
        workflow_run_id: null,
      });
    }

    // --------------------------------------------------
    // Membership check
    // --------------------------------------------------

    const membership =
      workflow.organization.org_members[0];

    if (!membership) {
      return res.status(403).json({
        status: "failed",
        message:
          "You are not a member of this organisation",
        workflow_run_id: null,
      });
    }

    // Owners and editors can trigger
    if (
      !["owner", "editor"].includes(
        membership.role
      )
    ) {
      return res.status(403).json({
        status: "failed",
        message:
          "Only owners and editors can trigger workflows",
        workflow_run_id: null,
      });
    }

    // --------------------------------------------------
    // Quota check
    // --------------------------------------------------

    const organization =
      workflow.organization;

    if (
      organization.quota_used >=
      organization.quota_allowed
    ) {
      return res.status(429).json({
        status: "failed",
        message:
          "Organisation quota exhausted",
        workflow_run_id: null,
      });
    }

    // --------------------------------------------------
    // Create workflow run
    // --------------------------------------------------

    const createRunMutation = gql`
      mutation CreateWorkflowRun(
        $workflowId: uuid!
        $startedAt: timestamptz!
      ) {
        insert_workflow_runs_one(
          object: {
            workflow_id: $workflowId
            status: "running"
            started_at: $startedAt
          }
        ) {
          id
          status
        }
      }
    `;

    const runData =
      await hasura.request(
        createRunMutation,
        {
          workflowId,
          startedAt: now(),
        }
      );

    const workflowRunId =
      runData.insert_workflow_runs_one.id;

    // This contains the previous step output.
    let previousOutput = null;

    // This stores the original LLM decision.
    // It prevents the HTTP step from replacing
    // the LLM decision before the conditional step.
    let llmDecision = null;

    // --------------------------------------------------
    // Execute workflow steps
    // --------------------------------------------------

    for (const step of workflow.workflow_steps) {
      const startedAt = now();

      // ------------------------------------------------
      // Create step run
      // ------------------------------------------------

      const createStepRunMutation = gql`
        mutation CreateStepRun(
          $workflowRunId: uuid!
          $workflowStepId: uuid!
          $startedAt: timestamptz!
        ) {
          insert_step_runs_one(
            object: {
              workflow_run_id: $workflowRunId
              workflow_step_id: $workflowStepId
              status: "running"
              started_at: $startedAt
              attempt_count: 0
            }
          ) {
            id
          }
        }
      `;

      const stepRunData =
        await hasura.request(
          createStepRunMutation,
          {
            workflowRunId,
            workflowStepId: step.id,
            startedAt,
          }
        );

      const stepRunId =
        stepRunData.insert_step_runs_one.id;

      try {
        let output;

        // ==================================================
        // LLM CALL
        // ==================================================

        if (step.type === "llm_call") {
          const execution =
            await executeWithRetry(
              () => runLLM(step.config),
              2
            );

          output = execution.result;

          const updateStep = gql`
            mutation UpdateLLMStep(
              $id: uuid!
              $output: jsonb!
              $attempts: Int!
              $completedAt: timestamptz!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: "completed"
                  output: $output
                  attempt_count: $attempts
                  completed_at: $completedAt
                }
              ) {
                id
              }
            }
          `;

          await hasura.request(
            updateStep,
            {
              id: stepRunId,
              output,
              attempts:
                execution.attempts,
              completedAt: now(),
            }
          );

          previousOutput =
            output.text;

          llmDecision =
            output.text;
        }

        // ==================================================
        // HTTP REQUEST
        // ==================================================

        else if (
          step.type === "http_request"
        ) {
          const execution =
            await executeWithRetry(
              () =>
                runHttpRequest(
                  step.config
                ),
              2
            );

          output = execution.result;

          const updateStep = gql`
            mutation UpdateHttpStep(
              $id: uuid!
              $output: jsonb!
              $attempts: Int!
              $completedAt: timestamptz!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: "completed"
                  output: $output
                  attempt_count: $attempts
                  completed_at: $completedAt
                }
              ) {
                id
              }
            }
          `;

          await hasura.request(
            updateStep,
            {
              id: stepRunId,
              output,
              attempts:
                execution.attempts,
              completedAt: now(),
            }
          );

          previousOutput =
            output;
        }

        // ==================================================
        // CONDITIONAL BRANCH
        // ==================================================

        else if (
          step.type ===
          "conditional_branch"
        ) {
          const conditionPassed =
            llmDecision === "YES";

          output = {
            condition:
              conditionPassed,

            previous_output:
              previousOutput,

            action:
              conditionPassed
                ? step.config.true_action
                : step.config.false_action,
          };

          const updateStep = gql`
            mutation UpdateBranch(
              $id: uuid!
              $output: jsonb!
              $completedAt: timestamptz!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: "completed"
                  output: $output
                  completed_at: $completedAt
                }
              ) {
                id
              }
            }
          `;

          await hasura.request(
            updateStep,
            {
              id: stepRunId,
              output,
              completedAt: now(),
            }
          );

          previousOutput =
            output;
        }

        // ==================================================
        // APPROVAL GATE
        // ==================================================

        else if (
          step.type === "approval_gate"
        ) {
          const pauseStep = gql`
            mutation PauseStep(
              $id: uuid!
              $runId: uuid!
              $output: jsonb!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: "paused"
                  output: $output
                }
              ) {
                id
              }

              update_workflow_runs_by_pk(
                pk_columns: { id: $runId }
                _set: {
                  status: "paused"
                }
              ) {
                id
              }
            }
          `;

          await hasura.request(
            pauseStep,
            {
              id: stepRunId,
              runId: workflowRunId,
              output: {
                message:
                  "Awaiting approval",
                required_role:
                  "owner",
              },
            }
          );

          return res.json({
            status: "paused",
            message:
              "Workflow paused and awaiting approval",
            workflow_run_id:
              workflowRunId,
          });
        }

        // ==================================================
        // UNSUPPORTED STEP
        // ==================================================

        else {
          throw new Error(
            `Unsupported step type: ${step.type}`
          );
        }
      } catch (stepError) {
        console.error(
          "Step failed:",
          stepError
        );

        // ----------------------------------------------
        // Mark step failed
        // ----------------------------------------------

        await hasura.request(
          gql`
            mutation FailStep(
              $id: uuid!
              $error: String!
              $completedAt: timestamptz!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: "failed"
                  error: $error
                  completed_at: $completedAt
                }
              ) {
                id
              }
            }
          `,
          {
            id: stepRunId,
            error:
              stepError.message,
            completedAt: now(),
          }
        );

        // ----------------------------------------------
        // Mark workflow failed
        // ----------------------------------------------

        await hasura.request(
          gql`
            mutation FailWorkflow(
              $runId: uuid!
              $error: String!
              $completedAt: timestamptz!
            ) {
              update_workflow_runs_by_pk(
                pk_columns: { id: $runId }
                _set: {
                  status: "failed"
                  error: $error
                  completed_at: $completedAt
                }
              ) {
                id
              }
            }
          `,
          {
            runId: workflowRunId,
            error:
              stepError.message,
            completedAt: now(),
          }
        );

        return res.status(500).json({
          status: "failed",
          message:
            stepError.message,
          workflow_run_id:
            workflowRunId,
        });
      }
    }

    // ==================================================
    // COMPLETE WORKFLOW
    // ==================================================

    const completeRunMutation = gql`
      mutation CompleteRun(
        $runId: uuid!
        $completedAt: timestamptz!
      ) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $runId }
          _set: {
            status: "completed"
            completed_at: $completedAt
          }
        ) {
          id
          status
        }
      }
    `;

    await hasura.request(
      completeRunMutation,
      {
        runId: workflowRunId,
        completedAt: now(),
      }
    );

    // ==================================================
    // INCREMENT QUOTA
    // ==================================================

    const quotaMutation = gql`
      mutation IncrementQuota(
        $orgId: uuid!
      ) {
        update_organizations_by_pk(
          pk_columns: { id: $orgId }
          _inc: {
            quota_used: 1
          }
        ) {
          id
          quota_used
        }
      }
    `;

    await hasura.request(
      quotaMutation,
      {
        orgId: organization.id,
      }
    );

    return res.json({
      status: "completed",
      message:
        "Workflow completed successfully",
      workflow_run_id:
        workflowRunId,
    });
  } catch (error) {
    console.error(
      "triggerWorkflowRun error:",
      error
    );

    return res.status(500).json({
      status: "failed",
      message: error.message,
      workflow_run_id: null,
    });
  }
});

// ======================================================
// APPROVE WORKFLOW RUN
// ======================================================

app.post(
  "/approveWorkflowRun",
  async (req, res) => {
    try {
      const input =
        req.body.input || {};

      const sessionVariables =
        req.body.session_variables || {};

      const workflowRunId =
        input.workflow_run_id;

      const userId =
        sessionVariables[
          "x-hasura-user-id"
        ];

      // ------------------------------------------------
      // Validate
      // ------------------------------------------------

      if (!workflowRunId) {
        return res.status(400).json({
          status: "failed",
          message:
            "workflow_run_id is required",
          workflow_run_id: null,
        });
      }

      if (!userId) {
        return res.status(401).json({
          status: "failed",
          message:
            "Authentication required",
          workflow_run_id:
            workflowRunId,
        });
      }

      // ------------------------------------------------
      // Get paused workflow
      // ------------------------------------------------

      const runQuery = gql`
        query GetPausedWorkflowRun(
          $runId: uuid!
          $userId: uuid!
        ) {
          workflow_runs_by_pk(
            id: $runId
          ) {
            id
            status
            workflow_id

            workflow {
              organization {
                id
                name
                quota_allowed
                quota_used

                org_members(
                  where: {
                    user_id: {
                      _eq: $userId
                    }
                  }
                ) {
                  user_id
                  role
                }
              }

              workflow_steps(
                order_by: {
                  position: asc
                }
              ) {
                id
                type
                position
              }
            }
          }
        }
      `;

      const runData =
        await hasura.request(
          runQuery,
          {
            runId: workflowRunId,
            userId,
          }
        );

      const run =
        runData.workflow_runs_by_pk;

      if (!run) {
        return res.status(404).json({
          status: "failed",
          message:
            "Workflow run not found",
          workflow_run_id:
            workflowRunId,
        });
      }

      // ------------------------------------------------
      // Must be paused
      // ------------------------------------------------

      if (run.status !== "paused") {
        return res.status(400).json({
          status: "failed",
          message:
            `Workflow run is not paused. Current status: ${run.status}`,
          workflow_run_id:
            workflowRunId,
        });
      }

      // ------------------------------------------------
      // Membership
      // ------------------------------------------------

      const organization =
        run.workflow.organization;

      const membership =
        organization.org_members[0];

      if (!membership) {
        return res.status(403).json({
          status: "failed",
          message:
            "You are not a member of this organisation",
          workflow_run_id:
            workflowRunId,
        });
      }

      // ------------------------------------------------
      // Only owner can approve
      // ------------------------------------------------

      if (membership.role !== "owner") {
        return res.status(403).json({
          status: "failed",
          message:
            "Only the organisation owner can approve this workflow",
          workflow_run_id:
            workflowRunId,
        });
      }

      // ------------------------------------------------
      // Find approval gate
      // ------------------------------------------------

      const approvalWorkflowStep =
        run.workflow.workflow_steps.find(
          (step) =>
            step.type ===
            "approval_gate"
        );

      if (!approvalWorkflowStep) {
        return res.status(400).json({
          status: "failed",
          message:
            "No approval gate exists in this workflow",
          workflow_run_id:
            workflowRunId,
        });
      }

      // ------------------------------------------------
      // Find paused approval step run
      // ------------------------------------------------

      const stepRunQuery = gql`
        query GetApprovalStepRun(
          $runId: uuid!
          $stepId: uuid!
        ) {
          step_runs(
            where: {
              workflow_run_id: {
                _eq: $runId
              }

              workflow_step_id: {
                _eq: $stepId
              }

              status: {
                _eq: "paused"
              }
            }

            limit: 1
          ) {
            id
            status
          }
        }
      `;

      const stepRunData =
        await hasura.request(
          stepRunQuery,
          {
            runId: workflowRunId,
            stepId:
              approvalWorkflowStep.id,
          }
        );

      const approvalStepRun =
        stepRunData.step_runs[0];

      if (!approvalStepRun) {
        return res.status(400).json({
          status: "failed",
          message:
            "No paused approval step found",
          workflow_run_id:
            workflowRunId,
        });
      }

      const approvedAt = now();

      // ------------------------------------------------
      // Approve workflow
      // ------------------------------------------------

      const approveMutation = gql`
        mutation ApproveWorkflow(
          $stepId: uuid!
          $runId: uuid!
          $approvedBy: uuid!
          $approvedAt: timestamptz!
          $output: jsonb!
        ) {
          update_step_runs_by_pk(
            pk_columns: {
              id: $stepId
            }

            _set: {
              status: "completed"
              approved_by: $approvedBy
              approved_at: $approvedAt
              completed_at: $approvedAt
              output: $output
            }
          ) {
            id
            status
          }

          update_workflow_runs_by_pk(
            pk_columns: {
              id: $runId
            }

            _set: {
              status: "completed"
              completed_at: $approvedAt
            }
          ) {
            id
            status
          }
        }
      `;

      await hasura.request(
        approveMutation,
        {
          stepId:
            approvalStepRun.id,

          runId:
            workflowRunId,

          approvedBy:
            userId,

          approvedAt,

          output: {
            message:
              "Workflow approved",

            approved: true,

            approved_by:
              userId,

            approved_at:
              approvedAt,
          },
        }
      );

      // ==================================================
      // INCREMENT QUOTA AFTER APPROVAL
      // ==================================================

      const quotaMutation = gql`
        mutation IncrementQuota(
          $orgId: uuid!
        ) {
          update_organizations_by_pk(
            pk_columns: {
              id: $orgId
            }

            _inc: {
              quota_used: 1
            }
          ) {
            id
            quota_used
          }
        }
      `;

      const quotaResult = await hasura.request(
        quotaMutation,
        {
          orgId: organization.id,
        }
      );

      console.log(
        "QUOTA UPDATED:",
        quotaResult.update_organizations_by_pk
      );

      // ------------------------------------------------
      // Response
      // ------------------------------------------------

      return res.json({
        status: "completed",
        message:
          "Workflow approved and completed",
        workflow_run_id:
          workflowRunId,
      });
    } catch (error) {
      console.error(
        "approveWorkflowRun error:",
        error
      );

      return res.status(500).json({
        status: "failed",
        message: error.message,
        workflow_run_id:
          req.body?.input
            ?.workflow_run_id ||
          null,
      });
    }
  }
);

// ======================================================
// START SERVER
// ======================================================

const PORT =
  process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Backend running on http://localhost:${PORT}`
  );
});