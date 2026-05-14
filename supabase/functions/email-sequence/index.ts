// email-sequence — RealtyFlow Systems
// Cold outbound engine. Replaces Make.com + GoHighLevel sequences.
// Runs daily via pg_cron. Sends next sequence step to contacts who are due.
//
// To schedule: Supabase Dashboard → Database → Extensions → enable pg_cron, then:
// select cron.schedule('email-sequence', '0 9 * * *',
//   $$select net.http_post(
//     url:='https://YOUR_PROJECT_ID.supabase.co/functions/v1/email-sequence',
//     headers:='{"Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
//   )$$
// );
//
// Import contacts via: Supabase Dashboard → Table Editor → sequence_contacts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date().toISOString();

  // Get all active contacts where next_email_at is now or overdue
  const { data: contacts, error } = await supabase
    .from("sequence_contacts")
    .select("*")
    .eq("status", "active")
    .lte("next_email_at", now)
    .limit(200); // safety cap per run

  if (error) {
    console.error("sequence contacts query:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!contacts?.length) {
    return new Response(JSON.stringify({ sent: 0, message: "No contacts due" }), { status: 200 });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY")!;
  let sent = 0;
  const errors: string[] = [];

  for (const contact of contacts) {
    const nextStepNumber = contact.current_step + 1;

    // Get next sequence step
    const { data: step } = await supabase
      .from("sequence_steps")
      .select("*")
      .eq("step_number", nextStepNumber)
      .eq("active", true)
      .single();

    if (!step) {
      // No more steps — mark complete
      await supabase
        .from("sequence_contacts")
        .update({ status: "completed" })
        .eq("id", contact.id);
      continue;
    }

    // Personalize
    const firstName = contact.name.split(" ")[0];
    const market    = contact.market ?? "your market";
    const subject   = personalize(step.subject, firstName, market);
    const html      = personalize(step.body_html, firstName, market);

    // Send via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "Erics at RealtyFlow <erics@realtyflow.xyz>",
        to:      [contact.email],
        subject,
        html,
        headers: { "X-RFS-Contact-Id": contact.id },
      }),
    });

    const resData = await res.json();

    if (!res.ok) {
      console.error("Resend error for", contact.email, resData);
      errors.push(contact.email);
      continue;
    }

    // Log sent email
    await supabase.from("email_log").insert({
      to_email:  contact.email,
      subject,
      type:      "sequence",
      resend_id: resData.id ?? null,
    });

    // Look up the step after next to calculate next send time
    const { data: futureStep } = await supabase
      .from("sequence_steps")
      .select("delay_days")
      .eq("step_number", nextStepNumber + 1)
      .eq("active", true)
      .single();

    const nextEmailAt = futureStep
      ? new Date(Date.now() + futureStep.delay_days * 86_400_000).toISOString()
      : null;

    await supabase
      .from("sequence_contacts")
      .update({
        current_step:  nextStepNumber,
        last_email_at: now,
        next_email_at: nextEmailAt,
        status:        futureStep ? "active" : "completed",
      })
      .eq("id", contact.id);

    sent++;
  }

  return new Response(
    JSON.stringify({ processed: contacts.length, sent, errors: errors.length }),
    { headers: { "Content-Type": "application/json" } }
  );
});

function personalize(template: string, firstName: string, market: string): string {
  return template
    .replace(/\{\{name\}\}/g, firstName)
    .replace(/\{\{market\}\}/g, market);
}
