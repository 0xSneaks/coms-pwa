// GET /api/presence — public, read-only crew presence. Logic and docs: lib/presence.mjs
import { handlePresence } from '../lib/presence.mjs';

export async function GET(request) {
  return handlePresence(request, process.env);
}
