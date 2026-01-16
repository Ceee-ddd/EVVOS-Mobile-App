// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = "https://zekbonbxwccgsfagrrph.supabase.co"
const supabaseServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpla2JvbmJ4d2NjZ3NmYWdycnBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODM5NDI5NSwiZXhwIjoyMDgzOTcwMjk1fQ.Ddpwys249qYzjlK-kNrZCzNhZ-7OX-RUUg74XnZxuOU" // Replace with actual service role key from dashboard
const supabase = createClient(supabaseUrl, supabaseServiceKey)

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()
    const {
      officer_id,
      status,
      location,
      duration,
      transcript,
      tags,
      alert,
      driver_name,
      plate_number,
      violations,
      notes,
      display_name,
      date_time,
    } = body

    // Validate required fields
    if (!officer_id || !driver_name || !plate_number) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Generate incident_id if not provided (for new inserts)
    let incident_id = body.incident_id;
    if (!incident_id) {
      const year = new Date().getFullYear();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      incident_id = `INCIDENT${year}${random}`;
    }

    const incidentData = {
      officer_id,
      status,
      location,
      duration,
      transcript,
      tags: tags || [],
      alert: alert || false,
      driver_name,
      plate_number,
      violations: violations || [],
      notes,
      display_name,
      incident_id,
      date_time,
    };

    let result;
    if (body.incident_id) {
      // Update existing
      result = await supabase
        .from('incidents')
        .update(incidentData)
        .eq('incident_id', body.incident_id);
    } else {
      // Insert new
      result = await supabase
        .from('incidents')
        .insert(incidentData);
    }

    const { data, error } = result;

    if (error) {
      console.error('Error inserting incident:', error)
      return new Response(JSON.stringify({ error: 'Failed to insert incident', details: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})