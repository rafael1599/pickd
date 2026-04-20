import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Extraer el body primero para ver si es un PING
    const body = await req.json();
    if (body.action === 'ping') {
      return new Response(
        JSON.stringify({ status: 'Connected', message: 'Function is reachable!' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // 2. Seguridad: Validar Token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'FUNC_ERROR: Missing Authorization Header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'FUNC_ERROR: Invalid or Expired Token', details: authError }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    // 3. Seguridad: Validar Rol Admin
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'FUNC_ERROR: Admin Role Required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    const { action, ...payload } = body;

    if (action === 'createUser') {
      const { email, password, full_name, role } = payload;
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (createError) throw createError;

      await adminClient
        .from('profiles')
        .update({
          role,
          full_name,
          email,
          created_by: user.id, // The admin who is making the request
        })
        .eq('id', newUser.user.id);

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 });
    } else if (action === 'updateUser') {
      const { userId, full_name, role, password, email, is_active } = payload;

      const profileUpdates: any = { full_name, role, email };
      if (typeof is_active === 'boolean') profileUpdates.is_active = is_active;

      const { error: profileError } = await adminClient
        .from('profiles')
        .update(profileUpdates)
        .eq('id', userId);
      if (profileError) throw profileError;

      const authUpdates: any = {};
      if (password) authUpdates.password = password;
      if (email) authUpdates.email = email;
      if (typeof is_active === 'boolean') {
        authUpdates.ban_duration = is_active ? 'none' : 'forever';
      }

      if (Object.keys(authUpdates).length > 0) {
        const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
          userId,
          authUpdates
        );
        if (authUpdateError) throw authUpdateError;
      }
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 });
    } else if (action === 'deleteUser') {
      await adminClient.auth.admin.deleteUser(payload.userId);
    } else {
      return new Response(JSON.stringify({ error: 'FUNC_ERROR: Invalid action' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: `FUNC_ERROR: ${error.message}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
