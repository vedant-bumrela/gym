const PLAN_PRICES = { Basic: 29, Standard: 49, Premium: 79 };
const pageTitles = { dashboard: "Overview", members: "Members", classes: "Classes", trainers: "Trainers", attendance: "Attendance", payments: "Payments" };
const avatarTones = ["", "tone-1", "tone-2", "tone-3", "tone-4"];
const state = { page: "dashboard", members: [], dashboard: null, attendance: [], payments: [], trainers: [], classes: [], editingMemberId: null, selectedDate: new Date().toISOString().slice(0, 10), weekOffset: 0, bookingClassId: null };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.fields = payload.fields || {};
    throw error;
  }
  return payload;
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function avatar(name, index = 0) {
  return `<span class="member-avatar ${avatarTones[index % avatarTones.length]}">${escapeHtml(initials(name))}</span>`;
}

function formatDate(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", options).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(amount);
}

function formatTime(value) {
  const date = new Date(value);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  if (minutes < 1440 && date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  }
  return formatDate(value, { day: "numeric", month: "short" });
}

function formatClassTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
}

function statusFor(member) {
  const remaining = Math.ceil((new Date(`${member.expiresAt}T00:00:00`) - new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`)) / 86_400_000);
  if (remaining < 0) return { label: "Expired", className: "expired" };
  if (remaining <= 30) return { label: `Expires in ${remaining}d`, className: "expiring" };
  return { label: "Active", className: "active" };
}

function notify(message, type = "") {
  const region = $("#toast-region");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

async function refreshDashboard() {
  const dashboard = await api("/api/dashboard");
  state.dashboard = dashboard;
  $("#stat-members").textContent = dashboard.totalMembers;
  $("#stat-active").textContent = dashboard.activeMembers;
  $("#stat-revenue").textContent = formatCurrency(dashboard.monthlyRevenue);
  $("#stat-checkins").textContent = dashboard.checkInsToday;
  $("#member-count").textContent = dashboard.totalMembers;
  $("#class-count").textContent = dashboard.todaysClasses;
  const months = dashboard.revenueByMonth;
  const peak = Math.max(1, ...months.map((month) => month.amount));
  $("#chart-total").textContent = formatCurrency(months.reduce((sum, month) => sum + month.amount, 0));
  $("#revenue-chart").innerHTML = months.map((month) => `
    <div class="bar-column" title="${escapeHtml(month.label)}: ${formatCurrency(month.amount)}">
      <div class="bar-track"><div class="bar-fill" style="height:${Math.max(month.amount ? 8 : 2, Math.round(month.amount / peak * 100))}%"></div></div>
      <span class="bar-label">${escapeHtml(month.label)}</span>
    </div>`).join("");
  $("#recent-attendance").innerHTML = dashboard.attendance.length
    ? dashboard.attendance.map((entry, index) => `<div class="activity-row">${avatar(entry.memberName, index)}<div class="activity-details"><strong>${escapeHtml(entry.memberName)}</strong><span>Checked in for a workout</span></div><span class="activity-time">${escapeHtml(formatTime(entry.checkedInAt))}</span></div>`).join("")
    : '<div class="activity-empty">No check-ins yet today. Your first member could be any minute!</div>';
  $("#expiring-members").innerHTML = dashboard.expiringMembers.length
    ? dashboard.expiringMembers.map((member, index) => {
      const status = statusFor(member);
      return `<tr><td><div class="member-cell">${avatar(member.name, index)}<div class="member-info"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.email)}</span></div></div></td><td><span class="plan-pill">${escapeHtml(member.plan)}</span></td><td>${escapeHtml(formatDate(member.expiresAt))}</td><td><span class="membership-status ${status.className}"><i></i>${escapeHtml(status.label)}</span></td><td><button class="row-action" data-action="edit-member" data-id="${escapeHtml(member.id)}" aria-label="Edit ${escapeHtml(member.name)}">···</button></td></tr>`;
    }).join("")
    : '<tr><td colspan="5" class="empty-state">Everyone is in good standing. Nice work!</td></tr>';
  const classes = await api("/api/classes?from=" + encodeURIComponent(new Date().toISOString().slice(0, 10)) + "&days=1");
  $("#dashboard-classes").innerHTML = classes.length
    ? classes.slice(0, 4).map((gymClass) => `<a class="dashboard-class" href="#classes"><span class="class-time">${escapeHtml(formatClassTime(gymClass.time))}</span><span class="dashboard-class-icon class-tone-${escapeHtml(gymClass.color)}">${escapeHtml(gymClass.category.slice(0, 1))}</span><span class="dashboard-class-copy"><strong>${escapeHtml(gymClass.title)}</strong><small>${escapeHtml(gymClass.trainerName)} · ${escapeHtml(gymClass.duration)} min</small></span><span class="dashboard-class-spots">${escapeHtml(gymClass.bookedCount)}/${escapeHtml(gymClass.capacity)} <small>spots</small></span></a>`).join("")
    : '<div class="activity-empty">The timetable is clear today. Why not schedule a class?</div>';
}

async function refreshNavigationCounts() {
  const dashboard = await api("/api/dashboard");
  $("#member-count").textContent = dashboard.totalMembers;
  $("#class-count").textContent = dashboard.todaysClasses;
}

function renderClassWeek() {
  const base = new Date(`${dateOffset(state.weekOffset)}T12:00:00`);
  $("#class-week").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setDate(date.getDate() + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date);
    const todayMatch = iso === new Date().toISOString().slice(0, 10);
    return `<button class="week-day ${iso === state.selectedDate ? "selected" : ""}" data-action="select-class-day" data-date="${iso}"><span>${todayMatch ? "TODAY" : escapeHtml(weekday.toUpperCase())}</span><strong>${date.getDate()}</strong></button>`;
  }).join("") + `<button class="week-step" data-action="week-next" aria-label="Next week">›</button>`;
  $("#class-week").insertAdjacentHTML("afterbegin", `<button class="week-step" data-action="week-previous" aria-label="Previous week" ${state.weekOffset <= 0 ? "disabled" : ""}>‹</button>`);
}

async function refreshClasses() {
  renderClassWeek();
  const [classes, trainers] = await Promise.all([
    api(`/api/classes?from=${encodeURIComponent(state.selectedDate)}&days=1`),
    state.trainers.length ? Promise.resolve(state.trainers) : api("/api/trainers"),
  ]);
  state.classes = classes;
  state.trainers = trainers;
  $("#class-day-title").textContent = state.selectedDate === new Date().toISOString().slice(0, 10)
    ? "Today's sessions"
    : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${state.selectedDate}T12:00:00`));
  $("#class-day-count").textContent = `${classes.length} ${classes.length === 1 ? "session" : "sessions"}`;
  $("#classes-empty").classList.toggle("hidden", classes.length > 0);
  $("#class-grid").innerHTML = classes.map((gymClass) => {
    const remaining = Math.max(0, gymClass.capacity - gymClass.bookedCount);
    const full = remaining === 0;
    const booked = gymClass.bookings.map((booking) => `<span class="booking-chip">${escapeHtml(initials(booking.memberName))}<button data-action="cancel-booking" data-booking-id="${escapeHtml(booking.id)}" title="Cancel ${escapeHtml(booking.memberName)}'s booking" aria-label="Cancel ${escapeHtml(booking.memberName)}'s booking">×</button></span>`).join("");
    return `<article class="class-card class-tone-${escapeHtml(gymClass.color)}"><div class="class-card-top"><span class="class-category">${escapeHtml(gymClass.category)}</span><span class="class-level">${escapeHtml(gymClass.level)}</span></div><div class="class-time-large">${escapeHtml(formatClassTime(gymClass.time))}<span>· ${escapeHtml(gymClass.duration)} min</span></div><h2>${escapeHtml(gymClass.title)}</h2><p class="class-description">${escapeHtml(gymClass.description)}</p><div class="class-coach">${avatar(gymClass.trainerName, 1)}<span><strong>${escapeHtml(gymClass.trainerName)}</strong><small>Coach</small></span><span class="class-occupancy">${escapeHtml(gymClass.bookedCount)} / ${escapeHtml(gymClass.capacity)}<small> spots</small></span></div><div class="occupancy-track"><i style="width:${Math.min(100, Math.round(gymClass.bookedCount / gymClass.capacity * 100))}%"></i></div><div class="class-card-foot"><div class="booking-chips">${booked || `<span class="booking-empty">${remaining} spots waiting for you</span>`}</div><button class="button ${full ? "button-light" : "button-dark"} class-book-button" data-action="book-class" data-class-id="${escapeHtml(gymClass.id)}" ${full ? "disabled" : ""}>${full ? "Class is full" : "Book a spot"} <span>→</span></button></div></article>`;
  }).join("");
  $("#class-trainer").innerHTML = '<option value="">Choose a coach</option>' + trainers.map((trainer) => `<option value="${escapeHtml(trainer.id)}">${escapeHtml(trainer.name)} · ${escapeHtml(trainer.specialty)}</option>`).join("");
}

async function refreshTrainers() {
  if (!state.trainers.length) state.trainers = await api("/api/trainers");
  $("#trainer-grid").innerHTML = state.trainers.map((trainer, index) => `<article class="trainer-card class-tone-${escapeHtml(trainer.color)}"><div class="trainer-art"><span class="trainer-number">COACH 0${index + 1}</span><span class="trainer-avatar">${escapeHtml(initials(trainer.name))}</span><span class="trainer-art-caption">${escapeHtml(trainer.specialty.split(" & ")[0])}<i>✳</i></span></div><div class="trainer-card-copy"><span class="eyebrow">${escapeHtml(trainer.specialty.toUpperCase())}</span><h2>${escapeHtml(trainer.name)}</h2><p>${escapeHtml(trainer.bio)}</p><a href="mailto:${escapeHtml(trainer.email)}" class="text-link">Say hello <span>↗</span></a></div></article>`).join("");
}

async function refreshMembers() {
  const params = new URLSearchParams();
  const search = $("#member-search")?.value.trim() || "";
  const filter = $("#member-filter")?.value || "all";
  if (search) params.set("search", search);
  if (filter !== "all") params.set("status", filter);
  const members = await api(`/api/members?${params}`);
  state.members = members;
  $("#member-results-count").textContent = `${members.length} ${members.length === 1 ? "member" : "members"}`;
  $("#members-empty").classList.toggle("hidden", members.length !== 0);
  $("#members-table").innerHTML = members.map((member, index) => {
    const status = statusFor(member);
    return `<tr><td><div class="member-cell">${avatar(member.name, index)}<div class="member-info"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.email)}</span></div></div></td><td>${escapeHtml(member.id)}</td><td><span class="plan-pill">${escapeHtml(member.plan)}</span></td><td>${escapeHtml(formatDate(member.joinedAt))}</td><td><span class="membership-status ${status.className}"><i></i>${escapeHtml(status.label)}</span></td><td><button class="row-action" data-action="edit-member" data-id="${escapeHtml(member.id)}" aria-label="Edit ${escapeHtml(member.name)}">···</button></td></tr>`;
  }).join("");
}

async function refreshAttendance() {
  const [attendance, members] = await Promise.all([api("/api/attendance"), api("/api/members")]);
  state.attendance = attendance;
  state.members = members;
  $("#attendance-date").textContent = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  $("#attendance-count").textContent = attendance.length;
  const activeMembers = members.filter((member) => member.expiresAt >= new Date().toISOString().slice(0, 10));
  $("#checkin-member").innerHTML = '<option value="">Select a member...</option>' + activeMembers.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)} · ${escapeHtml(member.plan)}</option>`).join("");
  $("#attendance-list").innerHTML = attendance.length
    ? attendance.map((entry, index) => `<div class="activity-row">${avatar(entry.memberName, index)}<div class="activity-details"><strong>${escapeHtml(entry.memberName)}</strong><span>${escapeHtml(entry.memberId)} · Workout check-in</span></div><span class="activity-time">${escapeHtml(new Date(entry.checkedInAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }))}</span></div>`).join("")
    : '<div class="activity-empty">No check-ins today. Time to open the doors!</div>';
}

async function refreshPayments() {
  const [payments, dashboard] = await Promise.all([api("/api/payments"), api("/api/dashboard")]);
  state.payments = payments;
  $("#payment-revenue").textContent = formatCurrency(dashboard.monthlyRevenue);
  $("#payment-count").textContent = payments.length;
  $("#payments-empty").classList.toggle("hidden", payments.length !== 0);
  $("#payments-table").innerHTML = payments.map((payment, index) => `
    <tr><td><div class="member-cell">${avatar(payment.memberName, index)}<div class="member-info"><strong>${escapeHtml(payment.memberName)}</strong><span>${escapeHtml(payment.memberId)}</span></div></div></td><td><span class="plan-pill">${escapeHtml(payment.plan)}</span></td><td>${escapeHtml(formatDate(payment.paidAt))}</td><td class="payment-method">${escapeHtml(payment.method)}</td><td><span class="payment-status">${escapeHtml(payment.status)}</span></td><td class="align-right">${formatCurrency(payment.amount)}</td></tr>`).join("");
}

function openMemberModal(member = null) {
  state.editingMemberId = member?.id || null;
  $("#member-form").reset();
  $$(".form-field", $("#member-form")).forEach((field) => {
    field.classList.remove("invalid");
    $(".field-error", field).textContent = "";
  });
  $("#member-form-error").classList.add("hidden");
  $("#modal-title").textContent = member ? "Edit member" : "Add a member";
  $("#save-member").innerHTML = member ? "Save changes <span>→</span>" : "Add member <span>→</span>";
  if (member) {
    for (const [key, value] of Object.entries(member)) {
      const field = $(`[name="${key}"]`, $("#member-form"));
      if (field) field.value = value;
    }
  }
  $("#member-modal").classList.remove("hidden");
  $('input[name="name"]', $("#member-form")).focus();
}

function closeMemberModal() {
  $("#member-modal").classList.add("hidden");
  state.editingMemberId = null;
}

function clearFieldError(field) {
  const wrapper = field.closest(".form-field");
  wrapper.classList.remove("invalid");
  $(".field-error", wrapper).textContent = "";
}

async function saveMember(event) {
  event.preventDefault();
  const form = event.currentTarget;
  $$(".form-field", form).forEach((wrapper) => {
    wrapper.classList.remove("invalid");
    $(".field-error", wrapper).textContent = "";
  });
  $("#member-form-error").classList.add("hidden");
  const body = Object.fromEntries(new FormData(form).entries());
  const validation = {
    name: body.name.trim().length >= 2,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()),
    phone: body.phone.trim().length >= 7,
    goal: Boolean(body.goal),
    plan: Boolean(body.plan),
  };
  let valid = true;
  for (const [name, passes] of Object.entries(validation)) {
    if (!passes) {
      valid = false;
      const field = $(`[name="${name}"]`, form);
      const wrapper = field.closest(".form-field");
      wrapper.classList.add("invalid");
      $(".field-error", wrapper).textContent = name === "email" ? "Enter a valid email address." : "Please complete this field.";
    }
  }
  if (!valid) return;

  const button = $("#save-member");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const editing = Boolean(state.editingMemberId);
    await api(editing ? `/api/members/${encodeURIComponent(state.editingMemberId)}` : "/api/members", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    closeMemberModal();
    notify(editing ? "Member details updated." : "New member added. Welcome aboard!");
    if ($("#stat-members")) await refreshDashboard();
    else await refreshNavigationCounts();
    if (state.page === "members") await refreshMembers();
    if (state.page === "attendance") await refreshAttendance();
  } catch (error) {
    for (const [name, message] of Object.entries(error.fields)) {
      const field = $(`[name="${name}"]`, form);
      if (field) {
        field.closest(".form-field").classList.add("invalid");
        $(".field-error", field.closest(".form-field")).textContent = message;
      }
    }
    $("#member-form-error").textContent = error.message;
    $("#member-form-error").classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.innerHTML = state.editingMemberId ? "Save changes <span>→</span>" : "Add member <span>→</span>";
  }
}

async function editMember(id) {
  const member = await api(`/api/members?search=${encodeURIComponent(id)}`);
  const match = member.find((entry) => entry.id === id);
  if (match) openMemberModal(match);
}

function openClassModal() {
  $("#class-form").reset();
  $("#class-form-error").classList.add("hidden");
  $("#class-form").elements.date.min = new Date().toISOString().slice(0, 10);
  $("#class-form").elements.date.value = state.selectedDate;
  $("#class-modal").classList.remove("hidden");
  $("#class-form").elements.title.focus();
}

async function saveClass(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#save-class");
  const formError = $("#class-form-error");
  formError.classList.add("hidden");
  button.disabled = true;
  button.textContent = "Saving...";
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    await api("/api/classes", { method: "POST", body: JSON.stringify(body) });
    $("#class-modal").classList.add("hidden");
    notify("Class added to the timetable. Let's get moving!");
    await refreshClasses();
    if ($("#stat-members")) await refreshDashboard();
    else await refreshNavigationCounts();
  } catch (error) {
    formError.textContent = Object.values(error.fields || {}).length
      ? Object.values(error.fields).join(" ")
      : error.message;
    formError.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.innerHTML = "Add to timetable <span>→</span>";
  }
}

async function openBookingModal(classId) {
  const gymClass = state.classes.find((entry) => entry.id === classId);
  if (!gymClass) throw new Error("This class isn't available. Refresh the timetable and try again.");
  const members = await api("/api/members?status=active");
  if (!members.length) {
    notify("Add an active member before booking a class.", "error");
    return;
  }
  state.bookingClassId = classId;
  const alreadyBooked = new Set(gymClass.bookings.map((booking) => booking.memberId));
  const bookableMembers = members.filter((member) => !alreadyBooked.has(member.id));
  if (!bookableMembers.length) {
    notify("All active members already have a spot in this class.", "error");
    return;
  }
  $("#booking-modal-title").textContent = gymClass.title;
  $("#booking-modal-detail").textContent = `${formatClassTime(gymClass.time)} · ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(new Date(`${gymClass.date}T12:00:00`))} · ${gymClass.capacity - gymClass.bookedCount} spots left`;
  $("#booking-member").innerHTML = '<option value="">Choose a member</option>' + bookableMembers.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)} · ${escapeHtml(member.plan)}</option>`).join("");
  $("#booking-modal").classList.remove("hidden");
  $("#booking-member").focus();
}

async function saveBooking(event) {
  event.preventDefault();
  if (!state.bookingClassId) return;
  const button = $("#save-booking");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const result = await api(`/api/classes/${encodeURIComponent(state.bookingClassId)}/bookings`, {
      method: "POST",
      body: JSON.stringify({ memberId: $("#booking-member").value }),
    });
    $("#booking-modal").classList.add("hidden");
    state.bookingClassId = null;
    notify(`${result.memberName} is booked in. See you on the mat!`);
    await refreshClasses();
    if ($("#stat-members")) await refreshDashboard();
    else await refreshNavigationCounts();
  } catch (error) {
    notify(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = "Confirm booking <span>→</span>";
  }
}

async function cancelBooking(bookingId) {
  if (!window.confirm("Cancel this class booking?")) return;
  await api(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: "DELETE" });
  notify("Booking cancelled. That spot is open again.");
  await refreshClasses();
  if ($("#stat-members")) await refreshDashboard();
  else await refreshNavigationCounts();
}

async function recordCheckin(event) {
  event.preventDefault();
  const memberId = $("#checkin-member").value;
  if (!memberId) return;
  try {
    const entry = await api("/api/attendance", { method: "POST", body: JSON.stringify({ memberId }) });
    notify(`${entry.memberName} is checked in. Have a great workout!`);
    await Promise.all([refreshAttendance(), $("#stat-members") ? refreshDashboard() : refreshNavigationCounts()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function recordPayment() {
  const members = await api("/api/members");
  if (!members.length) {
    notify("Add a member before recording a payment.", "error");
    return;
  }
  $("#payment-member").innerHTML = '<option value="">Choose a member</option>' + members.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)} · ${escapeHtml(member.plan)}${member.expiresAt < new Date().toISOString().slice(0, 10) ? " · expired" : ""}</option>`).join("");
  $("#payment-form").dataset.members = JSON.stringify(members);
  $("#payment-form").reset();
  $("#payment-amount").textContent = formatCurrency(0);
  $("#payment-modal").classList.remove("hidden");
  $("#payment-member").focus();
}

async function submitPayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const memberId = $("#payment-member").value;
  if (!memberId) return;
  const member = JSON.parse(form.dataset.members || "[]").find((entry) => entry.id === memberId);
  const button = $("#save-payment");
  button.disabled = true;
  button.textContent = "Recording...";
  try {
    await api("/api/payments", { method: "POST", body: JSON.stringify({ memberId, method: form.elements.method.value }) });
    $("#payment-modal").classList.add("hidden");
    notify(`Payment of ${formatCurrency(PLAN_PRICES[member.plan])} recorded for ${member.name}. Membership extended.`);
    await Promise.all([refreshPayments(), $("#stat-members") ? refreshDashboard() : refreshNavigationCounts()]);
  } catch (error) {
    notify(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = "Record payment <span>→</span>";
  }
}

function init() {
  state.page = document.body.dataset.page;
  $$(".copyright-year").forEach((year) => { year.textContent = new Date().getFullYear(); });
  $("#today-label").textContent = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
  $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#member-search")?.addEventListener("input", () => refreshMembers().catch((error) => notify(error.message, "error")));
  $("#member-filter")?.addEventListener("change", () => refreshMembers().catch((error) => notify(error.message, "error")));
  $("#member-form")?.addEventListener("submit", saveMember);
  $("#class-form")?.addEventListener("submit", saveClass);
  $("#booking-form")?.addEventListener("submit", saveBooking);
  $("#checkin-form")?.addEventListener("submit", recordCheckin);
  $("#record-payment")?.addEventListener("click", () => recordPayment().catch((error) => notify(error.message, "error")));
  $("#payment-form")?.addEventListener("submit", submitPayment);
  $("#payment-member")?.addEventListener("change", (event) => {
    const members = JSON.parse($("#payment-form").dataset.members || "[]");
    const member = members.find((entry) => entry.id === event.target.value);
    $("#payment-amount").textContent = formatCurrency(member ? PLAN_PRICES[member.plan] : 0);
  });
  $$(".payment-modal-close, .payment-modal-cancel").forEach((button) => button.addEventListener("click", () => $("#payment-modal").classList.add("hidden")));
  $("#payment-modal")?.addEventListener("click", (event) => {
    if (event.target === $("#payment-modal")) $("#payment-modal").classList.add("hidden");
  });
  $("#member-form")?.addEventListener("input", (event) => clearFieldError(event.target));
  $("#member-form")?.addEventListener("change", (event) => clearFieldError(event.target));
  $("#member-modal")?.addEventListener("click", (event) => {
    if (event.target === $("#member-modal") || event.target.closest('[data-action="close-modal"]')) closeMemberModal();
  });
  $$(".class-modal-close").forEach((button) => button.addEventListener("click", () => $("#class-modal").classList.add("hidden")));
  $("#class-modal")?.addEventListener("click", (event) => {
    if (event.target === $("#class-modal")) $("#class-modal").classList.add("hidden");
  });
  $$(".booking-modal-close").forEach((button) => button.addEventListener("click", () => { $("#booking-modal").classList.add("hidden"); state.bookingClassId = null; }));
  $("#booking-modal")?.addEventListener("click", (event) => {
    if (event.target === $("#booking-modal")) { $("#booking-modal").classList.add("hidden"); state.bookingClassId = null; }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#member-modal") && !$("#member-modal").classList.contains("hidden")) closeMemberModal();
    if (event.key === "Escape") $("#payment-modal")?.classList.add("hidden");
    if (event.key === "Escape") $("#class-modal")?.classList.add("hidden");
    if (event.key === "Escape" && $("#booking-modal")) { $("#booking-modal").classList.add("hidden"); state.bookingClassId = null; }
  });
  document.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "add-member" && $("#member-modal")) openMemberModal();
    if (action.dataset.action === "close-modal" && $("#member-modal")) closeMemberModal();
    if (action.dataset.action === "add-class" && $("#class-modal")) openClassModal();
    if (action.dataset.action === "select-class-day") {
      state.selectedDate = action.dataset.date;
      const difference = Math.round((new Date(`${state.selectedDate}T12:00:00`) - new Date(`${dateOffset(state.weekOffset)}T12:00:00`)) / 86_400_000);
      if (difference < 0 || difference >= 7) state.weekOffset = Math.max(0, Math.floor((new Date(`${state.selectedDate}T12:00:00`) - new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00`)) / 86_400_000 / 7) * 7);
      try { await refreshClasses(); } catch (error) { notify(error.message, "error"); }
    }
    if (action.dataset.action === "week-previous" && state.weekOffset > 0) {
      state.weekOffset = Math.max(0, state.weekOffset - 7);
      state.selectedDate = dateOffset(state.weekOffset);
      try { await refreshClasses(); } catch (error) { notify(error.message, "error"); }
    }
    if (action.dataset.action === "week-next") {
      state.weekOffset += 7;
      state.selectedDate = dateOffset(state.weekOffset);
      try { await refreshClasses(); } catch (error) { notify(error.message, "error"); }
    }
    if (action.dataset.action === "book-class") {
      try { await openBookingModal(action.dataset.classId); } catch (error) { notify(error.message, "error"); }
    }
    if (action.dataset.action === "cancel-booking") {
      try { await cancelBooking(action.dataset.bookingId); } catch (error) { notify(error.message, "error"); }
    }
    if (action.dataset.action === "edit-member") {
      try {
        await editMember(action.dataset.id);
      } catch (error) {
        notify(error.message, "error");
      }
    }
  });
  const pageLoads = {
    dashboard: refreshDashboard,
    members: refreshMembers,
    classes: refreshClasses,
    trainers: refreshTrainers,
    attendance: refreshAttendance,
    payments: refreshPayments,
  };
  Promise.all([
    pageLoads[state.page](),
    state.page === "dashboard" ? Promise.resolve() : refreshNavigationCounts(),
  ]).catch((error) => notify(`Couldn't load ${pageTitles[state.page].toLowerCase()}: ${error.message}`, "error"));
}

init();
