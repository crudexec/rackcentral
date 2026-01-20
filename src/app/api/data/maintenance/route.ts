import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getMaintenanceRecordsByUserId, saveMaintenanceRecords } from '@/lib/db';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const records = await getMaintenanceRecordsByUserId(user.id);

    // Group records by component_id
    const groupedRecords: Record<string, Array<{
      id: number;
      type: string;
      description: string;
      technician: string;
      status: string;
      timestamp: string;
      componentId: string;
      images: string[];
    }>> = {};

    for (const record of records) {
      if (!groupedRecords[record.component_id]) {
        groupedRecords[record.component_id] = [];
      }
      // Parse images from JSON string
      let images: string[] = [];
      try {
        images = record.images ? JSON.parse(record.images) : [];
      } catch {
        images = [];
      }
      groupedRecords[record.component_id].push({
        id: record.id,
        type: record.type,
        description: record.description,
        technician: record.technician || '',
        status: record.status,
        timestamp: record.timestamp,
        componentId: record.component_id,
        images,
      });
    }

    return NextResponse.json({ maintenanceRecords: groupedRecords });
  } catch (error) {
    console.error('Get maintenance records error:', error);
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

    const { maintenanceRecords } = await request.json();

    if (!maintenanceRecords) {
      return NextResponse.json(
        { success: false, error: 'Maintenance records are required' },
        { status: 400 }
      );
    }

    await saveMaintenanceRecords(user.id, maintenanceRecords);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Save maintenance records error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
