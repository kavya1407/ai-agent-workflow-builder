import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "https://ai-agent-workflow-builder-backend-chfg.onrender.com";

const WORKFLOW_ID =
  "e155fa4a-802b-491a-999b-d0aef0419bd5";

const USER_ID =
  "d9eabf93-dcca-44ce-a0be-7e2fa9cd2e55";

const ORGANIZATION_ID =
  "906774d4-9f33-47c1-9c82-acda8c637578";

function App() {
  const [status, setStatus] = useState("ready");
  const [message, setMessage] = useState("");
  const [workflowRunId, setWorkflowRunId] = useState(null);

  const [quota, setQuota] = useState({
    used: 0,
    allowed: 100,
  });

  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [stepDetails, setStepDetails] = useState([]);

  const [historyFilter, setHistoryFilter] = useState("all");

  const [loadingQuota, setLoadingQuota] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState(false);

  // =====================================================
  // LOAD QUOTA
  // =====================================================

  const loadQuota = async () => {
    try {
      setLoadingQuota(true);

      const response = await fetch(
        `${API_URL}/organization/${ORGANIZATION_ID}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to load quota"
        );
      }

      if (data.organization) {
        setQuota({
          used: Number(data.organization.quota_used),
          allowed: Number(data.organization.quota_allowed),
        });
      }
    } catch (error) {
      console.error("Quota error:", error);
    } finally {
      setLoadingQuota(false);
    }
  };

  // =====================================================
  // LOAD RUN HISTORY
  // =====================================================

  const loadRunHistory = async () => {
    try {
      setLoadingHistory(true);

      const response = await fetch(
        `${API_URL}/workflow-runs/${WORKFLOW_ID}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to load run history"
        );
      }

      const workflowRuns = data.runs || [];

      setRuns(workflowRuns);

      // Restore latest workflow state
      const latestRun = workflowRuns[0];

      if (latestRun) {
        setWorkflowRunId(latestRun.id);

        if (latestRun.status === "paused") {
          setStatus("paused");
          setMessage(
            "This workflow is waiting for owner approval."
          );
        } else if (latestRun.status === "completed") {
          setStatus("ready");
          setMessage("");
        } else if (latestRun.status === "failed") {
          setStatus("failed");
          setMessage(
            latestRun.error ||
              "The latest workflow run failed."
          );
        } else if (latestRun.status === "running") {
          setStatus("running");
          setMessage(
            "Workflow is currently running."
          );
        }
      }
    } catch (error) {
      console.error("Run history error:", error);
    } finally {
      setLoadingHistory(false);
    }
  };

  // =====================================================
  // LOAD STEP DETAILS
  // =====================================================

  const loadStepDetails = async (runId) => {
    try {
      setLoadingSteps(true);
      setSelectedRun(runId);
      setStepDetails([]);

      const response = await fetch(
        `${API_URL}/workflow-run/${runId}/steps`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Failed to load step details"
        );
      }

      setStepDetails(data.steps || []);
    } catch (error) {
      console.error("Step details error:", error);
      setStepDetails([]);
    } finally {
      setLoadingSteps(false);
    }
  };

  // =====================================================
  // INITIAL LOAD
  // =====================================================

  useEffect(() => {
    loadQuota();
    loadRunHistory();
  }, []);

  // =====================================================
  // RUN WORKFLOW
  // =====================================================

  const runWorkflow = async () => {
    try {
      setStatus("running");
      setMessage("Running workflow...");
      setWorkflowRunId(null);
      setSelectedRun(null);
      setStepDetails([]);

      const response = await fetch(
        `${API_URL}/triggerWorkflowRun`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: {
              workflow_id: WORKFLOW_ID,
            },
            session_variables: {
              "x-hasura-user-id": USER_ID,
            },
          }),
        }
      );

      const data = await response.json();

      if (response.status === 429) {
        setStatus("quota_exhausted");
        setMessage(
          "Organisation quota exhausted. Please increase your quota before running another workflow."
        );
        setWorkflowRunId(null);

        await loadQuota();
        await loadRunHistory();

        return;
      }

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to run workflow"
        );
      }

      setStatus(data.status);
      setMessage(data.message);
      setWorkflowRunId(data.workflow_run_id);

      await loadQuota();
      await loadRunHistory();

      if (data.status === "paused") {
        setStatus("paused");
        setMessage(data.message);
        setWorkflowRunId(data.workflow_run_id);
      }
    } catch (error) {
      console.error("Run workflow error:", error);

      setStatus("failed");
      setMessage(error.message);

      await loadRunHistory();
    }
  };

  // =====================================================
  // APPROVE WORKFLOW
  // =====================================================

  const approveWorkflow = async () => {
    if (!workflowRunId) {
      setStatus("failed");
      setMessage(
        "No workflow run is available for approval."
      );
      return;
    }

    try {
      setStatus("approving");
      setMessage("Approving workflow...");

      const response = await fetch(
        `${API_URL}/approveWorkflowRun`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: {
              workflow_run_id: workflowRunId,
            },
            session_variables: {
              "x-hasura-user-id": USER_ID,
            },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Approval failed"
        );
      }

      setStatus(data.status);
      setMessage(data.message);

      await loadQuota();
      await loadRunHistory();
      await loadStepDetails(workflowRunId);
    } catch (error) {
      console.error("Approval error:", error);

      setStatus("failed");
      setMessage(error.message);

      await loadRunHistory();
    }
  };

  // =====================================================
  // HELPERS
  // =====================================================

  const formatDate = (date) => {
    if (!date) {
      return "-";
    }

    return new Date(date).toLocaleString();
  };

  const getStatusLabel = () => {
    switch (status) {
      case "ready":
        return "Ready";
      case "running":
        return "Running";
      case "paused":
        return "Waiting for approval";
      case "approving":
        return "Approving";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "quota_exhausted":
        return "Quota Exhausted";
      default:
        return status;
    }
  };

  const getStepLabel = (type) => {
    switch (type) {
      case "llm_call":
        return "LLM Call";
      case "http_request":
        return "HTTP Request";
      case "conditional_branch":
        return "Conditional";
      case "approval_gate":
        return "Approval Gate";
      default:
        return type || "Workflow Step";
    }
  };

  // =====================================================
  // COUNTS
  // =====================================================

  const completedCount = runs.filter(
    (run) => run.status === "completed"
  ).length;

  const pausedCount = runs.filter(
    (run) => run.status === "paused"
  ).length;

  const failedCount = runs.filter(
    (run) => run.status === "failed"
  ).length;

  const runningCount = runs.filter(
    (run) => run.status === "running"
  ).length;

  const filteredRuns = runs.filter((run) => {
    if (historyFilter === "all") {
      return true;
    }

    return run.status === historyFilter;
  });

  const steps = [
    {
      number: 1,
      name: "LLM Call",
      description: "Generate AI response",
    },
    {
      number: 2,
      name: "HTTP Request",
      description: "Call external API",
    },
    {
      number: 3,
      name: "Conditional",
      description: "Evaluate AI decision",
    },
    {
      number: 4,
      name: "Approval Gate",
      description: "Owner approval required",
    },
  ];

  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="app">

      {/* HEADER */}

      <header className="header">
        <div>
          <h1>AI Workflow Builder</h1>
          <p>
            Build, run and manage AI workflows.
          </p>
        </div>

        <div className="quota">
          <div className="quota-info">
            <span>Organisation Quota</span>
            <strong>
              {quota.used} / {quota.allowed}
            </strong>
          </div>

          <button
            className="refresh-button"
            onClick={loadQuota}
            disabled={loadingQuota}
          >
            {loadingQuota
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </div>
      </header>

      <main className="container">

        {/* WORKFLOW */}

        <section className="workflow-card">

          <div className="workflow-header">

            <div>
              <span className="badge">
                WORKFLOW
              </span>

              <h2>AI Demo Workflow</h2>

              <p>
                A simple AI-powered workflow with
                conditional logic and human approval.
              </p>
            </div>

            <div
              className={`status ${status}`}
            >
              <span className="status-dot"></span>
              {getStatusLabel()}
            </div>

          </div>

          <div className="steps">
            {steps.map((step, index) => (
              <div
                className="step-wrapper"
                key={step.number}
              >
                <div className="step">

                  <div className="step-number">
                    {step.number}
                  </div>

                  <div>
                    <h3>{step.name}</h3>
                    <p>{step.description}</p>
                  </div>

                </div>

                {index <
                  steps.length - 1 && (
                  <div className="connector"></div>
                )}
              </div>
            ))}
          </div>

          <div className="actions">

            <button
              className="run-button"
              onClick={runWorkflow}
              disabled={
                status === "running" ||
                status === "approving" ||
                status === "paused"
              }
            >
              {status === "running"
                ? "Running..."
                : "▶ Run Workflow"}
            </button>

          </div>

          {status === "paused" &&
            workflowRunId && (
              <div className="approval-box">

                <div>
                  <h3>
                    ⚠️ Approval Required
                  </h3>

                  <p>
                    This workflow is waiting for
                    owner approval before it can
                    continue.
                  </p>
                </div>

                <button
                  className="approve-button"
                  onClick={approveWorkflow}
                >
                  ✓ Approve Workflow
                </button>

              </div>
            )}

          {message && (
            <div
              className={`result ${status}`}
            >

              <div>
                <strong>
                  {getStatusLabel()}
                </strong>

                <p>{message}</p>
              </div>

              {workflowRunId && (
                <div className="run-id">

                  <span>Run ID</span>

                  <code>
                    {workflowRunId}
                  </code>

                </div>
              )}

            </div>
          )}

        </section>

        {/* HISTORY */}

        <section className="history-card">

          <div className="history-header">

            <div>
              <span className="badge">
                HISTORY
              </span>

              <h2>
                Workflow Run History
              </h2>

              <p>
                View previous workflow executions.
              </p>
            </div>

            <button
              className="refresh-button"
              onClick={loadRunHistory}
              disabled={loadingHistory}
            >
              {loadingHistory
                ? "Refreshing..."
                : "Refresh History"}
            </button>

          </div>

          {/* SUMMARY */}

          <div className="history-summary">

            <div className="summary-card">
              <span>Total Runs</span>
              <strong>{runs.length}</strong>
            </div>

            <div className="summary-card completed-summary">
              <span>Completed</span>
              <strong>{completedCount}</strong>
            </div>

            <div className="summary-card paused-summary">
              <span>Paused</span>
              <strong>{pausedCount}</strong>
            </div>

            <div className="summary-card failed-summary">
              <span>Failed</span>
              <strong>{failedCount}</strong>
            </div>

          </div>

          {/* FILTERS */}

          <div className="history-filters">

            <button
              className={
                historyFilter === "all"
                  ? "filter-button active"
                  : "filter-button"
              }
              onClick={() =>
                setHistoryFilter("all")
              }
            >
              All
            </button>

            <button
              className={
                historyFilter === "completed"
                  ? "filter-button active"
                  : "filter-button"
              }
              onClick={() =>
                setHistoryFilter("completed")
              }
            >
              Completed
            </button>

            <button
              className={
                historyFilter === "paused"
                  ? "filter-button active"
                  : "filter-button"
              }
              onClick={() =>
                setHistoryFilter("paused")
              }
            >
              Paused
            </button>

            <button
              className={
                historyFilter === "failed"
                  ? "filter-button active"
                  : "filter-button"
              }
              onClick={() =>
                setHistoryFilter("failed")
              }
            >
              Failed
            </button>

          </div>

          {/* HISTORY LIST */}

          {loadingHistory ? (
            <div className="empty-history">
              Loading run history...
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="empty-history">
              No{" "}
              {historyFilter === "all"
                ? ""
                : historyFilter}{" "}
              workflow runs found.
            </div>
          ) : (
            <div className="history-list">

              {filteredRuns.map((run) => (
                <div
                  className={`history-item ${
                    selectedRun === run.id
                      ? "selected"
                      : ""
                  }`}
                  key={run.id}
                  onClick={() =>
                    loadStepDetails(run.id)
                  }
                >

                  <div className="history-main">

                    <div
                      className={`history-status ${run.status}`}
                    >
                      {run.status}
                    </div>

                    <code className="history-run-id">
                      {run.id}
                    </code>

                  </div>

                  <div className="history-times">

                    <div>
                      <span>Started</span>
                      <strong>
                        {formatDate(
                          run.started_at
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>Completed</span>
                      <strong>
                        {formatDate(
                          run.completed_at
                        )}
                      </strong>
                    </div>

                  </div>

                  {run.error && (
                    <div className="history-error">

                      <strong>Error</strong>

                      <p>
                        {run.error}
                      </p>

                    </div>
                  )}

                </div>
              ))}

            </div>
          )}

          {/* STEP DETAILS */}

          {selectedRun && (
            <div className="step-details">

              <div className="step-details-header">

                <div>
                  <span className="badge">
                    RUN DETAILS
                  </span>

                  <h2>
                    Step Execution Details
                  </h2>

                  <p>
                    Run ID:{" "}
                    <code>
                      {selectedRun}
                    </code>
                  </p>
                </div>

                <button
                  className="refresh-button"
                  onClick={() =>
                    loadStepDetails(
                      selectedRun
                    )
                  }
                  disabled={loadingSteps}
                >
                  {loadingSteps
                    ? "Refreshing..."
                    : "Refresh Steps"}
                </button>

              </div>

              {loadingSteps ? (
                <div className="empty-history">
                  Loading step details...
                </div>
              ) : stepDetails.length === 0 ? (
                <div className="empty-history">
                  No step details found.
                </div>
              ) : (
                <div className="step-details-list">

                  {stepDetails.map(
                    (step, index) => (
                      <div
                        className="step-detail-item"
                        key={step.id}
                      >

                        <div className="step-detail-top">

                          <div className="step-detail-number">
                            {index + 1}
                          </div>

                          <div className="step-detail-title">

                            <strong>
                              {getStepLabel(
                                step.workflow_step?.type
                              )}
                            </strong>

                            <span
                              className={`history-status ${step.status}`}
                            >
                              {step.status}
                            </span>

                          </div>

                        </div>

                        <div className="step-detail-info">

                          <div>
                            <span>Started</span>
                            <strong>
                              {formatDate(
                                step.started_at
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>Completed</span>
                            <strong>
                              {formatDate(
                                step.completed_at
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>Attempts</span>
                            <strong>
                              {step.attempt_count}
                            </strong>
                          </div>

                        </div>

                        {step.output && (
                          <div className="step-output">

                            <strong>
                              Output
                            </strong>

                            <pre>
                              {JSON.stringify(
                                step.output,
                                null,
                                2
                              )}
                            </pre>

                          </div>
                        )}

                        {step.error && (
                          <div className="history-error">

                            <strong>
                              Error
                            </strong>

                            <p>
                              {step.error}
                            </p>

                          </div>
                        )}

                      </div>
                    )
                  )}

                </div>
              )}

            </div>
          )}

        </section>

      </main>
    </div>
  );
}

export default App;
