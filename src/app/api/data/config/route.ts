import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getConfigByUserId, updateConfig } from '@/lib/db';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const dbConfig = await getConfigByUserId(user.id);

    if (!dbConfig) {
      // Return default config if none exists
      return NextResponse.json({
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
      });
    }

    // Transform snake_case to camelCase
    return NextResponse.json({
      config: {
        bays: dbConfig.bays,
        levels: dbConfig.levels,
        bayWidth: dbConfig.bay_width,
        bayDepth: dbConfig.bay_depth,
        levelHeight: dbConfig.level_height,
        beamColor: dbConfig.beam_color,
        frameColor: dbConfig.frame_color,
        palletColor: dbConfig.pallet_color,
        crossbarColor: dbConfig.crossbar_color,
        wireDeckColor: dbConfig.wire_deck_color,
        showWireDecks: Boolean(dbConfig.show_wire_decks),
        showPallets: Boolean(dbConfig.show_pallets),
        palletFill: dbConfig.pallet_fill,
      },
    });
  } catch (error) {
    console.error('Get config error:', error);
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

    const { config } = await request.json();

    if (!config) {
      return NextResponse.json(
        { success: false, error: 'Config is required' },
        { status: 400 }
      );
    }

    await updateConfig(user.id, config);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update config error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
