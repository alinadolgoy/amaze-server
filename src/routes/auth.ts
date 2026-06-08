import type { FastifyInstance } from 'fastify';
import { supabase } from '../utils/supabase.js';

interface LoginBody {
  email?: string;
  password?: string;
}

export default async function authRoutes(server: FastifyInstance) {
  
  /**
   * 🔑 POST /api/auth/login
   * Verifies email/password with Supabase and sets secure HttpOnly session cookies.
   */
  server.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required.' });
    }

    try {
      // 1. Authenticate with Supabase server-to-server
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error || !data.session) {
        return reply.status(401).send({ error: error?.message || 'Invalid email or password.' });
      }

      // 2. Set secure HttpOnly cookie containing the access_token (JWT)
      reply.setCookie('sb-access-token', data.session.access_token, {
        path: '/',
        httpOnly: true, // Guard against XSS
        secure: process.env.NODE_ENV === 'production', // True only on production HTTPS
        sameSite: 'lax', // Protect against CSRF
        maxAge: data.session.expires_in // Match token expiration duration (usually 1 hour)
      });

      // Also set the refresh token so the backend can refresh session when expired
      reply.setCookie('sb-refresh-token', data.session.refresh_token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 // 30 days
      });

      server.log.info(`Successful login for user: ${data.user?.email}`);

      return {
        message: 'Login successful',
        user: {
          id: data.user?.id,
          email: data.user?.email
        }
      };
    } catch (err: unknown) {
      server.log.error(err instanceof Error ? err.message : String(err));
      return reply.status(500).send({ error: 'An unexpected internal server error occurred.' });
    }
  });

  /**
   * 🚪 POST /api/auth/logout
   * Clears the session cookies in the browser.
   */
  server.post('/logout', async (request, reply) => {
    reply.clearCookie('sb-access-token', { path: '/' });
    reply.clearCookie('sb-refresh-token', { path: '/' });
    
    return { message: 'Logout successful' };
  });

  /**
   * 🕵️‍♂️ GET /api/auth/session
   * Verifies active cookie session and returns authenticated user info.
   */
  server.get('/session', async (request, reply) => {
    const token = request.cookies['sb-access-token'];
    const refreshToken = request.cookies['sb-refresh-token'];

    if (!token) {
      return reply.status(401).send({ authenticated: false, error: 'No active session cookie found.' });
    }

    try {
      // 1. Get user details from Supabase using the browser's JWT token
      let { data: { user }, error } = await supabase.auth.getUser(token);

      // 2. Token expired? Let's try silent auto-refreshing using the refresh token cookie
      if ((error || !user) && refreshToken) {
        server.log.info('Access token expired. Attempting silent session refresh...');
        
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: refreshToken
        });

        if (!refreshError && refreshData.session && refreshData.user) {
          // Successfully refreshed! Update cookies with new tokens
          user = refreshData.user;
          
          reply.setCookie('sb-access-token', refreshData.session.access_token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: refreshData.session.expires_in
          });

          reply.setCookie('sb-refresh-token', refreshData.session.refresh_token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60
          });

          server.log.info('Session successfully refreshed silently.');
        } else {
          // Refresh token failed or expired, clear cookies
          reply.clearCookie('sb-access-token', { path: '/' });
          reply.clearCookie('sb-refresh-token', { path: '/' });
          return reply.status(401).send({ authenticated: false, error: 'Session expired.' });
        }
      } else if (error || !user) {
        return reply.status(401).send({ authenticated: false, error: 'Session invalid or expired.' });
      }

      return {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email
        }
      };
    } catch (err: unknown) {
      server.log.error(err instanceof Error ? err.message : String(err));
      return reply.status(500).send({ error: 'An unexpected internal server error occurred.' });
    }
  });
}
