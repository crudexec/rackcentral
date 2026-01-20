import { NextResponse } from 'next/server';
import { createUser, getUserByEmail, createDefaultConfig } from '@/lib/db';
import { hashPassword, createToken, isValidEmail, isValidPassword } from '@/lib/auth';
import { setSessionCookie } from '@/lib/session';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format' },
        { status: 400 }
      );
    }

    if (!isValidPassword(password)) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'Email already registered' },
        { status: 409 }
      );
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const user = createUser(email, passwordHash);

    // Create default config for user
    createDefaultConfig(user.id);

    // Create session token
    const token = await createToken({ userId: user.id, email: user.email });

    // Create response with session cookie
    const response = NextResponse.json(
      {
        success: true,
        user: { id: user.id, email: user.email },
      },
      { status: 201 }
    );

    setSessionCookie(response, token);

    return response;
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
