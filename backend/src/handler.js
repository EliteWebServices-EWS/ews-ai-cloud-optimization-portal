const { mockClients, mockDashboard }       = require("./mock-data");
const { listTenants, getTenant,
        saveDashboardSnapshot }            = require("./tenants");
const { syncFromAws }                     = require("./aws-sync");
const { CognitoIdentityProviderClient,
        AdminGetUserCommand }              = require("@aws-sdk/client-cognito-identity-provider");

const ENABLE_SYNC  = process.env.ENABLE_AWS_SYNC === "true";
const USER_POOL_ID = process.env.USER_POOL_ID;
const cognito      = new CognitoIdentityProviderClient({});

const cors = {
  "Access-Control-Allow-Origin":  process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

function respond(statusCode, body) {
  return { statusCode, headers: cors, body: JSON.stringify(body) };
}

// HTTP API puts claims under requestContext.authorizer.jwt.claims
// REST API puts claims under requestContext.authorizer.claims
// Supporting both so local testing still works
function getUserEmail(event) {
  return event?.requestContext?.authorizer?.jwt?.claims?.email
      || event?.requestContext?.authorizer?.claims?.email
      || null;
}

async function isAllowed(userEmail, clientId) {
  if (!userEmail) return false;
  if (userEmail.endsWith("@elitewebservicesllc.com")) return true;
  try {
    const user = await cognito.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username:   userEmail
    }));
    const attr = user.UserAttributes?.find(
      a => a.Name === "custom:allowed_clients"
    );
    if (!attr?.Value) return false;
    const allowed = attr.Value.split(",").map(s => s.trim());
    return allowed.includes(clientId) || allowed.includes("*");
  } catch (err) {
    console.error("Cognito lookup failed:", err.message);
    return false;
  }
}

exports.handler = async (event) => {

  // EventBridge scheduled sync
  if (event.source === "eventbridge" && event.action === "syncAll") {
    const tenants = await listTenants();
    const results = [];
    for (const t of tenants) {
      if (t.status !== "Active" || !t.roleArn) {
        results.push({ id: t.id, skipped: true });
        continue;
      }
      try {
        const dash = await syncFromAws(t);
        await saveDashboardSnapshot(t.id, dash);
        results.push({ id: t.id, success: true });
        console.log("Synced:", t.id);
      } catch (e) {
        results.push({ id: t.id, error: e.message });
        console.error("Failed:", t.id, e.message);
      }
    }
    return { statusCode: 200, body: JSON.stringify(results) };
  }

  // HTTP API uses requestContext.http.method and requestContext.http.path
  // REST API uses event.httpMethod and event.path
  // Supporting both so code works in all environments
  const method = event.requestContext?.http?.method
              || event.httpMethod
              || "";
  const path   = event.requestContext?.http?.path
              || event.path
              || "";

  if (method === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  const userEmail = getUserEmail(event);

  // GET /v1/health — public, no auth
  if (method === "GET" && path === "/v1/health") {
    return respond(200, {
      status:    "ok",
      timestamp: new Date().toISOString(),
      mode:      ENABLE_SYNC ? "live" : "mock"
    });
  }

  // GET /v1/clients
  if (method === "GET" && path === "/v1/clients") {
    if (!ENABLE_SYNC) return respond(200, mockClients);
    const tenants = await listTenants();
    if (userEmail?.endsWith("@elitewebservicesllc.com")) {
      return respond(200, tenants);
    }
    const filtered = [];
    for (const t of tenants) {
      if (await isAllowed(userEmail, t.id)) filtered.push(t);
    }
    return respond(200, filtered);
  }

  // GET /v1/dashboard/{clientId}
  const dashMatch = path.match(/^\/v1\/dashboard\/(.+)$/);
  if (method === "GET" && dashMatch) {
    const clientId = dashMatch[1];
    if (ENABLE_SYNC && !(await isAllowed(userEmail, clientId))) {
      return respond(403, { error: "Access denied to this client" });
    }
    if (!ENABLE_SYNC) return respond(200, mockDashboard(clientId, clientId));
    const tenant = await getTenant(clientId);
    if (!tenant) return respond(404, { error: "Client not found" });
    const dash = tenant.dashboardSnapshot
      || mockDashboard(clientId, tenant.name);
    return respond(200, dash);
  }

  // POST /v1/clients/{clientId}/sync
  const syncMatch = path.match(/^\/v1\/clients\/(.+)\/sync$/);
  if (method === "POST" && syncMatch) {
    const clientId = syncMatch[1];
    if (ENABLE_SYNC && !(await isAllowed(userEmail, clientId))) {
      return respond(403, { error: "Access denied to this client" });
    }
    if (!ENABLE_SYNC) return respond(200, mockDashboard(clientId, clientId));
    const tenant = await getTenant(clientId);
    if (!tenant) return respond(404, { error: "Client not found" });
    const dash = await syncFromAws(tenant);
    await saveDashboardSnapshot(clientId, dash);
    return respond(200, dash);
  }

  // GET /v1/auth/me
  if (method === "GET" && path === "/v1/auth/me") {
    if (!userEmail) return respond(401, { error: "Not authenticated" });
    return respond(200, {
      email:   userEmail,
      isStaff: userEmail.endsWith("@elitewebservicesllc.com")
    });
  }

  return respond(404, { error: "Route not found" });
};
