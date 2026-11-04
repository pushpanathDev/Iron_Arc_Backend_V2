/*
 * "Welcome to the Pro club": sent when someone starts Iron Arc Pro (the trial
 * or a paid plan), with the receipt for it. While payments are test payments
 * the receipt says so plainly.
 */
const { C, escapeHtml, rupees, day, planName, receiptNumber, firstName, label, tickedCards, receiptHtml, receiptText, page } = require("./parts");

/** What Pro adds, as [title, text]. */
const UNLOCKED = [
  ["AI coach chat", "Ask anything about your plan. Too heavy, too long, knee acting up? Get changes to your week in plain language."],
  ["Unlimited AI plans", "New block, new split, new goal: build a fresh plan whenever you want, not once a month."],
];

/**
 * The email for a new Pro member. `payment` is the receipt just recorded (a
 * trial start has amount 0), `pro` the status after it (proSummary).
 */
function proWelcomeEmail({ user, payment, pro, trialDays }) {
  const trial = payment.kind === "trial";
  const charge = pro.nextCharge;
  const lead = trial
    ? `Your ${trialDays}-day free trial starts today. Train hard, lean on your coach, and see what Pro does for your week.${charge ? ` Keep going and your first charge is ${rupees(charge.amount)} on ${day(charge.on)}. Cancel any time before then in Profile → Subscription.` : ""}`
    : `Your ${planName(payment.plan)} plan is live.${charge ? ` It renews on ${day(charge.on)} at ${rupees(charge.amount)}, and you can cancel any time in Profile → Subscription.` : ""}`;
  const hello = `Hey ${firstName(user)}, chalk up. 💪 Iron Arc Pro is live on your account, and your coach just levelled up with you.`;

  const html = page({
    preheader: "You're in. Your coach is warmed up and unlimited plans are unlocked.",
    kicker: "Iron Arc · Pro club",
    title: "You're in.<br>Welcome to the Pro club.",
    blocks: [
      `<p style="margin:0 0 12px;">${escapeHtml(hello)}</p><p style="margin:0;">${escapeHtml(lead)}</p>`,
      `${label("What you just unlocked")}${tickedCards(UNLOCKED)}`,
      `<span style="color:${C.text};"><strong style="color:${C.accent};">Your first rep:</strong> open Iron Arc, tap <strong>Coach</strong> on your plan and tell it how this week felt.</span>`,
      receiptHtml(payment, { trialDays }),
    ],
  });

  const text = [
    "YOU'RE IN. WELCOME TO THE PRO CLUB.",
    "",
    hello.replace(" 💪", ""),
    "",
    lead,
    "",
    "What you just unlocked:",
    ...UNLOCKED.map(([title, body]) => `- ${title}: ${body}`),
    "",
    "Your first rep: open Iron Arc, tap Coach on your plan and tell it how this week felt.",
    "",
    ...receiptText(payment, { trialDays }),
    "",
    "Lift heavy, recover well.",
    "Team Iron Arc",
  ].join("\n");

  return { subject: "You're in 💪 Welcome to the Iron Arc Pro club", html, text };
}

module.exports = { proWelcomeEmail, receiptNumber, rupees };
