require("dotenv").config();

const { createClient } = require("@nhost/nhost-js");
const { GraphQLClient, gql } = require("graphql-request");

const nhost = createClient({
  subdomain: "vkhnqaqfzhnbkgxpjojt",
  region: "ap-south-1",
});

async function testWorkflowAction() {
  try {
    // 1. Login
    const result = await nhost.auth.signInEmailPassword({
      email: "kavyashreemanthri@gmail.com",
      password: "Kavya@123",
    });

    const session = result.body.session;

    console.log("Login successful!");
    console.log("User ID:", session.user.id);

    // 2. Authenticated GraphQL client
    const client = new GraphQLClient(
      process.env.HASURA_GRAPHQL_URL,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      }
    );

    // 3. Trigger workflow
    const mutation = gql`
      mutation TriggerWorkflow($workflowId: uuid!) {
        triggerWorkflowRun(workflow_id: $workflowId) {
          status
          message
          workflow_run_id
        }
      }
    `;

    const data = await client.request(mutation, {
      workflowId: "e155fa4a-802b-491a-999b-d0aef0419bd5",
    });

    console.log("ACTION RESULT:");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("ACTION FAILED:");

    if (error.response) {
      console.error(JSON.stringify(error.response, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

testWorkflowAction();