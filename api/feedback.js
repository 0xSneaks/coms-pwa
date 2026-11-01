// Invite-only guest feedback. Stores UNTRUSTED notes; does not create work orders.
import { handleFeedback } from '../lib/feedback.mjs';

export async function POST(request) {
  return handleFeedback(request, process.env);
}
