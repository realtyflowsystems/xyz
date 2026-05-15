// RealtyFlow Systems — Supabase Client Configuration
// Replace the placeholder values below after creating your Supabase project.
// Dashboard → Settings → API → copy Project URL and anon/public key.

const RFS = {
  supabaseUrl:  'https://wufmcymarbkrjzaqapuu.supabase.co',
  supabaseKey:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Zm1jeW1hcmJrcmp6YXFhcHV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDQyMzMsImV4cCI6MjA5NDE4MDIzM30.LKDGO75T-ph4tKrSDMA7uXBSgcFgXAlAZzlENmDHQk8', // Dashboard → Settings → API → anon/public key

  // Booking endpoint (same as supabaseUrl + /functions/v1/booking-create)
  bookingEndpoint() {
    return `${this.supabaseUrl}/functions/v1/booking-create`;
  },

  // Initialize Supabase JS client (loaded from CDN in pages that need it)
  // Usage: const sb = RFS.client();
  client() {
    if (!window.supabase) {
      console.error('Supabase JS not loaded. Add the CDN script before this file.');
      return null;
    }
    return window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
  },
};
