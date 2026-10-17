const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");

const ENV_FILE = path.join(__dirname, ".env");
const hasProcessMongoUri = Boolean(process.env.MONGODB_URI);
const envResult = dotenv.config({ path: ENV_FILE });
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ironhouse";
const MONGODB_URI_SOURCE = hasProcessMongoUri
  ? "environment"
  : (envResult.parsed?.MONGODB_URI ? ".env" : "local default");
const PUBLIC_DIR = path.join(__dirname, "public");
const LEGACY_DATA_FILE = path.join(__dirname, "data", "gym.json");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const PLAN_PRICES = { Basic: 29, Standard: 49, Premium: 79 };
const CATEGORIES = ["Strength", "HIIT", "Yoga", "Pilates", "Spin", "Boxing", "Mobility"];
const today = () => new Date().toISOString().slice(0, 10);
const dateOffset = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const memberSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  goal: { type: String, required: true },
  plan: { type: String, enum: Object.keys(PLAN_PRICES), required: true },
  joinedAt: { type: String, required: true },
  expiresAt: { type: String, required: true, index: true },
}, { timestamps: true, versionKey: false });

const attendanceSchema = new mongoose.Schema({
  memberId: { type: String, required: true },
  memberName: { type: String, required: true },
  checkedInAt: { type: Date, required: true, default: Date.now },
  localDate: { type: String, required: true },
}, { versionKey: false });
attendanceSchema.index({ memberId: 1, localDate: 1 }, { unique: true });

const paymentSchema = new mongoose.Schema({
  memberId: { type: String, required: true, index: true },
  memberName: { type: String, required: true },
  plan: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  paidAt: { type: Date, required: true, default: Date.now },
  method: { type: String, enum: ["Card", "Direct debit", "Cash"], required: true },
  status: { type: String, enum: ["Paid"], default: "Paid" },
}, { versionKey: false });

const trainerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  specialty: { type: String, required: true },
  bio: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  color: { type: String, default: "sage" },
}, { timestamps: true, versionKey: false });

const classSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, enum: CATEGORIES, required: true },
  description: { type: String, required: true },
  trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
  trainerName: { type: String, required: true },
  date: { type: String, required: true, index: true },
  time: { type: String, required: true },
  duration: { type: Number, required: true, min: 15, max: 180 },
  capacity: { type: Number, required: true, min: 1, max: 80 },
  bookedCount: { type: Number, default: 0, min: 0 },
  level: { type: String, enum: ["All levels", "Beginner", "Intermediate", "Advanced"], default: "All levels" },
  color: { type: String, default: "sage" },
}, { timestamps: true, versionKey: false });

const bookingSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: "GymClass", required: true, index: true },
  memberId: { type: String, required: true },
  memberName: { type: String, required: true },
  bookedAt: { type: Date, default: Date.now },
}, { versionKey: false });
bookingSchema.index({ classId: 1, memberId: 1 }, { unique: true });

const Member = mongoose.model("Member", memberSchema);
const Attendance = mongoose.model("Attendance", attendanceSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const Trainer = mongoose.model("Trainer", trainerSchema);
const GymClass = mongoose.model("GymClass", classSchema);
const Booking = mongoose.model("Booking", bookingSchema);

function plain(document) {
  if (!document) return document;
  const value = document.toObject ? document.toObject() : document;
  if (value._id && !value.id) value.id = String(value._id);
  delete value._id;
  delete value.__v;
  return value;
}

function createMemberData(name, email, phone, goal, plan, daysRemaining, index) {
  return {
    id: `MBR-${String(1042 + index).padStart(4, "0")}`,
    name,
    email,
    phone,
    goal,
    plan,
    joinedAt: dateOffset(-Math.max(35, 160 - index * 11)),
    expiresAt: dateOffset(daysRemaining),
  };
}

const sampleMembers = [
  ["Olivia Rhye", "olivia.rhye@example.com", "07512 830 441", "Strength", "Premium", -32],
  ["Phoenix Baker", "phoenix.baker@example.com", "07700 900 128", "Yoga", "Standard", 84],
  ["Lana Steiner", "lana.steiner@example.com", "07911 245 682", "Strength", "Premium", 16],
  ["Demi Wilkinson", "demi.wilkinson@example.com", "07862 411 093", "Pilates", "Standard", -5],
  ["Candice Wu", "candice.wu@example.com", "07422 190 536", "Cardio", "Basic", 52],
  ["Natali Craig", "natali.craig@example.com", "07754 301 720", "Yoga", "Premium", 103],
  ["Drew Cano", "drew.cano@example.com", "07533 881 204", "Strength", "Basic", -68],
  ["Orlando Diggs", "orlando.diggs@example.com", "07902 715 638", "Cardio", "Standard", 27],
  ["Andi Lane", "andi.lane@example.com", "07798 623 117", "Pilates", "Premium", 8],
].map((values, index) => createMemberData(...values, index));

const sampleTrainers = [
  { name: "Maya Bennett", specialty: "Strength & conditioning", bio: "Helping you move with confidence and build strength that lasts.", email: "maya@ironhouse.example", color: "coral" },
  { name: "Leo Grant", specialty: "HIIT & boxing", bio: "High energy, good music, and a workout you'll be proud of.", email: "leo@ironhouse.example", color: "blue" },
  { name: "Amara Okafor", specialty: "Yoga & mobility", bio: "A little room to breathe, reset, and reconnect with your body.", email: "amara@ironhouse.example", color: "violet" },
  { name: "Theo Martin", specialty: "Spin & endurance", bio: "Find your rhythm and discover what you're capable of.", email: "theo@ironhouse.example", color: "gold" },
  { name: "Iris Patel", specialty: "Pilates & core", bio: "Helping you build control, confidence, and strength from the inside out.", email: "iris@ironhouse.example", color: "sage" },
];

async function importLegacyData() {
  if (await Member.estimatedDocumentCount()) return false;
  let legacy;
  try {
    legacy = JSON.parse(await fs.readFile(LEGACY_DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    if (error instanceof SyntaxError) {
      console.error("Existing data/gym.json is invalid JSON; it has been left untouched.");
      throw error;
    }
    throw error;
  }
  if (!Array.isArray(legacy.members)) throw new Error("Existing gym.json does not contain a valid members list.");
  if (legacy.members.length) await Member.insertMany(legacy.members.map(({ createdAt, ...member }) => member), { ordered: false });
  if (Array.isArray(legacy.attendance) && legacy.attendance.length) {
    const entries = legacy.attendance.map((entry) => ({
      memberId: entry.memberId,
      memberName: entry.memberName,
      checkedInAt: new Date(entry.checkedInAt),
      localDate: new Date(entry.checkedInAt).toISOString().slice(0, 10),
    }));
    await Attendance.insertMany(entries, { ordered: false });
  }
  if (Array.isArray(legacy.payments) && legacy.payments.length) {
    await Payment.insertMany(legacy.payments.map((entry) => ({
      memberId: entry.memberId,
      memberName: entry.memberName,
      plan: entry.plan,
      amount: entry.amount,
      paidAt: new Date(entry.paidAt),
      method: entry.method,
      status: "Paid",
    })), { ordered: false });
  }
  console.log(`Imported ${legacy.members.length} members from data/gym.json into MongoDB.`);
  return true;
}

async function seedDatabase() {
  const importedLegacyData = await importLegacyData();
  if (!importedLegacyData && !(await Member.estimatedDocumentCount())) {
    await Member.insertMany(sampleMembers);
    const demoMembers = await Member.find().sort({ id: 1 }).lean();
    const now = new Date();
    await Attendance.insertMany(demoMembers.slice(0, 6).map((member, index) => ({
      memberId: member.id,
      memberName: member.name,
      checkedInAt: new Date(now.getTime() - (index + 1) * 19 * 60_000),
      localDate: today(),
    })));
    await Payment.insertMany(demoMembers.slice(0, 7).map((member, index) => ({
      memberId: member.id,
      memberName: member.name,
      plan: member.plan,
      amount: PLAN_PRICES[member.plan],
      paidAt: new Date(now.getTime() - index * 3 * 86_400_000),
      method: index % 2 ? "Card" : "Direct debit",
      status: "Paid",
    })));
    console.log("Added the starter member, attendance, and payment records.");
  }

  if (!(await Trainer.estimatedDocumentCount())) {
    await Trainer.insertMany(sampleTrainers);
  } else if (!(await Trainer.exists({ specialty: { $regex: "pilates", $options: "i" } }))) {
    await Trainer.create(sampleTrainers.find((trainer) => trainer.specialty.toLowerCase().includes("pilates")));
  }
  if (!(await GymClass.estimatedDocumentCount())) {
    const trainers = await Trainer.find().lean();
    const trainerMatches = {
      Strength: /strength/i,
      HIIT: /hiit/i,
      Yoga: /yoga/i,
      Pilates: /pilates/i,
      Spin: /spin/i,
      Boxing: /boxing/i,
      Mobility: /mobility/i,
    };
    const timetable = [
      ["Full body strength", "Strength", "Build confidence under the bar with a coached, all-levels strength session.", 0, "07:00", 50, 16, "Intermediate"],
      ["Sunrise flow", "Yoga", "Ease into the day with breath-led movement and a proper stretch.", 0, "08:30", 45, 20, "All levels"],
      ["Lunch break HIIT", "HIIT", "Short, sharp intervals that fit a busy day. Come ready to move.", 0, "12:15", 35, 14, "Intermediate"],
      ["Rhythm ride", "Spin", "Big playlists, good people, and a seriously satisfying ride.", 0, "17:30", 45, 18, "All levels"],
      ["Pilates foundations", "Pilates", "Find your centre and build control, one considered rep at a time.", 0, "18:30", 50, 16, "Beginner"],
      ["Saturday sweat", "HIIT", "A friendly, full-body circuit to get the weekend moving.", 1, "09:00", 40, 16, "All levels"],
      ["Slow Sunday yoga", "Yoga", "A slower flow to unwind, reset, and feel good for the week.", 2, "10:00", 55, 20, "All levels"],
      ["Boxing basics", "Boxing", "No experience needed. Learn the fundamentals and find your power.", 3, "18:00", 45, 12, "Beginner"],
      ["Lower body strength", "Strength", "Smart programming and practical coaching for stronger legs.", 4, "07:30", 50, 14, "Intermediate"],
      ["Mobility reset", "Mobility", "A guided session to restore range of motion and recover well.", 5, "12:00", 40, 18, "All levels"],
      ["Weekend spin club", "Spin", "A Saturday ride that always feels better than staying in bed.", 6, "09:30", 45, 20, "All levels"],
      ["Power Pilates", "Pilates", "A progressive, equipment-free class built around controlled strength.", 6, "11:00", 50, 16, "Intermediate"],
    ];
    await GymClass.insertMany(timetable.map(([title, category, description, offset, time, duration, capacity, level], index) => {
      const trainer = trainers.find((entry) => trainerMatches[category].test(entry.specialty)) || trainers[index % trainers.length];
      return {
        title, category, description, date: dateOffset(offset), time, duration, capacity, level,
        trainerId: trainer._id, trainerName: trainer.name, color: trainer.color,
      };
    }));
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function validateMember(input) {
  const member = {
    name: typeof input.name === "string" ? input.name.trim() : "",
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : "",
    phone: typeof input.phone === "string" ? input.phone.trim() : "",
    goal: typeof input.goal === "string" ? input.goal.trim() : "",
    plan: typeof input.plan === "string" ? input.plan : "",
  };
  const errors = {};
  if (member.name.length < 2 || member.name.length > 80) errors.name = "Enter a name between 2 and 80 characters.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)) errors.email = "Enter a valid email address.";
  if (member.phone.length < 7 || member.phone.length > 24) errors.phone = "Enter a valid phone number.";
  if (!["Strength", "Yoga", "Pilates", "Cardio", "General fitness"].includes(member.goal)) errors.goal = "Choose a valid fitness goal.";
  if (!Object.hasOwn(PLAN_PRICES, member.plan)) errors.plan = "Choose a valid membership plan.";
  return { member, errors };
}

function validateClass(input) {
  const data = {
    title: typeof input.title === "string" ? input.title.trim() : "",
    category: typeof input.category === "string" ? input.category : "",
    trainerId: typeof input.trainerId === "string" ? input.trainerId : "",
    date: typeof input.date === "string" ? input.date : "",
    time: typeof input.time === "string" ? input.time : "",
    duration: Number(input.duration),
    capacity: Number(input.capacity),
    level: typeof input.level === "string" ? input.level : "All levels",
    description: typeof input.description === "string" ? input.description.trim() : "",
  };
  const errors = {};
  if (data.title.length < 3 || data.title.length > 80) errors.title = "Enter a class name between 3 and 80 characters.";
  if (!CATEGORIES.includes(data.category)) errors.category = "Choose a valid class category.";
  if (!mongoose.isValidObjectId(data.trainerId)) errors.trainerId = "Choose a valid trainer.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || data.date < today()) errors.date = "Choose today or a future date.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) errors.time = "Choose a valid start time.";
  if (!Number.isInteger(data.duration) || data.duration < 15 || data.duration > 180) errors.duration = "Duration must be 15–180 minutes.";
  if (!Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > 80) errors.capacity = "Capacity must be between 1 and 80.";
  if (!["All levels", "Beginner", "Intermediate", "Advanced"].includes(data.level)) errors.level = "Choose a valid class level.";
  if (data.description.length < 8 || data.description.length > 300) errors.description = "Description must be 8–300 characters.";
  return { data, errors };
}

async function listClasses(url) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : today();
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const through = dateOffset(days);
  const classes = await GymClass.find({ date: { $gte: from, $lt: through } }).sort({ date: 1, time: 1 }).lean();
  const classIds = classes.map((entry) => entry._id);
  const bookings = classIds.length ? await Booking.find({ classId: { $in: classIds } }).sort({ bookedAt: 1 }).lean() : [];
  const bookingsByClass = new Map();
  for (const booking of bookings) {
    const key = String(booking.classId);
    if (!bookingsByClass.has(key)) bookingsByClass.set(key, []);
    bookingsByClass.get(key).push({
      id: String(booking._id),
      memberId: booking.memberId,
      memberName: booking.memberName,
      bookedAt: booking.bookedAt,
    });
  }
  return classes.map((entry) => {
    const classId = String(entry._id);
    const classBookings = bookingsByClass.get(classId) || [];
    return {
      ...plain(entry),
      bookings: classBookings,
      bookedCount: classBookings.length,
    };
  });
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  const method = request.method;

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { status: mongoose.connection.readyState === 1 ? "ok" : "unavailable", database: mongoose.connection.name });
  }

  if (method === "GET" && pathname === "/api/dashboard") {
    const month = today().slice(0, 7);
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const chartStart = new Date(monthStart);
    chartStart.setUTCMonth(chartStart.getUTCMonth() - 5);
    const [totalMembers, activeMembers, monthlyRevenue, checkInsToday, attendance, expiringMembers, payments, todaysClasses, totalBookings] = await Promise.all([
      Member.countDocuments(),
      Member.countDocuments({ expiresAt: { $gte: today() } }),
      Payment.aggregate([{ $match: { paidAt: { $gte: monthStart, $lt: monthEnd } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      Attendance.countDocuments({ localDate: today() }),
      Attendance.find({ localDate: today() }).sort({ checkedInAt: -1 }).limit(6).lean(),
      Member.find({ expiresAt: { $gte: today(), $lte: dateOffset(30) } }).sort({ expiresAt: 1 }).limit(5).lean(),
      Payment.find({ paidAt: { $gte: chartStart } }).select("paidAt amount").lean(),
      GymClass.countDocuments({ date: today() }),
      Booking.countDocuments(),
    ]);
    const revenueByMonth = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() - (5 - index));
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const amount = payments
        .filter((payment) => payment.paidAt.toISOString().slice(0, 7) === key)
        .reduce((sum, payment) => sum + payment.amount, 0);
      return {
        label: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date),
        amount,
      };
    });
    return sendJson(response, 200, {
      totalMembers,
      activeMembers,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
      checkInsToday,
      attendance: attendance.map(plain),
      expiringMembers: expiringMembers.map(plain),
      revenueByMonth,
      todaysClasses,
      totalBookings,
    });
  }

  if (method === "GET" && pathname === "/api/members") {
    const search = (url.searchParams.get("search") || "").trim();
    const status = url.searchParams.get("status") || "all";
    const filter = {};
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
        { id: { $regex: safeSearch, $options: "i" } },
      ];
    }
    if (status === "active") filter.expiresAt = { $gte: today() };
    if (status === "expired") filter.expiresAt = { $lt: today() };
    const members = await Member.find(filter).sort({ name: 1 }).lean();
    return sendJson(response, 200, members.map(plain));
  }

  if (method === "POST" && pathname === "/api/members") {
    const { member, errors } = validateMember(await readBody(request));
    if (Object.keys(errors).length) return sendJson(response, 422, { error: "Check the highlighted fields.", fields: errors });
    const highest = await Member.findOne({ id: /^MBR-\d+$/ }).sort({ id: -1 }).select("id").lean();
    const nextNumber = Math.max(1041, Number(highest?.id.match(/\d+$/)?.[0]) || 0) + 1;
    const created = await Member.create({ ...member, id: `MBR-${String(nextNumber).padStart(4, "0")}`, joinedAt: today(), expiresAt: dateOffset(30) });
    return sendJson(response, 201, plain(created));
  }

  const memberMatch = pathname.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch && (method === "PATCH" || method === "DELETE")) {
    const memberId = decodeURIComponent(memberMatch[1]);
    const member = await Member.findOne({ id: memberId });
    if (!member) return sendJson(response, 404, { error: "Member not found." });
    if (method === "PATCH") {
      const { member: updates, errors } = validateMember(await readBody(request));
      if (Object.keys(errors).length) return sendJson(response, 422, { error: "Check the highlighted fields.", fields: errors });
      Object.assign(member, updates);
      await member.save();
      return sendJson(response, 200, plain(member));
    }
    await Promise.all([
      Attendance.deleteMany({ memberId }),
      Booking.deleteMany({ memberId }),
    ]);
    await Member.deleteOne({ id: memberId });
    return sendJson(response, 200, { deleted: true });
  }

  if (method === "GET" && pathname === "/api/attendance") {
    const filter = {};
    if (url.searchParams.has("date")) filter.localDate = url.searchParams.get("date");
    else filter.localDate = today();
    const attendance = await Attendance.find(filter).sort({ checkedInAt: -1 }).lean();
    return sendJson(response, 200, attendance.map(plain));
  }

  if (method === "POST" && pathname === "/api/attendance") {
    const body = await readBody(request);
    const member = await Member.findOne({ id: body.memberId });
    if (!member) return sendJson(response, 404, { error: "Select a valid member." });
    if (member.expiresAt < today()) return sendJson(response, 422, { error: "This membership has expired. Renew it before checking in." });
    const entry = await Attendance.create({ memberId: member.id, memberName: member.name, checkedInAt: new Date(), localDate: today() });
    return sendJson(response, 201, plain(entry));
  }

  if (method === "GET" && pathname === "/api/payments") {
    const payments = await Payment.find().sort({ paidAt: -1 }).limit(500).lean();
    return sendJson(response, 200, payments.map(plain));
  }

  if (method === "POST" && pathname === "/api/payments") {
    const body = await readBody(request);
    const member = await Member.findOne({ id: body.memberId });
    if (!member) return sendJson(response, 404, { error: "Select a valid member." });
    const payment = await Payment.create({
      memberId: member.id,
      memberName: member.name,
      plan: member.plan,
      amount: PLAN_PRICES[member.plan],
      paidAt: new Date(),
      method: ["Card", "Direct debit", "Cash"].includes(body.method) ? body.method : "Card",
      status: "Paid",
    });
    const membershipStart = member.expiresAt >= today() ? member.expiresAt : today();
    const nextExpiry = new Date(`${membershipStart}T00:00:00.000Z`);
    nextExpiry.setUTCDate(nextExpiry.getUTCDate() + 30);
    member.expiresAt = nextExpiry.toISOString().slice(0, 10);
    await member.save();
    return sendJson(response, 201, plain(payment));
  }

  if (method === "GET" && pathname === "/api/trainers") {
    const trainers = await Trainer.find().sort({ name: 1 }).lean();
    return sendJson(response, 200, trainers.map(plain));
  }

  if (method === "GET" && pathname === "/api/classes") {
    return sendJson(response, 200, await listClasses(url));
  }

  if (method === "POST" && pathname === "/api/classes") {
    const { data, errors } = validateClass(await readBody(request));
    if (Object.keys(errors).length) return sendJson(response, 422, { error: "Check the class details.", fields: errors });
    const trainer = await Trainer.findById(data.trainerId);
    if (!trainer) return sendJson(response, 404, { error: "Select a valid trainer." });
    const gymClass = await GymClass.create({
      ...data,
      trainerName: trainer.name,
      color: trainer.color,
    });
    return sendJson(response, 201, { ...plain(gymClass), bookings: [] });
  }

  const classBookings = pathname.match(/^\/api\/classes\/([^/]+)\/bookings$/);
  if (classBookings && method === "POST") {
    const classId = classBookings[1];
    if (!mongoose.isValidObjectId(classId)) return sendJson(response, 404, { error: "Class not found." });
    const body = await readBody(request);
    const [gymClass, member] = await Promise.all([
      GymClass.findById(classId),
      Member.findOne({ id: body.memberId }),
    ]);
    if (!gymClass) return sendJson(response, 404, { error: "Class not found." });
    if (!member) return sendJson(response, 404, { error: "Select a valid member." });
    if (gymClass.date < today()) return sendJson(response, 422, { error: "Bookings have closed for this class." });
    if (member.expiresAt < today()) return sendJson(response, 422, { error: "Renew this membership before booking a class." });
    const reserved = await GymClass.findOneAndUpdate(
      { _id: gymClass._id, $expr: { $lt: ["$bookedCount", "$capacity"] } },
      { $inc: { bookedCount: 1 } },
      { new: true },
    );
    if (!reserved) return sendJson(response, 409, { error: "This class is full. Try another session." });
    try {
      const booking = await Booking.create({ classId: gymClass._id, memberId: member.id, memberName: member.name });
      return sendJson(response, 201, plain(booking));
    } catch (error) {
      await GymClass.updateOne({ _id: gymClass._id }, { $inc: { bookedCount: -1 } });
      throw error;
    }
  }

  const bookingMatch = pathname.match(/^\/api\/bookings\/([^/]+)$/);
  if (bookingMatch && method === "DELETE") {
    if (!mongoose.isValidObjectId(bookingMatch[1])) return sendJson(response, 404, { error: "Booking not found." });
    const booking = await Booking.findByIdAndDelete(bookingMatch[1]);
    if (!booking) return sendJson(response, 404, { error: "Booking not found." });
    await GymClass.updateOne({ _id: booking.classId, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } });
    return sendJson(response, 200, { cancelled: true });
  }

  return sendJson(response, 404, { error: "API endpoint not found." });
}

async function serveStatic(request, response, url) {
  const route = url.pathname === "/" ? "dashboard" : url.pathname.slice(1);
  const pageRoutes = new Set(["dashboard", "members", "classes", "trainers", "attendance", "payments"]);
  const requestedPath = pageRoutes.has(route)
    ? `/${route}.html`
    : decodeURIComponent(url.pathname === "/" ? "/dashboard.html" : url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, POST, PATCH, DELETE" });
        return response.end();
      }
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      return response.end();
    }
    await serveStatic(request, response, url);
  } catch (error) {
    if (error.code === 11000) {
      const message = error.keyPattern?.email
        ? "A member with this email address already exists."
        : error.keyPattern?.memberId
          ? "This member has already checked in today or booked this class."
          : "This record already exists.";
      return sendJson(response, 409, { error: message });
    }
    if (error.name === "ValidationError") {
      return sendJson(response, 422, { error: error.message });
    }
    console.error("Request failed:", error);
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : "An unexpected server error occurred." });
    else response.destroy();
  }
});

async function start() {
  if (envResult.error && envResult.error.code !== "ENOENT") {
    throw new Error(`Could not read the project environment file "${ENV_FILE}": ${envResult.error.message}`);
  }
  if (!process.env.MONGODB_URI && !envResult.parsed?.MONGODB_URI) {
    console.warn(`No MONGODB_URI found in "${ENV_FILE}"; trying the local MongoDB default. Copy .env.example to .env and set your connection string if MongoDB is hosted elsewhere.`);
  }
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (error) {
    let safeTarget = "the configured MongoDB server";
    let isAtlas = false;
    try {
      const safeUri = new URL(MONGODB_URI);
      isAtlas = safeUri.hostname.endsWith(".mongodb.net");
      safeTarget = `${safeUri.hostname}${safeUri.port ? `:${safeUri.port}` : ""}/${safeUri.pathname.replace(/^\/+/, "").split("/")[0]}`;
    } catch {
      safeTarget = "the configured MongoDB server (invalid connection URI)";
    }
    const hint = isAtlas
      ? " Check that your Atlas IP access list permits this machine and that the database username and password are correct and URL-encoded."
      : ` Confirm MongoDB is running or update MONGODB_URI in "${ENV_FILE}".`;
    throw new Error(`Could not connect to MongoDB at ${safeTarget} (configuration: ${MONGODB_URI_SOURCE}).${hint} Details: ${error.message}`);
  }
  await Promise.all([Member.init(), Attendance.init(), Booking.init()]);
  await seedDatabase();
  server.listen(PORT, HOST, () => {
    console.log(`Ironhouse is running at http://${HOST}:${PORT}`);
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
  });
}

start().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
