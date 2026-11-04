import { randomInt } from 'node:crypto';
import { authenticate, databaseStore } from '../../../server/supabase';
import { errorResponse } from '../../../server/errors';
import { readJson, validateCommand } from '../../../server/validation';
import { executeCommand } from '../../../server/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const owner = await authenticate(request);
    const { action, requestId } = validateCommand(await readJson(request));
    const state = await executeCommand(databaseStore(), owner, action, requestId, Date.now, () => randomInt(0x100000000) / 0x100000000);
    return Response.json({ state }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
