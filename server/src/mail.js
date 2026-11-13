// The three emails the server sends, through Cloudflare's Email Service.
// Plain words, plain text, one address: signin@populiverse.com.

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
