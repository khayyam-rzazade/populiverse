// The emails the server sends, through Cloudflare's Email Service. Plain
// words, plain text, one address: signin@populiverse.com. Nothing a person
// typed ever goes into a subject line, and nothing is sent as HTML, so what a
// person typed stays text in every email.

const FOOTER = "\n\nPopuliVerse\nhttps://populiverse.com";

function send(env, to, subject, text) {
  return env.EMAIL.send({
    from: { name: "PopuliVerse", email: env.MAIL_FROM },
    to,
    subject,
    text: text + FOOTER
  });
}

export function sendCode(env, to, code) {
  return send(
    env,
    to,
    `Your PopuliVerse code: ${code}`,
    `Your code is ${code}\n\nIt works for 10 minutes. Type it on the page where you asked for it.\n\nIf you did not ask for a code, you can ignore this email. Nobody can sign in without it.`
  );
}

export function sendNotInvited(env, to) {
  return send(
    env,
    to,
    "PopuliVerse Workspace",
    `Someone asked to sign in to the PopuliVerse Workspace with this address.\n\nThe workspace is open by invitation for now, and this address is not on the list. If you would like to join, write to ${env.EDITOR_EMAIL}.\n\nIf you did not ask, you can ignore this email.`
  );
}

export function sendDeletionWarning(env, to, date) {
  return send(
    env,
    to,
    "Your PopuliVerse Workspace account",
    `Your account in the PopuliVerse Workspace has not been used for two years. It will be deleted on ${date}, with everything in it.\n\nTo keep it, sign in once before then at https://populiverse.com/workspace/. To keep a copy of your work, sign in and use Download Everything on your account page.`
  );
}

// A country's name from its two-letter code, or the code itself.
function countryName(code) {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

function answerWithOther(answer, typed) {
  if (!answer) return "";
  return answer === "Other" && typed ? `Other (${typed})` : answer;
}

// What a person typed, set two spaces in on every line, so that it can never
// pass for a line of the email itself.
function indented(text) {
  return String(text)
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
}

// One email to the editor for each answer of the feedback card (master plan,
// section 18, stage 2, batch 5, Part A).
export function sendFeedback(env, { who, answer, changed }) {
  const p = who.profile || {};
  const lines = [changed ? "A reader has changed their answer to the feedback card in the Workspace." : "A reader has answered the feedback card in the Workspace.", ""];
  if (who.guest) {
    lines.push("Who: a guest, with no name and no email.");
  } else {
    const name = [p.first_name || who.user.name, p.middle_name, p.surname].filter(Boolean).join(" ");
    lines.push(`Who: ${name}`, `Email: ${who.user.email}`);
    lines.push(`Institution: ${[p.institution, countryName(p.country)].filter(Boolean).join(", ") || "not given"}`);
    lines.push(`Position: ${answerWithOther(p.position, p.position_other) || "not given"}`);
    lines.push(`Field: ${answerWithOther(p.field, p.field_other) || "not given"}`);
    if (p.interests) lines.push(`Research interests: ${p.interests}`);
    if (p.commentary) lines.push(`Writing for the Commentary, at registration: ${p.commentary}`);
  }
  lines.push(
    "",
    `How useful: ${answer.score} of 5`,
    `Uses it for: ${answer.uses.length ? answer.uses.join(", ") : "nothing ticked"}`,
    `Would like to help: ${answer.help.length ? answer.help.join(", ") : "nothing ticked"}`,
    "",
    "What is missing or awkward:",
    answer.missing ? indented(answer.missing) : "  nothing written",
    "",
    "Every answer is also on Your Desk: https://populiverse.com/workspace/desk.html"
  );
  return send(env, env.EDITOR_EMAIL, `Feedback card: ${answer.score} of 5${changed ? ", changed" : ""}`, lines.join("\n"));
}

// The email of what is new (master plan, section 18, stage 2, batch 5, Part
// D). What is in it comes from the Monitor's own file and the Library's own
// list: the items' own words, their references and addresses, and a count of
// works with its address. It ends with why it came and the link that stops it.
export function sendDigest(env, to, firstName, news, stopLink, test) {
  const lines = [];
  if (test) lines.push("This is the test you asked for on Your Desk. Readers get the same email, built for what each of them follows.", "");
  lines.push(firstName ? `Hello ${firstName},` : "Hello,", "");
  lines.push(`PopuliVerse Monitor ${news.issue} is out. Here is what is new on the actors and countries you follow in your Workspace.`);
  for (const it of news.items) {
    lines.push("", it.heading, [it.ref, it.day, it.about.join(", ")].filter(Boolean).join(" · "), it.url);
  }
  for (const w of news.works) {
    lines.push("", `${w.n} new ${w.n === 1 ? "work" : "works"} on ${w.name} in the Library`, w.url);
  }
  lines.push(
    "",
    "Your Workspace is at https://populiverse.com/workspace/",
    "",
    "You get this email because you asked for it in your PopuliVerse Workspace. To stop it, open this link and press Stop the Email. You do not need to sign in.",
    stopLink
  );
  const subject = `${test ? "Test. " : ""}PopuliVerse Monitor ${news.issue} on what you follow`;
  return send(env, to, subject, lines.join("\n"));
}
