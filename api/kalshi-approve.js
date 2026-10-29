// POST /api/kalshi-approve — owner Face ID signs one Kalshi prod order. Logic and docs: lib/kalshi-approve.mjs
import { handleKalshiApprove } from '../lib/kalshi-approve.mjs';

export async function POST(request) {
  return handleKalshiApprove(request, process.env);
}
