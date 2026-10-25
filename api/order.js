// POST /api/order — locked "Send to crew". Logic and docs: lib/handlers.mjs
import { handleOrder } from '../lib/handlers.mjs';

export async function POST(request) {
  return handleOrder(request, process.env);
}
