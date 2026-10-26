// POST /api/rollcall — roll call, the whole loop. Logic and docs: lib/rollcall.mjs
import { handleRollCall } from '../lib/rollcall.mjs';

export async function POST(request) {
  return handleRollCall(request, process.env);
}
