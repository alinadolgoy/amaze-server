import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../utils/supabase.js';

interface WorkoutExercise {
  id: string;
  name: string;
  weight: number;
  weightUnit: string;
  sets: number;
  reps: number;
  restDuration: number;
  completedSets?: Array<number | null>;
}

interface StartBody {
  presetName?: string;
  initialExercises?: WorkoutExercise[];
}

interface SyncBody {
  workoutId?: string;
  exercises?: WorkoutExercise[];
}

interface FinishBody {
  workoutId?: string;
  exercises?: Array<{
    name: string;
    weight: number;
    weightUnit?: string;
    sets: number;
    reps: number;
    completedSets?: Array<number | null>;
  }>;
}

export default async function liftRoutes(server: FastifyInstance) {
  
  /**
   * Helper to authenticate token and fetch user
   */
  async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies['sb-access-token'];
    if (!token) {
      reply.status(401).send({ error: 'Unauthorized: No active session cookie found.' });
      return null;
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      reply.status(401).send({ error: 'Unauthorized: Session invalid or expired.' });
      return null;
    }
    
    return user;
  }

  /**
   * 🕵️‍♂️ GET /api/lift/active
   * Checks if the user has an active workout session in progress.
   */
  server.get('/active', async (request, reply) => {
    const user = await authenticateRequest(request, reply);
    if (!user) return;

    try {
      const { data: activeWorkout, error } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Failed to retrieve active session.' });
      }

      return { activeWorkout };
    } catch (err: unknown) {
      server.log.error(err instanceof Error ? err.message : String(err));
      return reply.status(500).send({ error: 'An unexpected internal server error occurred.' });
    }
  });

  /**
   * 🚀 POST /api/lift/start
   * Starts a new active workout session in the database.
   */
  server.post<{ Body: StartBody }>('/start', async (request, reply) => {
    const user = await authenticateRequest(request, reply);
    if (!user) return;

    const { presetName, initialExercises } = request.body;

    if (!presetName) {
      return reply.status(400).send({ error: 'Preset name is required to start a workout.' });
    }

    try {
      // 1. Prevent duplicate active sessions by checking if one already exists
      const { data: existingActive } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (existingActive) {
        return { activeWorkout: existingActive, message: 'Returned existing active workout.' };
      }

      // 2. Insert new active session row
      const { data: newWorkout, error } = await supabase
        .from('workouts')
        .insert({
          user_id: user.id,
          preset_name: presetName,
          status: 'active',
          active_state: { exercises: initialExercises || [] }
        })
        .select()
        .single();

      if (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Failed to initialize active workout session.' });
      }

      server.log.info(`Started active workout "${presetName}" for user: ${user.email}`);
      return { activeWorkout: newWorkout };
    } catch (err: unknown) {
      server.log.error(err instanceof Error ? err.message : String(err));
      return reply.status(500).send({ error: 'An unexpected internal server error occurred.' });
    }
  });

  /**
   * 🔄 POST /api/lift/sync
   * Intercepts debounced changes and updates the active JSON state.
   */
  server.post<{ Body: SyncBody }>('/sync', async (request, reply) => {
    const user = await authenticateRequest(request, reply);
    if (!user) return;

    const { workoutId, exercises } = request.body;

    if (!workoutId || !exercises) {
      return reply.status(400).send({ error: 'Workout ID and exercises state are required.' });
    }

    try {
      const { error } = await supabase
        .from('workouts')
        .update({ active_state: { exercises } })
        .eq('id', workoutId)
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Failed to sync active state.' });
      }

      return { success: true, message: 'Workout state synced.' };
    } catch (err: unknown) {
      server.log.error(err instanceof Error ? err.message : String(err));
      return reply.status(500).send({ error: 'An unexpected internal server error occurred.' });
    }
  });

  /**
   * 🏁 POST /api/lift/finish
   * Converts the final JSON active state into relational history tables and marks it completed.
   */
  server.post<{ Body: FinishBody }>('/finish', async (request, reply) => {
    const user = await authenticateRequest(request, reply);
    if (!user) return;

    const { workoutId, exercises } = request.body;

    if (!workoutId || !exercises || !Array.isArray(exercises)) {
      return reply.status(400).send({ error: 'Workout ID and final exercises array are required.' });
    }

    try {
      // 1. Mark the workout header status as 'completed' and clear temporary JSON state
      const { error: headerError } = await supabase
        .from('workouts')
        .update({
          status: 'completed',
          active_state: null,
          completed_at: new Date().toISOString()
        })
        .eq('id', workoutId)
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (headerError) {
        server.log.error(headerError);
        return reply.status(500).send({ error: 'Failed to update workout status to completed.' });
      }

      // 2. Map exercises for batch relational insertion
      const exercisesToInsert = exercises.map(ex => ({
        workout_id: workoutId,
        name: ex.name,
        weight: ex.weight,
        weight_unit: ex.weightUnit || 'kg',
        sets: ex.sets,
        reps: ex.reps,
        completed_sets: ex.completedSets || []
      }));

      const { error: exercisesError } = await supabase
        .from('workout_exercises')
        .insert(exercisesToInsert);

      if (exercisesError) {
        server.log.error(exercisesError);
        return reply.status(500).send({ error: 'Failed to normalize completed exercises in database.' });
      }

      server.log.info(`Completed and normalized workout "${workoutId}" for user: ${user.email}`);
      return { success: true, message: 'Workout completed and logged successfully.' };
    } catch (err: unknown) {
      server.log.error(err instanceof Error ? err.message : String(err));
      return reply.status(500).send({ error: 'An unexpected internal server error occurred.' });
    }
  });

  /**
   * 📅 GET /api/lift/history
   * Queries the database for all completed workouts and their associated logged exercises.
   */
  server.get('/history', async (request, reply) => {
    const user = await authenticateRequest(request, reply);
    if (!user) return;

    try {
      const { data: history, error } = await supabase
        .from('workouts')
        .select(`
          id,
          preset_name,
          completed_at,
          created_at,
          workout_exercises (
            id,
            name,
            weight,
            weight_unit,
            sets,
            reps,
            completed_sets
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      if (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Failed to retrieve completed workouts history.' });
      }

      return { history };
    } catch (err: unknown) {
      server.log.error(err instanceof Error ? err.message : String(err));
      return reply.status(500).send({ error: 'An unexpected internal server error occurred.' });
    }
  });
}
