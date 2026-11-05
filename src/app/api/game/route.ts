import { createGame } from '../../../game/engine';
import { authenticate, databaseStore, insertGame } from '../../../server/supabase';
import { errorResponse } from '../../../server/errors';
import { readJson, validateCreate } from '../../../server/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const owner = await authenticate(request);
    const game = await databaseStore().read(owner);
    return Response.json({ state: game?.state ?? null, revision: game?.revision ?? 0, serverTime: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const owner = await authenticate(request);
    const input = validateCreate(await readJson(request));
    const state = await insertGame(owner, createGame(input.nickname, input.class, Date.now()));
    return Response.json({ state }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
