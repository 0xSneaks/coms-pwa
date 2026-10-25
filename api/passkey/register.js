// POST /api/passkey/register — one-time owner passkey setup. Logic: lib/handlers.mjs
import { handleRegister } from '../../lib/handlers.mjs';

export async function POST(request) {
  return handleRegister(request, process.env);
}
