import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getComponentHealthByUserId, saveComponentHealth } from '@/lib/db';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const healthRecords = await getComponentHealthByUserId(user.id);

    // Transform to Record<string, string>
    const componentHealth: Record<string, string> = {};
    for (const record of healthRecords) {
      componentHealth[record.component_id] = record.health_status;
    }

    return NextResponse.json({ componentHealth });
  } catch (error) {
    console.error('Get component health error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { componentHealth } = await request.json();

    if (!componentHealth) {
      return NextResponse.json(
        { success: false, error: 'Component health is required' },
        { status: 400 }
      );
    }

    await saveComponentHealth(user.id, componentHealth);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Save component health error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
