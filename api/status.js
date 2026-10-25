// POST /api/status — locked, read-only "Crew status". Logic and docs: lib/status.mjs
import { handleStatus } from '../lib/status.mjs';

export async function POST(request) {
  return handleStatus(request, process.env);
}
