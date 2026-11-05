import { authenticate, databaseStore } from '../../../server/supabase';
import { errorResponse } from '../../../server/errors';
import { readCheckpointJson, saveCheckpoint } from '../../../server/checkpoint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const owner = await authenticate(request);
    const result = await saveCheckpoint(databaseStore(), owner, await readCheckpointJson(request), Date.now());
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
