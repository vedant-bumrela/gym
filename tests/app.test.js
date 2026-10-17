const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { MongoMemoryServer } = require("mongodb-memory-server");

const ROOT = path.join(__dirname, "..");
let mongo;
let serverProcess;
let baseUrl;

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MONGODB_URI: mongo.getUri("ironhouse_test"),
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`App server exited with code ${serverProcess.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("App server did not become ready in time.");
}, { timeout: 120_000 });

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (mongo) await mongo.stop();
});

test("MongoDB startup errors identify failed configuration without exposing credentials", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        MONGODB_URI: "mongodb://preview-user:preview-secret@127.0.0.1:1/ironhouse",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /configuration: environment/);
  assert.match(result.stderr, /127\.0\.0\.1:1\/ironhouse/);
  assert.doesNotMatch(result.stderr, /preview-user|preview-secret/);
});

test("MongoDB-backed gym workflows validate members, attendance, classes, bookings, and payments", async () => {
  const health = await request("/api/health");
  assert.equal(health.payload.status, "ok");

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  const dashboardHtml = await page.text();
  assert.match(dashboardHtml, /data-page="dashboard"/);
  assert.match(dashboardHtml, /href="\/members"/);
  for (const [route, heading] of [
    ["dashboard", "Good morning"],
    ["members", "Your members"],
    ["classes", "Class timetable"],
    ["trainers", "Meet your coaches"],
    ["attendance", "Attendance"],
    ["payments", "Payments"],
  ]) {
    const response = await fetch(`${baseUrl}/${route}`);
    assert.equal(response.status, 200, `/${route} should be a standalone webpage`);
    const html = await response.text();
    assert.match(html, new RegExp(`data-page="${route}"`));
    assert.match(html, new RegExp(`<h1>${heading}`));
    assert.equal((html.match(/class="page-view"/g) || []).length, 1, `/${route} should contain only its own page content`);
  }

  const membersResponse = await request("/api/members");
  assert.equal(membersResponse.response.status, 200);
  assert.ok(membersResponse.payload.length >= 9);

  const memberResult = await request("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test Member",
      email: "test.member@example.test",
      phone: "07123456789",
      goal: "Strength",
      plan: "Basic",
    }),
  });
  assert.equal(memberResult.response.status, 201);
  const memberId = memberResult.payload.id;
  const originalExpiry = memberResult.payload.expiresAt;
  assert.match(memberId, /^MBR-\d+$/);

  const duplicateMember = await request("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test Member",
      email: "test.member@example.test",
      phone: "07123456789",
      goal: "Strength",
      plan: "Basic",
    }),
  });
  assert.equal(duplicateMember.response.status, 409);

  const checkin = await request("/api/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  assert.equal(checkin.response.status, 201);
  assert.equal(checkin.payload.memberId, memberId);

  const duplicateCheckin = await request("/api/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  assert.equal(duplicateCheckin.response.status, 409);

  const secondMember = await request("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Second Test Member",
      email: "second.test.member@example.test",
      phone: "07123456788",
      goal: "Yoga",
      plan: "Standard",
    }),
  });
  assert.equal(secondMember.response.status, 201);

  const trainers = await request("/api/trainers");
  assert.equal(trainers.response.status, 200);
  assert.ok(trainers.payload.length >= 5);
  assert.ok(trainers.payload.some((trainer) => /pilates/i.test(trainer.specialty)));
  const todaysClasses = await request(`/api/classes?from=${new Date().toISOString().slice(0, 10)}&days=1`);
  assert.match(todaysClasses.payload.find((entry) => entry.title === "Full body strength").trainerName, /maya/i);
  const gymClass = await request("/api/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Test strength class",
      category: "Strength",
      trainerId: trainers.payload[0].id,
      date: new Date().toISOString().slice(0, 10),
      time: "23:00",
      duration: "45",
      capacity: "1",
      level: "All levels",
      description: "A friendly test class.",
    }),
  });
  assert.equal(gymClass.response.status, 201);
  assert.equal(gymClass.payload.trainerName, trainers.payload[0].name);

  const booking = await request(`/api/classes/${gymClass.payload.id}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  assert.equal(booking.response.status, 201);

  const duplicateBooking = await request(`/api/classes/${gymClass.payload.id}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  assert.equal(duplicateBooking.response.status, 409);

  const fullClassBooking = await request(`/api/classes/${gymClass.payload.id}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId: secondMember.payload.id }),
  });
  assert.equal(fullClassBooking.response.status, 409);

  const classList = await request(`/api/classes?from=${new Date().toISOString().slice(0, 10)}&days=1`);
  const savedClass = classList.payload.find((entry) => entry.id === gymClass.payload.id);
  assert.equal(savedClass.bookedCount, 1);
  assert.equal(savedClass.bookings[0].memberId, memberId);

  const cancelled = await request(`/api/bookings/${booking.payload.id}`, { method: "DELETE" });
  assert.equal(cancelled.response.status, 200);

  const payment = await request("/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId, method: "Card" }),
  });
  assert.equal(payment.response.status, 201);
  assert.equal(payment.payload.amount, 29);
  const updatedMember = await request(`/api/members?search=${encodeURIComponent(memberId)}`);
  const expectedExpiry = new Date(`${originalExpiry}T00:00:00.000Z`);
  expectedExpiry.setUTCDate(expectedExpiry.getUTCDate() + 30);
  assert.equal(updatedMember.payload[0].expiresAt, expectedExpiry.toISOString().slice(0, 10));

  const cleanup = await request(`/api/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
  assert.equal(cleanup.response.status, 200);
  const secondCleanup = await request(`/api/members/${encodeURIComponent(secondMember.payload.id)}`, { method: "DELETE" });
  assert.equal(secondCleanup.response.status, 200);
});
