import { handleAuthGateway } from '@/server/auth-gateway';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleAuthGateway;
export const POST = handleAuthGateway;
export const PUT = handleAuthGateway;
