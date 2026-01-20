import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE_NAME = 'session';

// Routes that require authentication
const protectedRoutes = ['/', '/api/data'];

// Routes that are always public
const publicRoutes = ['/login', '/register', '/api/auth'];

// Get session token from request cookies
function getSessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value || null;
}

// Verify JWT token (lightweight, Edge-compatible)
async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('Middleware: JWT_SECRET not available');
      return false;
    }

    const secretKey = new TextEncoder().encode(secret);
    await jwtVerify(token, secretKey);
    return true;
  } catch (error) {
    console.error('Middleware: Token verification failed', error);
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if route is public
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Check if route is protected
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  );

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Get session token
  const token = getSessionToken(request);

  if (!token) {
    console.log('Middleware: No token for', pathname);
    // No token - redirect to login for page routes, return 401 for API routes
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Verify token
  const isValid = await verifySessionToken(token);

  if (!isValid) {
    console.log('Middleware: Invalid token for', pathname);
    // Invalid token - redirect to login for page routes, return 401 for API routes
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Valid token - continue
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
