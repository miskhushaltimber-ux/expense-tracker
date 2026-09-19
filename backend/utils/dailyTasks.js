import User from "../models/User.js";
import Expense from "../models/Expense.js";
import Income from "../models/Income.js";
import RecurringTransaction from "../models/RecurringTransaction.js";
import { advanceOneMonth } from "./recurring.js";
import { sendMail } from "./mailer.js";

const REMINDER_DAYS_BEFORE = Math.max(0, parseInt(process.env.REMINDER_DAYS_BEFORE, 10) || 2);

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Creates a real Expense/Income entry from every due recurring template
// (across all users — this is meant to be called once by a single scheduled
// job, not per-user), then advances each template to its next month.
const processRecurring = async () => {
  const today = startOfDay(new Date());
  const due = await RecurringTransaction.find({
    active: true,
    nextRunDate: { $lte: today },
    $or: [{ endDate: null }, { endDate: { $gte: today } }],
  });

  let created = 0;
  for (const r of due) {
    try {
      const commonFields = {
        user: r.user,
        amount: r.amount,
        category: r.category,
        customCategory: r.customCategory,
        party: r.party,
        paymentMode: r.paymentMode,
        paymentStatus: "Paid",
        notes: r.notes
          ? `${r.notes} (auto-created — recurring)`
          : "Auto-created from a recurring transaction",
        date: r.nextRunDate,
      };

      if (r.type === "expense") {
        await Expense.create({ ...commonFields, title: r.title });
      } else {
        await Income.create({ ...commonFields, source: r.title });
      }

      r.lastRunDate = r.nextRunDate;
      r.nextRunDate = advanceOneMonth(r.nextRunDate, r.dayOfMonth);
      await r.save();
      created += 1;
    } catch (error) {
      console.error(`Error processing recurring transaction ${r._id}:`, error.message);
    }
  }
  return created;
};

const reminderEmailHtml = (user, items) => {
  const rows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.type === "expense" ? "Pay" : "Collect"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.label}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.party || "—"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${new Date(i.dueDate).toLocaleDateString(
          "en-IN"
        )}${i.overdue ? " (overdue)" : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">₹${Number(
          i.amount
        ).toLocaleString("en-IN")}</td>
      </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#333;">
      <h2 style="color:#2563eb;margin-bottom:4px;">Kushal Timbers — Payment Reminder</h2>
      <p>Hi ${user.name || "there"}, here's what's due soon or already overdue:</p>
      <table style="border-collapse:collapse;width:100%;max-width:600px;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:6px 10px;">Action</th>
            <th style="padding:6px 10px;">Item</th>
            <th style="padding:6px 10px;">Party</th>
            <th style="padding:6px 10px;">Due</th>
            <th style="padding:6px 10px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;color:#666;font-size:13px;">Log in to the expense tracker to mark these as paid/received once settled.</p>
    </div>
  `;
};

// Emails each affected user a summary of their own Pending items due within
// REMINDER_DAYS_BEFORE days (or already overdue), across all users. Marks
// each included item with lastReminderSentAt so it isn't re-emailed again
// the same day if this job happens to run more than once.
const sendReminders = async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + REMINDER_DAYS_BEFORE);
  cutoff.setHours(23, 59, 59, 999);
  const today = startOfDay(new Date());

  const notAlreadyRemindedToday = { $or: [{ lastReminderSentAt: null }, { lastReminderSentAt: { $lt: today } }] };
  const query = { paymentStatus: "Pending", dueDate: { $ne: null, $lte: cutoff }, ...notAlreadyRemindedToday };

  const [expenses, incomes] = await Promise.all([Expense.find(query), Income.find(query)]);
  if (expenses.length === 0 && incomes.length === 0) return { emailsSent: 0, itemsFlagged: 0 };

  const byUser = new Map();
  const addItem = (doc, type) => {
    const key = doc.user.toString();
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push({
      doc,
      type,
      label: type === "expense" ? doc.title : doc.source,
      party: doc.party,
      dueDate: doc.dueDate,
      amount: doc.amount,
      overdue: new Date(doc.dueDate) < new Date(),
    });
  };
  expenses.forEach((e) => addItem(e, "expense"));
  incomes.forEach((i) => addItem(i, "income"));

  let emailsSent = 0;
  let itemsFlagged = 0;
  const now = new Date();

  for (const [userId, items] of byUser.entries()) {
    const user = await User.findById(userId);
    if (user?.email) {
      const result = await sendMail({
        to: user.email,
        subject: `Kushal Timbers: ${items.length} payment${items.length === 1 ? "" : "s"} due soon`,
        html: reminderEmailHtml(user, items),
      });
      if (result.sent) emailsSent += 1;
    }

    // Flag as reminded regardless of send success (e.g. SMTP not configured
    // yet) so this doesn't keep re-querying the same growing set all day —
    // the flag naturally clears again at the start of the next calendar day.
    await Promise.all(
      items.map((i) => {
        i.doc.lastReminderSentAt = now;
        return i.doc.save();
      })
    );
    itemsFlagged += items.length;
  }

  return { emailsSent, itemsFlagged };
};

// The single entry point called by both the internal node-cron schedule and
// the external-pingable /api/cron/run-daily endpoint.
export const runDailyTasks = async () => {
  const [recurringCreated, reminderSummary] = await Promise.all([processRecurring(), sendReminders()]);
  return { recurringCreated, ...reminderSummary };
};
