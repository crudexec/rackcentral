import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { getRacksByUserId, saveRacks, RackData } from '@/lib/db';

// Default rack configuration
function createDefaultRack(id: string, name: string, x: number, z: number): RackData {
  return {
    id,
    name,
    position: { x, z },
    rotation: 0,
    config: {
      bays: 3,
      levels: 4,
      bayWidth: 2.7,
      bayDepth: 1.2,
      levelHeight: 1.5,
      beamColor: '#ff6b00',
      frameColor: '#4a90d9',
      palletColor: '#c4a574',
      crossbarColor: '#ff9500',
      wireDeckColor: '#666666',
      showWireDecks: true,
      showPallets: false,
      palletFill: 70,
    },
  };
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });
    }

    const userId = payload.userId as number;
    let racks = await getRacksByUserId(userId);

    // If no racks exist, return a default rack
    if (racks.length === 0) {
      racks = [createDefaultRack('rack-1', 'Rack 1', 0, 0)];
    }

    return NextResponse.json({
      success: true,
      racks,
    });
  } catch (error) {
    console.error('Error fetching racks:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch racks' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    console.log('PUT /api/data/racks - Starting');
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) {
      console.log('PUT /api/data/racks - No token');
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      console.log('PUT /api/data/racks - Invalid token');
      return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });
    }

    const userId = payload.userId as number;
    console.log('PUT /api/data/racks - User:', userId);

    const body = await request.json();
    const { racks } = body as { racks: RackData[] };

    if (!Array.isArray(racks)) {
      console.log('PUT /api/data/racks - Invalid racks data');
      return NextResponse.json({ success: false, error: 'Invalid racks data' }, { status: 400 });
    }

    console.log('PUT /api/data/racks - Saving', racks.length, 'racks');
    await saveRacks(userId, racks);

    console.log('PUT /api/data/racks - Success');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving racks:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: `Failed to save racks: ${errorMessage}` }, { status: 500 });
  }
}
