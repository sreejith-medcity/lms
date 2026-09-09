import { logout } from '@/server/session';

export async function GET() {
  await logout();
}

export async function POST() {
  await logout();
}
