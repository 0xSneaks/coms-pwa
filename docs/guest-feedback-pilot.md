# AI COMS guest feedback — invite-only pilot

Status: DRAFT PR. Not deployed and not public submission ready.

## Purpose

Noah chats privately with his own Muse. Muse drafts one proposed idea, critique or bug report; Noah explicitly reviews and approves the specific text, then uses the feedback form. That submission is guest DATA, not a command.

## Pilot setup (owner-only; do not put codes or tokens in a chat or repository)

1. Merge only after independent review and passing CI. Existing COMS production passkey, orders and wallet approvals remain unchanged.
2. Configure GUEST_FEEDBACK_CODE_SHA256 as the lowercase SHA-256 hex digest of a strong random pilot invite code (minimum 20 characters; recommend 32+ random characters). Store the invite itself securely and share it privately with Noah. Never place the code in a URL, issue, commit, or screenshot.
3. Reuse the existing GITHUB_TOKEN authorized only for the AI COMS repo. Do not give Noah or his Muse this credential. The POST handler stores one file under feedback/inbox in the AI COMS repo.
4. After owner-approved deployment, send Noah the feedback form path /feedback.html and the invite code separately. Tell his Muse to summarize his critique without sending the rest of his private chat.
5. Noah checks the exact text and consent box, submits once, and gets a FB-* receipt.
6. Verify a matching file is present under feedback/inbox; verify BOARD.md and orders/ are unchanged. Muse reviews the file as untrusted feedback and recommends / parks / rejects. Only explicit owner instruction can promote it to work.

## Negative tests

npm run check runs tests for:
- valid IDEA/CRITIQUE/BUG submission stores feedback/inbox file only
- consent missing, invalid fields, wrong invite, wrong origin, cross-site and malformed bodies rejected
- duplicate sent once, and failure never represented as success
- malicious prompt-injection text remains quoted and untrusted, with no BOARD or orders writes
- rate limit rejection in simulated runtime

## Boundaries and limitations

- This pilot identifies an INVITE HOLDER, not the person Noah. A shared or stolen invite can impersonate him.
- Rate limiting is per warm server instance, not durable or distributed. Keep invitation secret; never use this endpoint as an open anonymous public intake.
- No automatic Muse-to-Muse connector is promised. The initial bridge is Noah's explicit copy/paste into the form.
- Private AI COMS repo stores the submitted summary. Do not submit secrets, private chat transcripts or personal records.
- No feedback action can send crypto transactions or issue deployment permissions.
- This code does not add a triage UI or automatic feedback ingestion. Muse can review GitHub feedback/inbox read-only after owner installs a separate review-only instruction.

## Before public Crypto Twitter rollout

Separate public submissions from privileged AI COMS services. Require durable per-sender limits, anti-bot challenges, abuse filtering, privacy and deletion policy, a moderation queue, and a human acceptance workflow. For launch, consider a dedicated public feedback service with minimal write-only credentials rather than reusing the agent coordination GitHub token. An independent security test must prove external text never becomes executable work. Owner explicitly approves deployment/public enablement as a separate action.

## Acceptance evidence

Code and tests alone are not a test *with Noah*. To claim that, obtain a feedback receipt from Noah's own action, independently verify the matching inbox entry, and verify his message was not promoted to an order. Without that evidence, live end-to-end status is UNKNOWN.
