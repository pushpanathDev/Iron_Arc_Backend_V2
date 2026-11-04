/*
 * Iron Arc Pro after the welcome: the trial ending soon, a cancellation, and a
 * renewal with its receipt. Same look and voice as the welcome email.
 */
const { escapeHtml, rupees, day, planName, firstName, label, tickedCards, receiptHtml, receiptText, testNote, page, paragraphs } = require("./parts");

/** Two days before the trial ends (and it will turn into a paid plan). */
function trialEndingEmail({ user, sub, amount }) {
  const ends = day(sub.trialEndsAt);
  const plan = planName(sub.nextPlan ?? sub.plan);
  const lines = [
    `Hey ${firstName(user)}, quick heads-up: your Iron Arc Pro trial ends on ${ends}.`,
    `Keep going and Pro carries on as ${plan} at ${rupees(amount)}. Nothing to do, your coach and unlimited plans stay right where they are.`,
    `Not for you? Cancel in Profile → Subscription before ${ends} and you won't be charged.`,
  ];
  const tips = [
    ["Plan next week with the coach", "Tell it what's coming up (travel, a tough week, a new goal) and it reshapes your week."],
    ["Try a fresh plan", "Pro has no monthly limit: build a new split or block and see how it feels."],
  ];
  const html = page({
    preheader: `Your trial ends on ${ends}. Here's how to make the most of the last two days.`,
    kicker: "Iron Arc · Pro trial",
    title: "Two days left<br>on your trial.",
    blocks: [paragraphs(...lines), `${label("Make the most of it")}${tickedCards(tips)}`, testNote("no money will be taken when the trial ends.")],
    signOff: "Finish strong.",
  });
  const text = ["TWO DAYS LEFT ON YOUR TRIAL.", "", ...lines, "", "Make the most of it:", ...tips.map(([t, b]) => `- ${t}: ${b}`), "", "Test mode: no money will be taken when the trial ends.", "", "Finish strong.", "Team Iron Arc"].join("\n");
  return { subject: `Your Pro trial ends on ${ends} ⏳`, html, text };
}

/** Right after cancelling: Pro stays until the period ends. */
function cancelledEmail({ user, until, trial }) {
  const date = day(until);
  const lines = [
    `Done, ${firstName(user)}. Your Iron Arc Pro ${trial ? "trial" : "plan"} won't ${trial ? "turn into a paid plan" : "renew"}, and nothing more will be charged.`,
    `You keep everything until ${date}: the coach chat and unlimited AI plans. After that you're back on Free. Your plans, logs and PRs stay exactly where they are.`,
    `Changed your mind? Resume any time before ${date} in Profile → Subscription.`,
  ];
  const html = page({
    preheader: `You're still Pro until ${date}.`,
    kicker: "Iron Arc · Pro",
    title: `You're still Pro<br>until ${escapeHtml(date)}.`,
    blocks: [paragraphs(...lines)],
    signOff: "The bar's always loaded for you.",
  });
  const text = [`YOU'RE STILL PRO UNTIL ${date.toUpperCase()}.`, "", ...lines, "", "The bar's always loaded for you.", "Team Iron Arc"].join("\n");
  return { subject: `Pro cancelled: you're still Pro until ${date}`, html, text };
}

/** A renewal was recorded: its receipt, and when the next one falls. */
function renewedEmail({ user, payment, nextOn, fromTrial }) {
  const plan = planName(payment.plan);
  const lines = [
    fromTrial
      ? `Hey ${firstName(user)}, your trial's done and you're going all in. 💪 Iron Arc Pro carries on as ${plan}.`
      : `Hey ${firstName(user)}, another ${payment.plan === "yearly" ? "year" : "month"} of Iron Arc Pro is locked in. 💪 Your coach and unlimited plans keep rolling.`,
    nextOn ? `Next renewal: ${day(nextOn)}. Cancel any time in Profile → Subscription.` : "",
  ].filter(Boolean);
  const html = page({
    preheader: `Your ${plan} plan renewed. Here's your receipt.`,
    kicker: "Iron Arc · Pro club",
    title: fromTrial ? "Trial's done.<br>Pro carries on." : "Pro renewed.<br>Keep lifting.",
    blocks: [paragraphs(...lines), receiptHtml(payment)],
  });
  const text = [fromTrial ? "TRIAL'S DONE. PRO CARRIES ON." : "PRO RENEWED. KEEP LIFTING.", "", ...lines.map((l) => l.replace(" 💪", "")), "", ...receiptText(payment), "", "Lift heavy, recover well.", "Team Iron Arc"].join("\n");
  return { subject: fromTrial ? "Your trial's done: welcome to Pro for real 💪" : `Pro renewed 💪 Your ${plan} receipt`, html, text };
}

module.exports = { trialEndingEmail, cancelledEmail, renewedEmail };
