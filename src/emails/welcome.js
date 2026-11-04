/*
 * "Welcome to Iron Arc": sent once to every new account when its onboarding is
 * done (services/welcomeService.js). Three first steps, and Pro in one quiet
 * line. Same look as the Pro emails (emails/parts.js).
 */
const { C, escapeHtml, firstName, label, tickedCards, page } = require("./parts");

/** The first steps, as [title, text]. */
const FIRST_STEPS = [
  ["Log your first workout", "Tap + and pick an exercise. Next time, your last weight and reps are already filled in."],
  ["Build your AI plan", "Profile → AI plan. A week built around your days, equipment and experience. Free accounts get one new plan a month."],
  ["Set your reminders", "Profile → Notifications. One nudge on your training days, never about a workout you've already done."],
];

/** `trialAvailable`: this person can still start Pro's free trial. */
function welcomeEmail({ user, trialAvailable }) {
  const hello = `Hey ${firstName(user)}, welcome aboard. 💪 Iron Arc remembers every set, shows you when you've got stronger, and plans your training week around you.`;
  const pro = trialAvailable
    ? "Want more? Iron Arc Pro adds the AI coach chat and unlimited AI plans. Try it free for 7 days from Profile → Subscription."
    : "Want more? Iron Arc Pro adds the AI coach chat and unlimited AI plans. See it in Profile → Subscription.";

  const html = page({
    preheader: "Three quick steps to get your first week going.",
    kicker: "Iron Arc",
    title: "Welcome to<br>Iron Arc.",
    blocks: [
      `<p style="margin:0;">${escapeHtml(hello)}</p>`,
      `${label("Your first three reps")}${tickedCards(FIRST_STEPS)}`,
      `<span style="color:${C.soft};font-size:15px;line-height:22px;">${escapeHtml(pro)}</span>`,
    ],
    signOff: "See you at the bar.",
    footer: "You're getting this once, because you just set up your Iron Arc account. Questions? Just reply to this email.",
  });

  const text = [
    "WELCOME TO IRON ARC.",
    "",
    hello.replace(" 💪", ""),
    "",
    "Your first three reps:",
    ...FIRST_STEPS.map(([title, body]) => `- ${title}: ${body}`),
    "",
    pro,
    "",
    "See you at the bar.",
    "Team Iron Arc",
  ].join("\n");

  return { subject: "Welcome to Iron Arc 💪 Your first week starts here", html, text };
}

module.exports = { welcomeEmail };
